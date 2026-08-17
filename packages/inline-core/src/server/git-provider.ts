/**
 * Couche d'abstraction du fournisseur Git.
 *
 * Le dépôt cible n'est pas arrêté. Tout le reste du code ignore s'il parle à
 * GitHub ou à GitLab : il ne connaît que ces deux opérations.
 *
 * `version` est l'empreinte opaque de l'état du fichier au moment de la
 * lecture. Elle sert au verrou optimiste et n'a pas la même nature d'un
 * fournisseur à l'autre — d'où l'abstraction.
 */

export interface GitAuthor {
  name: string;
  email: string;
}

export interface ReadResult {
  content: string;
  version: string;
}

export interface GitProvider {
  readFile(path: string): Promise<ReadResult>;
  /**
   * `content` accepte des octets pour les fichiers qui n'en sont pas —
   * une image téléversée. Un fichier neuf s'écrit avec `version` vide.
   */
  writeFile(
    path: string,
    content: string | Uint8Array,
    version: string,
    message: string,
    author: GitAuthor,
  ): Promise<{ version: string }>;
}

export interface GitConfig {
  /** « owner/repo » chez GitHub, « groupe/projet » chez GitLab. */
  repo: string;
  branch: string;
  token: string;
  /** Racine de l'API, surchargeable pour une instance auto-hébergée. */
  apiBase?: string;
}

export type GitErrorCode = 'conflict' | 'not_found' | 'unauthorized' | 'unavailable';

/**
 * Erreur d'un fournisseur. Ne transporte jamais le jeton : les messages sont
 * destinés aux journaux serveur, et le client ne reçoit qu'un code.
 */
export class GitError extends Error {
  code: GitErrorCode;

  constructor(code: GitErrorCode, message: string) {
    super(message);
    this.name = 'GitError';
    this.code = code;
  }
}

/** Encodage base64 sûr en UTF-8 (btoa seul casse les accents). */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Même encodage, pour un fichier qui n'est pas du texte. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // Par tranches : passer un tableau de plusieurs Mo à `apply` fait déborder
  // la pile d'appels.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(encoded: string): string {
  const binary = atob(encoded.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Construit le fournisseur d'après l'environnement. Le jeton est lu ici et
 * ne sort jamais de cette couche.
 */
export async function createGitProvider(env: Record<string, unknown>): Promise<GitProvider> {
  const name = String(env.GIT_PROVIDER ?? 'github').toLowerCase();

  const config: GitConfig = {
    repo: String(env.GIT_REPO ?? ''),
    branch: String(env.GIT_BRANCH ?? 'main'),
    token: String(env.GIT_TOKEN ?? ''),
    apiBase: env.GIT_API_BASE ? String(env.GIT_API_BASE) : undefined,
  };

  if (!config.repo || !config.token) {
    throw new GitError('unavailable', 'Configuration du dépôt incomplète (dépôt ou jeton absent).');
  }

  if (name === 'github') {
    const { createGitHubProvider } = await import('./github');
    return createGitHubProvider(config);
  }

  if (name === 'gitlab') {
    const { createGitLabProvider } = await import('./gitlab');
    return createGitLabProvider(config);
  }

  throw new GitError('unavailable', `Fournisseur Git inconnu : ${name}`);
}
