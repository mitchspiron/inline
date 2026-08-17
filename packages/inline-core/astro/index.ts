/**
 * L'intégration Astro d'`inline`.
 *
 *   import inline from 'inline-core/astro';
 *
 *   export default defineConfig({
 *     output: 'static',
 *     integrations: [inline({ locales: ['fr'] })],
 *   });
 *
 * Elle câble ce qu'un site câblerait à la main, et rien de plus : les pages
 * `/admin` et `/aide`, la construction de l'overlay, l'amorce d'édition, et la
 * bibliothèque d'images que les composants doivent pouvoir lire.
 *
 * Volontairement mince et sans magie. Une intégration ajoute une couche entre
 * le développeur et Astro : quand elle casse, l'erreur est moins lisible. Tout
 * ce qui peut rester un fichier ordinaire du site en reste un.
 */
// Importé statiquement, et pas à la demande : le hook de fin de build
// s'exécute après la fermeture du chargeur de modules de Vite, où un
// « import() » échoue.
import { build as esbuild } from 'esbuild';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface InlineOptions {
  /**
   * Codes des langues du site, la référence en premier. Un site monolingue en
   * déclare une seule. C'est la seule chose qu'`inline` ne peut pas savoir.
   */
  locales: readonly string[];
  /** Adresse affichée au client quand il a besoin d'aide ou d'une nouvelle clé. */
  support?: { email: string };
  /**
   * La charte du site : le fichier CSS qui définit les variables consommées
   * par `styles/tokens.css`. Les pages fournies clé en main s'habillent avec.
   */
  theme?: string;
  /**
   * Pages fournies clé en main. Passer `false` pour l'une d'elles quand le
   * site veut la sienne — un fichier `src/pages/admin.astro` la remplace alors
   * intégralement.
   */
  pages?: { admin?: boolean; help?: boolean };
}

/** Emplacement des sources du paquet, quel que soit l'endroit d'où il est chargé. */
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');

/**
 * Amorce d'édition — 200 octets, en clair dans le `<head>`.
 *
 * Un visiteur ordinaire n'exécute qu'une lecture de cookie et ne télécharge
 * rien : le contenu de la page ne dépend d'aucun JavaScript. Le témoin ne
 * porte aucun secret et ne donne aucun droit ; toutes les écritures restent
 * soumises au cookie de session, vérifié côté serveur.
 *
 * L'attente de `DOMContentLoaded` n'est pas décorative : injecté depuis le
 * `<head>`, un script de module s'exécute dès qu'il est chargé, donc
 * possiblement avant que `<body>` existe — et l'overlay lit ses repères sur
 * `body`.
 */
const LOADER =
  'document.cookie.includes("inline_edit=1")&&addEventListener("DOMContentLoaded",' +
  'function(){document.head.appendChild(Object.assign(document.createElement("script"),' +
  '{type:"module",src:"/editor/overlay.js"}))})';

/** Ce que la construction de l'overlay produit, en dev comme en production. */
const OVERLAY_ENTRY = join(packageRoot, 'src/editor/index.ts');

async function buildOverlay(outdir: string): Promise<void> {
  await esbuild({
    entryPoints: [OVERLAY_ENTRY],
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2020',
    // Le découpage n'est pas cosmétique : l'assainisseur et le décodeur de
    // photos d'iPhone ne se téléchargent qu'au moment où ils servent. Sans
    // lui, l'overlay dépasse largement son budget.
    splitting: true,
    outdir,
    entryNames: 'overlay',
    chunkNames: '[name]-[hash]',
    logLevel: 'error',
  });
}

/**
 * La bibliothèque d'images du site.
 *
 * `Media.astro` vit dans le paquet, les images vivent dans le site : le motif
 * de recherche doit donc s'exécuter côté site, sinon il ne trouve rien. Un
 * fichier de trois lignes fait le pont, et l'intégration le crée s'il manque.
 *
 * Le motif y est **relatif**. Un motif absolu est résolu depuis la racine du
 * projet, dont l'écriture varie selon la façon dont le build est lancé — sous
 * Windows, la casse de la lettre de lecteur suffit à le faire échouer.
 */
const LIBRARY_SOURCE = `/**
 * Bibliothèque d'images du site — créé par l'intégration inline, à laisser tel quel.
 *
 * Les composants du paquet ne peuvent pas chercher les images à votre place :
 * le motif doit s'exécuter ici, dans votre projet. Le motif est relatif à ce
 * fichier, jamais absolu.
 */
export const library = import.meta.glob<{ default: ImageMetadata }>(
  './**/*.{png,jpg,jpeg,webp,avif}',
  { eager: true },
);
`;

function ensureLibrary(srcDir: URL, logger: { info: (message: string) => void }): string {
  const mediaDir = join(fileURLToPath(srcDir), 'media');
  const libraryFile = join(mediaDir, 'library.ts');

  if (!existsSync(libraryFile)) {
    mkdirSync(mediaDir, { recursive: true });
    writeFileSync(libraryFile, LIBRARY_SOURCE);
    logger.info('src/media/library.ts créé — la bibliothèque d\'images du site.');
  }

  return libraryFile;
}

