#!/usr/bin/env node
/**
 * Durcissement : ce que les routes refusent, et à quel moment elles le refusent.
 *
 *   node scripts/test-guard.mjs
 *
 * Deux niveaux. D'abord les règles en isolation — chemins ouverts, noms de
 * médias, plafonds, budgets de débit. Ensuite les routes elles-mêmes, appelées
 * directement : c'est le seul moyen de vérifier l'*ordre* des contrôles, or
 * l'ordre est la moitié du sujet. Un plafond de taille placé après la lecture
 * du corps ne protège de rien.
 */
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findLeaks, evaluatedPart } from './check-logs.mjs';
import { hydratedIslands } from './check-html.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const workspace = await mkdtemp(join(tmpdir(), 'inline-guard-'));
let loaded = 0;

async function load(entry) {
  const outfile = join(workspace, `module-${(loaded += 1)}.mjs`);
  await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile,
    logLevel: 'error',
  });
  return import(pathToFileURL(outfile).href);
}

const guard = await load('packages/inline-core/src/server/guard.ts');

/**
 * Les langues sont une décision du site, pas du paquet : elles arrivent en
 * paramètre. Un site monolingue en déclare une seule.
 */
const LOCALES = ['fr', 'en'];

// --- Chemins ouverts en écriture -----------------------------------------------
console.log('\nChemins ouverts en écriture');

for (const path of [
  'src/content/pages/fr/home.json',
  'src/content/pages/en/home.json',
  'src/content/pages/fr/mentions-legales.json',
]) {
  check(`« ${path} » est accepté`, guard.isAllowedPath(path, LOCALES));
}

for (const [label, path] of [
  ['une remontée d\'arborescence', 'src/content/pages/fr/../../../.env'],
  ['une remontée encodée', 'src/content/pages/fr/%2e%2e/home.json'],
  ['un antislash', 'src\\content\\pages\\fr\\home.json'],
  ['un antislash au milieu', 'src/content/pages/fr\\home.json'],
  ['un octet nul', 'src/content/pages/fr/home.json\u0000'],
  ['un chemin absolu', '/src/content/pages/fr/home.json'],
  ['un sous-dossier', 'src/content/pages/fr/blog/article.json'],
  ['une majuscule', 'src/content/pages/fr/Home.json'],
  ['une autre extension', 'src/content/pages/fr/home.yaml'],
  ['aucune extension', 'src/content/pages/fr/home'],
  ['le code de l\'application', 'src/pages/admin.astro'],
  ['la configuration de déploiement', '.github/workflows/deploy.yml'],
  ['la configuration de l\'hébergeur', 'wrangler.toml'],
  ['le schéma lui-même', 'src/content/schema.ts'],
  ['la racine du contenu', 'src/content/pages/fr/'],
  ['un tiret en tête', 'src/content/pages/fr/-home.json'],
  ['un double tiret', 'src/content/pages/fr/a--b.json'],
  ['un nom démesuré', `src/content/pages/fr/${'a'.repeat(200)}.json`],
  ['une chaîne vide', ''],
  ['un nombre', 42],
  ['un objet', { toString: () => 'src/content/pages/fr/home.json' }],
  ['une valeur absente', undefined],
]) {
  check(`${label} : refusé`, !guard.isAllowedPath(path, LOCALES));
}

// Le segment de langue est restreint aux langues déclarées : autrement, une
// écriture créerait un dossier que rien ne construit.
check(
  'une langue non déclarée est refusée',
  !guard.isAllowedPath('src/content/pages/de/home.json', LOCALES),
);
check(
  'un code de langue trop long est refusé',
  !guard.isAllowedPath('src/content/pages/fra/home.json', LOCALES),
);

// --- Noms de médias -------------------------------------------------------------
console.log('\nNoms de médias');

for (const name of ['photo.webp', 'photo-equipe.jpg', 'logo-2024.png', 'a.webp']) {
  check(`« ${name} » est accepté`, guard.isAllowedMediaFile(name));
}

