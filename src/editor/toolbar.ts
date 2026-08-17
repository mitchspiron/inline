/**
 * Barre d'outils du champ en cours d'édition.
 *
 * Elle n'expose QUE les variantes du schéma : ses boutons sont construits à
 * partir de `src/lib/style-tokens.ts`, d'où le schéma Zod tire aussi ses
 * enums. Proposer une valeur que le build refuserait est donc impossible par
 * construction — il n'y a pas de liste à tenir à jour en double.
 *
 * Sur un champ richtext, il n'y a pas de tokens de style : la mise en forme est
 * dans le balisage, et les actions correspondent à la liste blanche
 * d'assainissement.
 */
import {
  ALIGNMENTS,
  COLORS,
  SIZES,
  WEIGHTS,
  type Alignment,
  type Color,
  type Size,
  type StyleTokens,
  type Weight,
} from '../lib/style-tokens';

/** Libellés en langage courant. Aucun nom de token n'apparaît à l'écran. */
const LABELS: Record<string, string> = {
  xs: 'Très petit', sm: 'Petit', base: 'Normal', lg: 'Grand',
  xl: 'Très grand', '2xl': 'Titre', '3xl': 'Grand titre',

  thin: 'Extra-fin', light: 'Fin', regular: 'Normal',
  medium: 'Moyen', semibold: 'Demi-gras', bold: 'Gras',

  left: 'À gauche', center: 'Centré', right: 'À droite',

  primary: 'Principale', secondary: 'Secondaire', muted: 'Discrète',
  accent: 'Accent', inverse: 'Claire',
};

export type StyleChange = Partial<StyleTokens>;
export type RichCommand = 'bold' | 'italic' | 'link' | 'bullets' | 'numbers';

export interface ToolbarHandlers {
  onStyle(change: StyleChange): void;
  onCommand(command: RichCommand): void;
}

export interface Toolbar {
  showForText(target: HTMLElement, style: StyleTokens): void;
  showForRichtext(target: HTMLElement): void;
  hide(): void;
  contains(node: Node): boolean;
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'cms-ui-tool';
  element.textContent = label;
  element.title = title;
  // `mousedown` plutôt que `click` : ne pas laisser le champ perdre le focus.
  element.addEventListener('mousedown', (event) => {
    event.preventDefault();
    onClick();
  });
  return element;
}

function group(title: string): HTMLElement {
  const element = document.createElement('div');
  element.className = 'cms-ui-tool-group';
  const label = document.createElement('span');
  label.className = 'cms-ui-tool-label';
  label.textContent = title;
  element.appendChild(label);
  return element;
}

export function createToolbar(handlers: ToolbarHandlers): Toolbar {
  const panel = document.createElement('div');
  panel.className = 'cms-ui-toolbar';
  panel.hidden = true;
  document.body.appendChild(panel);

  function place(target: HTMLElement): void {
    const box = target.getBoundingClientRect();
    panel.hidden = false;
    const own = panel.getBoundingClientRect();
    const top = box.top + window.scrollY - own.height - 10;
    panel.style.top = `${Math.max(window.scrollY + 8, top)}px`;
    panel.style.left = `${Math.max(8, box.left + window.scrollX)}px`;
  }

  function buildForText(style: StyleTokens): void {
    panel.replaceChildren();

    const sizes = group('Taille');
    for (const size of SIZES) {
      const control = button(LABELS[size], `Taille : ${LABELS[size]}`, () =>
        handlers.onStyle({ size: size as Size }),
      );
      control.setAttribute('aria-pressed', String(style.size === size));
      sizes.appendChild(control);
    }

    const weights = group('Épaisseur');
    for (const weight of WEIGHTS) {
      const control = button(LABELS[weight], `Épaisseur : ${LABELS[weight]}`, () =>
        handlers.onStyle({ weight: weight as Weight }),
      );
      control.setAttribute('aria-pressed', String(style.weight === weight));
      weights.appendChild(control);
    }

    const shape = group('Style');
    const italic = button('Italique', 'Mettre en italique', () =>
      handlers.onStyle({ italic: !style.italic }),
    );
    italic.setAttribute('aria-pressed', String(style.italic));
    shape.appendChild(italic);

    const alignments = group('Alignement');
    for (const align of ALIGNMENTS) {
      const control = button(LABELS[align], `Aligner ${LABELS[align]}`, () =>
        handlers.onStyle({ align: align as Alignment }),
      );
      control.setAttribute('aria-pressed', String(style.align === align));
      alignments.appendChild(control);
    }

    const colors = group('Couleur');
    for (const color of COLORS) {
      const control = button('', LABELS[color], () => handlers.onStyle({ color: color as Color }));
      control.classList.add('cms-ui-swatch');
      control.style.background = `var(--color-${color})`;
      control.setAttribute('aria-label', `Couleur : ${LABELS[color]}`);
      control.setAttribute('aria-pressed', String(style.color === color));
      colors.appendChild(control);
    }

    panel.append(sizes, weights, shape, alignments, colors);
  }

  function buildForRichtext(): void {
    panel.replaceChildren();
    const actions = group('Mise en forme');
    const commands: Array<[string, string, RichCommand]> = [
      ['Gras', 'Mettre en gras', 'bold'],
      ['Italique', 'Mettre en italique', 'italic'],
      ['Lien', 'Ajouter un lien', 'link'],
      ['Liste', 'Liste à puces', 'bullets'],
      ['Liste numérotée', 'Liste numérotée', 'numbers'],
    ];
    for (const [label, title, command] of commands) {
      actions.appendChild(button(label, title, () => handlers.onCommand(command)));
    }
    panel.append(actions);
  }

  return {
    showForText(target, style) {
      buildForText(style);
      place(target);
    },
    showForRichtext(target) {
      buildForRichtext();
      place(target);
    },
    hide() {
      panel.hidden = true;
    },
    contains(node) {
      return panel.contains(node);
    },
  };
}
