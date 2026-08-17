#!/usr/bin/env node
/**
 * Contrôle de l'overlay dans un DOM simulé.
 *
 *   node scripts/test-editor.mjs
 *
 * Vérifie les gestes qui font le lot 0 : cliquer rend le texte modifiable, la
 * saisie est conservée localement, la réouverture la restaure avec un bandeau,
 * et « Publier » envoie exactement ce qu'il faut à la fonction d'écriture.
 *
 * Le HTML utilisé est celui du build en mode édition : il faut donc avoir
 * lancé « npm run build:editor » avant.
 */
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = join(root, 'dist/fr/index.html');
const CONTENT = join(root, 'src/content/pages/fr/home.json');
const FILE = 'src/content/pages/fr/home.json';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

if (!existsSync(HTML)) {
  console.error('  ✗ dist/fr/index.html absent — lancer « npm run build » d\'abord.');
  process.exit(1);
}

const html = await readFile(HTML, 'utf8');
if (!html.includes('data-cms-file')) {
  console.error('  ✗ dist/fr/index.html ne porte pas les points d\'ancrage — relancer « npm run build ».');
  process.exit(1);
}

const overlay = (
  await build({
    entryPoints: [join(root, 'src/editor/index.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    write: false,
  })
).outputFiles[0].text;

const repoContent = await readFile(CONTENT, 'utf8');

/** Ouvre la page dans un DOM neuf, avec un faux serveur et un stockage partagé. */
async function openPage({ storage = new Map(), content = repoContent, version = 'v1', markup = html } = {}) {
  const calls = [];
  // « outside-only » : le script de la page n'est pas chargé tout seul, c'est
  // nous qui injectons le bundle de l'overlay dans le contexte de la fenêtre.
  const dom = new JSDOM(markup, {
    url: 'https://exemple.fr/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;

  // Stockage local partagé entre deux ouvertures, comme un vrai navigateur.
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    configurable: true,
  });

  window.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith('/api/content')) {
      return new window.Response(JSON.stringify({ content, version }), { status: 200 });
    }
    return new window.Response(JSON.stringify({ version: 'v2' }), { status: 200 });
  };
  window.Response = Response;
  window.confirm = () => true;
  window.prompt = () => 'https://exemple.fr';

  // jsdom n'implémente pas execCommand : on enregistre ce que l'overlay
  // demande au navigateur, ce qui suffit à vérifier ce qu'il lui transmet.
  const commands = [];
  window.document.execCommand = (name, _ui, value) => {
    commands.push({ name, value });
    return true;
  };

  window.eval(overlay);
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  return { window, document: window.document, calls, storage, commands };
}

