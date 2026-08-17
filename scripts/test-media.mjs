#!/usr/bin/env node
/**
 * Contrôles des médias, sans réseau.
 *
 *   node scripts/test-media.mjs
 *
 * Trois choses y sont vérifiées :
 *   - la reconnaissance d'un fichier à ses octets, pas à ce qu'il déclare ;
 *   - la lecture des dimensions dans l'en-tête, comparée à la vérité de sharp ;
 *   - la lecture d'une adresse de vidéo, dans toutes les formes qu'un client
 *     est susceptible de coller.
 */
import { build } from 'esbuild';
import sharp from 'sharp';
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

async function load(entry) {
  const dir = await mkdtemp(join(tmpdir(), 'inline-media-'));
  const outfile = join(dir, 'module.mjs');
  await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2020',
    outfile,
    logLevel: 'error',
  });
  const module = await import(pathToFileURL(outfile).href);
  return { module, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const image = await load('functions/lib/image.ts');
const video = await load('src/lib/video.ts');
const panel = await load('src/editor/media.ts');

const { inspectImage, describeRejectedFormat, normalizeFileName, uniqueFileName } = image.module;
const { parseVideoUrl, isValidVideoReference, embedUrl } = video.module;
const { computeCrop, suggestAlt } = panel.module;

// --- Reconnaissance et dimensions --------------------------------------------
console.log('\nReconnaissance des fichiers');

/** Une photo de téléphone : cas nominal du projet, pas cas limite. */
const phonePhoto = await sharp({
  create: { width: 4032, height: 3024, channels: 3, background: { r: 90, g: 120, b: 160 } },
})
  .jpeg({ quality: 100 })
  .toBuffer();

check(
  `une photo de 4032 × 3024 (${Math.round(phonePhoto.length / 1024 / 1024)} Mo) est reconnue`,
  inspectImage(new Uint8Array(phonePhoto))?.format === 'jpeg',
);
const phoneInfo = inspectImage(new Uint8Array(phonePhoto));
check(
  'ses dimensions sont lues correctement',
  phoneInfo?.width === 4032 && phoneInfo?.height === 3024,
  `${phoneInfo?.width} × ${phoneInfo?.height}`,
);

for (const [format, make] of [
  ['png', () => sharp({ create: { width: 640, height: 480, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer()],
  ['webp', () => sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 4, g: 5, b: 6 } } }).webp().toBuffer()],
  ['webp', () => sharp({ create: { width: 123, height: 456, channels: 4, background: { r: 4, g: 5, b: 6, alpha: 0.5 } } }).webp().toBuffer()],
  ['jpeg', () => sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 7, g: 8, b: 9 } } }).jpeg().toBuffer()],
]) {
  const buffer = await make();
  const truth = await sharp(buffer).metadata();
  const read = inspectImage(new Uint8Array(buffer));
  check(
    `${format} ${truth.width} × ${truth.height} : format et dimensions`,
    read?.format === format && read?.width === truth.width && read?.height === truth.height,
    `lu : ${read?.format} ${read?.width} × ${read?.height}`,
  );
}

console.log('\nFichiers refusés');

/** En-tête d'un MP4 : « ....ftypisom ». Un client déposera un jour une vidéo. */
const mp4 = new Uint8Array([
  0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  ...new Array(20).fill(0),
]);
check('un fichier vidéo n\'est pas pris pour une image', inspectImage(mp4) === null);
check('et il est reconnu comme vidéo', describeRejectedFormat(mp4) === 'video');

const heic = new Uint8Array([
  0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
  ...new Array(20).fill(0),
]);
check('une photo HEIC est reconnue comme telle', describeRejectedFormat(heic) === 'heic');

const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
check('un SVG est refusé', inspectImage(svg) === null);
check('et reconnu comme SVG', describeRejectedFormat(svg) === 'svg');

const html = new TextEncoder().encode('<!doctype html><html><body>pas une image</body></html>');
check('un fichier quelconque est refusé', inspectImage(html) === null);

// Un JPEG dont on a menti sur le nom reste un JPEG.
const renamed = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#123456' } })
  .jpeg()
  .toBuffer();
check(
  'le format vient des octets, pas de l\'extension',
  inspectImage(new Uint8Array(renamed))?.format === 'jpeg',
);

// --- Renommage ----------------------------------------------------------------
console.log('\nRenommage');

for (const [input, format, expected] of [
  ['Photo de l\'Équipe.JPG', 'jpeg', 'photo-de-l-equipe.jpg'],
  ['mon image   avec espaces.png', 'png', 'mon-image-avec-espaces.png'],
  ['Été 2024 — Réunion.jpeg', 'jpeg', 'ete-2024-reunion.jpg'],
  // Il ne reste rien d'exploitable : le nom retombe sur la valeur par défaut.
  ['../../etc/passwd', 'png', 'image.png'],
  ['.hidden', 'webp', 'image.webp'],
  ['%%%.jpg', 'jpeg', 'image.jpg'],
  ['ÀÉÎÕÜ.png', 'png', 'aeiou.png'],
]) {
  const result = normalizeFileName(input, format);
  check(`« ${input} » → « ${expected} »`, result === expected, result);
}

check('aucun nom ne contient de majuscule, d\'accent ou d\'espace',
  ['Photo Été.JPG', 'ÇA VA.png'].every((name) => /^[a-z0-9.-]+$/.test(normalizeFileName(name, 'jpeg'))));

