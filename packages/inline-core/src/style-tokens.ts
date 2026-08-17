/**
 * Les valeurs de style autorisées — source unique.
 *
 * Le schéma Zod construit ses enums à partir d'ici, et la barre d'outils de
 * l'overlay construit ses boutons à partir d'ici. Il ne peut donc pas exister
 * de bouton proposant une valeur que le build refusera : les deux listes sont
 * la même liste.
 *
 * Ce module ne dépend de rien — surtout pas de Zod, qui n'a rien à faire dans
 * le paquet envoyé au navigateur.
 */

export const SIZES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl'] as const;
export const WEIGHTS = ['thin', 'light', 'regular', 'medium', 'semibold', 'bold'] as const;
export const ALIGNMENTS = ['left', 'center', 'right'] as const;
export const COLORS = ['primary', 'secondary', 'muted', 'accent', 'inverse'] as const;

export type Size = (typeof SIZES)[number];
export type Weight = (typeof WEIGHTS)[number];
export type Alignment = (typeof ALIGNMENTS)[number];
export type Color = (typeof COLORS)[number];

export interface StyleTokens {
  size: Size;
  weight: Weight;
  italic: boolean;
  align: Alignment;
  color: Color;
}

/** Les classes CSS correspondantes. Même correspondance au build et à l'écran. */
export function styleClasses(style: StyleTokens): string[] {
  return [
    `cms-size-${style.size}`,
    `cms-weight-${style.weight}`,
    style.italic ? 'cms-italic' : '',
    `cms-align-${style.align}`,
    `cms-color-${style.color}`,
  ].filter(Boolean);
}
