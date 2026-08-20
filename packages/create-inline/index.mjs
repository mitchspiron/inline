#!/usr/bin/env node
/**
 * Crée un site `inline` prêt à éditer.
 *
 *   npm create inline@latest mon-site
 *   npm create inline@latest mon-site -- --nom "Boulangerie Martin" --courriel contact@…
 *
 * Ce que ça écrit : le squelette du site, les quatre adaptateurs de routes, la
 * charte, une page de contenu, les contrôles et l'intégration continue. Puis la
 * clé du site, affichée une fois.
 *
 * Ce que ça n'écrit pas : la logique d'édition. Elle arrive par
 * `inline-core`, en dépendance versionnée. C'est toute la différence entre un
 * échafaudage et un copier-coller : le jour d'un correctif de sécurité, un
 * `npm update` suffit.
 */
import { argon2id } from '@noble/hashes/argon2.js';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MODELE = join(here, 'modele');

/** Version d'`inline-core` posée en dépendance du site créé. */
const CORE_VERSION = '^2.1.0';
const ASTRO_VERSION = '^5.2.5';
/**
 * `scripts/make-key.mjs` en a besoin. Déclaré explicitement, et pas laissé au
 * hasard : le paquet arrive bien dans l'arbre par `inline-core`, mais rien ne
 * garantit qu'il soit hissé à la racine — sous pnpm, ou sous npm en stratégie
 * imbriquée, la commande échouerait sur un module introuvable.
 */
const HASHES_VERSION = '^2.3.0';
/**
 * `scripts/serve.mjs` assemble les routes au démarrage. Même raisonnement que
 * ci-dessus : le paquet arrive par `inline-core`, mais rien ne garantit qu'il
 * soit hissé à la racine.
 */
const ESBUILD_VERSION = '^0.28.2';
/**
 * Le comptage des tentatives sur Netlify. Dépendance normale et non de
 * développement : elle doit survivre à une installation de production, sinon
 * l'assemblage de la fonction échoue au déploiement.
 *
 * Site déposé ailleurs ? L'import est dynamique et n'est jamais atteint : la
 * ligne se retire de package.json avec le dossier netlify/.
 */
const NETLIFY_BLOBS_VERSION = '^10.7.13';

function option(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

/** Premier argument qui n'est ni une option ni sa valeur. */
function positional() {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith('--')) {
      if (args[index + 1] && !args[index + 1].startsWith('--')) index += 1;
      continue;
    }
    return args[index];
  }
  return '';
}

const target = positional();
if (!target) {
  console.error(`
  Usage : npm create inline@latest <dossier> [options]

    --nom       nom du site, affiché dans le pied de page
    --courriel  adresse de contact, affichée au client dans l'aide
    --langue    code de la langue principale (défaut : fr)
`);
  process.exit(1);
}

const projectDir = join(process.cwd(), target);
if (existsSync(projectDir) && readdirSync(projectDir).length > 0) {
  console.error(`\n  ✗ ${projectDir} existe déjà et n'est pas vide — rien n'a été écrit.\n`);
  process.exit(1);
}

const name = option('nom', target);
const email = option('courriel', 'contact@exemple.fr');
const locale = option('langue', 'fr');

if (!/^[a-z]{2}$/.test(locale)) {
  console.error(`\n  ✗ Code de langue invalide : « ${locale} ». Deux lettres minuscules.\n`);
  process.exit(1);
}

// --- Copie du modèle ------------------------------------------------------------

mkdirSync(projectDir, { recursive: true });
cpSync(MODELE, projectDir, { recursive: true });

/** Remplace les marqueurs du modèle dans un fichier déjà copié. */
function fill(relative, replacements) {
  const path = join(projectDir, relative);
  if (!existsSync(path)) return;
  let source = readFileSync(path, 'utf8');
  for (const [from, to] of replacements) source = source.split(from).join(to);
  writeFileSync(path, source);
}

for (const file of [
  'src/content/site.json',
  'src/content/pages/fr/home.json',
  'astro.config.mjs',
  '.env.example',
]) {
  fill(file, [
    ['__NOM__', name],
    ['__COURRIEL__', email],
  ]);
}

// La langue principale n'est « fr » que par défaut.
if (locale !== 'fr') {
  cpSync(join(projectDir, 'src/content/pages/fr'), join(projectDir, `src/content/pages/${locale}`), {
    recursive: true,
  });
  const { rmSync } = await import('node:fs');
  rmSync(join(projectDir, 'src/content/pages/fr'), { recursive: true, force: true });

  for (const file of ['src/lib/locales.ts', 'astro.config.mjs', 'scripts/check-locales.mjs', 'scripts/check-html.mjs']) {
    fill(file, [["'fr'", `'${locale}'`], ['pages/fr/', `pages/${locale}/`], ['dist/fr/', `dist/${locale}/`]]);
  }
}

// --- package.json ---------------------------------------------------------------