const taken = new Set(['photo.jpg', 'photo-2.jpg']);
check(
  'un nom déjà pris reçoit un suffixe plutôt que d\'écraser',
  uniqueFileName('photo.jpg', (name) => taken.has(name)) === 'photo-3.jpg',
);

// --- Adresses de vidéo ---------------------------------------------------------
console.log('\nAdresses de vidéo');

for (const [url, provider, id] of [
  ['https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'youtube', 'aqz-KE-bpKQ'],
  ['https://youtube.com/watch?v=aqz-KE-bpKQ&t=42s', 'youtube', 'aqz-KE-bpKQ'],
  ['https://m.youtube.com/watch?v=aqz-KE-bpKQ', 'youtube', 'aqz-KE-bpKQ'],
  ['https://youtu.be/aqz-KE-bpKQ', 'youtube', 'aqz-KE-bpKQ'],
  ['https://youtu.be/aqz-KE-bpKQ?t=30', 'youtube', 'aqz-KE-bpKQ'],
  ['https://www.youtube.com/embed/aqz-KE-bpKQ', 'youtube', 'aqz-KE-bpKQ'],
  ['https://www.youtube.com/shorts/aqz-KE-bpKQ', 'youtube', 'aqz-KE-bpKQ'],
  ['https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ', 'youtube', 'aqz-KE-bpKQ'],
  ['youtube.com/watch?v=aqz-KE-bpKQ', 'youtube', 'aqz-KE-bpKQ'],
  ['  https://youtu.be/aqz-KE-bpKQ  ', 'youtube', 'aqz-KE-bpKQ'],
  ['https://vimeo.com/347119375', 'vimeo', '347119375'],
  ['https://vimeo.com/channels/staffpicks/347119375', 'vimeo', '347119375'],
  ['https://player.vimeo.com/video/347119375', 'vimeo', '347119375'],
  ['https://vimeo.com/347119375?share=copy', 'vimeo', '347119375'],
]) {
  const parsed = parseVideoUrl(url);
  check(
    `« ${url.trim().slice(0, 52)} »`,
    parsed?.provider === provider && parsed?.videoId === id,
    JSON.stringify(parsed),
  );
}

const embedCode =
  '<iframe width="560" height="315" src="https://www.youtube.com/embed/aqz-KE-bpKQ" title="x"></iframe>';
check('un code d\'intégration collé en entier fonctionne',
  parseVideoUrl(embedCode)?.videoId === 'aqz-KE-bpKQ');

for (const url of [
  'https://exemple.fr/ma-video.mp4',
  'https://dailymotion.com/video/x123',
  'https://youtube.com/watch?v=trop-court',
  'pas une adresse du tout',
  '',
]) {
  check(`« ${url.slice(0, 40) || '(vide)'} » n'est pas reconnu`, parseVideoUrl(url) === null);
}

console.log('\nCohérence côté fonction');
check('un identifiant YouTube valide est accepté', isValidVideoReference('youtube', 'aqz-KE-bpKQ'));
check('un identifiant YouTube trop court est refusé', !isValidVideoReference('youtube', 'abc'));
check('un identifiant Vimeo valide est accepté', isValidVideoReference('vimeo', '347119375'));
check('un identifiant Vimeo non numérique est refusé', !isValidVideoReference('vimeo', 'abc'));
check('un fournisseur inconnu est refusé', !isValidVideoReference('dailymotion', '123'));
check(
  'une injection dans l\'identifiant est refusée',
  !isValidVideoReference('youtube', '"><script>alert(1)</script>'),
);
check(
  'l\'intégration passe par le domaine sans traceur',
  embedUrl('youtube', 'aqz-KE-bpKQ') === 'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ',
);

console.log('\nPréparation dans le navigateur');

// Une photo de téléphone en 4:3 posée dans un emplacement 16:9.
const landscape = computeCrop(4032, 3024, 16 / 9);
check(
  'une photo 4:3 est recadrée au format de l\'emplacement',
  Math.abs(landscape.width / landscape.height - 16 / 9) < 0.01,
  `${landscape.width} × ${landscape.height}`,
);
check('elle est réduite sous la largeur maximale', landscape.width <= 2000, String(landscape.width));
check('le recadrage est centré', landscape.cropY > 0 && landscape.cropX === 0);

// La même photo prise en portrait, posée au même endroit.
const portrait = computeCrop(3024, 4032, 16 / 9);
check(
  'une photo portrait est recadrée sans déformation',
  Math.abs(portrait.width / portrait.height - 16 / 9) < 0.01,
  `${portrait.width} × ${portrait.height}`,
);
check('le recadrage vertical est centré', portrait.cropX === 0 && portrait.cropY > 0);

check('une image déjà petite n\'est pas agrandie', computeCrop(800, 450, 16 / 9).width === 800);

console.log('\nDescription proposée');
check('le nom du fichier sert de description', suggestAlt('reunion-de-cadrage.jpg') === 'Reunion de cadrage');
check('un nom d\'appareil photo ne propose rien', suggestAlt('IMG_4032.HEIC') === '');
check('un nom de capture ne propose rien', suggestAlt('Screenshot 2024-05-01.png') === '');

await panel.cleanup();
await image.cleanup();
await video.cleanup();

if (failures > 0) {
  console.error(`\n${failures} contrôle(s) en échec.\n`);
  process.exit(1);
}
console.log('\nMédias : tous les contrôles passent.\n');