/** Simule une saisie : le navigateur modifie le texte, puis émet « input ». */
function type(window, element, text) {
  element.textContent = text;
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function buttonByText(document, label) {
  return [...document.querySelectorAll('button')].find((b) => b.textContent === label);
}

console.log('\nOverlay dans un DOM simulé');

// --- Première ouverture : édition et brouillon --------------------------------
const first = await openPage();
const title = first.document.querySelector('[data-cms="blocks.hero.title"]');

check('la barre flottante est présente', !!first.document.querySelector('.cms-ui-bar'));
check('« Publier » est désactivé sans modification', buttonByText(first.document, 'Publier').disabled);
check(
  'la version de référence est demandée au chargement',
  first.calls.some((c) => c.url.includes('/api/content')),
);

title.dispatchEvent(new first.window.MouseEvent('click', { bubbles: true }));
check('cliquer rend le texte modifiable', title.getAttribute('contenteditable') === 'true');

type(first.window, title, 'Un titre saisi par le client');
await new Promise((resolve) => setTimeout(resolve, 350));

check(
  'la modification est visible immédiatement dans la page',
  first.document.querySelector('[data-cms="blocks.hero.title"]').textContent ===
    'Un titre saisi par le client',
);
check('« Publier » devient actif', !buttonByText(first.document, 'Publier').disabled);
check(
  'la barre signale des modifications non publiées',
  first.document.querySelector('.cms-ui-status').textContent === 'Modifications non publiées',
);

const stored = JSON.parse(first.storage.get(`cms:draft:${FILE}`) ?? '{}');
check(
  'le brouillon est conservé localement',
  stored.fields?.['blocks.hero.title']?.value === 'Un titre saisi par le client',
);
check(
  'le brouillon ne contient aucune donnée sensible',
  !JSON.stringify([...first.storage.entries()]).toLowerCase().includes('token'),
);

// --- Deuxième ouverture : reprise du brouillon --------------------------------
const second = await openPage({ storage: first.storage });
check(
  'à la réouverture, la modification est restaurée',
  second.document.querySelector('[data-cms="blocks.hero.title"]').textContent ===
    'Un titre saisi par le client',
);
const banner = second.document.querySelector('.cms-ui-banner');
check('un bandeau de reprise est affiché', !!banner);
check(
  'le bandeau parle en langage courant',
  !!banner && /modifications non publiées/i.test(banner.textContent) && !/json|git|sha/i.test(banner.textContent),
  banner?.textContent,
);

// --- Publication --------------------------------------------------------------
buttonByText(second.document, 'Publier').click();
await new Promise((resolve) => setTimeout(resolve, 50));

const save = second.calls.find((c) => c.url === '/api/save');
check('« Publier » appelle la fonction d\'écriture', !!save);
const payload = save ? JSON.parse(save.init.body) : {};
check('le chemin envoyé est celui du contenu', payload.path === FILE);
check('la version lue à l\'ouverture est renvoyée', payload.version === 'v1');
check(
  'le message de publication respecte le format attendu',
  payload.message === 'content(fr): home — hero.title',
  payload.message,
);
const sent = payload.content ? JSON.parse(payload.content) : {};
check(
  'le contenu envoyé porte la modification',
  sent.blocks?.hero?.title?.value === 'Un titre saisi par le client',
);
check(
  'les autres champs sont inchangés',
  sent.blocks?.hero?.subtitle?.value === JSON.parse(repoContent).blocks.hero.subtitle.value,
);
check('le brouillon est vidé après publication', !second.storage.has(`cms:draft:${FILE}`));
check(
  'un message de confirmation en langage courant est affiché',
  /publié/i.test(second.document.querySelector('.cms-ui-banner')?.textContent ?? ''),
);

// --- Conflit ------------------------------------------------------------------
const third = await openPage();
const thirdTitle = third.document.querySelector('[data-cms="blocks.hero.title"]');
thirdTitle.dispatchEvent(new third.window.MouseEvent('click', { bubbles: true }));
type(third.window, thirdTitle, 'Modification faite pendant une autre publication');
await new Promise((resolve) => setTimeout(resolve, 350));
third.window.fetch = async (url) => {
  if (String(url).startsWith('/api/content')) {
    return new Response(JSON.stringify({ content: repoContent, version: 'v1' }), { status: 200 });
  }
  return new Response(JSON.stringify({ error: 'conflict' }), { status: 409 });
};
buttonByText(third.document, 'Publier').click();
await new Promise((resolve) => setTimeout(resolve, 50));

const conflictBanner = third.document.querySelector('.cms-ui-banner');
check('un conflit affiche un message clair', !!conflictBanner);
check(
  'le message de conflit invite à recharger, sans jargon',
  !!conflictBanner &&
    /rechargez/i.test(conflictBanner.textContent) &&
    !/(409|conflict|sha|git|json)/i.test(conflictBanner.textContent),
  conflictBanner?.textContent,
);
check(
  'après un conflit, le brouillon est conservé',
  third.storage.has(`cms:draft:${FILE}`),
);

// --- Barre d'outils : seulement les variantes du schéma ------------------------
console.log('\nBarre d\'outils');

const tokensModule = (
  await build({
    entryPoints: [join(root, 'src/lib/style-tokens.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
  })
).outputFiles[0].text;
const { SIZES, WEIGHTS, ALIGNMENTS, COLORS } = await import(
  `data:text/javascript;base64,${Buffer.from(tokensModule).toString('base64')}`
);

const styled = await openPage();
const heading = styled.document.querySelector('[data-cms="blocks.hero.title"]');
heading.dispatchEvent(new styled.window.MouseEvent('click', { bubbles: true }));

const toolbar = styled.document.querySelector('.cms-ui-toolbar');
check('la barre d\'outils apparaît sur un champ texte', !!toolbar && !toolbar.hidden);

const groups = [...styled.document.querySelectorAll('.cms-ui-tool-label')].map((l) => l.textContent);
check(
  'elle propose taille, épaisseur, style, alignement et couleur',
  ['Taille', 'Épaisseur', 'Style', 'Alignement', 'Couleur'].every((g) => groups.includes(g)),
  groups.join(', '),
);

const expectedButtons = SIZES.length + WEIGHTS.length + 1 + ALIGNMENTS.length + COLORS.length;
const toolButtons = [...styled.document.querySelectorAll('.cms-ui-tool')];
check(
  'un bouton par valeur du schéma, ni plus ni moins',
  toolButtons.length === expectedButtons,
  `${toolButtons.length} boutons pour ${expectedButtons} valeurs`,
);
check(
  'aucun libellé n\'expose un nom technique de token',
  !toolButtons.some((b) => [...SIZES, ...WEIGHTS, ...COLORS].includes(b.textContent)),
);

// Appliquer une taille : la page change tout de suite, et le brouillon suit.
const bigger = toolButtons.find((b) => b.title === 'Taille : Titre');
bigger.dispatchEvent(new styled.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
await new Promise((resolve) => setTimeout(resolve, 350));

check('la taille choisie s\'applique immédiatement', heading.classList.contains('cms-size-2xl'));
check('l\'ancienne taille est retirée', !heading.classList.contains('cms-size-3xl'));
check(
  'le style modifié entre dans le brouillon',
  JSON.parse(styled.storage.get(`cms:draft:${FILE}`)).fields['blocks.hero.title'].style.size === '2xl',
);

buttonByText(styled.document, 'Publier').click();
await new Promise((resolve) => setTimeout(resolve, 50));
const stylePayload = JSON.parse(styled.calls.find((c) => c.url === '/api/save').init.body);
const publishedStyle = JSON.parse(stylePayload.content).blocks.hero.title.style;
check('le style publié porte la nouvelle valeur', publishedStyle.size === '2xl');
check('les autres tokens de style sont préservés', publishedStyle.weight === 'bold');

// --- Richtext -----------------------------------------------------------------
console.log('\nRichtext');

const rich = await openPage();
const detail = rich.document.querySelector('[data-cms="blocks.pitch.detail"]');
check('le champ richtext est présent', !!detail);
check('il est marqué comme richtext', detail?.dataset.cmsType === 'richtext');
check('son balisage est rendu au build', detail?.querySelector('strong') !== null);

detail.dispatchEvent(new rich.window.MouseEvent('click', { bubbles: true }));
const richGroups = [...rich.document.querySelectorAll('.cms-ui-tool-label')].map((l) => l.textContent);
check('la barre du richtext propose la mise en forme', richGroups.includes('Mise en forme'));
check(
  'elle n\'offre aucun token de style',
  !richGroups.includes('Taille') && !richGroups.includes('Couleur'),
);

const WORD_PASTE =
  '<p class=MsoNormal><span style=\'font-size:14.0pt;font-family:"Times New Roman";color:#C00000\'>' +
  'Texte <b>collé</b> depuis Word</span><o:p></o:p></p><font face="Calibri">suite</font>';

function paste(page, element, html) {
  const event = new page.window.Event('paste', { bubbles: true, cancelable: true });
  event.clipboardData = { getData: (type) => (type === 'text/html' ? html : 'texte brut') };
  element.dispatchEvent(event);
}

paste(rich, detail, WORD_PASTE);
await new Promise((resolve) => setTimeout(resolve, 60));
const inserted = rich.commands.filter((c) => c.name === 'insertHTML').pop();
check('le collage passe par un contenu nettoyé', !!inserted, JSON.stringify(rich.commands));
check('aucun attribut style ne subsiste', !/style\s*=/i.test(inserted?.value ?? ''), inserted?.value);
check('aucun attribut class ne subsiste', !/class\s*=/i.test(inserted?.value ?? ''), inserted?.value);
check('aucune balise font ne subsiste', !/<font/i.test(inserted?.value ?? ''), inserted?.value);
check('aucune police ne subsiste', !/Calibri|Times New Roman/i.test(inserted?.value ?? ''), inserted?.value);
check('le texte est conservé', /Texte/.test(inserted?.value ?? ''), inserted?.value);
check('le gras est conservé', /<strong>collé<\/strong>/.test(inserted?.value ?? ''), inserted?.value);

paste(rich, detail, 'avant<script>alert(1)</script><img src=x onerror=alert(1)>après');
await new Promise((resolve) => setTimeout(resolve, 60));
const dangerous = rich.commands.filter((c) => c.name === 'insertHTML').pop();
check('un script collé est retiré côté navigateur', !/<script|onerror/i.test(dangerous?.value ?? ''), dangerous?.value);
check('le texte autour du script est conservé', dangerous?.value === 'avantaprès', dangerous?.value);


// --- Listes -------------------------------------------------------------------
console.log('\nListes');

const listPage = await openPage();
const listDoc = listPage.document;

function items(document) {
  return [...document.querySelectorAll('[data-cms-list] > [data-cms-item]')];
}
function ids(document) {
  return items(document).map((element) => element.dataset.cmsItem);
}

/** Structure d'un item, indépendamment de son identifiant et de ses textes. */
function shape(element) {
  const walk = (node) =>
    [...node.children].map((child) => ({
      tag: child.tagName,
      classes: [...child.classList].sort().join(' '),
      field: (child.dataset.cms ?? '').split('.').pop() ?? '',
      type: child.dataset.cmsType ?? '',
      children: walk(child),
    }));
  return JSON.stringify(walk(element));
}

check('les deux items du contenu sont rendus', ids(listDoc).join(',') === 't-001,t-002', ids(listDoc).join(','));
check('un bouton d\'ajout est posé', !!buttonByText(listDoc, 'Ajouter'));
check('le modèle d\'item est dans la page', !!listDoc.querySelector('template[data-cms-template="testimonials"]'));

const builtShape = shape(items(listDoc)[1]);

// Ajouter
buttonByText(listDoc, 'Ajouter').click();
await new Promise((resolve) => setTimeout(resolve, 350));

check('un item est ajouté à la fin', ids(listDoc).length === 3, ids(listDoc).join(','));
const addedId = ids(listDoc)[2];
check('son identifiant suit la série', addedId === 't-003', addedId);
check(
  'sa structure est identique à celle d\'un item construit',
  shape(items(listDoc)[2]) === builtShape,
  shape(items(listDoc)[2]),
);
check(
  'ses champs pointent vers son propre identifiant',
  [...items(listDoc)[2].querySelectorAll('[data-cms]')].every((f) =>
    f.dataset.cms.startsWith('collections.testimonials.' + addedId + '.'),
  ),
);
check(
  'aucun champ ne garde le marqueur du modèle',
  !listDoc.querySelector('[data-cms-list] [data-cms*="__id__"]'),
);

const draftAfterAdd = JSON.parse(listPage.storage.get('cms:draft:' + FILE));
check(
  'le brouillon retient la composition de la liste',
  draftAfterAdd.fields['collections.testimonials'].list.order.join(',') === 't-001,t-002,t-003',
  JSON.stringify(draftAfterAdd.fields['collections.testimonials']?.list?.order),
);
check(
  'le nouvel item est décrit dans le brouillon',
  !!draftAfterAdd.fields['collections.testimonials'].list.added[addedId],
);

// Le nouvel item est éditable tout de suite.
const newQuote = items(listDoc)[2].querySelector('[data-cms$=".quote"]');
newQuote.dispatchEvent(new listPage.window.MouseEvent('click', { bubbles: true }));
check('un item ajouté est modifiable sans recharger', newQuote.getAttribute('contenteditable') === 'true');
type(listPage.window, newQuote, 'Texte du nouvel item');
await new Promise((resolve) => setTimeout(resolve, 350));

// Dupliquer
function itemTool(document, label) {
  return [...document.querySelectorAll('.cms-ui-item-tools button')].find((b) => b.textContent === label);
}
function hover(page, element) {
  element.dispatchEvent(new page.window.MouseEvent('mouseover', { bubbles: true }));
}

hover(listPage, items(listDoc)[0]);
itemTool(listDoc, 'Dupliquer').dispatchEvent(
  new listPage.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }),
);
await new Promise((resolve) => setTimeout(resolve, 350));

check('la copie est insérée juste après l\'original', ids(listDoc)[1] === 't-004', ids(listDoc).join(','));
check('aucun identifiant n\'est réattribué', new Set(ids(listDoc)).size === ids(listDoc).length);
check(
  'la copie reprend le texte de l\'original',
  items(listDoc)[1].querySelector('[data-cms$=".quote"]').textContent ===
    items(listDoc)[0].querySelector('[data-cms$=".quote"]').textContent,
);

// Réordonner
hover(listPage, items(listDoc)[0]);
check('« Monter » est désactivé sur le premier item', itemTool(listDoc, 'Monter').disabled);
itemTool(listDoc, 'Descendre').dispatchEvent(
  new listPage.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }),
);
await new Promise((resolve) => setTimeout(resolve, 350));
check('l\'item descend d\'un rang', ids(listDoc)[0] === 't-004' && ids(listDoc)[1] === 't-001', ids(listDoc).join(','));

