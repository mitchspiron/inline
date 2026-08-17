/**
 * Panneau média.
 *
 * Image : le client choisit un fichier depuis son appareil, et rien d'autre.
 * Le navigateur décode, redresse, recadre au format attendu, réduit et convertit
 * en WebP avant l'envoi — une photo de 8 Mo part en quelques centaines de Ko.
 * Le client n'a jamais à redimensionner ni à convertir quoi que ce soit.
 *
 * Vidéo : un champ où coller un lien. Aucun fichier n'est jamais téléversé.
 */
import { parseVideoUrl, embedUrl, type VideoReference } from '../video';
import { decodeHeic, looksLikeHeic } from './heic';

/** Au-delà, on ne gagne plus rien de visible et on alourdit le dépôt. */
const MAX_WIDTH = 2000;
const WEBP_QUALITY = 0.82;

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  previewUrl: string;
}

export interface ImageResult {
  src: string;
  width: number;
  height: number;
  alt: string;
  previewUrl: string;
}

export type MediaResult =
  | ({ kind: 'image' } & ImageResult)
  | ({ kind: 'video'; title: string } & VideoReference);

/**
 * Décode, redresse, recadre et convertit — dans le navigateur.
 *
 * `imageOrientation: 'from-image'` applique l'orientation EXIF : sans elle, une
 * photo prise en portrait arrive couchée.
 */
export interface CropPlan {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  width: number;
  height: number;
}

/**
 * Calcule le recadrage centré au format attendu, puis la réduction.
 *
 * Isolé du dessin pour être vérifiable : c'est ici que se joue le cadrage
 * d'une photo de téléphone en portrait posée dans un emplacement paysage.
 */
export function computeCrop(
  sourceWidth: number,
  sourceHeight: number,
  ratio: number,
  maxWidth = MAX_WIDTH,
): CropPlan {
  const sourceRatio = sourceWidth / sourceHeight;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;

  if (sourceRatio > ratio) cropWidth = Math.round(sourceHeight * ratio);
  else cropHeight = Math.round(sourceWidth / ratio);

  const scale = Math.min(1, maxWidth / cropWidth);

  return {
    cropX: Math.round((sourceWidth - cropWidth) / 2),
    cropY: Math.round((sourceHeight - cropHeight) / 2),
    cropWidth,
    cropHeight,
    width: Math.max(1, Math.round(cropWidth * scale)),
    height: Math.max(1, Math.round(cropHeight * scale)),
  };
}

/**
 * Obtient des pixels, quel que soit le format.
 *
 * On tente d'abord le navigateur : c'est plus rapide, et Safari sait lire le
 * HEIC nativement. En cas d'échec, si le fichier est un HEIC, on charge le
 * décodeur — 1,4 Mo, qui ne partent que dans ce cas précis.
 */
async function decodeToBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!looksLikeHeic(head)) throw error;

    console.info('[editor] photo HEIC : décodage par le module dédié');
    return decodeHeic(file);
  }
}

export async function prepareImage(file: File, ratio: number): Promise<PreparedImage> {
  const bitmap = await decodeToBitmap(file);
  const { cropX, cropY, cropWidth, cropHeight, width, height } = computeCrop(
    bitmap.width,
    bitmap.height,
    ratio,
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas indisponible');
  context.drawImage(bitmap, cropX, cropY, cropWidth, cropHeight, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY),
  );
  if (!blob) throw new Error('conversion impossible');

  return { blob, width, height, previewUrl: URL.createObjectURL(blob) };
}

