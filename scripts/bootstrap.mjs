#!/usr/bin/env node
/**
 * Amorçage : extrait le JSON de contenu d'une page HTML déjà annotée.
 *
 *   npm run bootstrap -- --html chemin/page.html --page home --langue fr
 *   npm run bootstrap -- --html chemin/page.html --page home --essai
 *
 * Options : --html (obligatoire), --page, --langue, --essai (n'écrit rien),
 * --sortie (écrire ailleurs qu'à l'emplacement standard du contenu).
 *
 * Le chemin de reprise d'un site existant tient en deux temps :
 *
 *   1. poser les annotations dans le HTML — `data-cms` sur ce qui doit être
 *      modifiable, `data-cms-list` / `data-cms-item` sur les listes. C'est un
 *      travail de lecture, pas de réécriture : la structure ne bouge pas ;
 *   2. lancer cette commande, qui lit les valeurs **déjà présentes dans la
 *      page** et en fait le fichier de contenu.
 *
 * Le deuxième temps est automatique. Le premier ne peut pas l'être : décider
 * ce que le client a le droit de changer est une décision, pas une déduction.
 *
 * Rien n'est écrit tant que le résultat ne passe pas le schéma. Ce qui n'a pas
 * pu être déduit est listé à la fin plutôt que rempli d'une valeur plausible :
 * une description d'image inventée est pire qu'une description manquante.
 */
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function option(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const htmlPath = option('html');
const page = option('page', 'home');
const locale = option('langue', 'fr');
const dryRun = flag('essai');
/** Destination explicite — sinon l'emplacement standard du contenu. */
const outPath = option('sortie');

if (!htmlPath || !existsSync(htmlPath)) {
  console.error(
    '\n  Usage : npm run bootstrap -- --html <page.html> [--page home] [--langue fr] [--essai]\n',
  );
  process.exit(1);
}

// Le schéma et les tokens viennent du paquet : l'amorçage produit exactement
// ce que le build et la fonction d'écriture accepteront, pas une approximation.
const workspace = await mkdtemp(join(tmpdir(), 'inline-bootstrap-'));
async function load(entry) {
  const outfile = join(workspace, `${entry.replace(/[^a-z]/gi, '-')}.mjs`);
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
const { pageSchema } = await load('packages/inline-core/src/schema.ts');
const { SIZES, WEIGHTS, ALIGNMENTS, COLORS } = await load('packages/inline-core/src/style-tokens.ts');
const { parseVideoUrl } = await load('packages/inline-core/src/video.ts');

const DEFAULT_STYLE = { size: 'base', weight: 'regular', italic: false, align: 'left', color: 'primary' };

/** Ce que la page n'a pas permis de déduire — listé, jamais deviné. */
const gaps = [];
const note = (where, what) => gaps.push({ where, what });

/** Relit les tokens de style depuis les classes, à défaut les valeurs par défaut. */
function styleOf(element) {
  const has = (name) => element.classList.contains(name);
  return {
    size: SIZES.find((v) => has(`cms-size-${v}`)) ?? DEFAULT_STYLE.size,
    weight: WEIGHTS.find((v) => has(`cms-weight-${v}`)) ?? DEFAULT_STYLE.weight,
    italic: has('cms-italic'),
    align: ALIGNMENTS.find((v) => has(`cms-align-${v}`)) ?? DEFAULT_STYLE.align,
    color: COLORS.find((v) => has(`cms-color-${v}`)) ?? DEFAULT_STYLE.color,
  };
}

/** Le nom de fichier tel que le dépôt le portera, sans dossier ni requête. */
function mediaName(src, where) {
  const bare = String(src).split('?')[0].split('#')[0].split('/').pop() ?? '';
  const normalized = bare
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.(jpg|png|webp)$/.test(normalized)) {
    note(where, `nom de fichier à reprendre à la main (« ${bare} »)`);
  }
  return normalized;
}

function extractField(element, path) {
  const declared = element.dataset.cmsType;

  if (declared === 'media') {
    if (element.tagName === 'IFRAME' || element.querySelector('iframe')) {
      const frame = element.tagName === 'IFRAME' ? element : element.querySelector('iframe');
      const reference = parseVideoUrl(frame.getAttribute('src') ?? '');
      if (!reference) {
        note(path, 'vidéo non reconnue — coller son adresse dans l\'éditeur');
        return null;
      }
      const title = frame.getAttribute('title') ?? '';
      if (!title) note(path, 'titre de la vidéo absent');
      return { type: 'media', kind: 'video', ...reference, title: title || 'Vidéo' };
    }

    const image = element.tagName === 'IMG' ? element : element.querySelector('img');
    if (!image) {
      note(path, 'ni image ni vidéo trouvée');
      return null;
    }
    const alt = image.getAttribute('alt') ?? '';
    if (!alt) note(path, 'description de l\'image absente — à écrire avant publication');
    const width = Number(image.getAttribute('width'));
    const height = Number(image.getAttribute('height'));
    if (!width || !height) note(path, 'dimensions absentes de la balise — reprises à 0, à corriger');
    return {
      type: 'media',
      kind: 'image',
      src: mediaName(image.getAttribute('src') ?? '', path),
      alt,
      width: width || 0,
      height: height || 0,
    };
  }

  if (declared === 'richtext') {
    return { type: 'richtext', value: element.innerHTML.trim().replace(/\s+/g, ' ') };
  }

  const value = (element.textContent ?? '').trim().replace(/\s+/g, ' ');
  if (!value) note(path, 'texte vide dans la page');
  return { type: 'text', value, style: styleOf(element) };
}

/** Pose une valeur à un chemin pointé, en créant les niveaux manquants. */
function assign(target, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let node = target;
  for (const key of keys) {
    node[key] ??= {};
    node = node[key];
  }
  node[last] = value;
}

const dom = new JSDOM(readFileSync(htmlPath, 'utf8'));
const { document } = dom.window;

const title = document.querySelector('title')?.textContent?.trim() ?? '';
const description =
  document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '';
if (!title) note('meta.title', 'balise <title> absente');
if (!description) note('meta.description', 'meta description absente');

const content = {
  meta: { title: title.slice(0, 60), description: description.slice(0, 160) },
  blocks: {},
};

// --- Listes d'abord : leurs champs ne doivent pas atterrir dans « blocks » ----
const listed = new Set();
for (const list of document.querySelectorAll('[data-cms-list]')) {
  const name = list.dataset.cmsList;
  if (!name?.startsWith('collections.')) {
    note(name ?? '(sans nom)', 'liste ignorée : le nom doit commencer par « collections. »');
    continue;
  }
  const key = name.slice('collections.'.length);
  const items = [];
  const seen = new Set();

  for (const item of list.querySelectorAll('[data-cms-item]')) {
    const id = item.dataset.cmsItem;
    if (!id || seen.has(id)) {
      note(name, `identifiant d'item manquant ou en double (« ${id ?? ''} »)`);
      continue;
    }
    seen.add(id);

    const entry = { id };
    for (const field of item.querySelectorAll('[data-cms]')) {
      const path = field.dataset.cms;
      listed.add(path);
      // Le chemin complet est « collections.x.id.champ » : seul le dernier
      // segment nomme le champ dans l'item.
      const local = path.split('.').pop();
      const value = extractField(field, path);
      if (value) entry[local] = value;
    }
    items.push(entry);
  }

  if (items.length === 0) note(name, 'liste sans item exploitable');
  content.collections ??= {};
  content.collections[key] = items;
}

// --- Puis les champs simples --------------------------------------------------
for (const element of document.querySelectorAll('[data-cms]')) {
  const path = element.dataset.cms;
  if (!path || listed.has(path)) continue;
  if (!path.startsWith('blocks.')) {
    note(path, 'chemin ignoré : un champ simple doit commencer par « blocks. »');
    continue;
  }
  const value = extractField(element, path);
  if (value) assign(content, path, value);
}

// --- Validation ---------------------------------------------------------------
const validation = pageSchema.safeParse(content);
const target = outPath || join(root, 'src/content/pages', locale, `${page}.json`);

console.log(`\nAmorçage de « ${page} » en « ${locale} » depuis ${htmlPath}\n`);
console.log(`  champs simples   ${Object.values(content.blocks).reduce((n, b) => n + Object.keys(b).length, 0)}`);
for (const [name, items] of Object.entries(content.collections ?? {})) {
  console.log(`  liste ${name}${' '.repeat(Math.max(1, 12 - name.length))}${items.length} item(s)`);
}

// Les manques d'abord : ce sont eux qui expliquent le plus souvent l'échec
// du schéma qui suit.
if (gaps.length > 0) {
  console.log('\n  À reprendre à la main :\n');
  for (const gap of gaps) console.log(`    · ${gap.where} — ${gap.what}`);
}

if (!validation.success) {
  console.error('\n  Le contenu extrait ne passe pas le schéma — rien n\'a été écrit :\n');
  for (const issue of validation.error.issues.slice(0, 10)) {
    console.error(`    ✗ ${issue.path.join('.') || '(racine)'} : ${issue.message}`);
  }
  console.error(
    '\n  Compléter la page HTML (description et dimensions des images, notamment),\n' +
      '  puis relancer. Le schéma appliqué ici est celui du build et de la\n' +
      "  publication : ce qui passe ici passera partout.\n",
  );
  await rm(workspace, { recursive: true, force: true });
  process.exit(1);
}

if (dryRun) {
  console.log('\n  Essai : rien écrit. Relancer sans --essai pour produire le fichier.\n');
} else if (existsSync(target)) {
  console.error(`\n  ✗ ${target} existe déjà — rien n'a été écrit.\n`);
  await rm(workspace, { recursive: true, force: true });
  process.exit(1);
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(content, null, 2)}\n`);
  console.log(`\n  Écrit : ${target}`);
  console.log('  Copier ensuite les images dans src/media/, puis « npm run build ».\n');
}

await rm(workspace, { recursive: true, force: true });