// Supprimer : refus puis acceptation
listPage.window.confirm = () => false;
hover(listPage, items(listDoc)[0]);
itemTool(listDoc, 'Supprimer').dispatchEvent(
  new listPage.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }),
);
await new Promise((resolve) => setTimeout(resolve, 100));
check('refuser la confirmation ne supprime rien', ids(listDoc).length === 4, ids(listDoc).join(','));

let confirmMessage = '';
listPage.window.confirm = (message) => {
  confirmMessage = message;
  return true;
};
hover(listPage, items(listDoc)[0]);
itemTool(listDoc, 'Supprimer').dispatchEvent(
  new listPage.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }),
);
await new Promise((resolve) => setTimeout(resolve, 350));
check('confirmer supprime l\'item', ids(listDoc).length === 3, ids(listDoc).join(','));
check(
  'le message de confirmation rassure et ne parle pas technique',
  /conserv/i.test(confirmMessage) && !/(commit|git|json|sha)/i.test(confirmMessage),
  confirmMessage,
);

// Publication
buttonByText(listDoc, 'Publier').click();
await new Promise((resolve) => setTimeout(resolve, 100));

const listSave = listPage.calls.filter((c) => c.url === '/api/save').pop();
const listSent = JSON.parse(JSON.parse(listSave.init.body).content);
const published = listSent.collections.testimonials;