/** Une description tirée du nom du fichier, que le client n'a plus qu'à ajuster. */
export function suggestAlt(fileName: string): string {
  const stem = fileName.replace(/\.[^.]*$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (stem.length === 0) return '';
  // « IMG_4032 » ou « DSC00123 » ne décrivent rien : mieux vaut un champ vide.
  if (/^(img|dsc|photo|image|pxl|screenshot)[\s\d]*$/i.test(stem)) return '';
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

export interface MediaPanelHandlers {
  onImage(result: ImageResult): void;
  onVideo(result: { provider: VideoReference['provider']; videoId: string; title: string }): void;
  onUpload(blob: Blob, fileName: string): Promise<{ src: string } | { error: string }>;
}

export interface MediaPanel {
  openImage(target: HTMLElement, current: { alt: string; width: number; height: number }): void;
  openVideo(target: HTMLElement, current: { title: string }): void;
  close(): void;
  contains(node: Node): boolean;
}

function field(labelText: string, input: HTMLElement): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'cms-ui-field';
  const label = document.createElement('span');
  label.textContent = labelText;
  wrapper.append(label, input);
  return wrapper;
}

export function createMediaPanel(handlers: MediaPanelHandlers): MediaPanel {
  const panel = document.createElement('div');
  panel.className = 'cms-ui-panel';
  panel.hidden = true;
  document.body.appendChild(panel);

  function setStatus(container: HTMLElement, message: string, tone: 'info' | 'error' = 'info') {
    container.textContent = message;
    container.dataset.tone = tone;
  }

  return {
    openImage(target, current) {
      panel.replaceChildren();
      panel.hidden = false;

      const heading = document.createElement('h2');
      heading.textContent = 'Remplacer l’image';

      const picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = 'image/*';

      const preview = document.createElement('img');
      preview.className = 'cms-ui-preview';
      preview.alt = '';
      preview.hidden = true;

      const alt = document.createElement('input');
      alt.type = 'text';
      alt.value = current.alt;
      alt.placeholder = 'Ce que montre l’image, en quelques mots';

      const status = document.createElement('p');
      status.className = 'cms-ui-panel-status';

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'cms-ui-btn cms-ui-btn-ghost';
      close.textContent = 'Fermer';
      close.addEventListener('click', () => {
        panel.hidden = true;
      });

      const ratio = current.width / current.height;
      let prepared: PreparedImage | null = null;

      picker.addEventListener('change', async () => {
        const file = picker.files?.[0];
        if (!file) return;

        setStatus(status, 'Préparation de l’image…');
        try {
          prepared = await prepareImage(file, ratio);
        } catch (error) {
          console.warn('[editor] image illisible', error);
          setStatus(
            status,
            'Ce fichier n’a pas pu être lu. Essayez une autre photo.',
            'error',
          );
          return;
        }

        preview.src = prepared.previewUrl;
        preview.hidden = false;
        if (alt.value.trim().length === 0) alt.value = suggestAlt(file.name);

        setStatus(status, 'Envoi en cours…');
        const uploaded = await handlers.onUpload(prepared.blob, file.name);
        if ('error' in uploaded) {
          setStatus(status, uploaded.error, 'error');
          return;
        }

        setStatus(status, 'Image remplacée. Pensez à publier.');
        handlers.onImage({
          src: uploaded.src,
          width: prepared.width,
          height: prepared.height,
          alt: alt.value.trim() || current.alt,
          previewUrl: prepared.previewUrl,
        });
      });

      alt.addEventListener('input', () => {
        if (!prepared) return;
        handlers.onImage({
          src: '',
          width: prepared.width,
          height: prepared.height,
          alt: alt.value,
          previewUrl: prepared.previewUrl,
        });
      });

      panel.append(
        heading,
        field('Choisir une image sur votre appareil', picker),
        preview,
        field('Description de l’image', alt),
        status,
        close,
      );
      place(panel, target);
    },

    openVideo(target, current) {
      panel.replaceChildren();
      panel.hidden = false;

      const heading = document.createElement('h2');
      heading.textContent = 'Changer la vidéo';

      const url = document.createElement('input');
      url.type = 'text';
      url.placeholder = 'Collez ici le lien de la vidéo';

      const title = document.createElement('input');
      title.type = 'text';
      title.value = current.title;

      const status = document.createElement('p');
      status.className = 'cms-ui-panel-status';
      setStatus(status, 'Aucun fichier à envoyer : le lien suffit.');

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'cms-ui-btn cms-ui-btn-ghost';
      close.textContent = 'Fermer';
      close.addEventListener('click', () => {
        panel.hidden = true;
      });

      let reference: VideoReference | null = null;

      function apply(): void {
        if (!reference) return;
        handlers.onVideo({ ...reference, title: title.value.trim() || current.title });
      }

      url.addEventListener('input', () => {
        const value = url.value.trim();
        if (value.length === 0) {
          setStatus(status, 'Aucun fichier à envoyer : le lien suffit.');
          return;
        }
        reference = parseVideoUrl(value);
        if (!reference) {
          setStatus(status, 'Ce lien n’a pas été reconnu. Copiez celui de YouTube ou de Vimeo.', 'error');
          return;
        }
        setStatus(status, 'Vidéo reconnue. Pensez à publier.');
        apply();
      });

      title.addEventListener('input', apply);

      panel.append(
        heading,
        field('Lien de la vidéo', url),
        field('Titre affiché sous la vidéo', title),
        status,
        close,
      );
      place(panel, target);
    },

    close() {
      panel.hidden = true;
    },

    contains(node) {
      return panel.contains(node);
    },
  };
}

function place(panel: HTMLElement, target: HTMLElement): void {
  const box = target.getBoundingClientRect();
  panel.style.top = `${Math.max(window.scrollY + 8, box.top + window.scrollY)}px`;
  panel.style.left = `${Math.min(
    window.innerWidth - panel.offsetWidth - 16,
    box.left + window.scrollX,
  )}px`;
}

export { embedUrl };
