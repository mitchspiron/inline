/**
 * Ce qu'est un lien sûr — définition unique, partagée par le navigateur et la
 * fonction.
 *
 * Ce module n'a aucune dépendance : il est importé aussi bien par l'overlay
 * (où il pèse quelques centaines d'octets) que par l'assainissement serveur.
 * Deux définitions du même contrôle, c'est une divergence qui finit par
 * s'installer ; il n'y en a donc qu'une.
 *
 * La liste de caractères masquants est volontairement plus large que celle de
 * DOMPurify, pour deux raisons apprises à l'épreuve :
 *
 *  - U+FEFF n'y figure pas, ce qui laisse passer un « javascript: » coupé par
 *    cet espace de largeur nulle ; des navigateurs ont, par le passé,
 *    normalisé ces caractères dans les URL.
 *  - U+FFFD non plus, alors que c'est LE caractère à surveiller : un parseur
 *    HTML de navigateur remplace un octet nul par U+FFFD. Un attaquant écrit
 *    « java\0script: » ; l'analyseur de la fonction voit l'octet nul, le
 *    navigateur voit U+FFFD. Sans cette entrée, les deux côtés ne jugeaient
 *    pas le même lien — divergence trouvée par le corpus commun.
 */

const INVISIBLE = /[\u0000-\u0020\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2060\u3000\ufeff\ufffd]/g;

/** Les seuls protocoles acceptés dans un lien de contenu. */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function isSafeHref(href: string): boolean {
  if (typeof href !== 'string') return false;

  const cleaned = href.replace(INVISIBLE, '');
  if (cleaned.length === 0) return false;

  // Lien relatif, ancre ou requête : aucun protocole, donc aucun risque.
  if (/^[/#?]/.test(cleaned)) return true;

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);

  // Pas de protocole reconnaissable — mais si un caractère invisible en cachait
  // un, on le voit ici puisqu'ils ont été retirés avant l'analyse.
  if (!scheme) return true;

  return SAFE_SCHEMES.has(`${scheme[1].toLowerCase()}:`);
}
