/** Adaptateur de route — voir functions/api/auth.ts. */
import { createContentRoute } from 'inline-core/server';
import { LOCALES } from '../../src/lib/locales';

const route = createContentRoute({ locales: LOCALES });

export const onRequest = route.onRequest;
export const onRequestGet = route.onRequestGet;
