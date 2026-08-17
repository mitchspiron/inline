/**
 * Garde-fous communs aux routes.
 *
 * Tout ce qui décide « cette requête a-t-elle le droit d'aller plus loin »
 * vit ici : budgets de débit, plafonds de taille, chemins autorisés. Un seul
 * endroit à relire pour savoir ce qui est ouvert et ce qui ne l'est pas.
 *
 * Ces contrôles ne remplacent pas `verifyAuth`, ils s'y ajoutent — et ils
 * passent *avant* lui : refuser un appelant qui insiste ne demande pas de
 * savoir qui il est.
 */
import type { GitAuthor } from './git-provider';
import { checkRateLimit } from './rate-limit';

/** Contexte minimal d'une fonction de plateforme — évite une dépendance de types. */
export interface FunctionContext {
  request: Request;
  env: Record<string, unknown>;
}

/**
 * Ce que le site doit dire à `inline` — et la totalité de ce qu'il doit dire.
 *
 * Tout le reste (budgets, plafonds, formats, schéma) est identique d'un site à
 * l'autre et vit dans le paquet. Si cette interface s'allonge, c'est le signe
 * qu'une décision du paquet a fuité vers les sites.
 */
export interface SiteConfig {
  /** Codes des langues du site. Un site monolingue en déclare une seule. */
  locales: readonly string[];
}

export function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

// --- Chemins ------------------------------------------------------------------

/**
 * Liste blanche des chemins accessibles en écriture. Tout le reste du dépôt —
 * code, configuration, workflows de déploiement — est hors d'atteinte, y
 * compris pour une session valide.
 *
 * Le segment de langue est restreint aux langues **déclarées par le site** :
 * sans cela, `src/content/pages/zz/home.json` créerait un dossier que rien ne
 * construit, et le dépôt se remplirait de contenus invisibles. Les langues
 * arrivent donc en paramètre — c'est la seule chose que le paquet ne peut pas
 * savoir tout seul.
 */
const cachedPatterns = new Map<string, RegExp>();

function pathPattern(locales: readonly string[]): RegExp {
  const key = locales.join('|');
  let pattern = cachedPatterns.get(key);
  if (!pattern) {
    pattern = new RegExp(`^src/content/pages/(?:${key})/[a-z0-9]+(?:-[a-z0-9]+)*\\.json$`);
    cachedPatterns.set(key, pattern);
  }
  return pattern;
}

/**
 * Le chemin est-il ouvert en lecture et en écriture ?
 *
 * L'expression n'accepte que des minuscules, des chiffres et des traits
 * d'union : un `..`, un antislash, un octet nul ou une séquence encodée
 * (`%2e%2e`) échouent d'eux-mêmes. Les refus explicites qui suivent ne sont
 * donc pas nécessaires — ils sont là pour que la règle reste vraie si
 * l'expression venait à s'assouplir.
 */
export function isAllowedPath(path: unknown, locales: readonly string[]): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 120) return false;
  if (path.includes('..') || path.includes('\\') || path.includes('%') || path.includes('\0')) {
    return false;
  }
  return pathPattern(locales).test(path);
}

/** Les médias vivent ici pour que `<Image />` puisse les traiter au build. */
export const MEDIA_DIRECTORY = 'src/media';

/**
 * Un nom de fichier média, et rien qui puisse servir à sortir du dossier.
 *
 * Même règle des deux côtés : ce que `/api/upload` accepte d'écrire est
 * exactement ce que `/api/save` accepte de voir référencé.
 */
const MEDIA_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(jpg|png|webp)$/;

export function isAllowedMediaFile(name: unknown): name is string {
  return typeof name === 'string' && name.length <= 100 && MEDIA_FILE.test(name);
}

// --- Tailles ------------------------------------------------------------------

/** Plafond du contenu JSON accepté (~100 Ko). */
export const MAX_CONTENT_BYTES = 100_000;

/** Plafond de l'enveloppe complète d'une requête JSON — contenu, chemin, message. */
export const MAX_BODY_BYTES = 128_000;

/**
 * Refuse d'après la taille annoncée, avant d'avoir lu le corps.
 *
 * L'en-tête peut mentir ou manquer : ce n'est pas la protection, c'est
 * l'économie. Le vrai plafond reste mesuré sur les octets reçus.
 */
export function declaredBodyTooLarge(request: Request, max: number): boolean {
  const declared = Number(request.headers.get('content-length'));
  return Number.isFinite(declared) && declared > max;
}

// --- Débit --------------------------------------------------------------------

export interface RateBudget {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

/**
 * Budgets de débit, tous visibles d'un coup d'œil.
 *
 * `auth` est le seul qui protège un secret : sans lui, la clé du site tombe en
 * force brute. Les autres protègent le dépôt et le quota de l'API Git contre
 * une session volée ou un script parti en boucle. Ils sont donc larges — un
 * humain qui édite sa page ne les approche jamais.
 */
export const LIMITS = {
  auth: { bucket: 'auth', limit: 5, windowSeconds: 15 * 60 },
  content: { bucket: 'content', limit: 60, windowSeconds: 5 * 60 },
  save: { bucket: 'save', limit: 30, windowSeconds: 5 * 60 },
  upload: { bucket: 'upload', limit: 30, windowSeconds: 15 * 60 },
} as const satisfies Record<string, RateBudget>;

/** Message d'attente en langage courant — jamais un code, jamais un compteur. */
function waitMessage(windowSeconds: number): string {
  if (windowSeconds <= 5 * 60) return 'Trop de demandes coup sur coup. Patientez quelques minutes, puis réessayez.';
  return 'Trop de tentatives. Réessayez dans un quart d\'heure.';
}

/**
 * Compte l'appel et renvoie la réponse de refus s'il est de trop, `null` sinon.
 *
 * À appeler en premier dans la route : une tentative reste une tentative,
 * qu'elle soit bien formée, authentifiée ou non.
 */
export async function guardRate(
  request: Request,
  env: Record<string, unknown>,
  budget: RateBudget,
): Promise<Response | null> {
  const { allowed } = await checkRateLimit(request, env, budget);
  if (allowed) return null;

  // Volontairement sans identifiant d'appelant : on ne journalise pas qui,
  // seulement que la route a refusé.
  console.warn(`[${budget.bucket}] débit dépassé`);
  return json({ error: waitMessage(budget.windowSeconds) }, 429, {
    'retry-after': String(budget.windowSeconds),
  });
}

// --- Divers -------------------------------------------------------------------

/** Attribution du commit. Un site, un auteur. */
export function resolveAuthor(env: Record<string, unknown>): GitAuthor {
  return {
    name: String(env.EDITOR_NAME ?? 'Éditeur du site'),
    email: String(env.EDITOR_EMAIL ?? 'editeur@exemple.invalid'),
  };
}
