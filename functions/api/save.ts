/**
 * POST /api/save → { version }
 *
 * Enchaînement, dans cet ordre, sans raccourci :
 *   1. la route est-elle ouverte ;
 *   2. le corps est-il de la bonne forme et sous le plafond de taille ;
 *   3. le chemin est-il dans la liste blanche ;
 *   4. le contenu passe-t-il le MÊME schéma Zod que le build ;
 *   5. la version détenue par l'éditeur est-elle toujours celle du dépôt ;
 *   6. écriture, attribuée à l'auteur.
 *
 * La validation côté overlay ne compte pour rien ici : tout est revérifié.
 *
 * L'identité n'est jamais évaluée ici : `verifyAuth` en est le seul juge.
 * TODO lot 6 — limitation de débit.
 */
import { pageSchema } from '../../src/content/schema';
import { verifyAuth } from '../lib/auth';
import { sanitizeRichtext, sanitizeText } from '../lib/sanitize';
import { createGitProvider, GitError } from '../lib/git-provider';
import {
  MAX_CONTENT_BYTES,
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

/** Constructions qui ne sont jamais du contenu, quelle qu'en soit l'origine. */
const ATTACK = /<\s*(script|iframe|object|embed|form|svg|math)\b|\son[a-z]+\s*=|javascript\s*:|data\s*:\s*text\/html/i;

function containsAttack(node: unknown): boolean {
  if (typeof node === 'string') return ATTACK.test(node);
  if (node == null || typeof node !== 'object') return false;
  return Object.values(node as Record<string, unknown>).some(containsAttack);
}

/** Message de commit : préfixe imposé, corps borné, jamais recopié tel quel. */
function sanitizeMessage(message: unknown, path: string): string {
  const fallback = `content: ${path}`;
  if (typeof message !== 'string') return fallback;
  const cleaned = message.replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Toute autre méthode est refusée explicitement. */
export function onRequest(): Response {
  return json({ error: 'method_not_allowed' }, 405);
}

export async function onRequestPost({ request, env }: FunctionContext): Promise<Response> {
  if (!(await verifyAuth(request, env))) {
    return json({ error: 'unauthorized' }, 401);
  }

  let payload: Partial<SavePayload>;
  try {
    payload = (await request.json()) as Partial<SavePayload>;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  if (!isAllowedPath(payload.path)) {
    return json({ error: 'bad_request' }, 400);
  }
  if (typeof payload.content !== 'string' || typeof payload.version !== 'string') {
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

  // Puis on nettoie le reste — polices, classes, attributs de Word.
  sanitizeFields(parsed);

  const validation = pageSchema.safeParse(parsed);
  if (!validation.success) {
    console.error('[save] contenu refusé par le schéma', validation.error.issues.slice(0, 5));
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
