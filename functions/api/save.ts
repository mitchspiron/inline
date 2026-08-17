/**
 * POST /api/save → { version }
 *
 * Enchaînement, dans cet ordre, sans raccourci :
 *   1. la route est-elle ouverte ;
 *   2. le corps est-il de la bonne forme et sous le plafond de taille ;
 *   3. le chemin est-il dans la liste blanche ;
 *   4. le contenu passe-t-il le MÊME schéma Zod que le build ;
 *   5. la version détenue par l'éditeur est-elle toujours celle du dépôt ;
 *   6. écriture, attribuée à l'auteur.
 *
 * La validation côté overlay ne compte pour rien ici : tout est revérifié.
 *
 * L'identité n'est jamais évaluée ici : `verifyAuth` en est le seul juge.
 * TODO lot 6 — limitation de débit.
 */
import { pageSchema } from '../../src/content/schema';
import { verifyAuth } from '../lib/auth';
import { createGitProvider, GitError } from '../lib/git-provider';
import {
  MAX_CONTENT_BYTES,
  isAllowedPath,
  json,
  resolveAuthor,
  type FunctionContext,
} from '../lib/guard';

interface SavePayload {
  path: string;
  content: string;
  version: string;
  message: string;
}

/** Message de commit : préfixe imposé, corps borné, jamais recopié tel quel. */
function sanitizeMessage(message: unknown, path: string): string {
  const fallback = `content: ${path}`;
  if (typeof message !== 'string') return fallback;
  const cleaned = message.replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Toute autre méthode est refusée explicitement. */
export function onRequest(): Response {
  return json({ error: 'method_not_allowed' }, 405);
}

export async function onRequestPost({ request, env }: FunctionContext): Promise<Response> {
  if (!(await verifyAuth(request, env))) {
    return json({ error: 'not_found' }, 404);
  }

  let payload: Partial<SavePayload>;
  try {
    payload = (await request.json()) as Partial<SavePayload>;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  if (!isAllowedPath(payload.path)) {
    return json({ error: 'bad_request' }, 400);
  }
  if (typeof payload.content !== 'string' || typeof payload.version !== 'string') {
    return json({ error: 'bad_request' }, 400);
  }
  if (new TextEncoder().encode(payload.content).length > MAX_CONTENT_BYTES) {
    return json({ error: 'too_large' }, 413);
  }

  // Le même schéma qu'au build : un contenu qui casserait la production
  // n'entre pas dans le dépôt.
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.content);
  } catch {
    return json({ error: 'invalid_content' }, 422);
  }

  const validation = pageSchema.safeParse(parsed);
  if (!validation.success) {
    console.error('[save] contenu refusé par le schéma', validation.error.issues.slice(0, 5));
    return json({ error: 'invalid_content' }, 422);
  }

  try {
    const provider = await createGitProvider(env);

    // Verrou optimiste, vérifié explicitement avant l'écriture pour renvoyer
    // un conflit net quel que soit le fournisseur.
    const current = await provider.readFile(payload.path);
    if (current.version !== payload.version) {
      return json({ error: 'conflict' }, 409);
    }

    // On écrit la chaîne reçue telle quelle : elle dérive du fichier lu dans le
    // dépôt et seules les valeurs de texte y ont été remplacées. Ré-encoder
    // depuis l'objet validé supprimerait silencieusement toute clé que le
    // schéma ne connaît pas encore.
    const written = await provider.writeFile(
      payload.path,
      payload.content,
      payload.version,
      sanitizeMessage(payload.message, payload.path),
      resolveAuthor(env),
    );

    return json({ version: written.version });
  } catch (error) {
    const code = error instanceof GitError ? error.code : 'unavailable';
    console.error(`[save] écriture impossible (${code})`);
    if (code === 'conflict') return json({ error: 'conflict' }, 409);
    return json({ error: code }, 502);
  }
}
