#!/usr/bin/env node
/**
 * Prépare un nouveau site : clé, empreinte, secret, variables, aide-mémoire.
 *
 *   npm run create:site -- --nom "Boulangerie Martin" --depot agence/boulangerie-martin
 *
 * Options :
 *   --nom      nom du site, tel qu'il apparaîtra dans l'aide-mémoire
 *   --depot    « proprietaire/depot » du dépôt de contenu
 *   --branche  branche des publications (défaut : main)
 *   --auteur   nom d'auteur des publications (défaut : Éditeur du site)
 *   --courriel adresse d'auteur des publications
 *   --ecrire   écrit aussi un .dev.vars local pour essayer tout de suite
 *
 * Produit deux blocs distincts, et c'est le point important : ce qui part chez
 * le client et ce qui part chez l'hébergeur ne se ressemblent pas et ne
 * voyagent pas par le même canal. La clé n'est écrite nulle part — ce qui
 * n'est pas copié maintenant est perdu, et c'est voulu : une clé oubliée se
 * régénère, elle ne se retrouve pas.
 */
import { argon2id } from '@noble/hashes/argon2.js';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Paramètres recommandés par l'OWASP pour argon2id. */
const PARAMS = { m: 19456, t: 2, p: 1 };

function option(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

const flag = (name) => process.argv.includes(`--${name}`);

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeHash(key, salt) {
  const digest = argon2id(key, salt, { ...PARAMS, dkLen: 32 });
  return `$argon2id$v=19$m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}$${toBase64Url(salt)}$${toBase64Url(digest)}`;
}

const name = option('nom', 'Site du client');
const repo = option('depot', 'agence/site-du-client');
const branch = option('branche', 'main');
const author = option('auteur', 'Éditeur du site');
const email = option('courriel', 'editeur@exemple.fr');

const key = randomBytes(24).toString('base64url');
const sessionSecret = randomBytes(32).toString('base64url');
const started = Date.now();
const hash = encodeHash(key, randomBytes(16));
const elapsed = Date.now() - started;

const variables = [
  `EDITOR_KEY_HASH=${hash}`,
  `SESSION_SECRET=${sessionSecret}`,
  `EDITOR_NAME=${author}`,
  `EDITOR_EMAIL=${email}`,
  'GIT_PROVIDER=github',
  `GIT_REPO=${repo}`,
  `GIT_BRANCH=${branch}`,
  'GIT_TOKEN=<jeton du compte machine, portée restreinte à ce dépôt>',
].join('\n');

console.log(`
════════════════════════════════════════════════════════════════════════
  1. À REMETTRE AU CLIENT — ne sera plus affichée

  Site : ${name}

  Adresse d'édition :  https://<le site>/admin
  Clé personnelle :

      ${key}

  Cette clé n'ouvre que ce site. Elle ne donne accès à aucun autre client.
  À transmettre par un canal séparé de celui qui sert au reste du projet
  (pas dans le même courriel que le lien, idéalement pas par courriel).

════════════════════════════════════════════════════════════════════════
  2. À POSER CHEZ L'HÉBERGEUR — jamais dans le dépôt

${variables}

  Déclarer aussi une liaison clé-valeur nommée RATE_LIMIT. Sans elle, le
  comptage des tentatives retombe sur un compteur en mémoire : suffisant en
  local, insuffisant en ligne.

════════════════════════════════════════════════════════════════════════
  3. AVANT DE LIVRER

  [ ] Le jeton Git est celui d'un compte machine, limité à ce seul dépôt,
      avec « Contents: Read and write » et rien d'autre.
  [ ] Les variables sont posées en secrets d'exécution, PAS en variables de
      build : elles ne doivent jamais atteindre le navigateur.
  [ ] curl -s https://<le site>/ | grep -c "<un titre de la page>"   →  1
  [ ] curl -s -X POST https://<le site>/api/save                     →  401
  [ ] Cinq clés fausses de suite sur /admin                          →  message d'attente
  [ ] La clé a été transmise, et effacée de partout ailleurs.

────────────────────────────────────────────────────────────────────────
  Empreinte calculée en ${elapsed} ms (argon2id, m=${PARAMS.m}, t=${PARAMS.t}, p=${PARAMS.p}).
  C'est aussi le coût de chaque vérification côté serveur : lent
  volontairement, c'est ce qui rend la force brute impraticable.

  Rotation : relancer cette commande, remplacer les variables chez
  l'hébergeur, redéployer, retransmettre. Remplacer SESSION_SECRET ferme
  immédiatement toutes les sessions ouvertes.
════════════════════════════════════════════════════════════════════════
`);

if (flag('ecrire')) {
  const target = join(root, '.dev.vars');
  if (existsSync(target)) {
    console.error(
      `  ✗ ${target} existe déjà — rien n'a été écrit.\n` +
        "    Le supprimer d'abord si vous voulez repartir de zéro.\n",
    );
    process.exit(1);
  }
  // Le jeton réel n'a rien à faire ici : en local, le faux service Git
  // (`npm run mock:git`) accepte n'importe quelle valeur.
  const local = variables.replace(/^GIT_TOKEN=.*$/m, 'GIT_TOKEN=essai-local');
  writeFileSync(
    target,
    `# Essai local uniquement. Ignoré par Git, jamais déployé.\n${local}\nGIT_API_BASE=http://127.0.0.1:8787\n`,
  );
  console.log(`  .dev.vars écrit. Clé pour l'essai local :\n\n      ${key}\n`);
}
