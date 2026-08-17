/**
 * Adaptateur de route. Toute la logique vit dans `inline-core` : identité,
 * limitation de débit, plafonds, chemins, schéma, verrou optimiste, écriture.
 *
 * Ce fichier n'existe que parce que l'hébergeur découvre les routes par
 * l'arborescence de /functions. Il ne doit jamais contenir de règle.
 */
import { createAuthRoute } from 'inline-core/server';

const route = createAuthRoute();

export const onRequest = route.onRequest;
export const onRequestPost = route.onRequestPost;
export const onRequestDelete = route.onRequestDelete;
