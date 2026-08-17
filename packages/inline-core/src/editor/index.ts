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
import {
  cloneItem,
  cloneTemplate,
  findLists,
  itemElement,
  itemsOf,
  mountListControls,
  nextId,
  type ListZone,
} from './collection';
import { embedUrl } from '../video';
import { loadSanitizer, sanitizeRichtext, sanitizeText } from './sanitize';
import { createToolbar, type RichCommand, type StyleChange } from './toolbar';
import {
  ALIGNMENTS,
  COLORS,
  SIZES,
  WEIGHTS,
  styleClasses,
  type StyleTokens,
} from '../style-tokens';

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

/**
 * Renvoie le nœud parent et la clé finale d'un chemin, ou null.
 *
 * Un segment qui tombe sur un tableau désigne un item par son identifiant, et
 * non par sa position : c'est ce qui permet à un item de changer de rang sans
 * que les modifications en cours ne se retrouvent sur son voisin.
 */
function resolve(source: any, path: string): { parent: any; key: string } | null {
  const keys = path.split('.');
  const key = keys.pop()!;
  let node = source;

  for (const step of keys) {
    if (node == null || typeof node !== 'object') return null;
    node = Array.isArray(node) ? node.find((entry) => entry?.id === step) : node[step];
  }

  if (node == null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    const index = node.findIndex((entry) => entry?.id === key);
    return index === -1 ? null : { parent: node, key: String(index) };
  }
  return key in node ? { parent: node, key } : null;
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

  /**
   * Les langues déclarées par la page. L'overlay ne les devine pas et ne les
   * connaît pas : quelles langues existent, comment elles s'appellent et à
   * quelle adresse elles répondent sont des décisions du site. Il lit ce que
   * le build a posé, donc exactement les pages qui existent.
   */
  let declared: Array<{ locale: string; href: string; label: string }> = [];
  try {
    declared = JSON.parse(document.body.dataset.cmsLocales ?? '[]');
  } catch {
    console.warn('[editor] langues de la page illisibles');
  }

  const localeLinks = declared.map((entry) => ({
    locale: entry.locale,
    href: entry.href,
    label: entry.label || entry.locale,
    current: entry.locale === context.locale,
  }));

  const ui: Ui = mountUi({
    onPublish: doPublish,
    onReset: doReset,
    locales: localeLinks,
    untranslated: Number(document.body.dataset.cmsUntranslated ?? 0),
  });
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
      if (result.status === 'busy') {
        return {
          error: 'Vous avez envoyé beaucoup d\'images coup sur coup. Patientez quelques minutes, puis réessayez.',
        };
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
    if (edit.value === undefined && !edit.style && !edit.media && !edit.list) delete edits[path];
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

  /**
   * Rend une zone modifiable. Appelée au chargement, et de nouveau sur les
   * items ajoutés en cours de session — qui doivent être éditables tout de
   * suite, sans rechargement.
   */
  function registerZone(zone: Zone): void {
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
      return;
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

  for (const zone of zones.values()) registerZone(zone);

  /** Enregistre les champs d'un item qui vient d'apparaître dans la page. */
  function registerItem(element: HTMLElement): void {
    for (const field of element.querySelectorAll<HTMLElement>('[data-cms]')) {
      const path = field.dataset.cms!;
      if (zones.has(path)) continue;

      const declared = field.dataset.cmsType;
      const kind: FieldKind =
        declared === 'richtext' ? 'richtext' : declared === 'media' ? 'media' : 'text';
      const zone: Zone = {
        path,
        element: field,
        kind,
        mediaKind: kind === 'media' ? (field.dataset.cmsKind === 'video' ? 'video' : 'image') : undefined,
      };

      zones.set(path, zone);
      baseValues[path] = kind === 'richtext' ? field.innerHTML : (field.textContent ?? '');
      if (kind === 'text') baseStyles[path] = styleFromElement(field);
      registerZone(zone);
    }
  }

  // --- Listes ---------------------------------------------------------------

  const lists = findLists();
  /** Composition d'origine, telle que construite. */
  const baseOrder: Record<string, string[]> = {};
  /** Les nœuds d'origine, gardés pour pouvoir revenir en arrière. */
  const baseNodes: Record<string, Map<string, HTMLElement>> = {};
  /**
   * Tous les identifiants ayant existé, y compris ceux d'items supprimés.
   * Cet ensemble ne rétrécit jamais : c'est ce qui garantit qu'aucun
   * identifiant n'est réattribué.
   */
  const usedIds: Record<string, Set<string>> = {};

  for (const zone of lists) {
    const items = itemsOf(zone);
    const ids = items.map((element) => element.dataset.cmsItem!).filter(Boolean);
    baseOrder[zone.path] = ids;
    baseNodes[zone.path] = new Map(items.map((element) => [element.dataset.cmsItem!, element]));
    usedIds[zone.path] = new Set(ids);
  }

  function currentOrder(path: string): string[] {
    return [...(edits[path]?.list?.order ?? baseOrder[path] ?? [])];
  }

  function currentAdded(path: string): Record<string, unknown> {
    return { ...(edits[path]?.list?.added ?? {}) };
  }

  function setList(path: string, order: string[], added: Record<string, unknown>): void {
    const original = baseOrder[path] ?? [];
    const unchanged =
      order.length === original.length && order.every((id, index) => original[index] === id);

    if (unchanged && Object.keys(added).length === 0) {
      if (edits[path]) delete edits[path].list;
    } else {
      edits[path] = { ...edits[path], list: { order, added } };
    }
    prune(path);
    markDirty();
  }

  /** L'item tel qu'il est à l'écran : sa version du dépôt, plus les retouches. */
  function itemJson(zone: ListZone, id: string): Record<string, unknown> | null {
    const added = edits[zone.path]?.list?.added?.[id];
    let item: Record<string, unknown> | null = added
      ? JSON.parse(JSON.stringify(added))
      : null;

    if (!item && source) {
      const target = resolve(source, zone.path);
      const list = target ? target.parent[target.key] : null;
      const found = Array.isArray(list) ? list.find((entry: any) => entry?.id === id) : null;
      if (found) item = JSON.parse(JSON.stringify(found));
    }
    if (!item) return null;

    // Les modifications non publiées de cet item doivent suivre la copie.
    for (const [path, edit] of Object.entries(edits)) {
      const prefix = `${zone.path}.${id}.`;
      if (!path.startsWith(prefix)) continue;
      const field = item[path.slice(prefix.length)] as Record<string, unknown> | undefined;
      if (!field) continue;
      if (edit.value !== undefined) field.value = edit.value;
      if (edit.style) field.style = { ...(field.style as object), ...edit.style };
      if (edit.media) Object.assign(field, edit.media);
    }

    delete item.id;
    return item;
  }

  const listControls = mountListControls(lists, {
    onAdd(zone) {
      if (!zone.template || !zone.blank) {
        ui.showBanner({
          text: "Cette liste ne peut pas recevoir de nouvel élément pour le moment.",
          tone: 'error',
          actions: [{ label: 'Fermer', onClick: () => ui.clearBanner() }],
        });
        return;
      }

      const id = nextId(usedIds[zone.path], zone.name);
      usedIds[zone.path].add(id);

      const element = cloneTemplate(zone, id);
      if (!element) return;

      zone.container.appendChild(element);
      registerItem(element);

      setList(zone.path, [...currentOrder(zone.path), id], {
        ...currentAdded(zone.path),
        [id]: JSON.parse(JSON.stringify(zone.blank)),
      });
      listControls.refresh();
    },

    onDuplicate(zone, id) {
      const sourceElement = itemElement(zone, id);
      const copyOf = itemJson(zone, id);
      if (!sourceElement || !copyOf) {
        ui.showBanner({
          text: "Cet élément n'a pas pu être copié, réessayez.",
          tone: 'error',
          actions: [{ label: 'Fermer', onClick: () => ui.clearBanner() }],
        });
        return;
      }

      const newId = nextId(usedIds[zone.path], zone.name);
      usedIds[zone.path].add(newId);

      const element = cloneItem(sourceElement, id, newId, zone.path);
      sourceElement.insertAdjacentElement('afterend', element);
      registerItem(element);

      const order = currentOrder(zone.path);
      order.splice(order.indexOf(id) + 1, 0, newId);
      setList(zone.path, order, { ...currentAdded(zone.path), [newId]: copyOf });
      listControls.refresh();
    },

    onRemove(zone, id) {
      // Confirmation obligatoire, et message rassurant : un client qui n'a pas
      // peur de casser son site est un client qui s'en sert.
      const confirmed = window.confirm(
        'Retirer cet élément de la liste ?\n\n' +
          'Il disparaîtra de la page à la prochaine publication. Vos versions ' +
          'précédentes sont conservées : rien n’est perdu définitivement.',
      );
      if (!confirmed) return;

      const element = itemElement(zone, id);
      element?.remove();

      const added = currentAdded(zone.path);
      delete added[id];
      setList(
        zone.path,
        currentOrder(zone.path).filter((entry) => entry !== id),
        added,
      );
      listControls.hideTools();
    },

    onMove(zone, id, direction) {
      const order = currentOrder(zone.path);
      const index = order.indexOf(id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= order.length) return;

      [order[index], order[target]] = [order[target], order[index]];

      const element = itemElement(zone, id);
      const neighbour = itemElement(zone, order[index]);
      if (element && neighbour) {
        if (direction === -1) neighbour.insertAdjacentElement('beforebegin', element);
        else neighbour.insertAdjacentElement('afterend', element);
      }

      setList(zone.path, order, currentAdded(zone.path));
      listControls.refresh();
    },
  });

  /** Remet une liste dans sa composition d'origine. */
  function restoreList(zone: ListZone): void {
    for (const element of itemsOf(zone)) element.remove();
    for (const id of baseOrder[zone.path] ?? []) {
      const element = baseNodes[zone.path]?.get(id);
      if (element) zone.container.appendChild(element);
    }
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

    // Les listes reprennent leur composition d'origine, avec les nœuds
    // construits : les items ajoutés disparaissent, les retirés reviennent.
    for (const listZone of lists) {
      if (edits[listZone.path]?.list) restoreList(listZone);
    }

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
    listControls.hideTools();
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

    // Les listes d'abord : ajouts, retraits et ordre. Les modifications de
    // champs qui suivent désignent des items par identifiant, et doivent donc
    // trouver la liste dans sa composition finale.
    for (const path of paths) {
      const list = edits[path].list;
      if (!list) continue;

      const target = resolve(next, path);
      if (!target) continue;

      const before: any[] = Array.isArray(target.parent[target.key])
        ? target.parent[target.key]
        : [];
      const byId = new Map(before.map((entry) => [entry.id, entry]));

      target.parent[target.key] = list.order
        .map((id) => {
          const item = byId.get(id) ?? list.added[id];
          return item ? JSON.parse(JSON.stringify({ ...(item as object), id })) : null;
        })
        .filter(Boolean);
    }

    for (const path of paths) {
      const target = resolve(next, path);
      if (!target) continue;
      const field = target.parent[target.key];
      const edit = edits[path];
      const zone = zones.get(path);

      if (edit.list) continue;

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

    if (result.status === 'busy') {
      ui.showBanner({
        text: 'Vous avez publié beaucoup de fois coup sur coup. Patientez quelques minutes, puis réessayez : vos modifications sont conservées.',
        tone: 'error',
        actions: [{ label: 'Fermer', onClick: () => ui.clearBanner() }],
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