check('la liste publiée a le bon nombre d\'items', published.length === 3, String(published.length));
check(
  'l\'ordre publié est celui de la page',
  published.map((i) => i.id).join(',') === ids(listDoc).join(','),
  published.map((i) => i.id).join(','),
);
check('chaque item publié porte son identifiant', published.every((i) => /^t-\d{3}$/.test(i.id)));
check('aucun identifiant en double', new Set(published.map((i) => i.id)).size === published.length);
check(
  'le texte saisi dans l\'item ajouté est publié',
  published.find((i) => i.id === addedId)?.quote.value === 'Texte du nouvel item',
  JSON.stringify(published.find((i) => i.id === addedId)?.quote?.value),
);
check(
  'les items publiés gardent la forme du schéma',
  published.every((i) => i.quote?.type === 'text' && i.author?.type === 'text' && i.quote.style?.size),
);

// Annuler
const resetPage = await openPage();
const resetDoc = resetPage.document;
buttonByText(resetDoc, 'Ajouter').click();
await new Promise((resolve) => setTimeout(resolve, 350));
check('un item est bien ajouté avant l\'annulation', ids(resetDoc).length === 3);
buttonByText(resetDoc, 'Annuler mes modifications').click();
await new Promise((resolve) => setTimeout(resolve, 100));
check('annuler rend à la liste sa composition d\'origine', ids(resetDoc).join(',') === 't-001,t-002', ids(resetDoc).join(','));

