/**
 * Dialogue avec les fonctions serveur.
 *
 * Le jeton d'écriture n'existe que côté fonction : rien ici ne le connaît,
 * ne le reçoit ni ne le stocke.
 */

export interface LoadedContent {
  /** Le JSON du fichier, tel quel. */
  content: string;
  /** Empreinte de la version lue à l'ouverture — sert au verrou optimiste. */
  version: string;
}

export type PublishResult =
  | { status: 'published'; version: string }
  /** Le fichier a changé côté dépôt depuis l'ouverture de la page. */
  | { status: 'conflict' }
  /** La session de 8 h est terminée. */
  | { status: 'expired' }
  /** Contenu refusé par la validation serveur. */
  | { status: 'rejected' }
  /** Réseau, service indisponible, cause inconnue. */
  | { status: 'failed' };

export async function loadContent(file: string): Promise<LoadedContent | null> {
  try {
    const response = await fetch(`/api/content?path=${encodeURIComponent(file)}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      console.warn('[editor] lecture du contenu impossible', response.status);
      return null;
    }
    return (await response.json()) as LoadedContent;
  } catch (error) {
    console.warn('[editor] lecture du contenu impossible', error);
    return null;
  }
}

export async function publish(payload: {
  path: string;
  content: string;
  version: string;
  message: string;
}): Promise<PublishResult> {
  let response: Response;
  try {
    response = await fetch('/api/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.warn('[editor] publication : appel impossible', error);
    return { status: 'failed' };
  }

  if (response.ok) {
    const body = (await response.json()) as { version: string };
    return { status: 'published', version: body.version };
  }

  // Le détail technique reste dans la console, jamais à l'écran.
  const detail = await response.text().catch(() => '');
  console.warn('[editor] publication refusée', response.status, detail);

  if (response.status === 401) return { status: 'expired' };
  if (response.status === 409) return { status: 'conflict' };
  if (response.status === 400 || response.status === 422) return { status: 'rejected' };
  return { status: 'failed' };
}
