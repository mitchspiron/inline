/**
 * Contrôle des fichiers reçus par `/api/upload`.
 *
 * Rien de ce que déclare le navigateur n'est cru : ni le type MIME annoncé, ni
 * le nom du fichier, ni les dimensions. Le type est reconnu à ses octets, les
 * dimensions sont lues dans l'en-tête du fichier, le nom est réécrit.
 *
 * Les pixels, eux, ne sont pas retouchés ici : le navigateur a déjà recadré et
 * converti avant l'envoi, et le build produit ensuite AVIF et WebP. Cette
 * couche vérifie, elle ne transforme pas.
 */

export type ImageFormat = 'jpeg' | 'png' | 'webp';

export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
}

/** Types acceptés. Tout le reste est refusé, y compris les vidéos. */
export const ALLOWED_TYPES: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Plafond côté fonction. Le navigateur envoie bien plus petit en pratique. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function readU16(bytes: Uint8Array, offset: number, littleEndian = false): number {
  return littleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32(bytes: Uint8Array, offset: number, littleEndian = false): number {
  return littleEndian
    ? (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)) >>> 0
    : ((bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>> 0;
}

function matches(bytes: Uint8Array, offset: number, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** PNG : les dimensions sont dans le bloc IHDR, toujours en tête. */
function readPng(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 24) return null;
  return { format: 'png', width: readU32(bytes, 16), height: readU32(bytes, 20) };
}

/** JPEG : il faut parcourir les segments jusqu'au marqueur de trame. */
function readJpeg(bytes: Uint8Array): ImageInfo | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];

    // SOF0 à SOF15, hors marqueurs qui ne décrivent pas une trame.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        format: 'jpeg',
        height: readU16(bytes, offset + 5),
        width: readU16(bytes, offset + 7),
      };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + readU16(bytes, offset + 2);
  }
  return null;
}

/** WebP : trois variantes de bloc, chacune range ses dimensions ailleurs. */
function readWebp(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 30) return null;
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);

  if (chunk === 'VP8 ') {
    return {
      format: 'webp',
      width: readU16(bytes, 26, true) & 0x3fff,
      height: readU16(bytes, 28, true) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    const packed = readU32(bytes, 21, true);
    return {
      format: 'webp',
      width: (packed & 0x3fff) + 1,
      height: ((packed >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === 'VP8X') {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { format: 'webp', width, height };
  }
  return null;
}

/**
 * Reconnaît le format d'après les octets et en lit les dimensions.
 * Renvoie `null` si ce n'est pas une image d'un format accepté.
 */
export function inspectImage(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 24) return null;

  if (matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return readPng(bytes);
  if (matches(bytes, 0, [0xff, 0xd8, 0xff])) return readJpeg(bytes);
  if (matches(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && matches(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
    return readWebp(bytes);
  }
  return null;
}

/**
 * Reconnaît les formats refusés, pour pouvoir le dire clairement plutôt que
 * de répondre « fichier invalide ».
 */
export function describeRejectedFormat(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;

  const brand = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  if (brand === 'ftyp') {
    const kind = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
    if (kind.startsWith('heic') || kind.startsWith('heix') || kind.startsWith('mif1')) return 'heic';
    return 'video';
  }
  if (matches(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) return 'video'; // Matroska, WebM
  if (matches(bytes, 0, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (matches(bytes, 0, [0x3c, 0x3f, 0x78, 0x6d]) || matches(bytes, 0, [0x3c, 0x73, 0x76, 0x67])) {
    return 'svg';
  }
  if (matches(bytes, 0, [0x25, 0x50, 0x44, 0x46])) return 'pdf';
  return null;
}

/**
 * Réécrit le nom du fichier : minuscules, sans accent, sans espace.
 * Le nom d'origine n'est jamais conservé — c'est une donnée fournie par le
 * client, et elle sert à construire un chemin.
 */
export function normalizeFileName(original: string, format: ImageFormat): string {
  const withoutExtension = original.replace(/\.[^.]*$/, '');

  const slug = withoutExtension
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  const extension = format === 'jpeg' ? 'jpg' : format;
  return `${slug || 'image'}.${extension}`;
}

/** Ajoute un suffixe si le nom est déjà pris, plutôt que d'écraser. */
export function uniqueFileName(name: string, exists: (candidate: string) => boolean): string {
  if (!exists(name)) return name;

  const dot = name.lastIndexOf('.');
  const base = name.slice(0, dot);
  const extension = name.slice(dot);

  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}-${index}${extension}`;
    if (!exists(candidate)) return candidate;
  }
  return `${base}-${Date.now()}${extension}`;
}
