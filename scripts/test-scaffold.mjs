#!/usr/bin/env node
/**
 * L'échafaudage produit-il un site qui construit et qui passe ses contrôles ?
 *
 *   node scripts/test-scaffold.mjs
 *
 * C'est le garde-fou contre la pourriture du modèle. `create-inline` embarque
 * une copie du squelette d'un site : sans ce test, elle diverge en silence du
 * dépôt de référence et on ne s'en aperçoit qu'au prochain client — c'est-à-dire
 * au pire moment.
 *
 * Le test crée un vrai site dans un dossier temporaire, y installe le paquet
 * local, construit, et lance ses contrôles. Long (une minute environ), mais
 * c'est le seul niveau où la question a un sens.
 *
 * Passer --court pour s'arrêter après la génération, sans installer ni
 * construire — utile en développement, insuffisant en intégration continue.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const quick = process.argv.includes('--court');
let failures = 0;

function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/**
 * Sous Windows, `npm` est un script et non un exécutable : il faut passer par
 * l'interpréteur de commandes pour le trouver. Mais l'interpréteur redécoupe
 * les arguments sur les espaces — et le chemin de ce dépôt en contient. D'où
 * les guillemets, posés uniquement quand l'interpréteur est de la partie.
 */
function run(command, args, cwd) {
  const shell = process.platform === 'win32' && command === 'npm';
  const finalArgs = shell ? args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)) : args;

  try {
    return {
      code: 0,
      output: execFileSync(command, finalArgs, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell,
      }),
    };
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

/**
 * L'atelier vit dans le dépôt, pas dans le dossier temporaire du système.
 *
 * Sous Windows, les deux sont souvent sur des disques différents, et Astro
 * calcule le chemin d'une route injectée avec « path.relative » : d'un disque
 * à l'autre, il n'existe pas de chemin relatif, et le build échoue pour une
 * raison qui n'a rien à voir avec le code testé.
 */
const workspace = await mkdtemp(join(root, '.tmp-scaffold-'));

// --- Génération -----------------------------------------------------------------
console.log('\nGénération');

const created = run(
  'node',
  [
    join(root, 'packages/create-inline/index.mjs'),
    'site-essai',
    '--nom',
    'Boulangerie Martin',
    '--courriel',
    'contact@boulangerie-martin.fr',
  ],
  workspace,
);
const project = join(workspace, 'site-essai');

check('l\'échafaudage aboutit', created.code === 0, created.output.slice(-500));
check('la clé du site est affichée une fois', /saisissez cette clé/.test(created.output));
check(
  'la clé n\'est pas un secret devinable',
  /\n {10}[A-Za-z0-9_-]{30,}\n/.test(created.output),
);

for (const file of [
  'package.json',
  'astro.config.mjs',
  'wrangler.toml',
  '.gitignore',
  '.dev.vars',
  '.env.example',
  'tsconfig.json',
  'functions/api/save.ts',
  'src/content/config.ts',
  'src/content/site.json',
  'src/content/pages/fr/home.json',
  'src/layouts/Base.astro',
  'src/pages/[lang]/[...slug].astro',
  'src/styles/theme.css',
  'scripts/check-html.mjs',
  '.github/workflows/ci.yml',
]) {
  check(`${file} est présent`, existsSync(join(project, file)));
}

const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
check('le site dépend d\'inline-core, il ne le recopie pas', !!pkg.dependencies['inline-core']);
check(
  'aucune logique d\'édition n\'a été recopiée',
  !existsSync(join(project, 'src/editor')) && !existsSync(join(project, 'functions/lib')),
);

const site = JSON.parse(readFileSync(join(project, 'src/content/site.json'), 'utf8'));
check('le nom du site est repris', site.name === 'Boulangerie Martin', site.name);
check('l\'adresse de contact est reprise', site.contact.email === 'contact@boulangerie-martin.fr');
check(
  'aucun marqueur de modèle ne subsiste',
  !readFileSync(join(project, 'src/content/pages/fr/home.json'), 'utf8').includes('__NOM__'),
);

const devVars = readFileSync(join(project, '.dev.vars'), 'utf8');
check('l\'empreinte de la clé est posée, pas la clé', /EDITOR_KEY_HASH=\$argon2id\$/.test(devVars));
check('la clé en clair n\'est nulle part sur disque', !devVars.includes('EDITOR_KEY='));
check(
  '.dev.vars est ignoré par Git',
  readFileSync(join(project, '.gitignore'), 'utf8').includes('.dev.vars'),
);

// Un dossier déjà occupé ne doit jamais être écrasé.
const again = run('node', [join(root, 'packages/create-inline/index.mjs'), 'site-essai'], workspace);
check('un dossier non vide n\'est jamais écrasé', again.code === 1);

if (quick) {
  await rm(workspace, { recursive: true, force: true });
  console.log('\n  (--court : installation et build non exécutés)\n');
  process.exit(failures === 0 ? 0 : 1);
}

// --- Installation et build --------------------------------------------------------
console.log('\nInstallation et build');

// Le paquet local remplace celui du registre : c'est la version en cours de
// développement qu'on veut mettre à l'épreuve, pas la dernière publiée.
const corePath = join(root, 'packages/inline-core').replace(/\\/g, '/');
const installed = run('npm', ['install', '--no-audit', '--no-fund', `inline-core@file:${corePath}`], project);
check('les dépendances s\'installent', installed.code === 0, installed.output.slice(-600));

const built = run('npm', ['run', 'build'], project);
check('le site construit', built.code === 0, built.output.slice(-800));

if (built.code === 0) {
  check('la page d\'accueil est produite', existsSync(join(project, 'dist/fr/index.html')));
  check('la page d\'accès est produite', existsSync(join(project, 'dist/admin/index.html')));
  check('la page d\'aide est produite', existsSync(join(project, 'dist/aide/index.html')));
  check('l\'overlay est construit', existsSync(join(project, 'dist/editor/overlay.js')));

  const home = readFileSync(join(project, 'dist/fr/index.html'), 'utf8');
  check('le contenu est dans le HTML brut', home.includes('data-cms="blocks.hero.title"'));
  check('l\'amorce d\'édition est posée par l\'intégration', home.includes('inline_edit=1'));
  check('un visiteur ne télécharge aucun script d\'édition', !home.includes('/editor/overlay.js"></script>'));
  check(
    'la bibliothèque d\'images a été créée',
    existsSync(join(project, 'src/media/library.ts')),
  );

  const checked = run('npm', ['run', 'check'], project);
  check('les contrôles passent', checked.code === 0, checked.output.slice(-800));
}

// --- Une sortie non statique est refusée --------------------------------------------
console.log('\nGarde-fou de configuration');

const configPath = join(project, 'astro.config.mjs');
const original = readFileSync(configPath, 'utf8');
writeFileSync(configPath, original.replace("output: 'static'", "output: 'server'"));
const refused = run('npm', ['run', 'build'], project);
check('une sortie serveur fait échouer le build', refused.code !== 0);
check(
  'et le message dit pourquoi',
  /n'est pas supporté|\/functions/.test(refused.output),
  refused.output.slice(-300),
);
writeFileSync(configPath, original);

await rm(workspace, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} contrôle(s) en échec.\n`);
  process.exit(1);
}
console.log('\nÉchafaudage : tous les contrôles passent.\n');
