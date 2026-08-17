/**
 * Garde-fous communs aux fonctions d'écriture et de lecture.
 */
import type { GitAuthor } from './git-provider';

/** Contexte minimal d'une fonction de plateforme — évite une dépendance de types. */
export interface FunctionContext {
  request: Request;
  env: Record<string, unknown>;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/**
 * Liste blanche des chemins accessibles en écriture. Tout le reste du dépôt —
 * code, configuration, workflows — est hors d'atteinte.
 */
const ALLOWED_PATH = /^src\/content\/pages\/[a-z]{2}\/[a-z0-9-]+\.json$/;

export function isAllowedPath(path: unknown): path is string {
  return typeof path === 'string' && !path.includes('..') && ALLOWED_PATH.test(path);
}

/** Plafond de taille du contenu accepté (~100 Ko de JSON). */
export const MAX_CONTENT_BYTES = 100_000;

/**
 * Attribution du commit. Un site, un auteur.
 *
 * TODO lot 1 — renommer en EDITOR_NAME / EDITOR_EMAIL, conformément au plan.
 */
export function resolveAuthor(env: Record<string, unknown>): GitAuthor {
  return {
    name: String(env.EDITOR_AUTHOR_NAME ?? 'Éditeur du site'),
    email: String(env.EDITOR_AUTHOR_EMAIL ?? 'editeur@exemple.invalid'),
  };
}
