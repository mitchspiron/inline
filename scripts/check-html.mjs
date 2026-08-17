#!/usr/bin/env node
/**
 * Filet de sécurité contre une hydratation posée par réflexe.
 *
 * Vérifie, sur le HTML réellement construit :
 *   1. chaque valeur texte du JSON est présente dans la source HTML ;
 *   2. chaque `data-cms` du HTML pointe vers une clé qui existe dans le JSON ;
 *   3. aucune île hydratée n'est présente dans la page.
 *
 * Sort en code 1 au moindre manquement.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Lot 0 : une page. La table s'étendra avec le routage multilingue. */
const PAGES = [
  { content: 'src/content/pages/fr/home.json', html: 'dist/index.html' },
];

const errors = [];

/** Ramène le HTML à du texte comparable : entités décodées, espaces normalisés. */
function decode(html) {
  return html
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** Aplatit les champs textuels du JSON en { chemin: valeur }. */
function collectTextFields(node, path = [], out = {}) {
  if (node && typeof node === 'object' && (node.type === 'text' || node.type === 'richtext')) {
    out[path.join('.')] = { kind: node.type, value: node.value };
    return out;
  }
  if (node && typeof node === 'object' && node.type === 'media') {
    out[path.join('.')] = { kind: node.kind, field: node };
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      collectTextFields(child, [...path, key], out);
    }
  }
  return out;
}

for (const page of PAGES) {
  const contentPath = join(root, page.content);
  const htmlPath = join(root, page.html);

  if (!existsSync(htmlPath)) {
    errors.push(`${page.html} est absent — lancer « npm run build » d'abord.`);
    continue;
  }

  const data = JSON.parse(readFileSync(contentPath, 'utf8'));
  const rawHtml = readFileSync(htmlPath, 'utf8');
  const haystack = decode(rawHtml);
  const fields = collectTextFields(data);

  // 1. Tout le contenu est dans le HTML servi.
  for (const [path, entry] of Object.entries(fields)) {
    if (entry.kind === 'text' || entry.kind === 'richtext') {
      const needle = entry.value.replace(/\s+/g, ' ').trim();
      if (!haystack.includes(needle)) {
        errors.push(`${page.html} : la valeur de « ${path} » est absente du HTML brut.`);
      }
      continue;
    }

    if (entry.kind === 'image') {
      // Le fichier est renommé au build ; son nom d'origine reste reconnaissable.
      const stem = entry.field.src.replace(/\.[^.]*$/, '');
      if (!rawHtml.includes(stem)) {
        errors.push(`${page.html} : l'image de « ${path} » n'apparaît pas dans le HTML brut.`);
      }
      if (!haystack.includes(entry.field.alt.replace(/\s+/g, ' ').trim())) {
        errors.push(`${page.html} : la description de l'image « ${path} » est absente.`);
      }
      // width et height sont exigés partout : sans eux, la page saute au chargement.
      const tag = new RegExp(`<img[^>]*${stem}[^>]*>`).exec(rawHtml)?.[0] ?? '';
      if (!/width="\d+"/.test(tag) || !/height="\d+"/.test(tag)) {
        errors.push(`${page.html} : l'image de « ${path} » n'a pas ses dimensions.`);
      }
      continue;
    }

    if (entry.kind === 'video') {
      if (!rawHtml.includes(entry.field.videoId)) {
        errors.push(`${page.html} : la vidéo de « ${path} » n'apparaît pas dans le HTML brut.`);
      }
      if (!haystack.includes(entry.field.title.replace(/\s+/g, ' ').trim())) {
        errors.push(`${page.html} : le titre de la vidéo « ${path} » est absent.`);
      }
    }
  }

  // 2. Aucun data-cms orphelin.
  for (const match of rawHtml.matchAll(/data-cms="([^"]+)"/g)) {
    if (!(match[1] in fields)) {
      errors.push(`${page.html} : data-cms="${match[1]}" ne correspond à aucun champ du contenu.`);
    }
  }

  // 3. Aucune île hydratée : le contenu ne doit dépendre d'aucun JS.
  if (/astro-island|client:(load|idle|visible|media|only)/.test(rawHtml)) {
    errors.push(`${page.html} : une hydratation de composant est présente (directive client:*).`);
  }
}

if (errors.length > 0) {
  console.error('\n  Contrôle du HTML : échec\n');
  for (const error of errors) console.error(`  ✗ ${error}`);
  console.error('');
  process.exit(1);
}

console.log(`  Contrôle du HTML : ${PAGES.length} page(s) vérifiée(s), contenu bien dans la source.`);
