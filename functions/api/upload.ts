/**
 * POST /api/upload → { src, width, height }
 *
 * Reçoit une image déjà recadrée et convertie par le navigateur, la vérifie,
 * la renomme et la range dans le dépôt. Le build en tirera ensuite AVIF, WebP
 * et le jeu de largeurs.
 *
 * Rien de ce que déclare l'appelant n'est cru : le type est reconnu aux octets,
 * les dimensions sont lues dans l'en-tête du fichier, le nom est réécrit.
 *
 * TODO lot 6 — limitation de débit.
 */
import { verifyAuth } from '../lib/auth';
import { createGitProvider, GitError } from '../lib/git-provider';
import {
  MAX_UPLOAD_BYTES,
  describeRejectedFormat,
  inspectImage,
  normalizeFileName,
  uniqueFileName,
} from '../lib/image';
import { json, resolveAuthor, type FunctionContext } from '../lib/guard';

/** Les fichiers vivent ici pour que `<Image />` puisse les traiter au build. */
const MEDIA_DIRECTORY = 'src/media';

/** Toute autre méthode est refusée explicitement. */
export function onRequest(): Response {
  return json({ error: 'method_not_allowed' }, 405);
}

export async function onRequestPost({ request, env }: FunctionContext): Promise<Response> {
  if (!(await verifyAuth(request, env))) {
    return json({ error: 'unauthorized' }, 401);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return json({ error: 'bad_request' }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return json({ error: 'too_large' }, 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  const info = inspectImage(bytes);
  if (!info) {
    // Dire ce qui a été reconnu permet un message clair à l'écran.
    const rejected = describeRejectedFormat(bytes);
    console.error(`[upload] format refusé : ${rejected ?? 'inconnu'}`);
    return json({ error: 'unsupported_format', kind: rejected ?? 'unknown' }, 415);
  }
  if (info.width < 1 || info.height < 1 || info.width > 10000 || info.height > 10000) {
    return json({ error: 'unsupported_format', kind: 'dimensions' }, 415);
  }

  const requested = typeof form.get('name') === 'string' ? String(form.get('name')) : 'image';
  const baseName = normalizeFileName(requested, info.format);

  try {
    const provider = await createGitProvider(env);

    // Un nom déjà pris ne doit jamais écraser l'image d'une autre page.
    const taken = new Set<string>();
    const candidate = uniqueFileName(baseName, (name) => taken.has(name));
    let finalName = candidate;
    let attempts = 0;

    while (attempts < 5) {
      try {
        await provider.readFile(`${MEDIA_DIRECTORY}/${finalName}`);
        taken.add(finalName);
        finalName = uniqueFileName(baseName, (name) => taken.has(name));
        attempts += 1;
      } catch (error) {
        if (error instanceof GitError && error.code === 'not_found') break;
        throw error;
      }
    }

    await provider.writeFile(
      `${MEDIA_DIRECTORY}/${finalName}`,
      bytes,
      '',
      `media: ajout de ${finalName}`,
      resolveAuthor(env),
    );

    return json({ src: finalName, width: info.width, height: info.height });
  } catch (error) {
    const code = error instanceof GitError ? error.code : 'unavailable';
    console.error(`[upload] écriture impossible (${code})`);
    if (code === 'conflict') return json({ error: 'conflict' }, 409);
    return json({ error: code }, 502);
  }
}
