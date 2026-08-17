/**
 * Langues du site et repli de traduction.
 *
 * Deux exigences qui semblent se contredire, et se complètent :
 *
 *  - une clé absente d'une locale **fait échouer `npm run check`**, pour
 *    qu'une traduction oubliée ne parte jamais en production ;
 *  - en attendant, la page affiche le texte de la langue par défaut plutôt
 *    qu'un trou, et le champ est marqué comme non traduit.
 *
 * Le repli n'est donc pas une tolérance : c'est ce qui rend une page
 * consultable pendant qu'on la traduit, sans masquer le travail restant.
 */

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

/** Adresse d'une page dans une locale donnée. */
export function localePath(locale: string, page: string): string {
  return page === 'home' ? `/${locale}/` : `/${locale}/${page}/`;
}

/**
 * Fusionne une locale avec la langue par défaut.
 *
 * Tout champ absent est repris de la référence et signalé ; la structure
 * renvoyée reste exactement celle du schéma, de sorte que les composants n'ont
 * rien à savoir du multilingue.
 */
export interface MergeResult<T> {
  data: T;
  /** Chemins des champs repris de la langue par défaut. */
  untranslated: string[];
}

function isField(node: unknown): node is Record<string, unknown> {
  return (
    node != null &&
    typeof node === 'object' &&
    typeof (node as Record<string, unknown>).type === 'string'
  );
}

function mergeNode(
  reference: unknown,
  translation: unknown,
  path: string[],
  untranslated: string[],
): unknown {
  // Un champ manquant est repris tel quel, et noté.
  if (translation === undefined) {
    if (isField(reference)) untranslated.push(path.join('.'));
    return structuredCloneish(reference);
  }

  if (isField(reference)) return translation;

  // Les listes se réconcilient par identifiant : un item traduit peut être
  // rangé différemment sans que les traductions ne glissent d'un item à l'autre.
  if (Array.isArray(reference)) {
    if (!Array.isArray(translation)) return structuredCloneish(reference);
    const byId = new Map(
      translation
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => [(entry as { id?: string }).id, entry]),
    );
    return reference.map((entry) => {
      const id = (entry as { id?: string })?.id;
      const match = byId.get(id);
      return match === undefined
        ? (untranslated.push([...path, String(id)].join('.')), structuredCloneish(entry))
        : mergeNode(entry, match, [...path, String(id)], untranslated);
    });
  }

  if (reference != null && typeof reference === 'object') {
    if (translation == null || typeof translation !== 'object') return structuredCloneish(reference);
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(reference as Record<string, unknown>)) {
      result[key] = mergeNode(
        value,
        (translation as Record<string, unknown>)[key],
        [...path, key],
        untranslated,
      );
    }
    return result;
  }

  return translation;
}

/** Copie profonde sans dépendre de `structuredClone`, absent de certains runtimes. */
function structuredCloneish<T>(value: T): T {
  return value == null || typeof value !== 'object' ? value : JSON.parse(JSON.stringify(value));
}

export function mergeWithDefault<T>(reference: T, translation: T | undefined): MergeResult<T> {
  const untranslated: string[] = [];
  if (translation === undefined) {
    return { data: structuredCloneish(reference), untranslated: ['*'] };
  }
  const data = mergeNode(reference, translation, [], untranslated) as T;
  return { data, untranslated };
}
