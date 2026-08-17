/**
 * Assainissement côté navigateur, par DOMPurify.
 *
 * Il y a un vrai DOM ici : c'est l'outil de référence, et il traite les
 * attaques par mutation qu'un analyseur syntaxique ne voit pas.
 *
 * Ce nettoyage-là est du confort : il évite qu'un collage depuis un traitement
 * de texte ne pollue l'écran. **Il ne fait pas autorité.** Ce qui décide de ce
 * qui entre dans le dépôt, c'est `functions/lib/sanitize.ts`, côté serveur.
 * Les deux implémentations sont comparées sur un même corpus par
 * `scripts/test-sanitize.mjs`.
 */
import DOMPurify from 'dompurify';
import { isSafeHref } from '../lib/safe-href';

const ALLOWED_TAGS = ['strong', 'em', 'a', 'br', 'ul', 'ol', 'li'];
const ALLOWED_ATTR = ['href'];

/** Mêmes protocoles que côté serveur : ni ftp, ni data, ni javascript. */
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|[^a-z+.-]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/**
 * DOMPurify ignore certains caractères invisibles que `isSafeHref` retire.
 * Ce passage applique la définition partagée, pour que navigateur et fonction
 * refusent exactement les mêmes liens.
 */
function dropUnsafeLinks(container: HTMLElement): void {
  for (const link of Array.from(container.querySelectorAll('a[href]'))) {
    if (!isSafeHref(link.getAttribute('href') ?? '')) link.removeAttribute('href');
  }
}

/**
 * Word écrit en `b` et `i` là où le modèle attend `strong` et `em`.
 * On renomme avant le nettoyage final, sinon l'intention du client — mettre
 * en gras — serait perdue au collage.
 */
function renameLegacyTags(container: HTMLElement): void {
  for (const [from, to] of [
    ['b', 'strong'],
    ['i', 'em'],
  ]) {
    for (const element of Array.from(container.querySelectorAll(from))) {
      const replacement = document.createElement(to);
      while (element.firstChild) replacement.appendChild(element.firstChild);
      element.replaceWith(replacement);
    }
  }
}

export function sanitizeRichtext(html: string): string {
  if (typeof html !== 'string' || html.length === 0) return '';

  // Premier passage : `b` et `i` sont tolérés le temps d'être renommés.
  const holder = document.createElement('div');
  holder.innerHTML = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS, 'b', 'i'],
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
  });

  renameLegacyTags(holder);
  dropUnsafeLinks(holder);

  // Second passage : la liste blanche stricte, celle du modèle de contenu.
  return DOMPurify.sanitize(holder.innerHTML, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
  });
}

/** Un champ texte est une chaîne : ni balise, ni retour à la ligne. */
export function sanitizeText(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  const holder = document.createElement('div');
  holder.innerHTML = DOMPurify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  return (holder.textContent ?? '').replace(/\s+/g, ' ').trim();
}
