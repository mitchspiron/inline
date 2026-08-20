/**
 * Les quatre routes, réunies en une table qu'aucun hébergeur ne connaît.
 *
 * Pourquoi ceci vit dans le paquet. Un site déclare ses routes une fois ; ce
 * sont les hébergeurs qui diffèrent, et ils diffèrent sur trois détails :
 * comment ils découvrent une route, comment ils nomment un gestionnaire,
 * comment ils passent les variables. Aucun de ces trois détails n'est une
 * décision du site — donc aucun ne justifie de recopier la logique de
 * répartition dans chaque site, ni de la réécrire à chaque changement
 * d'hébergeur.
 *
 * Ce que le site garde : sa configuration, une ligne.
 *
 *     export const api = createRouter({ locales: LOCALES });
 *
 * Ce que l'hébergeur ajoute : un adaptateur qui ne décide rien. Chez celui qui
 * découvre les routes par l'arborescence, il réexporte `api.routes['/api/…']` ;
 * chez celui qui attend un point d'entrée unique, il appelle `api.handle`.
 *
 * Rien ici ne dépend d'un hébergeur — règle 4. La convention de nommage
 * `onRequest<Méthode>` vient de l'un d'eux, mais elle n'engage rien : c'est un
 * nom de clé dans un objet, lisible par tous les autres.
 */
import { createAuthRoute } from './routes/auth';
import { createContentRoute } from './routes/content';
import { createSaveRoute } from './routes/save';
import { createUploadRoute } from './routes/upload';
import { json, type FunctionContext, type SiteConfig } from './guard';

export type RouteHandler = (context: FunctionContext) => Response | Promise<Response>;

/**
 * Les gestionnaires d'une route : `onRequest` pour le repli, et
 * `onRequest<Méthode>` pour chaque méthode servie.
 */
export type Route = Record<string, RouteHandler | undefined>;

/** Les chemins servis. Un site n'en ajoute pas : ce sont ceux de l'overlay. */
export const ROUTE_PATHS = ['/api/auth', '/api/content', '/api/save', '/api/upload'] as const;

export interface Router {
  /** La table, pour les hébergeurs qui veulent un fichier par route. */
  routes: Record<string, Route>;

  /** La route servant ce chemin, barre oblique finale ignorée. */
  find(pathname: string): Route | undefined;

  /** Le point d'entrée unique, pour tous les autres hébergeurs. */
  handle(request: Request, env: Record<string, unknown>): Promise<Response>;
}

/** `POST` → `onRequestPost`. */
function handlerName(method: string): string {
  return `onRequest${method.charAt(0).toUpperCase()}${method.slice(1).toLowerCase()}`;
}

export function createRouter(config: SiteConfig): Router {
  const routes: Record<string, Route> = {
    '/api/auth': createAuthRoute(),
    '/api/content': createContentRoute(config),
    '/api/save': createSaveRoute(config),
    '/api/upload': createUploadRoute(),
  };

  /**
   * `/api/save/` et `/api/save` désignent la même route : un hébergeur qui
   * normalise les URL ne doit pas faire disparaître une route.
   */
  function find(pathname: string): Route | undefined {
    const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    return routes[clean];
  }

  return {
    routes,
    find,

    /**
     * `env` porte ce que l'hébergeur expose : les variables, et les liaisons
     * éventuelles — dont `RATE_LIMIT`, sans laquelle le comptage des tentatives
     * retombe sur un compteur en mémoire (voir rate-limit.ts).
     *
     * Un chemin inconnu répond en JSON, jamais en HTML : l'appelant est
     * l'overlay, et une page d'erreur ne lui apprend rien.
     */
    async handle(request, env) {
      const route = find(new URL(request.url).pathname);
      if (!route) return json({ error: 'not_found' }, 404);

      const handler = route[handlerName(request.method)] ?? route.onRequest;
      if (!handler) return json({ error: 'method_not_allowed' }, 405);

      return handler({ request, env });
    },
  };
}
