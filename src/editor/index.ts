/**
 * Overlay d'édition — texte et richtext.
 *
 * Chargé uniquement quand le témoin d'édition est posé, donc après une
 * authentification réussie. Sur une page publique, ce fichier n'est jamais
 * téléchargé.
 *
 * Principe : un chemin (`data-cms`), un pointeur dans le JSON, une mutation.
 */
import { mountUi, type Ui } from './bar';
import { clearDraft, formatSavedAt, readDraft, writeDraft, type FieldEdit } from './draft';
import { loadContent, publish, uploadImage } from './api';
import { createMediaPanel } from './media';
import { embedUrl } from '../lib/video';
import { loadSanitizer, sanitizeRichtext, sanitizeText } from './sanitize';
import { createToolbar, type RichCommand, type StyleChange } from './toolbar';
import {
  ALIGNMENTS,
  COLORS,
  SIZES,
  WEIGHTS,
  styleClasses,
  type StyleTokens,
} from '../lib/style-tokens';

interface Context {
  file: string;
  locale: string;
  page: string;
}

type FieldKind = 'text' | 'richtext' | 'media';

interface Zone {
  path: string;
  element: HTMLElement;
  kind: FieldKind;
  /** Pour un média seulement : image ou vidéo. */
  mediaKind?: 'image' | 'video';
}

const DEFAULT_STYLE: StyleTokens = {
  size: 'base',
  weight: 'regular',
  italic: false,
  align: 'left',
  color: 'primary',
};

function readContext(): Context | null {
  const { cmsFile, cmsLocale, cmsPage } = document.body.dataset;
  if (!cmsFile || !cmsLocale || !cmsPage) return null;
  return { file: cmsFile, locale: cmsLocale, page: cmsPage };
}

/** Renvoie le nœud parent et la clé finale d'un chemin, ou null. */
function resolve(source: any, path: string): { parent: any; key: string } | null {
  const keys = path.split('.');
  const key = keys.pop()!;
  let node = source;
  for (const step of keys) {
    if (node == null || typeof node !== 'object') return null;
    node = node[step];
  }
  if (node == null || typeof node !== 'object' || !(key in node)) return null;
  return { parent: node, key };
}

/** Relit les tokens de style depuis les classes posées au build. */
function styleFromElement(element: HTMLElement): StyleTokens {
  const has = (name: string) => element.classList.contains(name);
  return {
    size: SIZES.find((value) => has(`cms-size-${value}`)) ?? DEFAULT_STYLE.size,
    weight: WEIGHTS.find((value) => has(`cms-weight-${value}`)) ?? DEFAULT_STYLE.weight,
    italic: has('cms-italic'),
    align: ALIGNMENTS.find((value) => has(`cms-align-${value}`)) ?? DEFAULT_STYLE.align,
    color: COLORS.find((value) => has(`cms-color-${value}`)) ?? DEFAULT_STYLE.color,
  };
}

function applyStyle(element: HTMLElement, style: StyleTokens): void {
  for (const name of Array.from(element.classList)) {
    if (name.startsWith('cms-size-') || name.startsWith('cms-weight-') ||
        name.startsWith('cms-align-') || name.startsWith('cms-color-') || name === 'cms-italic') {
      element.classList.remove(name);
    }
  }
  element.classList.add(...styleClasses(style));
}

