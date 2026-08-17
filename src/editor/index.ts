/**
 * Overlay d'édition — lot 0 : texte seul.
 *
 * Chargé uniquement quand le site est construit en mode édition. Dans un build
 * normal, ce fichier n'est ni référencé ni émis.
 *
 * Principe : un chemin (`data-cms`), un pointeur dans le JSON, une mutation.
 */
import { mountUi, type Ui } from './bar';
import { clearDraft, formatSavedAt, readDraft, writeDraft } from './draft';
import { loadContent, publish } from './api';

interface Context {
  file: string;
  locale: string;
  page: string;
}

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

function start(context: Context): void {
  const elements = new Map<string, HTMLElement>();
  for (const element of document.querySelectorAll<HTMLElement>('[data-cms]')) {
    elements.set(element.dataset.cms!, element);
  }
  if (elements.size === 0) return;

  /** Valeurs de référence : celles du dépôt une fois le contenu chargé. */
  const baseline: Record<string, string> = {};
  for (const [path, element] of elements) {
    baseline[path] = element.textContent ?? '';
  }

  /** Modifications en cours, uniquement celles qui diffèrent de la référence. */
  let edits: Record<string, string> = {};
  /** Contenu du fichier tel qu'il est dans le dépôt, et son empreinte de version. */
  let source: Record<string, any> | null = null;
  let version = '';
  let saveTimer: number | undefined;

  const ui: Ui = mountUi({ onPublish: doPublish, onReset: doReset });

  function markDirty(): void {
    ui.setDirty(Object.keys(edits).length > 0);
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => writeDraft(context.file, edits), 250);
  }

  function setValue(path: string, value: string): void {
    if (value === baseline[path]) delete edits[path];
    else edits[path] = value;
    markDirty();
  }

  // --- Édition ------------------------------------------------------------

  for (const [path, element] of elements) {
    element.addEventListener('click', (event) => {
      if (element.getAttribute('contenteditable') === 'true') return;
      event.preventDefault();
      // Attribut plutôt que propriété : c'est lui que cible le style de l'overlay.
      element.setAttribute('contenteditable', 'true');
      element.focus();
    });

    element.addEventListener('input', () => setValue(path, element.textContent ?? ''));

    element.addEventListener('blur', () => {
      element.removeAttribute('contenteditable');
    });

    element.addEventListener('keydown', (event) => {
      // Un champ texte est une chaîne : ni retour à la ligne, ni mise en forme.
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        element.blur();
      }
    });

    // Collage depuis un traitement de texte : on ne garde que les caractères.
    element.addEventListener('paste', (event) => {
      event.preventDefault();
      const text = (event.clipboardData?.getData('text/plain') ?? '').replace(/\s+/g, ' ');
      document.execCommand('insertText', false, text);
    });
  }

  // --- Brouillon local ----------------------------------------------------

  function applyDraft(): void {
    const draft = readDraft(context.file);
    if (!draft) return;

    let applied = 0;
    for (const [path, value] of Object.entries(draft.fields)) {
      const element = elements.get(path);
      if (!element || value === baseline[path]) continue;
      element.textContent = value;
      edits[path] = value;
      applied += 1;
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
      const element = elements.get(path);
      if (element) element.textContent = baseline[path] ?? '';
    }
    edits = {};
    clearDraft(context.file);
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
    for (const [path, element] of elements) {
      const target = resolve(source, path);
      if (!target) {
        console.warn(`[editor] chemin absent du contenu : ${path}`);
        continue;
      }
      const value = String(target.parent[target.key].value ?? '');
      baseline[path] = value;
      if (path in edits) {
        if (edits[path] === value) {
          delete edits[path];
          element.textContent = value;
        }
      } else {
        element.textContent = value;
      }
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
    ui.setBusy(true);

    const next = JSON.parse(JSON.stringify(source));
    for (const path of paths) {
      const target = resolve(next, path);
      if (!target) continue;
      target.parent[target.key].value = edits[path];
    }

    const result = await publish({
      path: context.file,
      content: `${JSON.stringify(next, null, 2)}\n`,
      version,
      message: commitMessage(paths),
    });

    ui.setBusy(false);

    if (result.status === 'published') {
      // Une sauvegarde de brouillon encore en attente n'a plus lieu d'être.
      window.clearTimeout(saveTimer);
      source = next;
      version = result.version;
      for (const path of paths) baseline[path] = edits[path];
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
