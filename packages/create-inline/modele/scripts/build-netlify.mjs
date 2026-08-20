#!/usr/bin/env node
/**
 * Assemble la fonction Netlify en un module ESM autonome.
 *
 *   node scripts/build-netlify.mjs        (lancé par « npm run build:netlify »)
 *
 * netlify/source/api.mts  →  netlify/functions/api.mjs
 *
 * Pourquoi ne pas laisser Netlify assembler. Deux impasses, et ce script les
 * évite toutes les deux :
 *
 *   - avec « node_bundler = esbuild », Netlify produit du CommonJS. L'export
 *     par défaut devient « exports.default », la fonction est prise pour une
 *     v1, et l'exécution appelle « handler » — qui n'existe pas. C'est une
 *     erreur 502 « handler is not a function », au moment d'entrer la clé ;
 *   - sans cette option, Netlify n'assemble pas et doit résoudre lui-même le
 *     TypeScript d'`inline-core`, qui est publié en source. Node ne charge pas
 *     de TypeScript : la fonction échoue à l'import.
 *
 * Le résultat est donc un fichier que Netlify n'a plus qu'à déposer : de l'ESM,
 * un export par défaut, aucune dépendance à résoudre.
 *
 * Ce script vérifie son propre produit avant de rendre la main. Un module qui
 * n'expose pas ce qu'il faut ne doit pas partir en production : l'erreur ne se
 * verrait qu'au premier essai de clé, sur le site déployé.
 */
import { build } from 'esbuild';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'netlify', 'source', 'api.mts');
const outfile = join(root, 'netlify', 'functions', 'api.mjs');

/** Le dossier est entièrement produit : on le refait à neuf à chaque build. */
rmSync(join(root, 'netlify', 'functions'), { recursive: true, force: true });
mkdirSync(join(root, 'netlify', 'functions'), { recursive: true });

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Tout est inclus : Netlify ne résout rien, donc rien ne peut manquer.
  packages: 'bundle',
  external: ['node:*'],
  logLevel: 'warning',
});

// --- Contrôle du produit ---------------------------------------------------------

const produced = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
const problems = [];

if (typeof produced.default !== 'function') {
  problems.push('aucun export par défaut : Netlify le prendrait pour une fonction v1');
}
if (produced.config?.path !== '/api/*') {
  problems.push(`le chemin déclaré est « ${produced.config?.path} » et non « /api/* »`);
}

/**
 * Un appel réel, pas seulement une inspection : un module peut exporter ce
 * qu'il faut et échouer à l'import d'une dépendance restée dehors.
 *
 * `GET /api/auth` n'est servie par aucune méthode : la réponse attendue est un
 * refus 405. C'est exactement ce que doit renvoyer le site déployé, et donc la
 * commande de vérification d'après déploiement.
 */
try {
  const response = await produced.default(new Request('https://exemple.fr/api/auth'));
  if (response.status !== 405) {
    problems.push(`GET /api/auth répond ${response.status} au lieu de 405`);
  }
} catch (error) {
  problems.push(`l'appel échoue : ${error.message}`);
}

if (problems.length > 0) {
  console.error('\n  ✗ La fonction Netlify assemblée est inutilisable :\n');
  for (const problem of problems) console.error(`      ${problem}`);
  console.error('');
  process.exit(1);
}

console.log('  Fonction Netlify : netlify/functions/api.mjs — export par défaut, /api/* servie.');
