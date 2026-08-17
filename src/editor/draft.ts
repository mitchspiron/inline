/**
 * Brouillon local. Les modifications sont conservées en continu : fermer
 * l'onglet sans publier ne perd rien.
 *
 * Ne contient QUE des valeurs de contenu — jamais de jeton, jamais d'identité.
 */

export interface Draft {
  savedAt: number;
  /** chemin dans le JSON → valeur saisie */
  fields: Record<string, string>;
}

const PREFIX = 'cms:draft:';

function key(file: string): string {
  return PREFIX + file;
}

export function readDraft(file: string): Draft | null {
  try {
    const raw = localStorage.getItem(key(file));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    if (!parsed || typeof parsed.fields !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeDraft(file: string, fields: Record<string, string>): void {
  try {
    if (Object.keys(fields).length === 0) {
      clearDraft(file);
      return;
    }
    const draft: Draft = { savedAt: Date.now(), fields };
    localStorage.setItem(key(file), JSON.stringify(draft));
  } catch (error) {
    // Quota plein ou stockage refusé : l'édition continue, sans filet local.
    console.warn('[editor] brouillon local indisponible', error);
  }
}

export function clearDraft(file: string): void {
  try {
    localStorage.removeItem(key(file));
  } catch {
    /* sans conséquence */
  }
}

export function formatSavedAt(timestamp: number): string {
  const date = new Date(timestamp);
  const sameDay = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `à ${time}` : `le ${date.toLocaleDateString('fr-FR')} à ${time}`;
}
