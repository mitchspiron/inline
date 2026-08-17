/**
 * Point unique de vérification d'identité.
 *
 * Aucun autre fichier du dépôt ne décide qui a le droit d'écrire. Les routes
 * appellent `verifyAuth` et rien d'autre : changer de mécanisme
 * d'authentification ou d'hébergeur ne doit toucher que ce fichier.
 *
 * Mécanique : une clé par site, jamais stockée en clair. Seule son empreinte
 * argon2id vit en variable d'environnement. Une clé correcte ouvre une session
 * de 8 h matérialisée par un cookie signé.
 *
 * Ce qui est protégé, c'est l'écriture, pas l'interface : quelqu'un qui ouvre
 * l'overlay sans clé modifie le DOM de son propre navigateur, sans plus de
 * conséquence qu'avec les outils de développement.
 */
import { argon2id } from '@noble/hashes/argon2.js';

/** Cookie de session : signé, illisible et inaccessible au JavaScript de la page. */
const SESSION_COOKIE = 'inline_session';

/**
 * Témoin d'édition, lisible par le navigateur. Il ne contient AUCUN secret et
 * ne donne aucun droit : sa seule fonction est d'indiquer à la page qu'elle
 * peut charger l'overlay. Le forger ne permet que d'afficher une interface
 * dont toutes les actions seront refusées côté serveur.
 */
const EDIT_MARKER_COOKIE = 'inline_edit';

const SESSION_TTL_SECONDS = 8 * 60 * 60;

// --- Encodage ---------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Comparaison à durée constante : la boucle ne s'interrompt jamais en avance. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

// --- Empreinte de la clé ----------------------------------------------------

interface Argon2Params {
  memorySize: number;
  iterations: number;
  parallelism: number;
  salt: Uint8Array;
  digest: Uint8Array;
}

/**
 * Lit une empreinte au format standard :
 * `$argon2id$v=19$m=19456,t=2,p=1$<sel>$<empreinte>`
 *
 * Les paramètres sont portés par l'empreinte elle-même : les durcir plus tard
 * ne demande que de régénérer la clé, sans toucher au code.
 */
function parseArgon2Hash(encoded: string): Argon2Params | null {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[1] !== 'argon2id') return null;

  const settings = Object.fromEntries(
    parts[3].split(',').map((entry) => {
      const [name, value] = entry.split('=');
      return [name, Number(value)];
    }),
  );
  if (!settings.m || !settings.t || !settings.p) return null;

  try {
    return {
      memorySize: settings.m,
      iterations: settings.t,
      parallelism: settings.p,
      salt: fromBase64Url(parts[4]),
      digest: fromBase64Url(parts[5]),
    };
  } catch {
    return null;
  }
}

/** Vérifie une clé contre son empreinte. Aucune information ne fuit par la durée. */
export async function verifyKey(key: string, encodedHash: string): Promise<boolean> {
  const params = parseArgon2Hash(encodedHash);
  if (!params) {
    console.error('[auth] empreinte de clé illisible');
    return false;
  }

  const candidate = argon2id(key, params.salt, {
    m: params.memorySize,
    t: params.iterations,
    p: params.parallelism,
    dkLen: params.digest.length,
  });

  return timingSafeEqual(candidate, params.digest);
}

// --- Session ----------------------------------------------------------------

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function sign(payload: string, secret: string): Promise<Uint8Array> {
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(payload));
  return new Uint8Array(signature);
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const entry of header.split(';')) {
    const separator = entry.indexOf('=');
    if (separator === -1) continue;
    if (entry.slice(0, separator).trim() === name) {
      return entry.slice(separator + 1).trim();
    }
  }
  return null;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function issueToken(secret: string): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify({ exp: nowSeconds() + SESSION_TTL_SECONDS })));
  return `${payload}.${toBase64Url(await sign(payload, secret))}`;
}

async function tokenIsValid(token: string, secret: string): Promise<boolean> {
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  let provided: Uint8Array;
  try {
    provided = fromBase64Url(signature);
  } catch {
    return false;
  }

  if (!timingSafeEqual(provided, await sign(payload, secret))) return false;

  try {
    const decoded = JSON.parse(decoder.decode(fromBase64Url(payload))) as { exp?: unknown };
    return typeof decoded.exp === 'number' && decoded.exp > nowSeconds();
  } catch {
    return false;
  }
}

// --- Interface publique ------------------------------------------------------

/**
 * L'écriture est-elle autorisée pour cette requête ?
 *
 * `env` s'ajoute à la signature du plan : le secret de signature vit dans
 * l'environnement de la fonction.
 */
export async function verifyAuth(request: Request, env: Record<string, unknown>): Promise<boolean> {
  const secret = String(env.SESSION_SECRET ?? '');
  if (secret.length < 32) {
    console.error('[auth] SESSION_SECRET absent ou trop court');
    return false;
  }

  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return false;

  return tokenIsValid(token, secret);
}

/**
 * Ouvre une session à partir de la clé de site.
 * Renvoie le jeton de session, ou `null` si la clé est refusée.
 */
export async function createSession(
  key: string,
  env: Record<string, unknown>,
): Promise<string | null> {
  const encodedHash = String(env.EDITOR_KEY_HASH ?? '');
  const secret = String(env.SESSION_SECRET ?? '');

  if (!encodedHash || secret.length < 32) {
    console.error('[auth] EDITOR_KEY_HASH ou SESSION_SECRET absent');
    return null;
  }
  if (!(await verifyKey(key, encodedHash))) return null;

  return issueToken(secret);
}

/** En-têtes à poser pour ouvrir la session. */
export function sessionCookies(token: string): string[] {
  const common = `Path=/; Max-Age=${SESSION_TTL_SECONDS}; Secure; SameSite=Strict`;
  return [
    `${SESSION_COOKIE}=${token}; HttpOnly; ${common}`,
    // Sans HttpOnly : la page doit pouvoir le lire pour charger l'overlay.
    `${EDIT_MARKER_COOKIE}=1; ${common}`,
  ];
}

/** En-têtes à poser pour fermer la session. */
export function clearedCookies(): string[] {
  const common = 'Path=/; Max-Age=0; Secure; SameSite=Strict';
  return [`${SESSION_COOKIE}=; HttpOnly; ${common}`, `${EDIT_MARKER_COOKIE}=; ${common}`];
}

export const SESSION_TTL = SESSION_TTL_SECONDS;
export const COOKIE_NAMES = { session: SESSION_COOKIE, marker: EDIT_MARKER_COOKIE };