for (const [label, name] of [
  ['une remontée', '../photo.webp'],
  ['un chemin', 'src/media/photo.webp'],
  ['une majuscule', 'Photo.webp'],
  ['un format vectoriel', 'photo.svg'],
  ['une double extension', 'photo.webp.svg'],
  ['une extension déguisée', 'photo.svg.webp.svg'],
  ['un point double', 'photo..webp'],
  ['un espace', 'ma photo.webp'],
  ['un accent', 'équipe.webp'],
  ['un séparateur encodé', 'photo%2fx.webp'],
  ['un octet nul', 'photo.webp\u0000'],
  ['un nom démesuré', `${'a'.repeat(200)}.webp`],
  ['une valeur absente', null],
]) {
  check(`${label} : refusé`, !guard.isAllowedMediaFile(name));
}

// --- Plafonds de taille ---------------------------------------------------------
console.log('\nPlafonds de taille');

const withLength = (value) =>
  new Request('https://exemple.fr/api/save', {
    method: 'POST',
    headers: value === null ? {} : { 'content-length': String(value) },
    body: 'x',
  });

check('une taille annoncée sous le plafond passe', !guard.declaredBodyTooLarge(withLength(1_000), 100_000));
check('une taille annoncée au-dessus est refusée', guard.declaredBodyTooLarge(withLength(200_000), 100_000));
check('une taille exactement au plafond passe', !guard.declaredBodyTooLarge(withLength(100_000), 100_000));
check(
  'une taille absente ne fait pas refuser à tort',
  !guard.declaredBodyTooLarge(withLength(null), 100_000),
);
check(
  'une taille illisible ne fait pas refuser à tort',
  !guard.declaredBodyTooLarge(withLength('énorme'), 100_000),
);
check('le plafond du contenu reste sous celui de l\'enveloppe', guard.MAX_CONTENT_BYTES < guard.MAX_BODY_BYTES);

// --- Budgets de débit -----------------------------------------------------------
console.log('\nBudgets de débit');

check('toutes les routes d\'écriture ont un budget', ['auth', 'content', 'save', 'upload'].every((name) => guard.LIMITS[name]));
check(
  'la clé du site reste la plus protégée',
  guard.LIMITS.auth.limit === 5 && guard.LIMITS.auth.windowSeconds === 15 * 60,
  JSON.stringify(guard.LIMITS.auth),
);
check(
  'chaque route compte dans son propre seau',
  new Set(Object.values(guard.LIMITS).map((budget) => budget.bucket)).size ===
    Object.keys(guard.LIMITS).length,
);

const from = (ip) => new Request('https://exemple.fr/x', { headers: { 'cf-connecting-ip': ip } });
const budget = { bucket: 'essai', limit: 3, windowSeconds: 60 };

const passes = [];
for (let attempt = 0; attempt < 4; attempt += 1) {
  passes.push(await guard.guardRate(from('203.0.113.20'), {}, budget));
}
check('sous le budget, rien n\'est refusé', passes.slice(0, 3).every((response) => response === null));
check('au-delà, la route refuse', passes[3]?.status === 429);
check('elle indique combien de temps patienter', passes[3]?.headers.get('retry-after') === '60');

const refusal = await passes[3].json();
check(
  'le refus est en langage courant, sans jargon ni compteur',
  /patientez/i.test(refusal.error) && !/(429|rate|limit|ip|bucket|\d+\s*tentative)/i.test(refusal.error),
  refusal.error,
);
check(
  'un autre appelant n\'est pas pénalisé',
  (await guard.guardRate(from('203.0.113.21'), {}, budget)) === null,
);
check(
  'un autre seau n\'est pas pénalisé',
  (await guard.guardRate(from('203.0.113.20'), {}, { ...budget, bucket: 'autre' })) === null,
);

// --- Routes : l'ordre des contrôles ---------------------------------------------
console.log('\nRoutes');

const saveModule = await load('packages/inline-core/src/server/routes/save.ts');
const uploadModule = await load('packages/inline-core/src/server/routes/upload.ts');
const contentModule = await load('packages/inline-core/src/server/routes/content.ts');

