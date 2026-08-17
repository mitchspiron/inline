/**
 * GET /api/content?path=… → { content, version }
 *
 * L'overlay appelle cette route au chargement pour connaître l'état réel du
 * dépôt et la version de référence du verrou optimiste. Le jeton reste ici :
 * la réponse ne contient que du contenu public et une empreinte.
 */
import { verifyAuth } from '../lib/auth';
import { createGitProvider, GitError } from '../lib/git-provider';
import { LIMITS, guardRate, isAllowedPath, json, type FunctionContext } from '../lib/guard';

/** Toute autre méthode est refusée explicitement. */
export function onRequest(): Response {
  return json({ error: 'method_not_allowed' }, 405);
}

export async function onRequestGet({ request, env }: FunctionContext): Promise<Response> {
  // Chaque lecture consomme le quota de l'API du dépôt : on borne, même pour
  // une session valide.
  const limited = await guardRate(request, env, LIMITS.content);
  if (limited) return limited;

  if (!(await verifyAuth(request, env))) {
    return json({ error: 'unauthorized' }, 401);
  }

  const path = new URL(request.url).searchParams.get('path');
  if (!isAllowedPath(path)) {
    return json({ error: 'bad_request' }, 400);
  }

  try {
    const provider = await createGitProvider(env);
    const { content, version } = await provider.readFile(path);
    return json({ content, version });
  } catch (error) {
    const code = error instanceof GitError ? error.code : 'unavailable';
    // Journalisé côté serveur uniquement, sans jeton ni contenu de session.
    console.error(`[content] lecture impossible (${code})`);
    return json({ error: code }, code === 'not_found' ? 404 : 502);
  }
}
