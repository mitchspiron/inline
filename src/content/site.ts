/**
 * Configuration globale, validée au build.
 *
 * Un `site.json` invalide fait échouer le build, au même titre qu'une page :
 * il n'y a pas de raison qu'une navigation cassée passe et qu'un titre trop
 * long soit refusé.
 */
import raw from './site.json';
import { siteSchema, type Site } from './schema';

const parsed = siteSchema.safeParse(raw);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.')} : ${issue.message}`)
    .join('\n');
  throw new Error(`[site.json] configuration invalide :\n${details}`);
}

export const site: Site = parsed.data;
