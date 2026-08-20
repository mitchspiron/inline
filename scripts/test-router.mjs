#!/usr/bin/env node
/**
 * Répartition des routes : le même comportement quel que soit l'hébergeur.
 *
 *   node scripts/test-router.mjs
 *
 * Ce que ce contrôle protège. Un site peut être déposé chez trois hébergeurs
 * qui ne se ressemblent pas — l'un découvre les routes par l'arborescence,
 * l'autre veut un point d'entrée unique, le troisième n'est qu'un processus
 * Node. Si la répartition diverge d'un hébergeur à l'autre, le site marche ici
 * et échoue là, et rien dans son apparence ne le signale.
 *
 * Les deux formes exposées par `createRouter` sont donc comparées entre elles :
 * la table (`routes`) et le point d'entrée (`handle`) doivent répondre la même
 * chose à la même requête. Le reste — identité, débit, schéma — est couvert par
 * test-guard.mjs et n'est pas rejoué ici.
 */
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const workspace = await mkdtemp(join(tmpdir(), 'inline-router-'));
const outfile = join(workspace, 'router.mjs');

await build({
  entryPoints: [join(root, 'packages/inline-core/src/server/router.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile,
  logLevel: 'error',
});

const { createRouter, ROUTE_PATHS } = await import(pathToFileURL(outfile).href);

/** Les langues sont une décision du site : elles arrivent en paramètre. */
const api = createRouter({ locales: ['fr', 'en'] });

/** Aucune variable : sans configuration, une route refuse — elle n'explose pas. */
const NO_VARIABLES = {};

function request(method, path, body) {
  return new Request(`https://exemple.fr${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body,
  });
}

// --- La table couvre exactement les routes de l'overlay ------------------------
console.log('\nLa table');

check('les quatre routes sont déclarées', Object.keys(api.routes).length === 4);
for (const path of ROUTE_PATHS) {
  check(`${path} est servie`, typeof api.routes[path] === 'object');
}

// --- Résolution d'un chemin ----------------------------------------------------
console.log('\nRésolution');

check('un chemin connu est trouvé', api.find('/api/save') !== undefined);
check('la barre oblique finale est ignorée', api.find('/api/save/') !== undefined);
check('un chemin inconnu ne l\'est pas', api.find('/api/inexistant') === undefined);
check('la racine ne résout pas', api.find('/') === undefined);
check(
  'un préfixe partiel ne résout pas',
  api.find('/api') === undefined && api.find('/api/sav') === undefined,
);

// --- Méthodes ------------------------------------------------------------------
console.log('\nMéthodes');

const methodCases = [
  ['GET', '/api/auth', 405, 'une méthode non servie retombe sur le refus'],
  ['GET', '/api/save', 405, 'une route en écriture refuse la lecture'],
  ['POST', '/api/content', 405, 'une route en lecture refuse l\'écriture'],
  ['get', '/api/auth', 405, 'la casse de la méthode ne change rien'],
];

for (const [method, path, status, label] of methodCases) {
  const response = await api.handle(request(method, path), NO_VARIABLES);
  check(label, response.status === status, `reçu ${response.status}`);
}

const unknown = await api.handle(request('GET', '/api/inexistant'), NO_VARIABLES);
check('un chemin inconnu répond 404', unknown.status === 404);
check(
  'et répond en JSON, jamais en HTML',
  (unknown.headers.get('content-type') ?? '').includes('application/json'),
);

// --- Les deux formes s'accordent -----------------------------------------------
console.log('\nLa table et le point d\'entrée s\'accordent');

/**
 * Le cœur du contrôle : ce qu'obtient l'hébergeur qui réexporte un gestionnaire
 * depuis la table, et ce qu'obtient celui qui passe par `handle`, doit être la
 * même réponse. Sinon « ça marche en local » cesse de vouloir dire quelque
 * chose.
 */
const agreement = [
  ['POST', '/api/auth', 'onRequestPost', JSON.stringify({ key: 'mauvaise' })],
  ['DELETE', '/api/auth', 'onRequestDelete', undefined],
  ['GET', '/api/content?path=src/content/pages/fr/home.json', 'onRequestGet', undefined],
  ['POST', '/api/save', 'onRequestPost', JSON.stringify({})],
  ['POST', '/api/upload', 'onRequestPost', undefined],
  ['GET', '/api/auth', 'onRequest', undefined],
];

for (const [method, path, name, body] of agreement) {
  const viaHandle = await api.handle(request(method, path), NO_VARIABLES);

  const route = api.find(path.split('?')[0]);
  const viaTable = await route[name]({ request: request(method, path, body), env: NO_VARIABLES });

  check(
    `${method} ${path.split('?')[0]} : ${viaHandle.status} des deux côtés`,
    viaHandle.status === viaTable.status,
    `table ${viaTable.status}, entrée ${viaHandle.status}`,
  );
}

// --- Aucune fuite d'hébergeur --------------------------------------------------
console.log('\nAucun hébergeur n\'est tranché');

const source = await import('node:fs').then(({ readFileSync }) =>
  readFileSync(join(root, 'packages/inline-core/src/server/router.ts'), 'utf8'),
);

/**
 * Règle 4 : le paquet ne doit dépendre d'aucun hébergeur. Un nom de produit
 * dans ce fichier signalerait que le choix a fui dans le code partagé.
 */
for (const name of ['cloudflare', 'netlify', 'vercel', 'wrangler', 'lambda', 'deno']) {
  check(`« ${name} » n'apparaît pas`, !source.toLowerCase().includes(name));
}

await rm(workspace, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} contrôle(s) en échec.\n`);
  process.exit(1);
}
console.log('\nRépartition : tous les contrôles passent.\n');
