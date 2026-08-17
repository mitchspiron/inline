#!/usr/bin/env node
/**
 * Multilingue : repli de traduction et pages construites.
 *
 *   node scripts/test-locales.mjs
 *
 * Deux niveaux : la fusion d'une traduction avec la langue de référence, testée
 * en isolation, et ce que le build en fait réellement — une URL par langue,
 * des liens réciproques, et aucune bascule par JavaScript.
 */
import { build } from 'esbuild';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const dir = await mkdtemp(join(tmpdir(), 'inline-locales-'));
const outfile = join(dir, 'locales.mjs');
await build({
  entryPoints: [join(root, 'src/lib/locales.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2020',
  outfile,
  logLevel: 'error',
});
const { mergeWithDefault, localePath, LOCALES, DEFAULT_LOCALE } = await import(
  pathToFileURL(outfile).href
);

// --- Repli de traduction ------------------------------------------------------
console.log('\nRepli de traduction');

const text = (value) => ({ type: 'text', value, style: { size: 'base' } });

const reference = {
  meta: { title: 'Titre', description: 'Description' },
  blocks: {
    hero: { title: text('Bonjour'), subtitle: text('Sous-titre') },
  },
  collections: {
    testimonials: [
      { id: 't-001', quote: text('Avis un') },
      { id: 't-002', quote: text('Avis deux') },
    ],
  },
};

const complete = mergeWithDefault(reference, {
  meta: { title: 'Title', description: 'Description' },
  blocks: { hero: { title: text('Hello'), subtitle: text('Subtitle') } },
  collections: {
    testimonials: [
      { id: 't-001', quote: text('Review one') },
      { id: 't-002', quote: text('Review two') },
    ],
  },
});
check('une traduction complète ne signale rien', complete.untranslated.length === 0, complete.untranslated.join(','));
check('elle affiche bien la traduction', complete.data.blocks.hero.title.value === 'Hello');

const partial = mergeWithDefault(reference, {
  meta: { title: 'Title', description: 'Description' },
  blocks: { hero: { title: text('Hello') } },
  collections: { testimonials: [{ id: 't-001', quote: text('Review one') }] },
});
check(
  'un champ absent est repris de la référence',
  partial.data.blocks.hero.subtitle.value === 'Sous-titre',
  partial.data.blocks.hero.subtitle?.value,
);
check('il est signalé comme non traduit', partial.untranslated.includes('blocks.hero.subtitle'), partial.untranslated.join(','));
check(
  'un item de liste absent est repris',
  partial.data.collections.testimonials.length === 2 &&
    partial.data.collections.testimonials[1].quote.value === 'Avis deux',
);
check('il est signalé aussi', partial.untranslated.includes('collections.testimonials.t-002'), partial.untranslated.join(','));
check('le champ traduit reste traduit', partial.data.blocks.hero.title.value === 'Hello');
check('rien n\'est jamais vide', JSON.stringify(partial.data).includes('Sous-titre'));

// Les items se réconcilient par identifiant, pas par position.
const reordered = mergeWithDefault(reference, {
  meta: { title: 'Title', description: 'Description' },
  blocks: { hero: { title: text('Hello'), subtitle: text('Subtitle') } },
  collections: {
    testimonials: [
      { id: 't-002', quote: text('Review two') },
      { id: 't-001', quote: text('Review one') },
    ],
  },
});
check(
  'un item traduit dans un autre ordre reste sur le bon item',
  reordered.data.collections.testimonials[0].quote.value === 'Review one' &&
    reordered.data.collections.testimonials[1].quote.value === 'Review two',
  JSON.stringify(reordered.data.collections.testimonials.map((i) => [i.id, i.quote.value])),
);

const missingPage = mergeWithDefault(reference, undefined);
check('une page non traduite est entièrement reprise', missingPage.data.blocks.hero.title.value === 'Bonjour');
check('et signalée comme telle', missingPage.untranslated.includes('*'));

check('l\'adresse de la page d\'accueil porte le préfixe de langue', localePath('en', 'home') === '/en/');
check('une autre page garde son segment', localePath('fr', 'services') === '/fr/services/');

// --- Pages construites ---------------------------------------------------------
console.log('\nPages construites');

const pages = LOCALES.map((locale) => ({
  locale,
  path: join(root, 'dist', locale, 'index.html'),
}));

if (pages.some((page) => !existsSync(page.path))) {
  console.error('  ✗ pages absentes — lancer « npm run build » d\'abord.');
  await rm(dir, { recursive: true, force: true });
  process.exit(1);
}

const html = Object.fromEntries(pages.map((page) => [page.locale, readFileSync(page.path, 'utf8')]));

for (const locale of LOCALES) {
  const page = html[locale];
  check(`/${locale}/ est construite`, page.length > 0);
  check(`/${locale}/ déclare sa langue`, new RegExp(`<html lang="${locale}"`).test(page));

  // Réciprocité : chaque page cite toutes les langues, elle comprise.
  for (const other of LOCALES) {
    check(
      `/${locale}/ pointe vers ${other}`,
      new RegExp(`rel="alternate" hreflang="${other}" href="[^"]*/${other}/"`).test(page),
    );
  }
  check(
    `/${locale}/ déclare x-default vers la langue de référence`,
    new RegExp(`hreflang="x-default" href="[^"]*/${DEFAULT_LOCALE}/"`).test(page),
  );
  check(
    `/${locale}/ propose les autres langues en vrais liens`,
    LOCALES.every((other) => new RegExp(`<a href="/${other}/"`).test(page)),
  );
}

check(
  'les deux pages ont un contenu distinct',
  html.fr !== html.en && html.en.includes('We build websites that convert'),
);
check(
  'chaque page a un seul h1',
  LOCALES.every((locale) => (html[locale].match(/<h1[\s>]/g) ?? []).length === 1),
);

// Aucune bascule de langue par JavaScript : le contenu ne dépend d'aucun script.
for (const locale of LOCALES) {
  const scripts = [...html[locale].matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  check(
    `/${locale}/ ne contient aucun script de bascule de langue`,
    !scripts.some(([, body]) => /lang|locale|i18n|translat/i.test(body)),
  );
  check(`/${locale}/ n'a aucune île hydratée`, !/astro-island|client:(load|idle|visible)/.test(html[locale]));
}

const rootPage = join(root, 'dist/index.html');
if (existsSync(rootPage)) {
  const redirect = readFileSync(rootPage, 'utf8');
  check(
    'la racine redirige vers la langue de référence sans JavaScript',
    /http-equiv="refresh"/i.test(redirect) &&
      redirect.includes(`/${DEFAULT_LOCALE}/`) &&
      !/<script/i.test(redirect),
  );
  check('et elle n\'est pas indexée', /noindex/i.test(redirect));
}

await rm(dir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} contrôle(s) en échec.\n`);
  process.exit(1);
}
console.log('\nMultilingue : tous les contrôles passent.\n');
