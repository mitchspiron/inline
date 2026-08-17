/**
 * POST /api/auth → ouvre une session à partir de la clé du site.
 * DELETE /api/auth → ferme la session.
 *
 * La clé n'est jamais stockée, jamais journalisée, jamais renvoyée. Seule son
 * empreinte vit côté serveur, et la comparaison se fait ici — jamais dans le
 * navigateur.
 *
 * Le message d'erreur est le même quelle que soit la cause : une clé fausse,
 * une clé absente et une configuration manquante se ressemblent vues du
 * client. Rien ne doit indiquer à un attaquant s'il approche.
 */
import { clearedCookies, createSession, sessionCookies } from '../lib/auth';
import { LIMITS, declaredBodyTooLarge, guardRate, json, type FunctionContext } from '../lib/guard';

/** Une clé raisonnable ne dépasse pas cette taille ; au-delà, on ne calcule rien. */
const MAX_KEY_LENGTH = 256;

/** Le corps attendu tient en une ligne : une clé et rien d'autre. */
const MAX_BODY = 2_000;

function refusal(): Response {
  return json({ error: 'clé incorrecte' }, 401);
}

export function onRequest(): Response {
  return json({ error: 'method_not_allowed' }, 405);
}

export async function onRequestPost({ request, env }: FunctionContext): Promise<Response> {
  // Compté avant toute vérification : une tentative reste une tentative,
  // qu'elle soit bien formée ou non.
  const limited = await guardRate(request, env, LIMITS.auth);
  if (limited) return limited;

  // Un corps démesuré ne sert qu'à faire travailler la fonction pour rien.
  if (declaredBodyTooLarge(request, MAX_BODY)) return refusal();

  let key = '';
  try {
    const body = (await request.json()) as { key?: unknown };
    if (typeof body.key === 'string') key = body.key;
  } catch {
    return refusal();
  }

  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return refusal();

  const token = await createSession(key, env);
  if (!token) return refusal();

  const response = json({ ok: true });
  for (const cookie of sessionCookies(token)) {
    response.headers.append('set-cookie', cookie);
  }
  return response;
}

export async function onRequestDelete(): Promise<Response> {
  const response = json({ ok: true });
  for (const cookie of clearedCookies()) {
    response.headers.append('set-cookie', cookie);
  }
  return response;
}