writeFileSync(
  join(projectDir, 'package.json'),
  `${JSON.stringify(
    {
      name: target.replace(/[^a-z0-9-]+/gi, '-').toLowerCase(),
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'astro dev',
        build: 'astro build',
        // Trois façons de servir le site avec ses routes. La troisième ne
        // dépend d'aucun hébergeur — voir README, « Le déploiement ».
        // La fonction Netlify est assemblée par le dépôt, pas par Netlify :
        // son bundler produit du CommonJS, et la fonction serait prise pour
        // une v1. Voir scripts/build-netlify.mjs.
        'build:netlify': 'node scripts/build-netlify.mjs',
        serve: 'node scripts/serve.mjs',
        'serve:functions': 'wrangler pages dev',
        'mock:git': 'node scripts/mock-git-api.mjs',
        // Une clé perdue se régénère, elle ne se retrouve pas : la commande
        // doit vivre là où vit le site, pas seulement chez qui l'a créé.
        'make:key': 'node scripts/make-key.mjs',
        check: 'node scripts/check-html.mjs && node scripts/check-locales.mjs && node scripts/check-logs.mjs && node scripts/check-secrets.mjs',
      },
      dependencies: {
        '@netlify/blobs': NETLIFY_BLOBS_VERSION,
        astro: ASTRO_VERSION,
        'inline-core': CORE_VERSION,
      },
      devDependencies: {
        '@noble/hashes': HASHES_VERSION,
        esbuild: ESBUILD_VERSION,
        wrangler: '^3.107.2',
      },
    },
    null,
    2,
  )}\n`,
);

// Le modèle ne peut pas embarquer un .gitignore : npm renomme ce fichier à la
// publication. Il est donc écrit ici.
writeFileSync(
  join(projectDir, '.gitignore'),
  `# Dépendances
node_modules/

# Build
dist/
.astro/
netlify/functions/

# Secrets — aucun fichier d'environnement réel ne doit entrer dans le dépôt.
# Seul .env.example est versionné.
.env
.env.*
!.env.example
.dev.vars

# Outils
.wrangler/
.netlify/
*.log
.DS_Store
`,
);

writeFileSync(
  join(projectDir, 'wrangler.toml'),
  `# Configuration de l'hébergeur pour les fonctions de /functions.
# Aucun secret ici : les variables se déclarent dans .dev.vars en local et dans
# la configuration du projet en production.
name = "${target.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}"
compatibility_date = "${new Date().toISOString().slice(0, 10)}"
pages_build_output_dir = "dist"
`,
);

// --- Les accès -------------------------------------------------------------------

/** Paramètres recommandés par l'OWASP pour argon2id. */
const PARAMS = { m: 19456, t: 2, p: 1 };
const toBase64Url = (bytes) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const key = randomBytes(24).toString('base64url');
const sessionSecret = randomBytes(32).toString('base64url');
const salt = randomBytes(16);
const digest = argon2id(key, salt, { ...PARAMS, dkLen: 32 });
const hash = `$argon2id$v=19$m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}$${toBase64Url(salt)}$${toBase64Url(digest)}`;

// En local, le faux service Git accepte n'importe quel jeton : on peut donc
// éditer dès la première minute, sans dépôt ni hébergeur.
writeFileSync(
  join(projectDir, '.dev.vars'),
  `# Essai local uniquement. Ignoré par Git, jamais déployé.
EDITOR_KEY_HASH=${hash}
SESSION_SECRET=${sessionSecret}
EDITOR_NAME=Éditeur du site
EDITOR_EMAIL=${email}
GIT_PROVIDER=github
GIT_REPO=agence/${target}
GIT_BRANCH=main
GIT_TOKEN=essai-local
GIT_API_BASE=http://127.0.0.1:8787
`,
);

console.log(`
  ${name} est prêt dans ${target}/

  1.  cd ${target}
      npm install

  2.  Dans trois terminaux, à la racine du projet :

        npm run mock:git         faux dépôt local, pour publier sans rien brancher
        npm run build
        npm run serve:functions

  3.  Ouvrez http://127.0.0.1:8788/admin et saisissez cette clé :

          ${key}

      Elle est déjà dans .dev.vars, qui n'entrera jamais dans le dépôt. Pour
      la production, régénérez-en une avec « npm run make:key » et posez les
      variables chez l'hébergeur. C'est aussi la commande de rotation, le jour
      où cette clé sera perdue ou à changer.

  4.  Modifiez un texte sur la page, cliquez sur Publier. La publication
      écrit dans src/content/ — relancez le build pour la voir figée.

  Ensuite : votre charte dans src/styles/theme.css, votre contenu dans
  src/content/, vos images dans src/media/. La logique d'édition vit dans
  inline-core — un « npm update inline-core » suffit à la mettre à jour.

  Pour la mise en ligne, l'hébergeur n'est pas tranché : functions/ pour ceux
  qui découvrent les routes par l'arborescence, netlify/ pour Netlify, ou
  « npm run serve » sur n'importe quelle plateforme qui lance un processus
  Node. Les dossiers inutilisés se suppriment sans rien casser.

  Un site déposé sans ses fonctions s'affiche mais refuse la clé. Après le
  premier déploiement, vérifiez-le en une commande :

      curl -i https://<votre-site>/api/auth

  405 : les fonctions tournent. Autre chose : elles ne tournent pas.
`);
