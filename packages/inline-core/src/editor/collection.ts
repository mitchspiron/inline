/**
 * Listes : ajouter, dupliquer, supprimer, réordonner.
 *
 * L'ajout **clone le `<template>` présent dans la page**. C'est la règle qui
 * évite d'écrire un moteur de rendu côté client : le modèle est rendu par le
 * même composant Astro que les items existants, donc un item ajouté a
 * exactement la structure d'un item construit — il n'y a pas deux rendus à
 * tenir d'accord.
 *
 * Les identifiants sont **stables et immuables**. Un identifiant déjà employé
 * n'est jamais réattribué, même après suppression : le réutiliser rattacherait
 * les modifications d'un item disparu à un item neuf.
 */

/** Marqueur posé dans le modèle, remplacé par l'identifiant réel au clonage. */
const PLACEHOLDER = '__id__';

export interface ListZone {
  /** Chemin de la liste, ex. « collections.testimonials ». */
  path: string;
  /** Nom court, ex. « testimonials ». */
  name: string;
  container: HTMLElement;
  template: HTMLTemplateElement | null;
  /** Item vierge, tel que déclaré à côté du modèle. */
  blank: Record<string, unknown> | null;
}

export interface ListHandlers {
  onAdd(zone: ListZone): void;
  onDuplicate(zone: ListZone, id: string): void;
  onRemove(zone: ListZone, id: string): void;
  onMove(zone: ListZone, id: string, direction: -1 | 1): void;
}

/** Repère les listes de la page et le modèle qui va avec chacune. */
export function findLists(): ListZone[] {
  const zones: ListZone[] = [];

  for (const container of document.querySelectorAll<HTMLElement>('[data-cms-list]')) {
    const path = container.dataset.cmsList!;
    const name = path.split('.').pop() ?? path;
    const template = document.querySelector<HTMLTemplateElement>(
      `template[data-cms-template="${name}"]`,
    );

    let blank: Record<string, unknown> | null = null;
    const raw = template?.dataset.cmsBlank;
    if (raw) {
      try {
        blank = JSON.parse(raw);
      } catch (error) {
        console.warn(`[editor] modèle d'item illisible pour « ${name} »`, error);
      }
    }
    if (!template) {
      // Sans modèle, l'ajout est impossible : on le dit, plutôt que d'offrir
      // un bouton qui ne ferait rien.
      console.warn(`[editor] la liste « ${name} » n'a pas de modèle d'item`);
    }

    zones.push({ path, name, container, template, blank });
  }

  return zones;
}

export function itemsOf(zone: ListZone): HTMLElement[] {
  return Array.from(zone.container.querySelectorAll<HTMLElement>(':scope > [data-cms-item]'));
}

export function itemElement(zone: ListZone, id: string): HTMLElement | null {
  return zone.container.querySelector<HTMLElement>(`:scope > [data-cms-item="${id}"]`);
}

/**
 * Fabrique un identifiant qui n'a jamais servi.
 *
 * `used` contient les identifiants d'origine ET tous ceux créés depuis
 * l'ouverture de la page, y compris ceux d'items supprimés entre-temps.
 */
export function nextId(used: Set<string>, name: string): string {
  // Le préfixe suit celui des items existants, sinon l'initiale de la liste.
  const fromExisting = [...used][0]?.match(/^([a-z]+)-/)?.[1];
  const prefix = (fromExisting ?? name.charAt(0) ?? 'i').toLowerCase() || 'i';

  let highest = 0;
  for (const id of used) {
    const match = /-(\d+)$/.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }

  const candidate = `${prefix}-${String(highest + 1).padStart(3, '0')}`;
  return used.has(candidate) ? `${prefix}-${String(highest + 2).padStart(3, '0')}` : candidate;
}

