#!/usr/bin/env node
/**
 * Sert le site construit — pages statiques et routes d'API — sur Node seul.
 *
 *   npm run build && npm run serve
 *
 * Pourquoi ce script existe. Les deux autres adaptateurs supposent un
 * hébergeur précis : /functions pour celui qui découvre les routes par
 * l'arborescence, /netlify pour Netlify. Celui-ci ne suppose rien d'autre que
 * Node, ce qui couvre le reste — une machine, un conteneur, n'importe quelle
 * plateforme qui lance un processus. Il sert aussi d'essai local sans installer
 * l'outil d'un hébergeur.
 *
 * Ce n'est pas un serveur d'usage général : pas de compression, pas de cache
 * fin, pas de TLS. Derrière un proxy, c'est suffisant ; exposé seul sur
 * Internet, c'est un choix à assumer.
 *
 * Variables : lues dans l'environnement du processus, complétées par .dev.vars
 * puis .env quand ces fichiers existent — l'environnement réel l'emporte
 * toujours, pour qu'un fichier oublié en local ne masque pas la production.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

/** Le bundle vit dans node_modules : déjà ignoré par Git, déjà jetable. */
const bundle = join(root, 'node_modules', '.inline', 'api.mjs');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Charge un fichier de variables sans écraser ce qui est déjà défini. */
function loadVariables(file) {
  const path = join(root, file);
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

/**
 * Assemble src/lib/api.ts en un module que Node sait charger.
 *
 * Node ne lit pas le TypeScript, et `inline-core` est publié en source. Un
 * assemblage au démarrage évite d'ajouter une étape de compilation à la main —
 * il dure une fraction de seconde et se refait à chaque lancement, donc jamais
 * périmé.
 */
async function loadRoutes() {
  await build({
    entryPoints: [join(root, 'src', 'lib', 'api.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    packages: 'bundle',
    external: ['node:*'],
    logLevel: 'warning',
  });

  const { api } = await import(`${pathToFileURL(bundle).href}?t=${Date.now()}`);
  return api;
}

/** Résout une URL vers un fichier de dist/, sans jamais en sortir. */
async function resolveStaticFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  const candidate = resolve(dist, `.${normalize(decoded)}`);
  if (candidate !== dist && !candidate.startsWith(dist + sep)) return undefined;

  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
    if (info.isDirectory()) {
      const index = join(candidate, 'index.html');
      if (existsSync(index)) return index;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Traduit une requête Node en requête web. */
function toWebRequest(incoming, origin) {
  const hasBody = incoming.method !== 'GET' && incoming.method !== 'HEAD';

  return new Request(new URL(incoming.url, origin), {
    method: incoming.method,
    headers: incoming.headers,
    body: hasBody ? Readable.toWeb(incoming) : undefined,
    duplex: 'half',
  });
}

/** Et une réponse web en réponse Node — cookies multiples compris. */
async function sendWebResponse(response, outgoing) {
  const headers = Object.fromEntries(response.headers);
  delete headers['set-cookie'];

  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) headers['set-cookie'] = cookies;

  outgoing.writeHead(response.status, headers);
  outgoing.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
}

async function main() {
  loadVariables('.dev.vars');
  loadVariables('.env');

  if (!existsSync(dist)) {
    console.error('  ✗ dist/ est absent — lancer « npm run build » d\'abord.');
    process.exit(1);
  }

  const api = await loadRoutes();
  const port = Number(process.env.PORT ?? 8788);
  const host = process.env.HOST ?? '127.0.0.1';

  const server = createServer(async (incoming, outgoing) => {
    const origin = `http://${incoming.headers.host ?? `${host}:${port}`}`;
    const { pathname } = new URL(incoming.url, origin);

    try {
      if (api.find(pathname)) {
        const response = await api.handle(toWebRequest(incoming, origin), process.env);
        await sendWebResponse(response, outgoing);
        return;
      }

      const file = await resolveStaticFile(pathname);
      if (!file) {
        outgoing.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        outgoing.end('Page introuvable');
        return;
      }

      outgoing.writeHead(200, {
        'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      });
      outgoing.end(incoming.method === 'HEAD' ? undefined : await readFile(file));
    } catch {
      // Rien n'est journalisé ici : une exception peut porter une valeur
      // sensible, et la réponse utile est déjà celle d'`inline`.
      outgoing.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      outgoing.end('{"error":"erreur interne"}');
    }
  });

  server.listen(port, host, () => {
    console.log(`  → http://${host}:${port}`);
  });
}

main();
