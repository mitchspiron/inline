/**
 * Lecture d'une adresse de vidéo — définition unique, partagée par l'overlay et
 * la fonction d'écriture.
 *
 * Le client colle ce qu'il a sous la main : la barre d'adresse, le bouton
 * « Partager », un code d'intégration. Toutes ces formes doivent marcher, parce
 * qu'aucune n'est plus « correcte » que les autres de son point de vue.
 *
 * Aucun fichier vidéo n'est jamais téléversé : on ne garde qu'un fournisseur et
 * un identifiant.
 */

export type VideoProvider = 'youtube' | 'vimeo';

export interface VideoReference {
  provider: VideoProvider;
  videoId: string;
}

/** Un identifiant YouTube fait onze caractères, jamais plus. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,}$/;

/**
 * Extrait le fournisseur et l'identifiant d'une adresse collée.
 * Renvoie `null` si rien de reconnaissable ne s'y trouve.
 */
export function parseVideoUrl(input: string): VideoReference | null {
  if (typeof input !== 'string') return null;

  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // Un code d'intégration collé en entier : on y récupère l'adresse.
  const fromIframe = /<iframe[^>]+src=["']([^"']+)["']/i.exec(trimmed);
  const candidate = fromIframe ? fromIframe[1] : trimmed;

  // Une adresse sans protocole reste une adresse pour le client.
  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') {
    const id = segments[0];
    return id && YOUTUBE_ID.test(id) ? { provider: 'youtube', videoId: id } : null;
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    const fromQuery = url.searchParams.get('v');
    if (fromQuery && YOUTUBE_ID.test(fromQuery)) {
      return { provider: 'youtube', videoId: fromQuery };
    }
    // /embed/ID, /shorts/ID, /live/ID, /v/ID
    const index = segments.findIndex((segment) =>
      ['embed', 'shorts', 'live', 'v'].includes(segment),
    );
    const id = index === -1 ? undefined : segments[index + 1];
    return id && YOUTUBE_ID.test(id) ? { provider: 'youtube', videoId: id } : null;
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    // Le dernier segment numérique gagne : couvre /channels/xxx/123 et /video/123.
    const id = [...segments].reverse().find((segment) => VIMEO_ID.test(segment));
    return id ? { provider: 'vimeo', videoId: id } : null;
  }

  return null;
}

/** Vérifie qu'un couple stocké est cohérent — appelé côté fonction. */
export function isValidVideoReference(provider: string, videoId: string): boolean {
  if (provider === 'youtube') return YOUTUBE_ID.test(videoId);
  if (provider === 'vimeo') return VIMEO_ID.test(videoId);
  return false;
}

/** Adresse d'intégration correspondante. */
export function embedUrl(provider: VideoProvider, videoId: string): string {
  return provider === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${videoId}`
    : `https://player.vimeo.com/video/${videoId}`;
}
