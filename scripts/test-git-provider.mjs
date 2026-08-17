#!/usr/bin/env node
/**
 * Test du fournisseur Git en isolation, sans passer par la fonction d'écriture.
 *
 *   node scripts/test-git-provider.mjs                   contrôles hors ligne (aucun appel réseau)
 *   node scripts/test-git-provider.mjs --online          lecture réelle du fichier de contenu
 *   node scripts/test-git-provider.mjs --online --write  aller-retour complet + conflit provoqué
 *
 * Le mode --write crée deux commits sur un fichier de test à la racine du
 * dépôt (`.cms-probe.json`), qu'il supprime ensuite du disque local mais pas
 * de l'historique. À n'utiliser que sur un dépôt de test.
 */
import { build } from 'esbuild';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const online = process.argv.includes('--online');
const withWrite = process.argv.includes('--write');

let failures = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Compile la couche TypeScript vers un module importable par Node. */
async function loadProvider() {
  const dir = await mkdtemp(join(tmpdir(), 'git-provider-'));
  const outfile = join(dir, 'git-provider.mjs');
  await build({
    entryPoints: [join(root, 'packages/inline-core/src/server/git-provider.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile,
    logLevel: 'error',
  });
  const module = await import(pathToFileURL(outfile).href);
  return { module, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const FAKE_ENV = {
  GIT_PROVIDER: 'github',
  GIT_REPO: 'agence/site-demo',
  GIT_BRANCH: 'main',
  GIT_TOKEN: 'jeton-de-test-ne-doit-jamais-fuiter',
};
const PATH = 'src/content/pages/fr/home.json';
const AUTHOR = { name: 'Éditeur du site', email: 'client@exemple.fr' };

async function offlineTests({ createGitProvider, GitError, toBase64, fromBase64 }) {
  console.log('\nContrôles hors ligne');

  check(
    'base64 : aller-retour sans perte sur les accents',
    fromBase64(toBase64('Éléphant — à côté')) === 'Éléphant — à côté',
  );

  const realFetch = globalThis.fetch;
  const calls = [];
  const respond = (status, body) => {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    };
  };

  try {
    // Lecture
    respond(200, {
      type: 'file',
      sha: 'sha-initial',
      content: toBase64('{"clé":"valeur accentuée"}'),
    });
    const provider = await createGitProvider(FAKE_ENV);
    const read = await provider.readFile(PATH);

    check('lecture : contenu décodé intact', read.content === '{"clé":"valeur accentuée"}');
    check('lecture : version = SHA du blob', read.version === 'sha-initial');
    check(
      'lecture : URL et branche correctes',
      calls[0].url === `https://api.github.com/repos/agence/site-demo/contents/${PATH}?ref=main`,
      calls[0].url,
    );
    check(
      'lecture : jeton transmis en en-tête, jamais en URL',
      !calls[0].url.includes(FAKE_ENV.GIT_TOKEN) &&
        calls[0].init.headers.authorization === `Bearer ${FAKE_ENV.GIT_TOKEN}`,
    );

    // Écriture
    calls.length = 0;
    respond(200, { content: { sha: 'sha-suivant' } });
    const written = await provider.writeFile(
      PATH,
      '{"clé":"nouvelle"}',
      'sha-initial',
      'content(fr): home — hero.title',
      AUTHOR,
    );
    const sent = JSON.parse(calls[0].init.body);

    check('écriture : nouvelle version renvoyée', written.version === 'sha-suivant');
    check('écriture : version attendue transmise (verrou optimiste)', sent.sha === 'sha-initial');
    check('écriture : contenu ré-encodé à l\'identique', fromBase64(sent.content) === '{"clé":"nouvelle"}');
    check('écriture : message de commit conservé', sent.message === 'content(fr): home — hero.title');
    check('écriture : commit attribué à l\'auteur', sent.committer.email === AUTHOR.email);

    // Traduction des erreurs
    const cases = [
      [409, 'conflict'],
      [422, 'conflict'],
      [404, 'not_found'],
      [401, 'unauthorized'],
      [500, 'unavailable'],
    ];
    for (const [status, expected] of cases) {
      respond(status, { message: 'refus' });
      let code = 'aucune erreur';
      let text = '';
      try {
        await provider.writeFile(PATH, '{}', 'sha-perime', 'msg', AUTHOR);
      } catch (error) {
        code = error instanceof GitError ? error.code : `type inattendu : ${error?.name}`;
        text = `${error.message}`;
      }
      check(`erreur ${status} traduite en « ${expected} »`, code === expected, code);
      check(
        `erreur ${status} : le jeton n'apparaît pas dans le message`,
        !text.includes(FAKE_ENV.GIT_TOKEN),
      );
    }

    // Configuration incomplète
    let refused = false;
    try {
      await createGitProvider({ GIT_PROVIDER: 'github', GIT_REPO: '', GIT_TOKEN: '' });
    } catch {
      refused = true;
    }
    check('configuration incomplète refusée', refused);

    let gitlabRefused = '';
    try {
      await createGitProvider({ ...FAKE_ENV, GIT_PROVIDER: 'gitlab' });
    } catch (error) {
      gitlabRefused = error.message;
    }
    check(
      'fournisseur GitLab : refus explicite, non silencieux',
      gitlabRefused.includes('non implémenté'),
      gitlabRefused,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function onlineTests({ createGitProvider, GitError }) {
  console.log('\nContrôles en ligne');

  const env = {
    GIT_PROVIDER: process.env.GIT_PROVIDER ?? 'github',
    GIT_REPO: process.env.GIT_REPO,
    GIT_BRANCH: process.env.GIT_BRANCH ?? 'main',
    GIT_TOKEN: process.env.GIT_TOKEN,
  };
  if (!env.GIT_REPO || !env.GIT_TOKEN) {
    console.error('  ✗ GIT_REPO et GIT_TOKEN doivent être définis dans l\'environnement.');
    failures += 1;
    return;
  }

  const provider = await createGitProvider(env);
  const read = await provider.readFile(PATH);
  check('lecture du fichier de contenu dans le dépôt', read.content.length > 0);
  check('version non vide', read.version.length > 0);
  check('contenu = JSON valide', (() => { try { JSON.parse(read.content); return true; } catch { return false; } })());

  const local = await readFile(join(root, PATH), 'utf8');
  check(
    'le contenu du dépôt correspond au fichier local',
    JSON.stringify(JSON.parse(read.content)) === JSON.stringify(JSON.parse(local)),
    'un écart signifie simplement que le local n\'est pas poussé',
  );

  if (!withWrite) {
    console.log('  · écriture non testée (ajouter --write)');
    return;
  }

  const probe = '.cms-probe.json';
  let version = '';
  try {
    const existing = await provider.readFile(probe);
    version = existing.version;
  } catch (error) {
    if (!(error instanceof GitError) || error.code !== 'not_found') throw error;
  }

  const first = await provider.writeFile(
    probe,
    `${JSON.stringify({ probe: 'écriture 1' }, null, 2)}\n`,
    version,
    'chore: test du fournisseur (1/2)',
    AUTHOR,
  );
  check('écriture acceptée', first.version.length > 0);

  const second = await provider.writeFile(
    probe,
    `${JSON.stringify({ probe: 'écriture 2' }, null, 2)}\n`,
    first.version,
    'chore: test du fournisseur (2/2)',
    AUTHOR,
  );
  check('écriture suivante acceptée avec la version à jour', second.version !== first.version);

  let conflictCode = 'aucune erreur';
  try {
    await provider.writeFile(
      probe,
      `${JSON.stringify({ probe: 'écriture périmée' }, null, 2)}\n`,
      first.version,
      'chore: test du fournisseur (conflit)',
      AUTHOR,
    );
  } catch (error) {
    conflictCode = error instanceof GitError ? error.code : `type inattendu : ${error?.name}`;
  }
  check('écriture avec une version périmée refusée', conflictCode === 'conflict', conflictCode);
}

const { module, cleanup } = await loadProvider();
try {
  await offlineTests(module);
  if (online) await onlineTests(module);
} finally {
  await cleanup();
}

if (failures > 0) {
  console.error(`\n${failures} contrôle(s) en échec.\n`);
  process.exit(1);
}
console.log('\nFournisseur Git : tous les contrôles passent.\n');