function start(context: Context): void {
  const zones = new Map<string, Zone>();
  for (const element of document.querySelectorAll<HTMLElement>('[data-cms]')) {
    const path = element.dataset.cms!;
    const declared = element.dataset.cmsType;
    const kind: FieldKind =
      declared === 'richtext' ? 'richtext' : declared === 'media' ? 'media' : 'text';
    const mediaKind = element.dataset.cmsKind === 'video' ? 'video' : 'image';
    zones.set(path, { path, element, kind, mediaKind: kind === 'media' ? mediaKind : undefined });
  }
  if (zones.size === 0) return;

  /** Valeurs de référence : celles du dépôt une fois le contenu chargé. */
  const baseValues: Record<string, string> = {};
  const baseStyles: Record<string, StyleTokens> = {};
  /** Pour les médias, la référence est l'objet du champ, pas une chaîne. */
  const baseMedia: Record<string, Record<string, unknown>> = {};
  for (const zone of zones.values()) {
    if (zone.kind === 'media') continue;
    baseValues[zone.path] =
      zone.kind === 'richtext' ? zone.element.innerHTML : (zone.element.textContent ?? '');
    if (zone.kind === 'text') baseStyles[zone.path] = styleFromElement(zone.element);
  }

  /** Modifications en cours, uniquement ce qui diffère de la référence. */
  let edits: Record<string, FieldEdit> = {};
  let source: Record<string, any> | null = null;
  let version = '';
  let saveTimer: number | undefined;
  let active: Zone | null = null;

  const ui: Ui = mountUi({ onPublish: doPublish, onReset: doReset });
  const toolbar = createToolbar({ onStyle: applyStyleChange, onCommand: runCommand });

  const mediaPanel = createMediaPanel({
    onImage(result) {
      if (!active || active.kind !== 'media') return;
      const path = active.path;
      const change: Record<string, string | number> = {
        alt: result.alt,
        width: result.width,
        height: result.height,
      };
      // Une saisie de description seule ne change pas le fichier.
      if (result.src) change.src = result.src;

      edits[path] = { ...edits[path], media: { ...(edits[path]?.media ?? {}), ...change } };
      prune(path);

      const image = active.element as HTMLImageElement;
      if (result.previewUrl) {
        // Le fichier définitif n'existe qu'après la reconstruction du site :
        // en attendant, on montre celui que le navigateur vient de préparer.
        image.removeAttribute('srcset');
        image.src = result.previewUrl;
      }
      image.alt = result.alt;
      markDirty();
    },

    onVideo(result) {
      if (!active || active.kind !== 'media') return;
      const path = active.path;
      edits[path] = {
        ...edits[path],
        media: {
          ...(edits[path]?.media ?? {}),
          provider: result.provider,
          videoId: result.videoId,
          title: result.title,
        },
      };
      prune(path);
      applyMediaToDom(active, edits[path].media!);
      markDirty();
    },

    async onUpload(blob, fileName) {
      const result = await uploadImage(blob, fileName);
      if (result.status === 'uploaded') return { src: result.src };

      if (result.status === 'expired') {
        return { error: 'Votre session a pris fin. Reconnectez-vous pour envoyer une image.' };
      }
      if (result.status === 'too_large') {
        return { error: 'Cette image est trop lourde. Essayez-en une autre.' };
      }
      if (result.status === 'rejected') {
        return {
          error:
            result.kind === 'video'
              ? "Ceci est une vidéo. Pour ajouter une vidéo, utilisez l'emplacement prévu et collez son lien."
              : "Ce type de fichier n'est pas accepté. Choisissez une photo.",
        };
      }
      return { error: "L'image n'a pas pu être envoyée, réessayez." };
    },
  });

  /** Reflète dans la page ce que le client vient de choisir. */
  function applyMediaToDom(zone: Zone, media: Record<string, unknown>): void {
    if (zone.mediaKind === 'video') {
      const frame = zone.element.querySelector('iframe');
      const caption = zone.element.querySelector('figcaption');
      const provider = String(media.provider ?? baseMedia[zone.path]?.provider ?? 'youtube');
      const videoId = String(media.videoId ?? baseMedia[zone.path]?.videoId ?? '');
      const title = String(media.title ?? baseMedia[zone.path]?.title ?? '');
      if (frame && videoId) {
        frame.src = embedUrl(provider as 'youtube' | 'vimeo', videoId);
        frame.title = title;
      }
      if (caption) caption.textContent = title;
      return;
    }
    const image = zone.element as HTMLImageElement;
    if (typeof media.alt === 'string') image.alt = media.alt;
  }

  function currentStyle(path: string): StyleTokens {
    return { ...(baseStyles[path] ?? DEFAULT_STYLE), ...(edits[path]?.style ?? {}) };
  }

  function markDirty(): void {
    ui.setDirty(Object.keys(edits).length > 0);
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => writeDraft(context.file, edits), 250);
  }

  /** Retire une entrée devenue identique à la référence. */
  function prune(path: string): void {
    const edit = edits[path];
    if (!edit) return;
    if (edit.value !== undefined && edit.value === baseValues[path]) delete edit.value;
    if (edit.style && Object.keys(edit.style).length === 0) delete edit.style;
    if (edit.media) {
      for (const [key, value] of Object.entries(edit.media)) {
        if (baseMedia[path]?.[key] === value) delete edit.media[key];
      }
      if (Object.keys(edit.media).length === 0) delete edit.media;
    }
    if (edit.value === undefined && !edit.style && !edit.media) delete edits[path];
  }

  function setValue(path: string, value: string): void {
    edits[path] = { ...edits[path], value };
    prune(path);
    markDirty();
  }

  function applyStyleChange(change: StyleChange): void {
    if (!active || active.kind !== 'text') return;
    const path = active.path;

    const merged = { ...(edits[path]?.style ?? {}), ...change };
    // Un aller-retour ramenant la valeur d'origine n'est pas une modification.
    for (const [token, value] of Object.entries(merged)) {
      if ((baseStyles[path] as any)?.[token] === value) delete (merged as any)[token];
    }

    edits[path] = { ...edits[path], style: merged };
    prune(path);

    applyStyle(active.element, currentStyle(path));
    toolbar.showForText(active.element, currentStyle(path));
    markDirty();
  }

  async function runCommand(command: RichCommand): Promise<void> {
    if (!active || active.kind !== 'richtext') return;
    active.element.focus();

    if (command === 'link') {
      const href = window.prompt('Adresse du lien (par exemple https://exemple.fr)');
      if (!href) return;
      document.execCommand('createLink', false, href);
    } else {
      const commands: Record<Exclude<RichCommand, 'link'>, string> = {
        bold: 'bold',
        italic: 'italic',
        bullets: 'insertUnorderedList',
        numbers: 'insertOrderedList',
      };
      document.execCommand(commands[command as Exclude<RichCommand, 'link'>], false);
    }

    // Le navigateur produit ce qu'il veut ; on ne garde que la liste blanche.
    const zone = active;
    const cleaned = await sanitizeRichtext(zone.element.innerHTML);
    zone.element.innerHTML = cleaned;
    setValue(zone.path, cleaned);
  }

  // --- Édition ------------------------------------------------------------

  for (const zone of zones.values()) {
    const { element, path, kind } = zone;

    if (kind === 'media') {
      element.addEventListener('click', (event) => {
        event.preventDefault();
        active = zone;
        toolbar.hide();

        const current = { ...(baseMedia[path] ?? {}), ...(edits[path]?.media ?? {}) };
        if (zone.mediaKind === 'video') {
          mediaPanel.openVideo(element, { title: String(current.title ?? '') });
        } else {
          mediaPanel.openImage(element, {
            alt: String(current.alt ?? (element as HTMLImageElement).alt ?? ''),
            width: Number(current.width ?? (element as HTMLImageElement).naturalWidth ?? 16),
            height: Number(current.height ?? (element as HTMLImageElement).naturalHeight ?? 9),
          });
        }
      });
      continue;
    }

    element.addEventListener('click', (event) => {
      if (element.getAttribute('contenteditable') !== 'true') {
        event.preventDefault();
        element.setAttribute('contenteditable', 'true');
        element.focus();
      }
      active = zone;
      if (kind === 'text') {
        toolbar.showForText(element, currentStyle(path));
      } else {
        // Chargé maintenant, pour être prêt au premier collage.
        void loadSanitizer();
        toolbar.showForRichtext(element);
      }
    });

    element.addEventListener('input', () => {
      setValue(path, kind === 'richtext' ? element.innerHTML : (element.textContent ?? ''));
    });

    element.addEventListener('blur', (event) => {
      // Cliquer dans la barre d'outils n'est pas quitter le champ.
      const next = (event as FocusEvent).relatedTarget;
      if (next instanceof Node && toolbar.contains(next)) return;

      element.removeAttribute('contenteditable');
      toolbar.hide();
      if (active === zone) active = null;

      if (kind === 'richtext') {
        void sanitizeRichtext(element.innerHTML).then((cleaned) => {
          if (cleaned !== element.innerHTML) element.innerHTML = cleaned;
          setValue(path, cleaned);
        });
      }
    });

    element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        element.blur();
        return;
      }
      // Un champ texte est une chaîne : ni retour à la ligne, ni mise en forme.
      if (kind === 'text' && event.key === 'Enter') {
        event.preventDefault();
        element.blur();
      }
    });

    /**
     * Collage. C'est le geste qui casse une charte graphique : le contenu
     * arrive avec ses polices, ses tailles et ses couleurs. On ne conserve
     * jamais la mise en forme d'origine.
     */
    element.addEventListener('paste', async (event) => {
      event.preventDefault();
      const clipboard = event.clipboardData;
      if (!clipboard) return;

      if (kind === 'text') {
        const text = sanitizeText(clipboard.getData('text/plain'));
        document.execCommand('insertText', false, text);
        setValue(path, element.textContent ?? '');
        return;
      }

      const html = clipboard.getData('text/html');
      const cleaned = html
        ? await sanitizeRichtext(html)
        : sanitizeText(clipboard.getData('text/plain'));
      document.execCommand('insertHTML', false, cleaned);

      const settled = await sanitizeRichtext(element.innerHTML);
      element.innerHTML = settled;
      setValue(path, settled);
    });
  }

  // --- Brouillon local ----------------------------------------------------

  function applyEditToDom(path: string, edit: FieldEdit): void {
    const zone = zones.get(path);
    if (!zone) return;
    if (zone.kind === 'media') {
      if (edit.media) applyMediaToDom(zone, edit.media);
      return;
    }
    if (edit.value !== undefined) {
      if (zone.kind === 'richtext') {
        void sanitizeRichtext(edit.value).then((cleaned) => {
          zone.element.innerHTML = cleaned;
        });
      } else {
        zone.element.textContent = edit.value;
      }
    }
    if (zone.kind === 'text') applyStyle(zone.element, currentStyle(path));
  }

  function applyDraft(): void {
    const draft = readDraft(context.file);
    if (!draft) return;

    let applied = 0;
    for (const [path, edit] of Object.entries(draft.fields)) {
      if (!zones.has(path)) continue;
      edits[path] = edit;
      prune(path);
      if (edits[path]) {
        applyEditToDom(path, edits[path]);
        applied += 1;
      }
    }
    if (applied === 0) {
      clearDraft(context.file);
      return;
    }

    ui.setDirty(true);
    ui.showBanner({
      text: `Vous avez des modifications non publiées sur cette page, enregistrées ${formatSavedAt(draft.savedAt)}.`,
      actions: [
        { label: 'Les supprimer', onClick: doReset },
        { label: 'Les garder', onClick: () => ui.clearBanner() },
      ],
    });
  }

  function doReset(): void {
    const confirmed = window.confirm(
      'Voulez-vous supprimer vos modifications non publiées et revenir au texte en ligne ?',
    );
    if (!confirmed) return;

    for (const path of Object.keys(edits)) {
      const zone = zones.get(path);
      if (!zone) continue;
      if (zone.kind === 'media') {
        applyMediaToDom(zone, baseMedia[path] ?? {});
        continue;
      }
      if (zone.kind === 'richtext') zone.element.innerHTML = baseValues[path] ?? '';
      else zone.element.textContent = baseValues[path] ?? '';
      if (zone.kind === 'text') applyStyle(zone.element, baseStyles[path] ?? DEFAULT_STYLE);
    }
    edits = {};
    clearDraft(context.file);
    toolbar.hide();
    mediaPanel.close();
    ui.clearBanner();
    ui.setDirty(false);
  }

  // --- Chargement de la version de référence ------------------------------

  async function loadBaseline(): Promise<void> {
    const loaded = await loadContent(context.file);
    if (!loaded) {
      ui.showBanner({
        text: "Vos modifications sont conservées, mais la publication n'est pas disponible pour le moment.",
        tone: 'error',
        actions: [{ label: 'Fermer', onClick: () => ui.clearBanner() }],
      });
      return;
    }

    try {
      source = JSON.parse(loaded.content);
    } catch (error) {
      console.warn('[editor] contenu illisible', error);
      return;
    }
    version = loaded.version;

    // La référence, c'est le dépôt — pas le HTML construit, qui peut dater.
    for (const zone of zones.values()) {
      const target = resolve(source, zone.path);
      if (!target) {
        console.warn(`[editor] chemin absent du contenu : ${zone.path}`);
        continue;
      }
      const field = target.parent[target.key];

      if (zone.kind === 'media') {
        const { type, kind, ...rest } = field;
        baseMedia[zone.path] = rest;
        prune(zone.path);
        if (edits[zone.path]?.media) applyMediaToDom(zone, edits[zone.path].media!);
        continue;
      }

      baseValues[zone.path] = String(field.value ?? '');
      if (zone.kind === 'text' && field.style) {
        baseStyles[zone.path] = { ...DEFAULT_STYLE, ...field.style };
      }

      prune(zone.path);
      if (edits[zone.path]) applyEditToDom(zone.path, edits[zone.path]);
      else applyEditToDom(zone.path, { value: baseValues[zone.path] });
    }
    markDirty();
  }

  // --- Publication --------------------------------------------------------

  function commitMessage(paths: string[]): string {
    const shortPaths = paths.map((path) => path.replace(/^blocks\./, ''));
    const shown = shortPaths.slice(0, 3).join(', ');
    const rest = shortPaths.length > 3 ? ` +${shortPaths.length - 3}` : '';
    return `content(${context.locale}): ${context.page} — ${shown}${rest}`;
  }

  async function doPublish(): Promise<void> {
    const paths = Object.keys(edits);
    if (paths.length === 0) return;

    if (!source) {
      ui.showBanner({
        text: "Cette modification n'a pas pu être enregistrée, réessayez.",
        tone: 'error',
        actions: [{ label: 'Fermer', onClick: () => ui.clearBanner() }],
      });
      return;
    }

    ui.clearBanner();
    toolbar.hide();
    mediaPanel.close();
    ui.setBusy(true);

    const next = JSON.parse(JSON.stringify(source));
    for (const path of paths) {
      const target = resolve(next, path);
      if (!target) continue;
      const field = target.parent[target.key];
      const edit = edits[path];
      const zone = zones.get(path);

      if (edit.value !== undefined) {
        field.value =
          zone?.kind === 'richtext'
            ? await sanitizeRichtext(edit.value)
            : sanitizeText(edit.value);
      }
      if (edit.style && field.style) {
        field.style = { ...field.style, ...edit.style };
      }
      if (edit.media) Object.assign(field, edit.media);
    }

    const result = await publish({
      path: context.file,
      content: `${JSON.stringify(next, null, 2)}\n`,
      version,
      message: commitMessage(paths),
    });

    ui.setBusy(false);

    if (result.status === 'published') {
      window.clearTimeout(saveTimer);
      source = next;
      version = result.version;
      for (const path of paths) {
        const target = resolve(next, path);
        if (!target) continue;
        const field = target.parent[target.key];
        if (zones.get(path)?.kind === 'media') {
          const { type, kind, ...rest } = field;
          baseMedia[path] = rest;
          continue;
        }
        baseValues[path] = String(field.value ?? '');
        if (field.style) baseStyles[path] = { ...DEFAULT_STYLE, ...field.style };
      }
      edits = {};
      clearDraft(context.file);
      ui.setDirty(false);
      ui.showBanner({
        text: "C'est publié. Votre site sera à jour dans une minute environ.",
        tone: 'success',
        actions: [{ label: 'Fermer', onClick: () => ui.clearBanner() }],
      });
      return;
    }

    if (result.status === 'expired') {
      ui.showBanner({
        text: 'Votre session a pris fin. Reconnectez-vous pour publier : vos modifications sont conservées.',
        tone: 'error',
        actions: [{ label: 'Se reconnecter', onClick: () => (window.location.href = '/admin') }],
      });
      return;
    }

    if (result.status === 'conflict') {
      ui.showBanner({
        text: "Cette page a été modifiée ailleurs depuis que vous l'avez ouverte. Rechargez-la pour repartir de la dernière version : vos modifications sont conservées.",
        tone: 'error',
        actions: [{ label: 'Recharger la page', onClick: () => window.location.reload() }],
      });
      return;
    }

    ui.showBanner({
      text:
        result.status === 'rejected'
          ? "Cette modification n'a pas pu être enregistrée. Vérifiez votre texte, puis réessayez."
          : "Cette modification n'a pas pu être enregistrée, réessayez.",
      tone: 'error',
      actions: [{ label: 'Fermer', onClick: () => ui.clearBanner() }],
    });
  }

  applyDraft();
  void loadBaseline();
}

const context = readContext();
if (context) start(context);