/** Réécrit l'identifiant d'un nœud d'item et de tous ses champs. */
export function retarget(element: HTMLElement, fromId: string, toId: string, listPath: string): void {
  element.dataset.cmsItem = toId;
  for (const field of element.querySelectorAll<HTMLElement>('[data-cms]')) {
    const current = field.dataset.cms ?? '';
    if (current.startsWith(`${listPath}.${fromId}.`)) {
      field.dataset.cms = `${listPath}.${toId}.${current.slice(`${listPath}.${fromId}.`.length)}`;
    }
  }
}

/**
 * Clone le modèle pour un nouvel item.
 * Renvoie `null` si la page n'en fournit pas — sans modèle, pas d'ajout.
 */
export function cloneTemplate(zone: ListZone, id: string): HTMLElement | null {
  if (!zone.template) return null;

  const fragment = zone.template.content.cloneNode(true) as DocumentFragment;
  const element = fragment.querySelector<HTMLElement>('[data-cms-item]');
  if (!element) return null;

  retarget(element, PLACEHOLDER, id, zone.path);
  return element;
}

/** Clone un item existant, champs et styles compris. */
export function cloneItem(source: HTMLElement, fromId: string, toId: string, listPath: string): HTMLElement {
  const element = source.cloneNode(true) as HTMLElement;
  retarget(element, fromId, toId, listPath);
  return element;
}

// --- Commandes affichées ------------------------------------------------------

export interface ListControls {
  refresh(): void;
  hideTools(): void;
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'cms-ui-tool';
  element.textContent = label;
  element.title = title;
  element.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return element;
}

/**
 * Pose les commandes : un bouton d'ajout par liste, et une barre flottante
 * au survol d'un item. Rien n'est injecté dans les items eux-mêmes — leur
 * structure reste exactement celle du build.
 */
export function mountListControls(zones: ListZone[], handlers: ListHandlers): ListControls {
  const tools = document.createElement('div');
  tools.className = 'cms-ui-item-tools';
  tools.hidden = true;
  document.body.appendChild(tools);

  let current: { zone: ListZone; id: string } | null = null;

  function hideTools(): void {
    tools.hidden = true;
    current = null;
  }

  function showTools(zone: ListZone, element: HTMLElement): void {
    const id = element.dataset.cmsItem;
    if (!id) return;
    current = { zone, id };

    const siblings = itemsOf(zone);
    const index = siblings.indexOf(element);

    tools.replaceChildren();
    const up = button('Monter', 'Déplacer vers le haut', () => handlers.onMove(zone, id, -1));
    up.disabled = index <= 0;
    const down = button('Descendre', 'Déplacer vers le bas', () => handlers.onMove(zone, id, 1));
    down.disabled = index === -1 || index >= siblings.length - 1;

    tools.append(
      up,
      down,
      button('Dupliquer', 'Créer une copie', () => handlers.onDuplicate(zone, id)),
      button('Supprimer', 'Retirer de la liste', () => handlers.onRemove(zone, id)),
    );

    tools.hidden = false;
    const box = element.getBoundingClientRect();
    tools.style.top = `${box.top + window.scrollY - tools.offsetHeight - 6}px`;
    tools.style.left = `${box.right + window.scrollX - tools.offsetWidth}px`;
  }

  for (const zone of zones) {
    zone.container.addEventListener('mouseover', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-cms-item]');
      if (target && zone.container.contains(target)) showTools(zone, target);
    });

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'cms-ui-btn cms-ui-add';
    add.textContent = 'Ajouter';
    add.title = "Ajouter un élément à la liste";
    add.disabled = !zone.template;
    add.addEventListener('click', () => handlers.onAdd(zone));
    zone.container.insertAdjacentElement('afterend', add);
  }

  document.addEventListener('scroll', hideTools, { passive: true });

  return {
    refresh() {
      if (!current) return;
      const element = itemElement(current.zone, current.id);
      if (element) showTools(current.zone, element);
      else hideTools();
    },
    hideTools,
  };
}
