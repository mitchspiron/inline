/**
 * Point unique de vérification d'identité.
 *
 * Aucun autre fichier du dépôt ne décide qui a le droit d'écrire. Les routes
 * appellent `verifyAuth` et rien d'autre : changer d'hébergeur ou de mécanisme
 * d'authentification ne doit toucher que ce fichier.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LOT 0 — il n'y a PAS d'authentification.
 *
 * L'accès est ouvert dès lors que l'exploitant a explicitement posé
 * EDITOR_ENABLED=true, et fermé sinon. Ce n'est pas une identité : c'est un
 * interrupteur, qui évite seulement qu'un déploiement par mégarde expose une
 * route d'écriture ouverte à tous.
 *
 * TODO lot 1 — remplacer par la clé de site :
 *   1. `createSession` compare la clé saisie à EDITOR_KEY_HASH (argon2id,
 *      variable d'environnement), en temps constant, et renvoie un cookie de
 *      session signé : HttpOnly, Secure, SameSite=Strict, 8 h.
 *   2. `verifyAuth` vérifie la signature et la fraîcheur de ce cookie.
 *   3. Limitation de débit sur /api/auth : 5 tentatives par IP par 15 min.
 *   4. Le hash n'est jamais servi au navigateur, jamais comparé côté client.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * L'écriture est-elle autorisée pour cette requête ?
 *
 * `env` s'ajoute à la signature du plan : la vérification du cookie aura besoin
 * du secret de signature, qui vit dans l'environnement de la fonction.
 */
export async function verifyAuth(
  _request: Request,
  env: Record<string, unknown>,
): Promise<boolean> {
  return String(env.EDITOR_ENABLED ?? '') === 'true';
}

/**
 * Ouvre une session à partir de la clé de site.
 * Renvoie la valeur du cookie à poser, ou `null` si la clé est refusée.
 */
export async function createSession(
  _key: string,
  _env: Record<string, unknown>,
): Promise<string | null> {
  // TODO lot 1 — argon2id + cookie signé. Voir l'en-tête de ce fichier.
  return null;
}
