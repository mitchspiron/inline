/**
 * Adaptateur de route pour un hébergeur qui découvre les routes par
 * l'arborescence de /functions.
 *
 * Les routes sont déclarées dans src/lib/api.ts, une fois pour tous les
 * hébergeurs. Ce fichier n'existe que pour donner à celui-ci le chemin et les
 * noms d'export qu'il attend. Il ne doit jamais contenir de règle.
 */
import { api } from '../../src/lib/api';

const route = api.routes['/api/auth'];

export const onRequest = route.onRequest;
export const onRequestPost = route.onRequestPost;
export const onRequestDelete = route.onRequestDelete;
