/**
 * Assainissement côté navigateur.
 *
 * Il y a un vrai DOM ici : DOMPurify est l'outil de référence, et il traite les
 * attaques par mutation qu'un analyseur syntaxique ne voit pas.
 *
 * Il est **chargé à la demande**, au premier champ richtext ouvert. Il pèse à
 * lui seul plus des deux tiers de l'overlay, et la plupart des sessions
 * d'édition ne touchent jamais à un champ richtext : le faire entrer dans le
 * paquet initial le ferait payer à tout le monde pour quelques-uns.
 *
 * Ce nettoyage est du confort : il évite qu'un collage depuis un traitement de
 * texte ne pollue l'écran. **Il ne fait pas autorité.** Ce qui décide de ce qui
 * entre dans le dépôt, c'est `functions/lib/sanitize.ts`. Les deux
 * implémentations sont comparées sur un même corpus par
 * `scripts/test-sanitize.mjs`.
 */
import { isSafeHref } from '../safe-href';

const ALLOWED_TAGS = ['strong', 'em', 'a', 'br', 'ul', 'ol', 'li'];
const ALLOWED_ATTR = ['href'];

/** Mêmes protocoles que côté serveur : ni ftp, ni data, ni javascript. */
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|[^a-z+.-]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/** Balises dont le contenu disparaît aussi — même liste que côté serveur. */
const DROP_CONTENT =
  'script,style,title,textarea,noscript,noembed,noframes,xmp,iframe,head,svg,math,template,video,audio,colgroup,thead,desc';

type Purifier = { sanitize(html: string, config: Record<string, unknown>): string };

let purifier: Purifier | null = null;
let loading: Promise<Purifier | null> | null = null;

/**
 * Charge DOMPurify. Appelé dès qu'un champ richtext est ouvert, bien avant
 * que le client n'ait eu le temps de coller quoi que ce soit.
 */
export function loadSanitizer(): Promise<Purifier | null> {
  if (purifier) return Promise.resolve(purifier);
  if (loading) return loading;

  loading = import('dompurify')
    .then((module) => {
      purifier = module.default as unknown as Purifier;
      return purifier;
    })
    .catch((error) => {
      console.warn('[editor] assainissement indisponible', error);
      return null;
    });

  return loading;
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

export async function sanitizeRichtext(html: string): Promise<string> {
  if (typeof html !== 'string' || html.length === 0) return '';

  const purify = await loadSanitizer();
  // Si la bibliothèque n'a pas pu être chargée, on retombe sur du texte seul :
  // moins riche, mais jamais dangereux. Le serveur tranchera de toute façon.
  if (!purify) return sanitizeText(html);

  // Premier passage : `b` et `i` sont tolérés le temps d'être renommés.
  const holder = document.createElement('div');
  holder.innerHTML = purify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS, 'b', 'i'],
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
  });

  renameLegacyTags(holder);
  dropUnsafeLinks(holder);

  // Second passage : la liste blanche stricte, celle du modèle de contenu.
  return purify.sanitize(holder.innerHTML, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
  });
}

/**
 * Un champ texte est une chaîne : ni balise, ni retour à la ligne.
 *
 * Pas besoin de DOMPurify ici : on analyse dans un `<template>`, dont le
 * contenu est inerte — aucune image ne se charge, aucun script ne s'exécute —
 * puis on ne garde que le texte.
 */
export function sanitizeText(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return '';

  const template = document.createElement('template');
  template.innerHTML = input;
  for (const node of Array.from(template.content.querySelectorAll(DROP_CONTENT))) {
    node.remove();
  }
  return (template.content.textContent ?? '').replace(/\s+/g, ' ').trim();
}
