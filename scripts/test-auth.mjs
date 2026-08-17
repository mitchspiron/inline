#!/usr/bin/env node
/**
 * Contrôles de l'authentification et de la limitation de débit, en isolation.
 *
 *   node scripts/test-auth.mjs
 *
 * Aucun appel réseau, aucun serveur : on charge les modules de /functions/lib
 * et on les met à l'épreuve directement.
 */
import { build } from 'esbuild';
import { argon2id } from '@noble/hashes/argon2.js';
import { randomBytes } from 'node:crypto';
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

async function load(entry) {
  const dir = await mkdtemp(join(tmpdir(), 'inline-auth-'));
  const outfile = join(dir, 'module.mjs');
  await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile,
    logLevel: 'error',
  });
  return { module: await import(pathToFileURL(outfile).href), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Empreinte allégée : ces contrôles n'ont pas besoin du coût de production. */
const PARAMS = { m: 512, t: 1, p: 1 };
function makeHash(key) {
  const salt = randomBytes(16);
  const digest = argon2id(key, salt, { ...PARAMS, dkLen: 32 });
  return `$argon2id$v=19$m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}$${toBase64Url(salt)}$${toBase64Url(digest)}`;
}

const KEY = 'clé-de-site-correcte';
const SECRET = 'secret-de-signature-de-trente-deux-caracteres-au-moins';
const ENV = { EDITOR_KEY_HASH: makeHash(KEY), SESSION_SECRET: SECRET };

const requestWith = (cookie) =>
  new Request('https://exemple.fr/api/save', cookie ? { headers: { cookie } } : undefined);

// --- Authentification --------------------------------------------------------

const auth = await load('functions/lib/auth.ts');
const { verifyKey, createSession, verifyAuth, sessionCookies, clearedCookies, COOKIE_NAMES } =
  auth.module;

console.log('\nClé de site');
check('la bonne clé est reconnue', await verifyKey(KEY, ENV.EDITOR_KEY_HASH));
check('une clé fausse est refusée', !(await verifyKey('mauvaise clé', ENV.EDITOR_KEY_HASH)));
check('une clé vide est refusée', !(await verifyKey('', ENV.EDITOR_KEY_HASH)));
check(
  'une clé approchante est refusée',
  !(await verifyKey(KEY.slice(0, -1) + 'x', ENV.EDITOR_KEY_HASH)),
);
check('une empreinte illisible est refusée', !(await verifyKey(KEY, 'nimporte-quoi')));
check(
  'une empreinte d\'un autre algorithme est refusée',
  !(await verifyKey(KEY, '$bcrypt$v=19$m=1,t=1,p=1$c2VsCg$aGFzaAo')),
);

console.log('\nSession');
const token = await createSession(KEY, ENV);
check('une clé correcte ouvre une session', typeof token === 'string' && token.length > 0);
check('une clé fausse n\'ouvre rien', (await createSession('mauvaise', ENV)) === null);
check(
  'sans empreinte configurée, aucune session',
  (await createSession(KEY, { SESSION_SECRET: SECRET })) === null,
);
check(
  'sans secret de signature, aucune session',
  (await createSession(KEY, { EDITOR_KEY_HASH: ENV.EDITOR_KEY_HASH })) === null,
);

const cookieHeader = `${COOKIE_NAMES.session}=${token}`;
check('la session ouvre l\'accès', await verifyAuth(requestWith(cookieHeader), ENV));
check('aucun cookie, aucun accès', !(await verifyAuth(requestWith(null), ENV)));
check(
  'un jeton falsifié est refusé',
  !(await verifyAuth(requestWith(`${COOKIE_NAMES.session}=${token.slice(0, -3)}AAA`), ENV)),
);
check(
  'un jeton signé avec un autre secret est refusé',
  !(await verifyAuth(requestWith(cookieHeader), { ...ENV, SESSION_SECRET: SECRET.replace('a', 'b') })),
);
check(
  'changer le secret ferme les sessions ouvertes',
  !(await verifyAuth(requestWith(cookieHeader), { ...ENV, SESSION_SECRET: 'un-tout-autre-secret-de-trente-deux-caracteres' })),
);
check(
  'le témoin d\'édition seul ne donne aucun accès',
  !(await verifyAuth(requestWith(`${COOKIE_NAMES.marker}=1`), ENV)),
);
check(
  'un secret trop court ferme tout',
  !(await verifyAuth(requestWith(cookieHeader), { ...ENV, SESSION_SECRET: 'court' })),
);

// Expiration : on avance l'horloge de 8 h et une minute.
const realNow = Date.now;
Date.now = () => realNow() + (8 * 60 * 60 + 60) * 1000;
check('la session expire au bout de 8 h', !(await verifyAuth(requestWith(cookieHeader), ENV)));
Date.now = realNow;
check('avant 8 h, la session reste valable', await verifyAuth(requestWith(cookieHeader), ENV));

console.log('\nCookies');
const [session, marker] = sessionCookies(token);
check('le cookie de session est HttpOnly', session.includes('HttpOnly'));
check('le cookie de session est Secure', session.includes('Secure'));
check('le cookie de session est SameSite=Strict', session.includes('SameSite=Strict'));
check('la session dure 8 h', session.includes(`Max-Age=${8 * 60 * 60}`));
check('le témoin d\'édition est lisible par la page', !marker.includes('HttpOnly'));
check('le témoin ne contient aucun secret', /^inline_edit=1;/.test(marker));
check(
  'la déconnexion périme les deux cookies',
  clearedCookies().every((cookie) => cookie.includes('Max-Age=0')),
);

await auth.cleanup();

// --- Limitation de débit -----------------------------------------------------

const limiter = await load('functions/lib/rate-limit.ts');
const { checkRateLimit, clientIdentifier, createMemoryStore } = limiter.module;

console.log('\nLimitation de débit');
const from = (ip) => new Request('https://exemple.fr/api/auth', { headers: { 'cf-connecting-ip': ip } });
const options = { bucket: 'test-auth', limit: 5, windowSeconds: 900 };

const results = [];
for (let attempt = 0; attempt < 6; attempt += 1) {
  results.push(await checkRateLimit(from('203.0.113.7'), {}, options));
}
check('les 5 premières tentatives passent', results.slice(0, 5).every((r) => r.allowed));
check('la 6ᵉ est bloquée', results[5].allowed === false, `tentatives=${results[5].attempts}`);

const other = await checkRateLimit(from('203.0.113.9'), {}, options);
check('une autre adresse n\'est pas pénalisée', other.allowed);

check(
  'l\'adresse est lue dans l\'en-tête de l\'hébergeur',
  clientIdentifier(from('198.51.100.4')) === '198.51.100.4',
);
check(
  'à défaut d\'adresse, on limite globalement plutôt que pas du tout',
  clientIdentifier(new Request('https://exemple.fr/')) === 'inconnu',
);

const store = createMemoryStore();
await store.increment('fenetre', 1);
const before = await store.increment('fenetre', 1);
check('le compteur s\'incrémente dans la fenêtre', before === 2);

await limiter.cleanup();

if (failures > 0) {
  console.error(`\n${failures} contrôle(s) en échec.\n`);
  process.exit(1);
}
console.log('\nAuthentification : tous les contrôles passent.\n');
