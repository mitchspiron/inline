/** Adaptateur de route — voir functions/api/auth.ts. */
import { api } from '../../src/lib/api';

const route = api.routes['/api/save'];

export const onRequest = route.onRequest;
export const onRequestPost = route.onRequestPost;
