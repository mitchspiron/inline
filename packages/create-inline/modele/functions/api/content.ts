/** Adaptateur de route — voir functions/api/auth.ts. */
import { api } from '../../src/lib/api';

const route = api.routes['/api/content'];

export const onRequest = route.onRequest;
export const onRequestGet = route.onRequestGet;
