/**
 * Ce que `inline-core` expose aux fonctions serveur d'un site.
 *
 * Un site ne contient que des adaptateurs de trois lignes : une fabrique
 * appelée avec la configuration du site, et les gestionnaires réexportés sous
 * les noms qu'attend l'hébergeur. Toute la logique — identité, débit,
 * plafonds, chemins, schéma, verrou optimiste, écriture — vit ici et se met à
 * jour d'un seul coup pour tous les sites.
 *
 * Les deux points de couplage restent isolés, et deux seulement :
 *
 *   server/git-provider.ts   readFile / writeFile        (GitHub | GitLab)
 *   server/auth.ts           verifyAuth / createSession  (clé de site | délégué)
 */
export { createAuthRoute } from './routes/auth';
export { createContentRoute } from './routes/content';
export { createSaveRoute, sanitizeMessage } from './routes/save';
export { createUploadRoute } from './routes/upload';

export type { FunctionContext, SiteConfig } from './guard';
export {
  LIMITS,
  MAX_BODY_BYTES,
  MAX_CONTENT_BYTES,
  MEDIA_DIRECTORY,
  declaredBodyTooLarge,
  guardRate,
  isAllowedMediaFile,
  isAllowedPath,
  json,
  resolveAuthor,
} from './guard';

export { createSession, verifyAuth, verifyKey, sessionCookies, clearedCookies } from './auth';
export { createGitProvider, GitError, type GitProvider, type GitAuthor } from './git-provider';
export { sanitizeRichtext, sanitizeText, isSafeHref } from './sanitize';
export {
  MAX_UPLOAD_BYTES,
  describeRejectedFormat,
  inspectImage,
  normalizeFileName,
  uniqueFileName,
} from './image';
export {
  checkRateLimit,
  clientIdentifier,
  createMemoryStore,
  createKvStore,
  type RateLimitStore,
} from './rate-limit';
