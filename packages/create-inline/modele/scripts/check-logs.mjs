#!/usr/bin/env node
/**
 * Contrôle de journalisation : rien de sensible ne part dans les journaux.
 *
 *   node scripts/check-logs.mjs
 *
 * « Ne jamais journaliser la clé, l'empreinte, le cookie de session ou le
 * jeton Git » est une règle qu'on respecte spontanément le jour où on l'écrit,
 * et qu'on enfreint six mois plus tard en ajoutant un `console.error(error)`
 * pour déboguer. Ce contrôle est là pour ce jour-là.
 *
 * Méthode : chaque appel à `console.*` est isolé, ses chaînes de caractères
 * sont retirées — un message en français parlant de « clé » n'est pas une
 * fuite — et ce qui reste, c'est-à-dire les expressions réellement évaluées,
 * est comparé à une liste d'identifiants interdits.
 */
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Les répertoires qui produisent du code exécuté avec des secrets à portée. */
const SCANNED = ['functions', 'packages/inline-core/src', 'src'];

/**
 * Identifiants qui ne doivent jamais être évalués dans un appel de journal.
 *
 * Deux familles : les secrets eux-mêmes, et les objets qui les contiennent —
 * journaliser `env` ou `request` entier revient à journaliser tout ce qu'ils
 * portent, aujourd'hui comme après le prochain ajout de variable.
 */
const FORBIDDEN = [
  'token',
  'secret',
  'hash',
  'cookie',
  'cookies',
  'authorization',
  'password',
  'credential',
  'session',
  'key',
  'env',
  'headers',
  'payload',
];

/** Ce qui reste lisible : une variable nommée ainsi n'a rien de sensible. */
const TOLERATED = new Set(['keyCode', 'keydown', 'keyup', 'keys', 'sessionStorage']);

async function* walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      yield* walk(full);
    } else if (/\.(ts|astro|mjs)$/.test(entry.name)) {
      yield full;
    }
  }
}

/**
 * Retire ce qui est littéral pour ne garder que ce qui est évalué.
 *
 * Les chaînes simples disparaissent entièrement. Dans un gabarit, seules les
 * interpolations comptent : le texte autour est un message, pas une donnée.
 */
export function evaluatedPart(source) {
  return source
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, (template) =>
      [...template.matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1]).join(' '));
}

/** Isole les arguments d'un appel, parenthèses équilibrées. */
function callArguments(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  return source.slice(openIndex + 1);
}

/**
 * Relève les appels de journal fautifs d'un fichier source.
 * Renvoie `[{ line, exposed }]` — vide quand tout va bien.
 */
export function findLeaks(source) {
  const leaks = [];

  for (const match of source.matchAll(/console\s*\.\s*(log|info|warn|error|debug|trace|dir)\s*\(/g)) {
    const openIndex = match.index + match[0].length - 1;
    const evaluated = evaluatedPart(callArguments(source, openIndex));

    const exposed = [
      ...new Set(
        [...evaluated.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)]
          .map((identifier) => identifier[0])
          .filter((name) => !TOLERATED.has(name))
          .filter((name) => FORBIDDEN.includes(name.toLowerCase())),
      ),
    ];

    if (exposed.length > 0) {
      leaks.push({ line: source.slice(0, match.index).split('\n').length, exposed });
    }
  }

  return leaks;
}

/** Nombre d'appels à `console.*` d'un fichier — sert au décompte affiché. */
export function countCalls(source) {
  return [...source.matchAll(/console\s*\.\s*(log|info|warn|error|debug|trace|dir)\s*\(/g)].length;
}

async function main() {
  let violations = 0;
  let calls = 0;
  let files = 0;

  for (const directory of SCANNED) {
    for await (const file of walk(join(root, directory))) {
      const source = readFileSync(file, 'utf8');
      files += 1;
      calls += countCalls(source);

      for (const leak of findLeaks(source)) {
        console.error(
          `  ✗ ${relative(root, file)}:${leak.line} — journalise « ${leak.exposed.join(', ')} »`,
        );
        violations += 1;
      }
    }
  }

  if (violations > 0) {
    console.error(
      `\n${violations} appel(s) de journal exposent une donnée sensible.\n` +
        'Journaliser un code de situation, jamais la valeur reçue.\n',
    );
    process.exit(1);
  }

  console.log(
    `Contrôle des journaux : ${calls} appel(s) inspecté(s) dans ${files} fichier(s), rien de sensible.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
