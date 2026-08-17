/**
 * Limitation de débit.
 *
 * Sans elle, une clé de site tombe en force brute : c'est le point de sécurité
 * le plus critique du projet, et la raison pour laquelle elle est livrée avec
 * l'authentification et non repoussée au durcissement.
 *
 * Le comptage a besoin d'un état partagé entre les instances de la fonction :
 * un compteur en mémoire se réinitialise à chaque démarrage à froid et n'est
 * pas vu par les autres instances. L'état est donc isolé derrière une
 * interface, comme le dépôt Git et l'authentification.
 */

export interface RateLimitStore {
  /** Incrémente le compteur de `key` et renvoie sa valeur dans la fenêtre courante. */
  increment(key: string, windowSeconds: number): Promise<number>;
}

export interface RateLimitResult {
  allowed: boolean;
  attempts: number;
}

/**
 * Compteur en mémoire — développement local et essais uniquement.
 *
 * Il ne survit pas à un redémarrage et n'est pas partagé entre instances : en
 * production, il laisserait passer une attaque distribuée sur plusieurs
 * instances. Ne jamais s'en contenter sur un site en ligne.
 */
export function createMemoryStore(): RateLimitStore {
  const counters = new Map<string, { count: number; expiresAt: number }>();

  return {
    async increment(key, windowSeconds) {
      const now = Date.now();
      const existing = counters.get(key);

      if (!existing || existing.expiresAt <= now) {
        counters.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
        return 1;
      }

      existing.count += 1;
      return existing.count;
    },
  };
}

interface KvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/**
 * Compteur sur un espace clé-valeur de l'hébergeur.
 *
 * Attention : ces espaces sont à cohérence différée. Deux tentatives quasi
 * simultanées peuvent lire le même compteur et n'en incrémenter qu'un. La
 * protection reste efficace contre une attaque par force brute — qui suppose
 * des milliers d'essais — mais n'est pas exacte à l'unité. Pour un comptage
 * strict, viser un stockage fortement cohérent (Durable Object ou équivalent).
 */
export function createKvStore(namespace: KvNamespace): RateLimitStore {
  return {
    async increment(key, windowSeconds) {
      const current = Number((await namespace.get(key)) ?? '0');
      const next = Number.isFinite(current) ? current + 1 : 1;
      await namespace.put(key, String(next), { expirationTtl: windowSeconds });
      return next;
    },
  };
}

/** Choisit le stockage disponible. La liaison de l'hébergeur prime toujours. */
export function resolveStore(env: Record<string, unknown>): RateLimitStore {
  const binding = env.RATE_LIMIT as KvNamespace | undefined;
  if (binding && typeof binding.get === 'function' && typeof binding.put === 'function') {
    return createKvStore(binding);
  }
  return sharedMemoryStore;
}

const sharedMemoryStore = createMemoryStore();

/**
 * Identifie l'appelant. L'en-tête varie d'un hébergeur à l'autre ; à défaut,
 * on retombe sur une valeur commune, qui limite alors globalement plutôt que
 * par appelant — plus strict, jamais plus permissif.
 */
export function clientIdentifier(request: Request): string {
  const direct = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip');
  if (direct) return direct;

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();

  return 'inconnu';
}

export async function checkRateLimit(
  request: Request,
  env: Record<string, unknown>,
  options: { bucket: string; limit: number; windowSeconds: number },
): Promise<RateLimitResult> {
  const store = resolveStore(env);
  const key = `${options.bucket}:${clientIdentifier(request)}`;
  const attempts = await store.increment(key, options.windowSeconds);
  return { allowed: attempts <= options.limit, attempts };
}
