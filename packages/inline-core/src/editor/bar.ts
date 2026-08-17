/**
 * Barre flottante et bandeaux d'information.
 *
 * Chaque chaîne affichée est en langage courant : ni « commit », ni « SHA »,
 * ni code HTTP, ni nom de fichier. Le détail technique va dans la console.
 */
import { OVERLAY_CSS } from './styles';

export interface BannerAction {
  label: string;
  onClick: () => void;
}

export interface BannerOptions {
  text: string;
  tone?: 'info' | 'success' | 'error';
  actions?: BannerAction[];
}

export interface Ui {
  setDirty(dirty: boolean): void;
  setBusy(busy: boolean): void;
  showBanner(options: BannerOptions): void;
  clearBanner(): void;
}

export interface LocaleLink {
  locale: string;
  label: string;
  href: string;
  current: boolean;
}

export function mountUi(handlers: {
  onPublish: () => void;
  onReset: () => void;
  /** Les langues du site, telles que déclarées par la page. */
  locales?: LocaleLink[];
  /** Nombre de champs affichés dans la langue par défaut, faute de traduction. */
  untranslated?: number;
}): Ui {
  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  document.head.appendChild(style);

  document.body.classList.add('cms-ui-on');

  // L'édition de texte sur petit écran donne un mauvais résultat : on le dit,
  // plutôt que de livrer une interface dégradée.
  const blocker = document.createElement('div');
  blocker.className = 'cms-ui-blocker';
  blocker.textContent = 'La modification du contenu nécessite un ordinateur.';
  document.body.appendChild(blocker);

  const bar = document.createElement('div');
  bar.className = 'cms-ui-bar';

  const status = document.createElement('span');
  status.className = 'cms-ui-status';
  status.dataset.dirty = 'false';
  status.textContent = 'Aucune modification';

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'cms-ui-btn cms-ui-btn-ghost';
  reset.textContent = 'Annuler mes modifications';
  reset.disabled = true;
  reset.addEventListener('click', handlers.onReset);

  const publish = document.createElement('button');
  publish.type = 'button';
  publish.className = 'cms-ui-btn';
  publish.textContent = 'Publier';
  publish.disabled = true;
  publish.addEventListener('click', handlers.onPublish);

  /**
   * Choix de la langue : de vrais liens vers de vraies URL.
   *
   * Aucune bascule par JavaScript, ici pas plus qu'ailleurs — changer de langue,
   * c'est changer de page.
   */
  const locales = handlers.locales ?? [];
  if (locales.length > 1) {
    const group = document.createElement('span');
    group.className = 'cms-ui-langs';
    for (const entry of locales) {
      const link = document.createElement('a');
      link.href = entry.href;
      link.hreflang = entry.locale;
      link.textContent = entry.label;
      if (entry.current) link.setAttribute('aria-current', 'true');
      group.appendChild(link);
    }
    bar.appendChild(group);
  }

  const pending = handlers.untranslated ?? 0;
  if (pending > 0) {
    const notice = document.createElement('span');
    notice.className = 'cms-ui-pending';
    notice.textContent =
      pending === 1
        ? '1 texte reste à traduire sur cette page'
        : `${pending} textes restent à traduire sur cette page`;
    notice.title = "Ces textes s'affichent pour l'instant dans la langue principale.";
    bar.appendChild(notice);
  }

  // Un lien, pas un panneau : l'aide tient sur une page du site, elle n'a pas
  // à vivre dans l'overlay ni à ouvrir une fenêtre par-dessus le travail.
  const help = document.createElement('a');
  help.className = 'cms-ui-help';
  help.href = '/aide';
  help.target = '_blank';
  help.rel = 'noopener';
  help.textContent = 'Aide';

  bar.append(status, help, reset, publish);
  document.body.appendChild(bar);

  let banner: HTMLElement | null = null;
  let dirty = false;
  let busy = false;

  function refresh(): void {
    status.dataset.dirty = String(dirty);
    status.textContent = busy
      ? 'Publication en cours…'
      : dirty
        ? 'Modifications non publiées'
        : 'Aucune modification';
    publish.disabled = busy || !dirty;
    reset.disabled = busy || !dirty;
  }

  return {
    setDirty(value) {
      dirty = value;
      refresh();
    },
    setBusy(value) {
      busy = value;
      refresh();
    },
    clearBanner() {
      banner?.remove();
      banner = null;
    },
    showBanner({ text, tone = 'info', actions = [] }) {
      banner?.remove();
      banner = document.createElement('div');
      banner.className = 'cms-ui-banner';
      banner.dataset.tone = tone;
      banner.setAttribute('role', 'status');

      const message = document.createElement('span');
      message.textContent = text;
      banner.appendChild(message);

      const group = document.createElement('span');
      group.className = 'cms-ui-banner-actions';
      for (const action of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className =
          action === actions[actions.length - 1] && actions.length > 1
            ? 'cms-ui-btn'
            : 'cms-ui-btn cms-ui-btn-ghost';
        button.textContent = action.label;
        button.addEventListener('click', action.onClick);
        group.appendChild(button);
      }
      banner.appendChild(group);
      document.body.appendChild(banner);
    },
  };
}
