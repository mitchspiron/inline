/**
 * Implémentation GitLab — non écrite.
 *
 * Le fournisseur cible n'est pas arrêté. La signature est posée pour que le
 * choix se fasse par la variable GIT_PROVIDER, sans toucher au reste du code.
 *
 * TODO — à savoir avant d'écrire cette implémentation :
 *
 * 1. Le chemin de fichier est un segment d'URL entièrement encodé, séparateurs
 *    compris : `src/content/pages/fr/home.json` devient
 *    `src%2Fcontent%2Fpages%2Ffr%2Fhome.json`. Encoder chaque segment
 *    séparément, comme pour GitHub, ne fonctionne pas.
 *      GET  /api/v4/projects/{id}/repository/files/{chemin encodé}?ref={branche}
 *      PUT  /api/v4/projects/{id}/repository/files/{chemin encodé}
 *
 * 2. `version` n'est PAS le SHA du blob mais le `last_commit_id` renvoyé par la
 *    lecture, à repasser tel quel à l'écriture. GitLab compare le dernier commit
 *    ayant touché le fichier, là où GitHub compare le contenu. Le verrou reste
 *    équivalent, mais la valeur n'est pas interchangeable : un brouillon ouvert
 *    avant un changement de fournisseur produirait un faux conflit.
 *
 * 3. L'identifiant de projet peut être numérique ou le chemin encodé
 *    (`groupe%2Fprojet`). GIT_REPO doit être encodé avant insertion dans l'URL.
 *
 * 4. Authentification : en-tête `PRIVATE-TOKEN`, pas `Authorization: Bearer`.
 *
 * 5. Conflit : GitLab répond 400 avec un message, là où GitHub répond 409.
 *    Traduire en GitError('conflict') pour que l'appelant reste inchangé.
 *
 * 6. L'attribution du commit passe par `author_email` / `author_name` dans le
 *    corps de la requête.
 */
import { GitError, type GitConfig, type GitProvider } from './git-provider';

export function createGitLabProvider(_config: GitConfig): GitProvider {
  throw new GitError(
    'unavailable',
    'Fournisseur GitLab non implémenté — voir functions/lib/gitlab.ts.',
  );
}
