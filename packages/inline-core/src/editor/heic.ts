/**
 * Décodage des photos HEIC, dans le navigateur.
 *
 * Un iPhone photographie en HEIC par défaut. Safari sait l'afficher, Chrome et
 * Firefox non : `createImageBitmap` y échoue. Sans ce module, un client sur PC
 * qui reçoit une photo par AirDrop ou par courriel se voit refuser son fichier —
 * ce qui revient à lui demander de le convertir, exactement ce que le projet
 * s'interdit.
 *
 * Le décodeur pèse 1,4 Mo : il est **chargé à la demande**, uniquement quand un
 * fichier HEIC est choisi. Un client qui n'en dépose jamais ne le télécharge
 * jamais. Une fois décodée, la photo repasse par le même chemin que les autres —
 * recadrage, réduction, conversion WebP — et ce qui part sur le réseau se compte
 * en centaines de kilo-octets.
 *
 * Côté fonction, ce décodage serait impossible : le runtime interdit la
 * compilation de WebAssembly à l'exécution. Le navigateur, lui, l'autorise.
 */

/**
 * Marques de la famille HEIF qui désignent une image compressée en HEVC.
 * `mif1` et `msf1` sont les marques génériques utilisées par certains
 * appareils ; `avif` n'y figure pas, les navigateurs le lisent nativement.
 */
const HEIC_BRANDS = new Set([
  'heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1',
]);

/** Reconnaît un HEIC à ses octets — l'extension du fichier ne prouve rien. */
export function looksLikeHeic(head: Uint8Array): boolean {
  if (head.length < 12) return false;

  const marker = String.fromCharCode(head[4], head[5], head[6], head[7]);
  if (marker !== 'ftyp') return false;

  const brand = String.fromCharCode(head[8], head[9], head[10], head[11]).toLowerCase();
  return HEIC_BRANDS.has(brand);
}

interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(
    target: { data: Uint8ClampedArray; width: number; height: number },
    done: (result: unknown) => void,
  ): void;
}

interface HeifLibrary {
  HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[] };
}

let library: Promise<HeifLibrary> | null = null;

/**
 * Le module n'est demandé qu'une fois, et seulement s'il sert.
 *
 * On vise le build ESM plutôt que l'entrée par défaut du paquet : celle-ci
 * passe par une enveloppe CommonJS qui embarque les branches Node du décodeur
 * — inutiles ici, et sources d'erreurs à l'exécution.
 */
function loadLibrary(): Promise<HeifLibrary> {
  if (!library) {
    library = import('libheif-js/libheif-wasm/libheif-bundle.mjs').then((module) => {
      const factory = (module.default ?? module) as unknown as () => HeifLibrary | Promise<HeifLibrary>;
      return typeof factory === 'function' ? factory() : (factory as unknown as HeifLibrary);
    });
  }
  return library;
}

/**
 * Décode une photo HEIC en pixels utilisables par un canvas.
 *
 * Les transformations enregistrées dans le fichier — dont la rotation — sont
 * appliquées par le décodeur : une photo prise en portrait ressort en portrait.
 */
export async function decodeHeic(file: File): Promise<ImageBitmap> {
  const libheif = await loadLibrary();
  const bytes = new Uint8Array(await file.arrayBuffer());

  const images = new libheif.HeifDecoder().decode(bytes);
  if (images.length === 0) throw new Error('aucune image dans le fichier');

  // Un fichier peut contenir une séquence (rafale, photo animée) : on prend la
  // première, qui est l'image principale.
  const image = images[0];
  const width = image.get_width();
  const height = image.get_height();
  if (!width || !height) throw new Error('dimensions illisibles');

  const data = new Uint8ClampedArray(width * height * 4);
  await new Promise<void>((resolve, reject) => {
    image.display({ data, width, height }, (result) => {
      if (result) resolve();
      else reject(new Error('décodage refusé'));
    });
  });

  return createImageBitmap(new ImageData(data, width, height));
}