export default function inline(options: InlineOptions) {
  if (!Array.isArray(options?.locales) || options.locales.length === 0) {
    throw new Error(
      "[inline] Il faut déclarer au moins une langue : inline({ locales: ['fr'] }).",
    );
  }
  for (const locale of options.locales) {
    if (!/^[a-z]{2}$/.test(locale)) {
      throw new Error(`[inline] Code de langue invalide : « ${locale} ». Deux lettres minuscules.`);
    }
  }

  const wantAdmin = options.pages?.admin !== false;
  const wantHelp = options.pages?.help !== false;

  return {
    name: 'inline',
    hooks: {
      'astro:config:setup'({ config, injectRoute, injectScript, updateConfig, logger }: any) {
        // Règle 1 du projet, vérifiée là où elle se décide. En sortie serveur,
        // le contenu ne serait plus figé dans le HTML et les routes de
        // /functions ne seraient plus les seules à écrire.
        if (config.output && config.output !== 'static') {
          throw new Error(
            `[inline] output: '${config.output}' n'est pas supporté. ` +
              "inline construit des sites statiques ; toute route dynamique passe par /functions.",
          );
        }

        const libraryFile = ensureLibrary(config.srcDir, logger);

        // La charte appartient au site : les pages du paquet ne peuvent pas
        // l'importer par un chemin, seulement par un nom que l'intégration
        // résout.
        const themeFile = join(
          fileURLToPath(config.root),
          options.theme ?? 'src/styles/theme.css',
        );
        if (!existsSync(themeFile)) {
          throw new Error(
            `[inline] Charte introuvable : ${themeFile}\n` +
              "        Créez-la, ou indiquez-en une autre : inline({ theme: 'src/styles/ma-charte.css' }).",
          );
        }

        // Les pages sont désignées par leur nom de paquet, jamais par un
        // chemin de fichier : Astro attend un spécificateur qu'il résout
        // lui-même, et un chemin Windows ne survit pas au trajet.
        if (wantAdmin) {
          injectRoute({ pattern: '/admin', entrypoint: 'inline-core/pages/admin.astro' });
        }
        if (wantHelp) {
          injectRoute({ pattern: '/aide', entrypoint: 'inline-core/pages/aide.astro' });
        }

        injectScript('head-inline', LOADER);

        updateConfig({
          vite: {
            plugins: [
              configModule(options),
              pathAlias('inline:media', libraryFile),
              pathAlias('inline:theme', themeFile),
              overlayInDev(),
            ],
          },
        });
      },

      async 'astro:build:done'({ dir }: any) {
        await buildOverlay(join(fileURLToPath(dir), 'editor'));
      },
    },
  };
}

// --- Modules virtuels -----------------------------------------------------------

const CONFIG_ID = 'inline:config';

/**
 * Rend la configuration lisible par les pages du paquet.
 *
 * Sans cela, `/admin` et `/aide` devraient importer un fichier du site, ce
 * qu'un paquet ne peut pas faire.
 */
function configModule(options: InlineOptions) {
  const resolved = `\0${CONFIG_ID}`;
  return {
    name: 'inline:config',
    resolveId(id: string) {
      return id === CONFIG_ID ? resolved : null;
    },
    load(id: string) {
      if (id !== resolved) return null;
      return `export const locales = ${JSON.stringify(options.locales)};
export const defaultLocale = ${JSON.stringify(options.locales[0])};
export const support = ${JSON.stringify(options.support ?? null)};`;
    },
  };
}

/**
 * Fait pointer un nom vers un vrai fichier du site.
 *
 * Pas de module virtuel ici, et c'est délibéré : la bibliothèque d'images et
 * la charte sont des fichiers que le développeur ouvre, modifie et voit dans
 * les traces d'erreur. Un contenu synthétisé à la volée ne se déboguerait pas.
 */
function pathAlias(name: string, file: string) {
  return {
    name: `alias:${name}`,
    resolveId(id: string) {
      return id === name ? file : null;
    },
  };
}

/**
 * Sert l'overlay pendant le développement, à la même adresse qu'en production.
 *
 * Il serait tentant de laisser Vite servir la source directement. Le chemin
 * dépendrait alors de l'endroit d'où le paquet est chargé — dossier de travail
 * ici, `node_modules` chez un client — et le `<script>` posé dans la page ne
 * serait pas le même en dev et en production. Une seule adresse, un seul
 * chemin de code.
 */
function overlayInDev() {
  return {
    name: 'inline:overlay-dev',
    apply: 'serve' as const,
    configureServer(server: any) {
      const outdir = join(tmpdir(), 'inline-overlay-dev');

      server.middlewares.use(async (request: any, response: any, next: any) => {
        const url = (request.url ?? '').split('?')[0];
        if (!url.startsWith('/editor/')) return next();

        try {
          // Reconstruit à chaque demande : l'overlay se compile en moins de
          // cent millisecondes, ce qui évite d'inventer une invalidation de
          // cache pour rien.
          await buildOverlay(outdir);
          const file = join(outdir, url.slice('/editor/'.length));
          if (!existsSync(file)) return next();
          response.setHeader('content-type', 'text/javascript; charset=utf-8');
          createReadStream(file).pipe(response);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