// --- Langues ------------------------------------------------------------------
console.log('\nLangues');

const langPage = await openPage();
const langLinks = [...langPage.document.querySelectorAll('.cms-ui-langs a')];

check('la barre propose les langues du site', langLinks.length === 2, String(langLinks.length));
check(
  'ce sont de vrais liens vers de vraies adresses',
  langLinks.map((a) => a.getAttribute('href')).join(',') === '/fr/,/en/',
  langLinks.map((a) => a.getAttribute('href')).join(','),
);
check(
  'la langue courante est signalée',
  langLinks.filter((a) => a.getAttribute('aria-current') === 'true').length === 1,
);
check(
  'les langues sont nommées, pas codées',
  langLinks.map((a) => a.textContent).join(',') === 'Français,English',
  langLinks.map((a) => a.textContent).join(','),
);
check('aucun compteur quand tout est traduit', !langPage.document.querySelector('.cms-ui-pending'));

// Une page dont deux textes ne sont pas traduits.
const pendingMarkup = html.replace('<body ', '<body data-cms-untranslated="2" ');
const pendingPage = await openPage({ markup: pendingMarkup });
const pendingNotice = pendingPage.document.querySelector('.cms-ui-pending');
check('le nombre de textes à traduire est affiché', !!pendingNotice, 'absent');
check(
  'il est formulé en langage courant, sans jargon',
  /2 textes restent à traduire/.test(pendingNotice?.textContent ?? '') &&
    !/(locale|i18n|clé|json)/i.test(pendingNotice?.textContent ?? ''),
  pendingNotice?.textContent,
);

if (failures > 0) {
  console.error(`\n${failures} contrôle(s) en échec.\n`);
  process.exit(1);
}
console.log('\nOverlay : tous les contrôles passent.\n');
