/** Adaptateur de route — voir functions/api/auth.ts. */
import { createUploadRoute } from 'inline-core/server';

const route = createUploadRoute();

export const onRequest = route.onRequest;
export const onRequestPost = route.onRequestPost;
