/** Adaptateur de route — voir functions/api/auth.ts. */
import { createSaveRoute } from 'inline-core/server';
import { LOCALES } from '../../src/lib/locales';

const route = createSaveRoute({ locales: LOCALES });

export const onRequest = route.onRequest;
export const onRequestPost = route.onRequestPost;
