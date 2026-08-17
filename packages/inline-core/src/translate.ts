/**
 * Repli de traduction — la mécanique, pas la liste des langues.
 *
 * Quelles langues existent est une décision du site ; comment une traduction
 * partielle se comporte est une décision d'`inline`. Seule la seconde vit ici.
 *
 * Deux exigences qui semblent se contredire, et se complètent :
 *
 *  - une clé absente d'une locale **fait échouer `npm run check`**, pour
 *    qu'une traduction oubliée ne parte jamais en production ;
 *  - en attendant, la page affiche le texte de la langue de référence plutôt
 *    qu'un trou, et le champ est marqué comme non traduit.
 *
 * Le repli n'est donc pas une tolérance : c'est ce qui rend une page
 * consultable pendant qu'on la traduit, sans masquer le travail restant.
 */

/** Adresse d'une page dans une locale donnée. */
export function localePath(locale: string, page: string): string {
  return page === 'home' ? `/${locale}/` : `/${locale}/${page}/`;
}

export interface MergeResult<T> {
  data: T;
  /** Chemins des champs repris de la langue de référence. */
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

/**
 * Fusionne une traduction avec la langue de référence.
 *
 * La structure renvoyée reste exactement celle du schéma : les composants n'ont
 * rien à savoir du multilingue.
 */
export function mergeWithDefault<T>(reference: T, translation: T | undefined): MergeResult<T> {
  const untranslated: string[] = [];
  if (translation === undefined) {
    return { data: structuredCloneish(reference), untranslated: ['*'] };
  }
  const data = mergeNode(reference, translation, [], untranslated) as T;
  return { data, untranslated };
}
