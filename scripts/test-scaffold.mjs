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
 * Trois modes :
 *
 *   --court    s'arrête après la génération, sans installer ni construire.
 *              Utile en développement, insuffisant en intégration continue.
 *
 *   (défaut)   installe les paquets par leur chemin dans le dépôt. Rapide à
 *              mettre en place, mais ne dit rien de ce qui partirait au
 *              registre : npm suit les fichiers présents, pas la liste
 *              publiée.
 *
 *   --paquet   passe par « npm pack », donc par les archives exactes qu'une
 *              publication produirait. C'est le seul mode qui attrape un
 *              fichier oublié dans « files » ou un chemin absent d'« exports ».
 *              À lancer avant toute publication.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const quick = process.argv.includes('--court');
const packed = process.argv.includes('--paquet');
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

/**
 * Fabrique l'archive d'un paquet et l'ouvre, pour travailler sur exactement ce
 * qu'une publication enverrait — ni plus, ni moins.
 */
function packAndExtract(packageDir, label) {
  const dest = join(workspace, `paquet-${label}`);
  mkdirSync(dest, { recursive: true });

  const done = run('npm', ['pack', packageDir, '--pack-destination', dest, '--silent'], root);
  if (done.code !== 0) return { code: done.code, output: done.output };

  const tarball = readdirSync(dest).find((entry) => entry.endsWith('.tgz'));
  if (!tarball) return { code: 1, output: 'aucune archive produite' };

  // Nom nu et répertoire de travail plutôt qu'un chemin complet : certains
  // « tar » lisent « D:\… » comme une machine distante et tentent de s'y
  // connecter.
  const extracted = run('tar', ['-xzf', tarball], dest);
  return {
    code: extracted.code,
    output: extracted.output,
    archive: join(dest, tarball),
    dir: join(dest, 'package'),
  };
}

let scaffolder = join(root, 'packages/create-inline/index.mjs');
/** Ce qu'on installera comme `inline-core` : un dossier, ou une archive. */
let coreSpecifier = `file:${join(root, 'packages/inline-core').replace(/\\/g, '/')}`;

if (packed) {
  console.log('\nArchives de publication');

  const core = packAndExtract(join(root, 'packages/inline-core'), 'core');
  check('l\'archive d\'inline-core se fabrique', core.code === 0, core.output?.slice(-300));

  const creator = packAndExtract(join(root, 'packages/create-inline'), 'create');
  check('l\'archive de create-inline se fabrique', creator.code === 0, creator.output?.slice(-300));

  if (core.code !== 0 || creator.code !== 0) {
    await rm(workspace, { recursive: true, force: true });
    process.exit(1);
  }

  // Ce que « files » a réellement retenu. Un oubli ici ne se voit qu'après
  // publication, quand un site tiers échoue à construire.
  for (const [label, file] of [
    ['l\'intégration', 'astro/index.ts'],
    ['les composants', 'components/Media.astro'],
    ['les pages clé en main', 'pages/aide.astro'],
    ['le schéma', 'src/schema.ts'],
    ['les routes serveur', 'src/server/routes/save.ts'],
    ['le répartiteur de routes', 'src/server/router.ts'],
    ['la correspondance des styles', 'styles/tokens.css'],
  ]) {
    check(`l'archive contient ${label}`, existsSync(join(core.dir, file)));
  }
  for (const [label, file] of [
    ['le modèle de contenu', 'modele/src/content/pages/fr/home.json'],
    ['les adaptateurs de routes', 'modele/functions/api/save.ts'],
    ["l'adaptateur Netlify", 'modele/netlify/source/api.mts'],
    ['son assemblage', 'modele/scripts/build-netlify.mjs'],
    ['la configuration Netlify', 'modele/netlify.toml'],
    ['le serveur Node autonome', 'modele/scripts/serve.mjs'],
    ['les contrôles', 'modele/scripts/check-html.mjs'],
    ['la génération de clé', 'modele/scripts/make-key.mjs'],
    ['l\'intégration continue', 'modele/.github/workflows/ci.yml'],
    ['le modèle de variables', 'modele/.env.example'],
  ]) {
    check(`l'archive de création contient ${label}`, existsSync(join(creator.dir, file)));
  }

  scaffolder = join(creator.dir, 'index.mjs');
  coreSpecifier = core.archive;
}

// --- Génération -----------------------------------------------------------------
console.log('\nGénération');

