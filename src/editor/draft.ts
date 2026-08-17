/**
 * Brouillon local. Les modifications sont conservées en continu : fermer
 * l'onglet sans publier ne perd rien.
 *
 * Ne contient QUE des valeurs de contenu — jamais de clé, jamais de jeton,
 * jamais de cookie.
 */
import type { StyleTokens } from '../lib/style-tokens';

export interface FieldEdit {
  /** Texte ou balisage saisi. */
  value?: string;
  /** Tokens de style modifiés depuis la barre d'outils. */
  style?: Partial<StyleTokens>;
}

export interface Draft {
  savedAt: number;
  /** chemin dans le JSON → ce qui a été modifié */
  fields: Record<string, FieldEdit>;
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
    if (!parsed || typeof parsed.fields !== 'object' || parsed.fields === null) return null;

    // Brouillon écrit avant que les styles ne soient éditables : la valeur
    // était une simple chaîne. On le relit plutôt que de le jeter.
    const fields: Record<string, FieldEdit> = {};
    for (const [path, edit] of Object.entries(parsed.fields as Record<string, unknown>)) {
      if (typeof edit === 'string') fields[path] = { value: edit };
      else if (edit && typeof edit === 'object') fields[path] = edit as FieldEdit;
    }

    return { savedAt: parsed.savedAt, fields };
  } catch {
    return null;
  }
}

export function writeDraft(file: string, fields: Record<string, FieldEdit>): void {
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