// Les routes se construisent avec la configuration du site — c'est tout ce
// qu'un site a à dire au paquet.
const save = { ...saveModule.createSaveRoute({ locales: LOCALES }), sanitizeMessage: saveModule.sanitizeMessage };
const upload = uploadModule.createUploadRoute();
const content = contentModule.createContentRoute({ locales: LOCALES });

check('une méthode inattendue est refusée sur la publication', save.onRequest().status === 405);
check('une méthode inattendue est refusée sur l\'envoi d\'image', upload.onRequest().status === 405);
check('une méthode inattendue est refusée sur la lecture', content.onRequest().status === 405);

/** Requête de publication anonyme, depuis une adresse donnée. */
const savePost = (ip, init = {}) =>
  save.onRequestPost({
    request: new Request('https://exemple.fr/api/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(init.headers ?? {}) },
      body: init.body ?? JSON.stringify({ path: 'src/content/pages/fr/home.json', content: '{}', version: 'v1', message: 'm' }),
    }),
    env: {},
  });

// Sans session, la route refuse — et elle continue de refuser jusqu'à ce que
// le budget soit épuisé, moment où elle cesse de répondre à l'appelant.
const anonymous = [];
for (let attempt = 0; attempt < guard.LIMITS.save.limit; attempt += 1) {
  anonymous.push((await savePost('198.51.100.10')).status);
}
check(
  'sans session, la publication est refusée',
  anonymous.every((status) => status === 401),
  [...new Set(anonymous)].join(','),
);
const exhausted = await savePost('198.51.100.10');
check('l\'insistance finit par être bloquée', exhausted.status === 429, String(exhausted.status));

// Le plafond de taille passe AVANT l'identité : une session volée ne doit pas
// être nécessaire pour qu'un corps démesuré coûte cher.
const huge = await savePost('198.51.100.11', { headers: { 'content-length': '50000000' } });
check(
  'un corps démesuré est refusé sans même vérifier l\'identité',
  huge.status === 413,
  String(huge.status),
);

const uploadAnonymous = await upload.onRequestPost({
  request: new Request('https://exemple.fr/api/upload', {
    method: 'POST',
    headers: { 'cf-connecting-ip': '198.51.100.12', 'content-length': '50000000' },
    body: 'x',
  }),
  env: {},
});
check(
  'une image démesurée est refusée sans vérifier l\'identité',
  uploadAnonymous.status === 413,
  String(uploadAnonymous.status),
);

const contentAnonymous = [];
for (let attempt = 0; attempt < guard.LIMITS.content.limit; attempt += 1) {
  contentAnonymous.push(
    (
      await content.onRequestGet({
        request: new Request(
          'https://exemple.fr/api/content?path=src/content/pages/fr/home.json',
          { headers: { 'cf-connecting-ip': '198.51.100.13' } },
        ),
        env: {},
      })
    ).status,
  );
}
check('sans session, la lecture est refusée', contentAnonymous.every((status) => status === 401));
check(
  'la lecture aussi finit par être bloquée',
  (
    await content.onRequestGet({
      request: new Request('https://exemple.fr/api/content?path=src/content/pages/fr/home.json', {
        headers: { 'cf-connecting-ip': '198.51.100.13' },
      }),
      env: {},
    })
  ).status === 429,
);

// --- Message de publication ------------------------------------------------------
console.log('\nMessage de publication');

const fallbackPath = 'src/content/pages/fr/home.json';
check(
  'un message normal est conservé',
  save.sanitizeMessage('content(fr): home — hero.title', fallbackPath) ===
    'content(fr): home — hero.title',
);
check(
  'un retour à la ligne ne peut pas ajouter de lignes à l\'historique',
  !save.sanitizeMessage('titre\n\nfaux corps signé', fallbackPath).includes('\n'),
);
check(
  'un retour chariot non plus',
  !save.sanitizeMessage('titre\r\nfaux corps', fallbackPath).includes('\r'),
);
check(
  'un séparateur Unicode non plus',
  !/[\u2028\u2029]/.test(save.sanitizeMessage('titre\u2028faux corps\u2029suite', fallbackPath)),
);
check(
  'une marque d\'inversion d\'écriture est retirée',
  !/[\u200e\u200f\u202a-\u202e]/.test(save.sanitizeMessage('titre\u202e gnp.otohp', fallbackPath)),
);
check(
  'un message démesuré est borné',
  save.sanitizeMessage('m'.repeat(5_000), fallbackPath).length <= 120,
);
check(
  'un message vide retombe sur une valeur sûre',
  save.sanitizeMessage('   ', fallbackPath) === `content: ${fallbackPath}`,
);
check(
  'un message qui n\'est pas du texte retombe sur une valeur sûre',
  save.sanitizeMessage({ toString: () => 'injecté' }, fallbackPath) === `content: ${fallbackPath}`,
);

