/**
 * POST /api/save → { version }
 *
 * Enchaînement, dans cet ordre, sans raccourci :
 *   1. l'appelant n'a-t-il pas dépassé son débit ;
 *   2. la route est-elle ouverte ;
 *   3. le corps est-il de la bonne forme et sous le plafond de taille ;
 *   4. le chemin est-il dans la liste blanche ;
 *   5. le contenu passe-t-il le MÊME schéma Zod que le build ;
 *   6. la version détenue par l'éditeur est-elle toujours celle du dépôt ;
 *   7. écriture, attribuée à l'auteur.
 *
 * La validation côté overlay ne compte pour rien ici : tout est revérifié.
 *
 * L'identité n'est jamais évaluée ici : `verifyAuth` en est le seul juge.
 */
import { pageSchema } from '../../src/content/schema';
import { verifyAuth } from '../lib/auth';
import { sanitizeRichtext, sanitizeText } from '../lib/sanitize';
import { isValidVideoReference } from '../../src/lib/video';
import { createGitProvider, GitError } from '../lib/git-provider';
import {
  LIMITS,
  MAX_BODY_BYTES,
  MAX_CONTENT_BYTES,
  declaredBodyTooLarge,
  guardRate,
  isAllowedMediaFile,
  isAllowedPath,
  json,
  resolveAuthor,
  type FunctionContext,
} from '../lib/guard';

interface SavePayload {
  path: string;
  content: string;
  version: string;
  message: string;
}

/**
 * Assainit toutes les valeurs de champ, en place.
 *
 * L'overlay nettoie déjà côté navigateur, et ça ne compte pour rien : c'est
 * ici que se décide ce qui entre dans le dépôt. Un appel direct à cette route,
 * sans passer par l'interface, subit exactement le même traitement.
 */
function sanitizeFields(node: unknown): void {
  if (node == null || typeof node !== 'object') return;

  const record = node as Record<string, unknown>;
  if (record.type === 'richtext' && typeof record.value === 'string') {
    record.value = sanitizeRichtext(record.value);
    return;
  }
  if (record.type === 'text' && typeof record.value === 'string') {
    record.value = sanitizeText(record.value);
    return;
  }

  for (const child of Object.values(record)) sanitizeFields(child);
}

/**
 * Contrôles que le schéma ne peut pas exprimer.
 *
 * Zod dit que `src` est une chaîne non vide et que `provider` est dans une
 * liste ; il ne dit pas que `src` doit désigner un fichier du dossier des
 * médias, ni qu'un identifiant YouTube fait onze caractères.
 */
function mediaIsValid(node: unknown): boolean {
  if (node == null || typeof node !== 'object') return true;

  const record = node as Record<string, unknown>;
  if (record.type === 'media') {
    if (record.kind === 'image') {
      return isAllowedMediaFile(record.src);
    }
    if (record.kind === 'video') {
      return isValidVideoReference(String(record.provider), String(record.videoId));
    }
    return false;
  }

  return Object.values(record).every(mediaIsValid);
}

/**
 * Les identifiants d'items sont uniques dans leur liste.
 *
 * Le schéma valide leur forme, pas leur unicité. Deux items partageant un
 * identifiant casseraient la réconciliation DOM/JSON : l'éditeur écrirait dans
 * l'un et afficherait l'autre.
 */
function collectionIdsAreUnique(parsed: unknown): boolean {
  const collections = (parsed as { collections?: Record<string, unknown> })?.collections;
  if (!collections || typeof collections !== 'object') return true;

  for (const items of Object.values(collections)) {
    if (!Array.isArray(items)) return false;
    const seen = new Set<string>();
    for (const item of items) {
      const id = (item as { id?: unknown })?.id;
      if (typeof id !== 'string' || seen.has(id)) return false;
      seen.add(id);
    }
  }
  return true;
}

/** Constructions qui ne sont jamais du contenu, quelle qu'en soit l'origine. */
const ATTACK = /<\s*(script|iframe|object|embed|form|svg|math)\b|\son[a-z]+\s*=|javascript\s*:|data\s*:\s*text\/html/i;

function containsAttack(node: unknown): boolean {
  if (typeof node === 'string') return ATTACK.test(node);
  if (node == null || typeof node !== 'object') return false;
  return Object.values(node as Record<string, unknown>).some(containsAttack);
}

/**
 * Message de publication : borné, sur une seule ligne, jamais recopié tel quel.
 *
 * Un retour à la ligne y séparerait le titre du corps, et une suite de lignes
 * bien choisies laisserait un appelant écrire ce qu'il veut dans l'historique
 * du dépôt. Exporté pour être mis à l'épreuve directement.
 */
