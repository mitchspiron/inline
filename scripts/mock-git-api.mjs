#!/usr/bin/env node
/**
 * Faux service Git, pour essayer la chaîne complète sans dépôt distant.
 *
 *   node scripts/mock-git-api.mjs        écoute sur http://127.0.0.1:8787
 *
 * Il imite les deux seules routes utilisées de l'API Contents de GitHub et
 * écrit dans les fichiers du projet, en local. Utile pour vérifier l'édition,
 * la publication et le conflit de version sans dépendre du réseau.
 *
 * AIDE AU DÉVELOPPEMENT UNIQUEMENT — jamais déployé, jamais utilisé en
 * production. La version renvoyée est calculée comme un identifiant de blob
 * Git, donc elle change dès que le contenu change.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MOCK_PORT ?? 8787);

/** Identifiant de contenu, à la manière d'un blob Git. */
function blobId(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(payload);
}

/** N'accepte que des chemins du projet, jamais de remontée d'arborescence. */
function safePath(relative) {
  const target = normalize(join(root, relative));
  return target.startsWith(normalize(root)) ? target : null;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const match = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);

  if (!match) return send(response, 404, { message: 'route inconnue' });
  if (!request.headers.authorization) return send(response, 401, { message: 'jeton absent' });

  const file = safePath(decodeURIComponent(match[1]));
  if (!file) return send(response, 400, { message: 'chemin refusé' });

  if (request.method === 'GET') {
    try {
      const content = await readFile(file, 'utf8');
      return send(response, 200, {
        type: 'file',
        sha: blobId(content),
        content: Buffer.from(content, 'utf8').toString('base64'),
      });
    } catch {
      return send(response, 404, { message: 'fichier introuvable' });
    }
  }

  if (request.method === 'PUT') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const content = Buffer.from(body.content, 'base64').toString('utf8');

    let current = null;
    try {
      current = blobId(await readFile(file, 'utf8'));
    } catch {
      /* fichier neuf */
    }

    // Le cœur du verrou optimiste, côté service.
    if ((current ?? '') !== (body.sha ?? '')) {
      return send(response, 409, { message: 'la version fournie ne correspond plus au fichier' });
    }

    await writeFile(file, content, 'utf8');
    console.log(`  écrit  ${match[1]}  « ${body.message} »  (${body.committer?.email})`);
    return send(response, 200, { content: { sha: blobId(content) } });
  }

  return send(response, 405, { message: 'méthode non gérée' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Faux service Git en écoute sur http://127.0.0.1:${PORT}`);
  console.log('Renseignez GIT_API_BASE=http://127.0.0.1:8787 dans .dev.vars pour l\'utiliser.\n');
});
