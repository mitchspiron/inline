#!/usr/bin/env node
/**
 * Vérifie qu'aucun secret n'a fuité dans ce qui est servi.
 *
 * Contrôle le dossier de build : la valeur du jeton configuré en local, les
 * formes de jetons connues, et les noms de variables qui n'ont rien à faire
 * côté navigateur.
 *
 * Ce script n'affiche jamais la valeur trouvée, seulement le fichier fautif.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (!existsSync(dist)) {
  console.error('  ✗ dist/ est absent — lancer « npm run build » d\'abord.');
  process.exit(1);
}

/** Valeurs à traquer : le jeton local, s'il est renseigné. */
const secretValues = [];
for (const file of ['.dev.vars', '.env']) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(GIT_TOKEN|CF_[A-Z_]*TOKEN|[A-Z_]*SECRET[A-Z_]*)\s*=\s*(.+)\s*$/);
    if (match && match[2].trim().length >= 8) {
      secretValues.push({ name: match[1], value: match[2].trim() });
    }
  }
}
if (process.env.GIT_TOKEN && process.env.GIT_TOKEN.length >= 8) {
  secretValues.push({ name: 'GIT_TOKEN', value: process.env.GIT_TOKEN });
}

/** Formes reconnaissables, même sans valeur locale configurée. */
const patterns = [
  { label: 'jeton GitHub', regex: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { label: 'jeton GitHub (fine-grained)', regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { label: 'jeton GitLab', regex: /\bglpat-[A-Za-z0-9_-]{15,}\b/ },
  { label: 'nom de variable serveur', regex: /GIT_TOKEN|EDITOR_AUTHOR_EMAIL|GIT_API_BASE/ },
  { label: 'en-tête d\'autorisation', regex: /authorization["'\s:]+bearer/i },
];

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

const errors = [];
const TEXT = /\.(html|js|mjs|css|json|txt|xml|map|svg)$/i;

for (const file of walk(dist)) {
  if (!TEXT.test(file)) continue;
  const content = readFileSync(file, 'utf8');
  const name = relative(root, file);

  for (const secret of secretValues) {
    if (content.includes(secret.value)) {
      errors.push(`${name} : contient la valeur de ${secret.name}.`);
    }
  }
  for (const pattern of patterns) {
    if (pattern.regex.test(content)) {
      errors.push(`${name} : ${pattern.label} détecté.`);
    }
  }
}

if (errors.length > 0) {
  console.error('\n  Contrôle des secrets : échec\n');
  for (const error of errors) console.error(`  ✗ ${error}`);
  console.error('');
  process.exit(1);
}

const scope = secretValues.length > 0 ? `${secretValues.length} valeur(s) locale(s) + formes connues` : 'formes connues';
console.log(`  Contrôle des secrets : rien dans dist/ (${scope}).`);
