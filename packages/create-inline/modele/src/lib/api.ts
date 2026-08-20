/**
 * Les routes serveur de CE site.
 *
 * Comme locales.ts, c'est de la configuration et non de la logique : la
 * répartition — quel chemin, quelle méthode, quelle réponse — vit dans
 * `inline-core` et se met à jour avec lui. Ici, une ligne.
 *
 * Les adaptateurs d'hébergeur se branchent tous sur cet objet, et aucun ne
 * décide quoi que ce soit :
 *
 *   functions/api/*.ts         réexportent api.routes['/api/…']
 *   netlify/functions/api.mts  appelle api.handle
 *   scripts/serve.mjs          appelle api.handle
 *
 * Changer d'hébergeur ne touche donc ni au contenu, ni aux routes.
 */
import { createRouter } from 'inline-core/server';
import { LOCALES } from './locales';

export const api = createRouter({ locales: LOCALES });
