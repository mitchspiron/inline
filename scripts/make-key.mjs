#!/usr/bin/env node
/**
 * Génère la clé d'un site et son empreinte.
 *
 *   npm run make:key
 *
 * Affiche trois choses :
 *   - la clé, à transmettre au client — elle n'est stockée nulle part ;
 *   - son empreinte argon2id, à poser en variable d'environnement ;
 *   - un secret de signature de session.
 *
 * Rien n'est écrit sur disque : ce qui n'est pas copié est perdu, et c'est
 * voulu. Une clé oubliée se régénère, elle ne se retrouve pas.
 */
import { argon2id } from '@noble/hashes/argon2.js';
import { randomBytes } from 'node:crypto';

/** Paramètres recommandés par l'OWASP pour argon2id. */
const PARAMS = { m: 19456, t: 2, p: 1 };

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Empreinte au format standard, paramètres compris. */
function encodeHash(key, salt) {
  const digest = argon2id(key, salt, { ...PARAMS, dkLen: 32 });
  const settings = `m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}`;
  return `$argon2id$v=19$${settings}$${toBase64Url(salt)}$${toBase64Url(digest)}`;
}

const key = randomBytes(24).toString('base64url');
const sessionSecret = randomBytes(32).toString('base64url');
const started = Date.now();
const hash = encodeHash(key, randomBytes(16));
const elapsed = Date.now() - started;

console.log(`
────────────────────────────────────────────────────────────────────────
  À TRANSMETTRE AU CLIENT — ne sera plus affichée

  Clé du site :

    ${key}

────────────────────────────────────────────────────────────────────────
  À POSER EN VARIABLES D'ENVIRONNEMENT — jamais dans le dépôt

EDITOR_KEY_HASH=${hash}
SESSION_SECRET=${sessionSecret}

────────────────────────────────────────────────────────────────────────
  Empreinte calculée en ${elapsed} ms (argon2id, m=${PARAMS.m}, t=${PARAMS.t}, p=${PARAMS.p}).
  C'est aussi le coût de chaque vérification côté serveur : lent volontairement,
  c'est ce qui rend la force brute impraticable.

  Rotation de clé : relancer cette commande, remplacer les deux variables chez
  l'hébergeur, redéployer, transmettre la nouvelle clé. Remplacer SESSION_SECRET
  ferme immédiatement toutes les sessions ouvertes.
────────────────────────────────────────────────────────────────────────
`);
