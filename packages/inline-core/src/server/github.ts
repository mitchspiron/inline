/**
 * Implémentation GitHub — API Contents.
 *
 * `version` = SHA du blob. GitHub refuse lui-même un PUT dont le `sha` ne
 * correspond plus à l'état du fichier : le verrou optimiste est donc appliqué
 * par le service, pas seulement par nous.
 */
import {
  GitError,
  fromBase64,
  bytesToBase64,
  toBase64,
  type GitAuthor,
  type GitConfig,
  type GitProvider,
  type ReadResult,
} from './git-provider';

const DEFAULT_API = 'https://api.github.com';

export function createGitHubProvider(config: GitConfig): GitProvider {
  const api = (config.apiBase ?? DEFAULT_API).replace(/\/$/, '');

  function endpoint(path: string): string {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    return `${api}/repos/${config.repo}/contents/${encodedPath}`;
  }

  function headers(): Record<string, string> {
    return {
      authorization: `Bearer ${config.token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'cms-front-editor',
    };
  }

  /** Traduit une réponse d'erreur sans jamais recopier d'en-tête ni de jeton. */
  async function fail(response: Response): Promise<never> {
    const body = await response.text().catch(() => '');
    const detail = body.slice(0, 300);

    if (response.status === 404) {
      throw new GitError('not_found', `Fichier ou dépôt introuvable. ${detail}`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new GitError('unauthorized', `Accès au dépôt refusé. ${detail}`);
    }
    // 409 : SHA périmé. 422 : GitHub renvoie parfois ce code pour le même motif.
    if (response.status === 409 || response.status === 422) {
      throw new GitError('conflict', `Version périmée. ${detail}`);
    }
    throw new GitError('unavailable', `Dépôt indisponible (${response.status}). ${detail}`);
  }

  return {
    async readFile(path: string): Promise<ReadResult> {
      const url = `${endpoint(path)}?ref=${encodeURIComponent(config.branch)}`;
      const response = await fetch(url, { headers: headers() });
      if (!response.ok) await fail(response);

      const body = (await response.json()) as { content?: string; sha?: string; type?: string };
      if (body.type !== 'file' || typeof body.content !== 'string' || !body.sha) {
        throw new GitError('not_found', 'La cible n\'est pas un fichier.');
      }

      return { content: fromBase64(body.content), version: body.sha };
    },

    async writeFile(
      path: string,
      content: string | Uint8Array,
      version: string,
      message: string,
      author: GitAuthor,
    ): Promise<{ version: string }> {
      const response = await fetch(endpoint(path), {
        method: 'PUT',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify({
          message,
          content: typeof content === 'string' ? toBase64(content) : bytesToBase64(content),
          // Un fichier neuf n'a pas de version à faire correspondre.
          ...(version ? { sha: version } : {}),
          branch: config.branch,
          committer: { name: author.name, email: author.email },
          author: { name: author.name, email: author.email },
        }),
      });
      if (!response.ok) await fail(response);

      const body = (await response.json()) as { content?: { sha?: string } };
      return { version: body.content?.sha ?? '' };
    },
  };
}