// --- Journalisation ---------------------------------------------------------------
console.log('\nJournalisation');

check(
  'un jeton journalisé est détecté',
  findLeaks('console.error(`échec ${token}`);').length === 1,
);
check(
  'un environnement journalisé est détecté',
  findLeaks('console.log("état", env);').length === 1,
);
check(
  'un cookie journalisé est détecté',
  findLeaks('console.warn(request.headers.get("cookie"));').length === 1,
);
check(
  'une empreinte journalisée est détectée',
  findLeaks('console.error("refus", { hash });').length === 1,
);
check(
  'un message français parlant de clé n\'est pas une fuite',
  findLeaks("console.error('[auth] clé incorrecte, aucune session ouverte');").length === 0,
);
check(
  'un code de situation n\'est pas une fuite',
  findLeaks('console.error(`[save] écriture impossible (${code})`);').length === 0,
);
check(
  'le texte d\'un gabarit est ignoré, son interpolation non',
  evaluatedPart('`clé secrète : ${value}`').trim() === 'value',
  evaluatedPart('`clé secrète : ${value}`'),
);
check(
  'la ligne fautive est signalée',
  findLeaks('const a = 1;\nconsole.error(token);')[0]?.line === 2,
);

// --- Hydratation -------------------------------------------------------------
console.log('\nHydratation');

/** Ce que produit Astro pour un composant de framework hydraté. */
const island = (inner, directive = 'load') =>
  `<astro-island uid="x" client="${directive}" component-url="/_astro/C.js">${inner}</astro-island>`;

/** Le contrôle tel qu'il est appliqué dans check-html.mjs. */
const editableInsideIsland = (html) =>
  hydratedIslands(html).some((zone) => /data-cms(?:-list)?="/.test(zone));

check(
  'une zone éditable dans une île hydratée est refusée',
  editableInsideIsland(`<main>${island('<h1 data-cms="blocks.hero.title">Titre</h1>')}</main>`),
);
check(
  'une liste éditable dans une île hydratée est refusée aussi',
  editableInsideIsland(island('<div data-cms-list="collections.avis"></div>')),
);
check(
  'une île sans zone éditable est acceptée',
  !editableInsideIsland(`<h1 data-cms="blocks.hero.title">Titre</h1>${island('<div class="carousel"></div>')}`),
);
check(
  'une page sans île du tout est acceptée',
  !editableInsideIsland('<h1 data-cms="blocks.hero.title">Titre</h1>'),
);
check(
  'une zone éditable juste après une île fermée est acceptée',
  !editableInsideIsland(`${island('<div class="carte"></div>')}<p data-cms="blocks.about.body">Texte</p>`),
);
check(
  'deux îles sont examinées séparément',
  editableInsideIsland(
    `${island('<div class="carte"></div>')}${island('<p data-cms="blocks.about.body">Texte</p>')}`,
  ),
);
check(
  'une île non fermée est examinée jusqu\'au bout du document',
  editableInsideIsland('<astro-island client="load"><p data-cms="blocks.a.b">x</p>'),
);
check('le découpage compte les îles', hydratedIslands(`${island('a')}${island('b')}`).length === 2);

// Le HTML réellement construit ne doit contenir aucune île : le site modèle
// n'utilise aucun composant de framework.
const built = readFileSync(join(root, 'dist/fr/index.html'), 'utf8');
check('la page construite ne contient aucune île', hydratedIslands(built).length === 0);

await rm(workspace, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} contrôle(s) en échec.\n`);
  process.exit(1);
}
console.log('\nDurcissement : tous les contrôles passent.\n');
