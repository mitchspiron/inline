#!/usr/bin/env node
/**
 * Parité des clés entre locales.
 *
 * Une clé ajoutée dans une seule langue est le défaut le plus discret du
 * multilingue : le site se construit, la page s'affiche — avec le texte de la
 * langue par défaut — et personne ne voit rien. Ce contrôle est ce qui fait
 * qu'on le voit.
 *
 * Il signale, dans les deux sens :
 *   - une clé présente dans la langue de référence et absente d'une traduction ;
 *   - une clé présente dans une traduction et inconnue de la référence, qui ne
 *     serait jamais affichée ;
 *   - un item de collection présent d'un côté seulement ;
 *   - une page entière non traduite.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(root, 'src/content/pages');

/** Doit rester d'accord avec src/lib/locales.ts. */
const LOCALES = ['fr'];
const DEFAULT_LOCALE = 'fr';

const errors = [];

/** Aplatit le contenu en chemins de champs. Les items sont repérés par leur identifiant. */
function collectPaths(node, path = [], out = new Set()) {
  if (node && typeof node === 'object' && typeof node.type === 'string') {
    out.add(path.join('.'));
    return out;
  }
  if (Array.isArray(node)) {
    for (const entry of node) {
      if (entry && typeof entry === 'object' && typeof entry.id === 'string') {
        collectPaths(entry, [...path, entry.id], out);
      }
    }
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      if (key === 'id') continue;
      collectPaths(child, [...path, key], out);
    }
  }
  return out;
}

function pagesOf(locale) {
  const directory = join(CONTENT, locale);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length));
}

const referencePages = pagesOf(DEFAULT_LOCALE);
if (referencePages.length === 0) {
  console.error(`  ✗ Aucune page dans la langue de référence (${DEFAULT_LOCALE}).`);
  process.exit(1);
}

let compared = 0;

for (const locale of LOCALES) {
  if (locale === DEFAULT_LOCALE) continue;

  // Une page traduite sans équivalent dans la référence n'est rattachée à rien.
  for (const page of pagesOf(locale)) {
    if (!referencePages.includes(page)) {
      errors.push(`${locale}/${page}.json existe, mais pas ${DEFAULT_LOCALE}/${page}.json.`);
    }
  }

  for (const page of referencePages) {
    const translationPath = join(CONTENT, locale, `${page}.json`);
    if (!existsSync(translationPath)) {
      errors.push(`${locale}/${page}.json est absent — la page n'est pas traduite.`);
      continue;
    }

    const reference = collectPaths(
      JSON.parse(readFileSync(join(CONTENT, DEFAULT_LOCALE, `${page}.json`), 'utf8')),
    );
    const translation = collectPaths(JSON.parse(readFileSync(translationPath, 'utf8')));
    compared += 1;

    for (const key of reference) {
      if (!translation.has(key)) {
        errors.push(`${locale}/${page}.json : « ${key} » n'est pas traduit.`);
      }
    }
    for (const key of translation) {
      if (!reference.has(key)) {
        errors.push(
          `${locale}/${page}.json : « ${key} » n'existe pas dans ${DEFAULT_LOCALE} — ` +
            'cette clé ne sera jamais affichée.',
        );
      }
    }
  }
}

if (errors.length > 0) {
  console.error('\n  Parité des locales : échec\n');
  for (const error of errors) console.error(`  ✗ ${error}`);
  console.error('');
  process.exit(1);
}

console.log(
  `  Parité des locales : ${compared} page(s) comparée(s) sur ${LOCALES.length} langues, aucune clé manquante.`,
);
