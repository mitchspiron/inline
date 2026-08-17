/**
 * Assainissement du richtext, côté serveur — l'autorité.
 *
 * ─── Pourquoi pas DOMPurify ici ───────────────────────────────────────────
 * DOMPurify a besoin d'un DOM. Le runtime des fonctions n'en fournit pas, et
 * le DOM en JavaScript pur essayé (linkedom) n'expose ni
 * `document.implementation` ni `NodeFilter`. Dans ce cas, DOMPurify ne lève
 * PAS d'erreur : il passe `isSupported` à faux et `sanitize()` renvoie son
 * entrée telle quelle. Vérifié dans le runtime : un `<script>` et un
 * `href="javascript:"` ressortaient intacts. Un assainissement qui ne nettoie
 * rien sans le dire est pire que pas d'assainissement du tout.
 *
 * Ici, la sortie est reconstruite depuis l'analyse syntaxique : rien n'est
 * « retiré » d'une chaîne, seul ce qui figure dans la liste blanche est
 * réécrit. Tout le reste n'existe pas dans le résultat.
 *
 * La parité avec DOMPurify côté navigateur est vérifiée par
 * `scripts/test-sanitize.mjs`, qui soumet le même corpus aux deux
 * implémentations et compare les sorties.
 * ──────────────────────────────────────────────────────────────────────────
 */
import { Parser } from 'htmlparser2';
import { isSafeHref } from '../safe-href';

export { isSafeHref };

/** La liste blanche du modèle de contenu. Rien d'autre ne sort d'ici. */
export const ALLOWED_TAGS = ['strong', 'em', 'a', 'br', 'ul', 'ol', 'li'] as const;

/** Seul `a` porte un attribut, et un seul. */
const ALLOWED_ATTRIBUTES: Record<string, readonly string[]> = { a: ['href'] };

/** Balises sans fermeture. */
const VOID_TAGS = new Set(['br']);

/**
 * Balises dont le CONTENU disparaît aussi, et pas seulement la balise.
 * Ailleurs, une balise inconnue est déballée : le texte qu'elle entoure est
 * du contenu légitime.
 */
const DROP_CONTENT = new Set([
  'annotation-xml', 'audio', 'colgroup', 'desc', 'foreignobject', 'head',
  'iframe', 'math', 'mi', 'mn', 'mo', 'ms', 'mtext', 'noembed', 'noframes',
  'noscript', 'plaintext', 'script', 'style', 'svg', 'template', 'thead',
  'title', 'video', 'xmp',
]);

/** Word et consorts écrivent en `b` / `i` : on préserve l'intention. */
const RENAMED: Record<string, string> = { b: 'strong', i: 'em' };

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

/**
 * Reconstruit le fragment en ne conservant que la liste blanche.
 * Le résultat est sûr par construction, pas par soustraction.
 */
export function sanitizeRichtext(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return '';

  const output: string[] = [];
  /** Pile des balises ouvertes. Une chaîne vide = balise déballée. */
  const open: string[] = [];
  /** Profondeur dans une balise dont le contenu doit disparaître. */
  let dropping = 0;

  const parser = new Parser(
    {
      onopentag(rawName, attributes) {
        const name = RENAMED[rawName] ?? rawName;

        if (dropping > 0) {
          if (!VOID_TAGS.has(name)) dropping += 1;
          return;
        }
        if (DROP_CONTENT.has(rawName)) {
          dropping = 1;
          return;
        }
        if (!(ALLOWED_TAGS as readonly string[]).includes(name)) {
          if (!VOID_TAGS.has(name)) open.push('');
          return;
        }

        let rendered = `<${name}`;
        for (const attribute of ALLOWED_ATTRIBUTES[name] ?? []) {
          const value = attributes[attribute];
          if (typeof value !== 'string') continue;
          if (attribute === 'href' && !isSafeHref(value)) continue;
          rendered += ` ${attribute}="${escapeAttribute(value)}"`;
        }
        output.push(`${rendered}>`);

        if (!VOID_TAGS.has(name)) open.push(name);
      },

      ontext(text) {
        if (dropping > 0) return;
        output.push(escapeText(text));
      },

      onclosetag(rawName) {
        const name = RENAMED[rawName] ?? rawName;

        if (dropping > 0) {
          if (!VOID_TAGS.has(name)) dropping -= 1;
          return;
        }
        if (VOID_TAGS.has(name)) return;

        const emitted = open.pop();
        if (emitted) output.push(`</${emitted}>`);
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );

  parser.write(input);
  parser.end();

  // Une balise laissée ouverte par une entrée mal formée est refermée ici.
  while (open.length > 0) {
    const remaining = open.pop();
    if (remaining) output.push(`</${remaining}>`);
  }

  return output.join('');
}

/**
 * Un champ texte est une chaîne : aucune balise, aucun retour à la ligne.
 * On ne retire pas le balisage à coups d'expressions régulières : on ne
 * conserve que le texte reconnu par l'analyseur.
 */
export function sanitizeText(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return '';

  const parts: string[] = [];
  let dropping = 0;

  const parser = new Parser(
    {
      onopentag(name) {
        if (dropping > 0) {
          if (!VOID_TAGS.has(name)) dropping += 1;
        } else if (DROP_CONTENT.has(name)) {
          dropping = 1;
        }
      },
      ontext(text) {
        if (dropping === 0) parts.push(text);
      },
      onclosetag(name) {
        if (dropping > 0 && !VOID_TAGS.has(name)) dropping -= 1;
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );

  parser.write(input);
  parser.end();

  return parts.join('').replace(/\s+/g, ' ').trim();
}
