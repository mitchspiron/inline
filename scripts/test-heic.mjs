#!/usr/bin/env node
/**
 * Décodage des photos HEIC.
 *
 *   node scripts/test-heic.mjs
 *   INLINE_HEIC_SAMPLE=/chemin/photo.heic node scripts/test-heic.mjs
 *
 * La reconnaissance du format est vérifiée sans rien de plus qu'un en-tête.
 * Le décodage complet, lui, demande une vraie photo : aucun encodeur HEVC
 * n'est disponible pour en fabriquer une, et une photo personnelle n'a rien à
 * faire dans un dépôt. Le contrôle est donc **explicitement sauté** quand
 * aucun échantillon n'est fourni — jamais passé en silence.
 *
 * Pour l'exécuter, poser un fichier dans `fixtures/sample.heic` ou renseigner
 * INLINE_HEIC_SAMPLE.
 */
import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
let skipped = 0;

function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function skip(label, why) {
  console.log(`  · ${label} — non exécuté : ${why}`);
  skipped += 1;
}

const dir = await mkdtemp(join(tmpdir(), 'inline-heic-'));
const outfile = join(dir, 'heic.mjs');
await build({
  entryPoints: [join(root, 'src/editor/heic.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['browser', 'module', 'main'],
  target: 'es2020',
  outfile,
  logLevel: 'error',
});
const { looksLikeHeic, decodeHeic } = await import(pathToFileURL(outfile).href);

// --- Reconnaissance -----------------------------------------------------------
console.log('\nReconnaissance du format');

function header(brand) {
  const bytes = new Uint8Array(16);
  bytes.set([0, 0, 0, 0x20], 0);
  bytes.set([...'ftyp'].map((c) => c.charCodeAt(0)), 4);
  bytes.set([...brand].map((c) => c.charCodeAt(0)), 8);
  return bytes;
}

for (const brand of ['heic', 'heix', 'hevc', 'mif1', 'msf1', 'HEIC']) {
  check(`marque « ${brand} » reconnue`, looksLikeHeic(header(brand)));
}

for (const [label, bytes] of [
  ['un JPEG', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(12).fill(0)])],
  ['un PNG', new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(12).fill(0)])],
  ['un WebP', new Uint8Array([...[...'RIFF'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ...[...'WEBP'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0])],
  ['un AVIF (lu nativement par les navigateurs)', header('avif')],
  ['un MP4', header('isom')],
  ['un fichier trop court', new Uint8Array([0xff, 0xd8])],
]) {
  check(`${label} n'est pas pris pour un HEIC`, !looksLikeHeic(bytes));
}

// --- Décodage -----------------------------------------------------------------
console.log('\nDécodage complet');

const samplePath =
  process.env.INLINE_HEIC_SAMPLE ??
  (existsSync(join(root, 'fixtures/sample.heic')) ? join(root, 'fixtures/sample.heic') : null);

if (!samplePath || !existsSync(samplePath)) {
  skip(
    'une photo HEIC est décodée en pixels',
    'aucun échantillon (poser fixtures/sample.heic ou définir INLINE_HEIC_SAMPLE)',
  );
} else {
  // Le module vise le navigateur : on lui fournit les deux objets qu'il attend.
  globalThis.ImageData = class {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
  globalThis.createImageBitmap = async (source) => ({
    width: source.width,
    height: source.height,
    data: source.data,
    close() {},
  });

  const bytes = readFileSync(samplePath);
  const file = {
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    slice: (start, end) => ({
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset + start, bytes.byteOffset + end),
    }),
  };

  if (!looksLikeHeic(new Uint8Array(bytes.subarray(0, 16)))) {
    // Cas vécu : un JPEG portant l'extension .HEIC. La reconnaissance par les
    // octets a raison, et le navigateur lira ce fichier par la voie normale.
    skip(
      'une photo HEIC est décodée en pixels',
      `l'échantillon fourni n'est pas un HEIC (${samplePath})`,
    );
    await rm(dir, { recursive: true, force: true });
    console.log(`\nHEIC : contrôles passés, ${skipped} non exécuté(s).\n`);
    process.exit(failures > 0 ? 1 : 0);
  }
  check('le fichier est bien reconnu comme HEIC', true);

  const started = Date.now();
  const bitmap = await decodeHeic(file);
  const elapsed = Date.now() - started;

  check('la photo est décodée', bitmap.width > 0 && bitmap.height > 0, `${bitmap.width} × ${bitmap.height}`);
  check(
    'le nombre de pixels correspond aux dimensions',
    bitmap.data.length === bitmap.width * bitmap.height * 4,
  );

  // Une image entièrement uniforme signalerait un décodage raté.
  const sample = bitmap.data.subarray(0, Math.min(bitmap.data.length, 400_000));
  const distinct = new Set();
  for (let index = 0; index < sample.length; index += 4) distinct.add(sample[index]);
  check('les pixels ne sont pas uniformes', distinct.size > 8, `${distinct.size} valeurs distinctes`);

  const opaque = bitmap.data[3] === 255;
  check('le canal alpha est renseigné', opaque, String(bitmap.data[3]));

  console.log(`    (${(bytes.length / 1024 / 1024).toFixed(2)} Mo décodés en ${elapsed} ms)`);
}

await rm(dir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} contrôle(s) en échec.\n`);
  process.exit(1);
}
console.log(
  skipped > 0
    ? `\nHEIC : contrôles passés, ${skipped} non exécuté(s) faute d'échantillon.\n`
    : '\nHEIC : tous les contrôles passent.\n',
);
