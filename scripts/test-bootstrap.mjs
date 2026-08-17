#!/usr/bin/env node
/**
 * Amorçage d'un site existant : ce qui est extrait, et ce qui est refusé.
 *
 *   node scripts/test-bootstrap.mjs
 *
 * La fixture est une page de site statique annotée à la main — le cas réel
 * d'une reprise. Le test vérifie autant ce que l'amorçage produit que ce qu'il
 * refuse de produire : une page dont une image n'a pas de description ne doit
 * pas donner un fichier de contenu avec un `alt` vide, elle doit échouer.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(root, 'scripts/fixtures/site-existant.html');
let failures = 0;

function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const workspace = await mkdtemp(join(tmpdir(), 'inline-bootstrap-test-'));

/** Lance l'amorçage, renvoie le code de sortie et la sortie affichée. */
function run(args) {
  try {
    const output = execFileSync('node', [join(root, 'scripts/bootstrap.mjs'), ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

// --- Page complète -------------------------------------------------------------
console.log('\nPage annotée complète');

const target = join(workspace, 'accueil.json');
const done = run(['--html', FIXTURE, '--page', 'accueil', '--langue', 'fr', '--sortie', target]);
check('l\'amorçage aboutit', done.code === 0, done.output.slice(-400));
check('le fichier de contenu est écrit', existsSync(target));

const content = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : {};

check('le titre vient de la balise <title>', content.meta?.title === 'Boulangerie Martin — pains au levain');
check('la description vient de la balise meta', /Boulangerie artisanale/.test(content.meta?.description ?? ''));

check(
  'un texte est repris tel qu\'il est dans la page',
  content.blocks?.hero?.title?.value === 'Le pain au levain, tous les matins',
  content.blocks?.hero?.title?.value,
);
check(
  'ses variantes de style sont relues depuis les classes',
  content.blocks?.hero?.title?.style?.size === '3xl' &&
    content.blocks?.hero?.title?.style?.weight === 'bold' &&
    content.blocks?.hero?.title?.style?.align === 'center',
  JSON.stringify(content.blocks?.hero?.title?.style),
);
check(
  'un texte sans classe retombe sur les valeurs par défaut',
  content.collections?.avis?.[0]?.quote?.style?.size === 'base',
);

check(
  'le richtext garde son balisage autorisé',
  /<strong>pétrissons<\/strong>/.test(content.blocks?.about?.body?.value ?? '') &&
    /<a href="\/contact">/.test(content.blocks?.about?.body?.value ?? ''),
  content.blocks?.about?.body?.value,
);

check(
  'une image garde sa description et ses dimensions',
  content.blocks?.about?.photo?.alt === 'Le fournil au petit matin' &&
    content.blocks?.about?.photo?.width === 1600 &&
    content.blocks?.about?.photo?.height === 900,
);
check(
  'son nom de fichier est normalisé, accents et espaces compris',
  content.blocks?.about?.photo?.src === 'fournil-de-la-boulangerie.jpg',
  content.blocks?.about?.photo?.src,
);

check(
  'une vidéo devient un fournisseur et un identifiant, jamais un fichier',
  content.blocks?.about?.film?.provider === 'youtube' &&
    content.blocks?.about?.film?.videoId === 'aqz-KE-bpKQ' &&
    !('src' in (content.blocks?.about?.film ?? {})),
  JSON.stringify(content.blocks?.about?.film),
);

const avis = content.collections?.avis ?? [];
check('la liste est reprise avec ses items', avis.length === 2);
check(
  'chaque item garde l\'identifiant posé dans la page',
  avis[0]?.id === 'a-001' && avis[1]?.id === 'a-002',
);
check(
  'les champs d\'item sont rangés sous leur nom court',
  avis[0]?.quote?.value === 'Le meilleur pain de la ville.' && avis[0]?.author?.value === 'Claire D.',
);
check(
  'les champs de liste ne sont pas aussi rangés dans les blocs',
  !JSON.stringify(content.blocks).includes('meilleur pain'),
);

check(
  'un chemin hors périmètre est ignoré et signalé',
  /pied\.mention/.test(done.output) && !JSON.stringify(content).includes('Mention hors périmètre'),
);

// --- Page incomplète -----------------------------------------------------------
console.log('\nPage annotée incomplète');

const broken = join(workspace, 'incomplete.html');
writeFileSync(
  broken,
  readFileSync(FIXTURE, 'utf8').replace('alt="Le fournil au petit matin"', ''),
);
const brokenTarget = join(workspace, 'incomplete.json');
const refused = run(['--html', broken, '--page', 'accueil', '--sortie', brokenTarget]);

check('une image sans description fait échouer l\'amorçage', refused.code === 1);
check('et rien n\'est écrit', !existsSync(brokenTarget));
check(
  'le manque est nommé avant l\'erreur de schéma',
  /description de l'image absente/.test(refused.output),
  refused.output.slice(-300),
);
check(
  'le message dit quoi corriger, pas seulement que c\'est invalide',
  /Compléter la page HTML/.test(refused.output),
);

// --- Essai à blanc --------------------------------------------------------------
console.log('\nEssai à blanc');

const dryTarget = join(workspace, 'essai.json');
const dry = run(['--html', FIXTURE, '--page', 'accueil', '--sortie', dryTarget, '--essai']);
check('l\'essai aboutit', dry.code === 0);
check('mais n\'écrit rien', !existsSync(dryTarget));
check('et le dit', /rien écrit/.test(dry.output));

// Un fichier existant n'est jamais écrasé : un amorçage relancé par erreur ne
// doit pas effacer le contenu déjà édité par le client.
const second = run(['--html', FIXTURE, '--page', 'accueil', '--sortie', target]);
check('un fichier existant n\'est jamais écrasé', second.code === 1);
check(
  'et le contenu déjà en place est intact',
  JSON.parse(readFileSync(target, 'utf8')).meta.title === content.meta.title,
);

await rm(workspace, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} contrôle(s) en échec.\n`);
  process.exit(1);
}
console.log('\nAmorçage : tous les contrôles passent.\n');