const created = run(
  'node',
  [
    scaffolder,
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
  'netlify.toml',
  'netlify/source/api.mts',
  'scripts/build-netlify.mjs',
  'scripts/serve.mjs',
  'src/lib/api.ts',
  'src/content/config.ts',
  'src/content/site.json',
  'src/content/pages/fr/home.json',
  'src/layouts/Base.astro',
  'src/pages/[lang]/[...slug].astro',
  'src/styles/theme.css',
  'scripts/check-html.mjs',
  'scripts/make-key.mjs',
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

/**
 * Ce que `.dev.vars` promet doit exister dans le projet.
 *
 * Il pointe vers un faux dépôt local pour qu'on puisse publier dès la première
 * minute, sans dépôt ni hébergeur. Si le service n'est pas livré avec, la
 * première publication échoue sur une erreur réseau et la promesse ment — ce
 * qui est exactement arrivé avant que ce contrôle existe.
 */
if (/GIT_API_BASE=http:\/\/127\.0\.0\.1/.test(devVars)) {
  check('le faux dépôt local est livré', existsSync(join(project, 'scripts/mock-git-api.mjs')));
  check(
    'et il a sa commande',
    JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')).scripts['mock:git'] !==
      undefined,
  );
  check(
    'le mode d\'emploi affiché explique comment le lancer',
    /mock:git/.test(created.output),
  );
}
/**
 * Une clé perdue se régénère, elle ne se retrouve pas — encore faut-il que la
 * commande vive là où vit le site. Sans ce contrôle, la rotation n'est possible
 * que depuis le dépôt de référence, c'est-à-dire nulle part pour qui a reçu un
 * site livré.
 */
check('la commande de clé est livrée', existsSync(join(project, 'scripts/make-key.mjs')));
check(
  'et elle est déclarée dans le projet',
  JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')).scripts['make:key'] !== undefined,
);
check('le mode d\'emploi affiché la mentionne', /make:key/.test(created.output));

check('l\'empreinte de la clé est posée, pas la clé', /EDITOR_KEY_HASH=\$argon2id\$/.test(devVars));
check('la clé en clair n\'est nulle part sur disque', !devVars.includes('EDITOR_KEY='));
check(
  '.dev.vars est ignoré par Git',
  readFileSync(join(project, '.gitignore'), 'utf8').includes('.dev.vars'),
);

// Un dossier déjà occupé ne doit jamais être écrasé.
const again = run('node', [scaffolder, 'site-essai'], workspace);
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
const installed = run('npm', ['install', '--no-audit', '--no-fund', coreSpecifier], project);
check('les dépendances s\'installent', installed.code === 0, installed.output.slice(-600));

/**
 * La génération de clé n'installe rien : elle s'appuie sur la bibliothèque de
 * hachage qui arrive avec `inline-core`. Le contrôle porte donc autant sur la
 * commande que sur cette dépendance transitive.
 */
const keyed = run('npm', ['run', 'make:key'], project);
check('le site sait régénérer sa clé', keyed.code === 0, keyed.output.slice(-400));
check(
  'et il en sort une empreinte argon2id',
  /EDITOR_KEY_HASH=\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/.test(keyed.output),
);

const built = run('npm', ['run', 'build'], project);
check('le site construit', built.code === 0, built.output.slice(-800));

if (built.code === 0) {
  check('la page d\'accueil est produite', existsSync(join(project, 'dist/fr/index.html')));
  check('la page d\'accès est produite', existsSync(join(project, 'dist/admin/index.html')));
  check('la page d\'aide est produite', existsSync(join(project, 'dist/aide/index.html')));
  check('l\'overlay est construit', existsSync(join(project, 'dist/editor/overlay.js')));

  // --- Les adaptateurs du site généré ------------------------------------------
  //
  // C'est le seul échec d'`inline` qui ne se voit pas à l'écran : un site
  // déposé sans routes utilisables s'affiche parfaitement et refuse la clé.
  // Le contrôle porte donc sur le site *généré*, et sur l'artefact réellement
  // déployé — pas sur la source dont il sort.
  const netlifyBuilt = run('npm', ['run', 'build:netlify'], project);
  check(
    "la fonction Netlify s'assemble",
    netlifyBuilt.code === 0,
    netlifyBuilt.output.slice(-600),
  );

  writeFileSync(
    join(project, 'essai-adaptateurs.mjs'),
    `import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const query = (method, path) => new Request('https://exemple.fr' + path, { method });

// La table, telle que la lisent les adaptateurs de /functions.
await build({
  entryPoints: ['src/lib/api.ts'], outfile: join('node_modules', '.essai', 'api.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  packages: 'bundle', external: ['node:*'], logLevel: 'silent',
});
const { api } = await import(pathToFileURL(join('node_modules', '.essai', 'api.mjs')).href);
const viaTable = await api.routes['/api/auth'].onRequest({
  request: query('GET', '/api/auth'), env: {},
});

// L'artefact Netlify, chargé comme son exécution le charge.
const netlify = await import(pathToFileURL('netlify/functions/api.mjs').href);

console.log(JSON.stringify({
  table: viaTable.status,
  netlify: (await netlify.default(query('GET', '/api/auth'))).status,
  chemin: netlify.config?.path,
  inconnu: (await netlify.default(query('GET', '/api/inconnu'))).status,
  // Ce qui distingue une fonction v2 d'une v1. Un artefact en CommonJS
  // n'exposerait pas « default », et l'exécution appellerait « handler » :
  // 502 « handler is not a function », au moment d'entrer la clé.
  defaut: typeof netlify.default,
}));
`,
  );

  const adapters = run('node', ['essai-adaptateurs.mjs'], project);
  check("les adaptateurs du site généré s'exécutent", adapters.code === 0, adapters.output.slice(-600));

  if (adapters.code === 0) {
    const line = adapters.output.trim().split(/\r?\n/).pop();
    let seen = {};
    try {
      seen = JSON.parse(line);
    } catch {
      check('la sortie du contrôle est lisible', false, line);
    }

    check('la table sert /api/auth', seen.table === 405, `reçu ${seen.table}`);
    check("l'artefact Netlify sert /api/auth", seen.netlify === 405, `reçu ${seen.netlify}`);
    check(
      'les deux formes répondent la même chose',
      seen.table === seen.netlify,
      `table ${seen.table}, Netlify ${seen.netlify}`,
    );
    check("l'artefact Netlify déclare son chemin", seen.chemin === '/api/*', String(seen.chemin));
    check('un chemin inconnu répond 404', seen.inconnu === 404, `reçu ${seen.inconnu}`);
    check(
      "l'artefact Netlify est une fonction v2, pas v1",
      seen.defaut === 'function',
      `export par défaut : ${seen.defaut}`,
    );
  }

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
