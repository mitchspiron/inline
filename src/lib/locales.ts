/**
 * Les langues de CE site.
 *
 * C'est de la configuration, pas de la logique : la mécanique du repli de
 * traduction vit dans `inline-core`, la liste des langues vit ici. Un site
 * monolingue garde une seule entrée et n'a rien d'autre à changer.
 *
 * Ajouter une langue : voir le README, section « Ajouter une langue ». Trois
 * endroits à toucher, dont ce fichier.
 */
export { localePath, mergeWithDefault, type MergeResult } from 'inline-core/translate';

export const LOCALES = ['fr', 'en'] as const;
export const DEFAULT_LOCALE = 'fr';

export type Locale = (typeof LOCALES)[number];

/** Nom de la langue dans la langue elle-même — jamais un code à l'écran. */
export const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