export function sanitizeMessage(message: unknown, path: string): string {
  const fallback = `content: ${path}`;
  if (typeof message !== 'string') return fallback;

  // Caractères de contrôle et de formatage confondus : pas seulement les
  // retours à la ligne, mais aussi les séparateurs Unicode et les marques
  // d'inversion de sens d'écriture, qui permettent d'afficher autre chose que
  // ce qui est écrit.
  const cleaned = message
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  return cleaned.length > 0 ? cleaned : fallback;
}

/** Toute autre méthode est refusée explicitement. */
export function onRequest(): Response {
  return json({ error: 'method_not_allowed' }, 405);
}

export async function onRequestPost({ request, env }: FunctionContext): Promise<Response> {
  // Avant l'identité : refuser un appelant qui insiste ne demande pas de
  // savoir qui il est, et une session volée ne doit pas pouvoir marteler
  // l'API du dépôt.
  const limited = await guardRate(request, env, LIMITS.save);
  if (limited) return limited;

  if (declaredBodyTooLarge(request, MAX_BODY_BYTES)) {
    return json({ error: 'too_large' }, 413);
  }

  if (!(await verifyAuth(request, env))) {
    return json({ error: 'unauthorized' }, 401);
  }

  // Lu en texte pour mesurer ce qui est réellement arrivé : l'en-tête de
  // taille peut mentir ou manquer, les octets non.
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json({ error: 'too_large' }, 413);
  }

  let payload: Partial<SavePayload>;
  try {
    payload = JSON.parse(raw) as Partial<SavePayload>;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return json({ error: 'bad_request' }, 400);
  }

  if (!isAllowedPath(payload.path)) {
    return json({ error: 'bad_request' }, 400);
  }
  if (typeof payload.content !== 'string' || typeof payload.version !== 'string') {
    return json({ error: 'bad_request' }, 400);
  }
  if (payload.version.length > 200) {
    return json({ error: 'bad_request' }, 400);
  }
  if (new TextEncoder().encode(payload.content).length > MAX_CONTENT_BYTES) {
    return json({ error: 'too_large' }, 413);
  }

  // Le même schéma qu'au build : un contenu qui casserait la production
  // n'entre pas dans le dépôt.
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.content);
  } catch {
    return json({ error: 'invalid_content' }, 422);
  }

  /**
   * Une tentative caractérisée est refusée, pas seulement nettoyée.
   *
   * Un collage depuis un traitement de texte n'apporte jamais ces
   * constructions — l'overlay les a déjà retirées. Les voir arriver ici
   * signifie que la route est appelée directement.
   */
  if (containsAttack(parsed)) {
    console.error('[save] contenu refusé : balisage manifestement hostile');
    return json({ error: 'invalid_content' }, 422);
  }

  if (!mediaIsValid(parsed)) {
    console.error('[save] contenu refusé : référence de média invalide');
    return json({ error: 'invalid_content' }, 422);
  }

  if (!collectionIdsAreUnique(parsed)) {
    console.error("[save] contenu refusé : identifiants d'items en double");
    return json({ error: 'invalid_content' }, 422);
  }

  // Puis on nettoie le reste — polices, classes, attributs de Word.
  sanitizeFields(parsed);

  const validation = pageSchema.safeParse(parsed);
  if (!validation.success) {
    // On journalise *où* et *pourquoi*, jamais la valeur reçue : les rapports
    // de Zod embarquent le contenu fautif, qui n'a rien à faire dans un
    // journal d'hébergeur.
    const where = validation.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(racine)'}: ${issue.code}`);
    console.error('[save] contenu refusé par le schéma', where);
    return json({ error: 'invalid_content' }, 422);
  }

  // Ce qui est écrit est exactement ce qui vient d'être validé et assaini.
  // On repart de l'objet analysé, et non du schéma : Zod supprimerait au
  // passage toute clé qu'il ne connaît pas encore.
  const content = `${JSON.stringify(parsed, null, 2)}\n`;

  try {
    const provider = await createGitProvider(env);

    // Verrou optimiste, vérifié explicitement avant l'écriture pour renvoyer
    // un conflit net quel que soit le fournisseur.
    const current = await provider.readFile(payload.path);
    if (current.version !== payload.version) {
      return json({ error: 'conflict' }, 409);
    }

    const written = await provider.writeFile(
      payload.path,
      content,
      payload.version,
      sanitizeMessage(payload.message, payload.path),
      resolveAuthor(env),
    );

    return json({ version: written.version });
  } catch (error) {
    const code = error instanceof GitError ? error.code : 'unavailable';
    console.error(`[save] écriture impossible (${code})`);
    if (code === 'conflict') return json({ error: 'conflict' }, 409);
    return json({ error: code }, 502);
  }
}
