# inline

Édition de contenu en front pour sites statiques. Le contenu vit dans des
fichiers JSON validés par Zod, il est injecté dans le HTML au moment du build,
et une interface d'édition superposée permet de le modifier directement sur la
page — sans CMS, sans serveur applicatif.

Le client reçoit une URL, `monsite.fr/admin`, et une clé. Il entre, il modifie
ses textes sur ses propres pages, il publie. Chaque publication est un commit ;
le site se reconstruit dans la minute.

**État : les huit lots sont livrés.** Textes, richtext, images, vidéos,
listes, multilingue, durcissement, industrialisation. Le périmètre v1 est
gelé — voir *Hors périmètre*.

Un nouveau projet démarre en une commande :

```bash
npm create inline@latest mon-site
```

La logique d'édition vit dans [inline-core](packages/inline-core), en
dépendance versionnée. Ce dépôt en est le site de référence.

---

## Prérequis

- Node.js 20 ou plus (développé sous 22.14).
- Un dépôt Git accessible par API pour publier — GitHub aujourd'hui.
  Un faux service local est fourni pour essayer sans dépôt.

---

## Mise en route

```bash
npm install
npm run create:site -- --nom "Essai local" --ecrire
```

La commande génère la clé du site, son empreinte et le secret de session, puis
écrit un `.dev.vars` prêt à l'emploi. **La clé elle-même n'est stockée nulle
part** : copiez-la, c'est elle que vous saisirez. Une clé perdue se régénère,
elle ne se retrouve pas.

Pour un vrai site, lancer la même commande sans `--ecrire` et poser les
variables chez l'hébergeur — voir [docs/nouveau-site.md](docs/nouveau-site.md).

```bash
npm run build            # construit le site
npm run serve:functions  # sert le site ET les fonctions sur http://127.0.0.1:8788
```

Ouvrez `http://127.0.0.1:8788/admin`, entrez la clé : vous arrivez sur le site
avec l'édition active. Cliquez sur un texte, modifiez-le, publiez.

---

## Variables d'environnement

Toutes documentées dans [`.env.example`](.env.example), le seul fichier
d'environnement versionné. En local : `.dev.vars`. En production : la
configuration de l'hébergeur. Jamais le dépôt.

| Variable | Rôle |
|---|---|
| `EDITOR_KEY_HASH` | Empreinte argon2id de la clé du site. Sans elle, aucune édition possible. |
| `SESSION_SECRET` | Signature des cookies de session. 32 caractères minimum. |
| `EDITOR_NAME`, `EDITOR_EMAIL` | Auteur des publications. Un site, un auteur. |
| `GIT_PROVIDER` | `github` ou `gitlab` (non implémenté). |
| `GIT_REPO` | `proprietaire/depot` |
| `GIT_BRANCH` | Branche de publication, `main` par défaut. |
| `GIT_TOKEN` | Jeton d'écriture du compte machine de l'agence. |
| `GIT_API_BASE` | Facultatif : autre racine d'API (instance auto-hébergée, ou faux service local). |

Deux secrets ne quittent jamais le serveur : le **jeton Git** et l'**empreinte
de la clé**. Ni l'un ni l'autre n'apparaît dans une page, une réponse HTTP ou un
stockage du navigateur. `npm run check` le vérifie sur le dossier de build.

Sur GitHub, utilisez un jeton à portée restreinte (*fine-grained*), limité au
seul dépôt du site, avec la permission **Contents: Read and write** et rien
d'autre.

---

## Commandes

```bash
npm run dev              # Serveur Astro seul — le site, sans les fonctions ni l'édition
npm run build            # Build de production (échoue si le contenu est invalide)
npm run serve            # Site + fonctions sur Node seul — aucun outil d'hébergeur
npm run serve:functions  # Site + fonctions via l'outil de l'hébergeur
npm run check            # HTML brut + parité des langues + journaux + aucun secret
npm run test             # Git, authentification, durcissement, répartition, amorçage, assainissement, médias, HEIC, langues, overlay
npm run create:site      # Régénère les accès d'un site : clé, empreinte, variables
npm run test:scaffold    # Crée un site de zéro, l'installe, le construit, le contrôle
npm run test:pack        # Idem, mais depuis les archives qu'une publication produirait
npm run bootstrap        # Extrait le contenu d'une page HTML déjà annotée
npm run make:key         # Génère seulement une clé et son empreinte (rotation)
npm run mock:git         # Faux service Git local, pour publier sans dépôt
```

`npm run check` doit passer avant tout commit. Il échoue si une valeur du JSON
n'est pas dans le HTML servi — c'est le filet contre une hydratation posée par
réflexe, qui sortirait le contenu de l'index des moteurs et des assistants.

Ces deux commandes sont exactement celles que lance l'intégration continue
([.github/workflows/ci.yml](.github/workflows/ci.yml)) sur chaque poussée et
chaque proposition de fusion. Elles bloquent la branche : un contrôle qui ne
bloque pas se contourne, puis se désactive, puis disparaît.

---

## Essayer la publication en local

### Sans dépôt, avec le faux service Git

Ajoutez `GIT_API_BASE=http://127.0.0.1:8787` à `.dev.vars`. Les publications
écrivent alors directement dans les fichiers du projet, comme le ferait un
commit.

```bash
npm run mock:git          # 1. faux service Git
npm run build             # 2. construit le site
npm run serve:functions   # 3. sert le tout
```

### Avec un vrai dépôt

Même chose, sans `GIT_API_BASE`, avec un `GIT_REPO` et un `GIT_TOKEN` réels.
Chaque publication produit un commit `content(fr): home — hero.title`, attribué
à `EDITOR_NAME` / `EDITOR_EMAIL`.

Le fournisseur seul se teste sans passer par l'interface :

```bash
npm run test:git                                             # hors ligne
GIT_REPO=… GIT_TOKEN=… node scripts/test-git-provider.mjs --online          # lecture réelle
GIT_REPO=… GIT_TOKEN=… node scripts/test-git-provider.mjs --online --write  # écriture + conflit
```

### Vérifier le verrou en cas d'édition simultanée

Ouvrez la page en édition, modifiez un texte sans publier. Modifiez le même
fichier ailleurs. Publiez depuis le premier onglet : la publication est refusée,
un message invite à recharger, et rien n'est écrasé. Après rechargement, le
bandeau de reprise repropose vos modifications.

---

## Multilingue

Une URL par langue, construite au build : `/fr/`, `/en/`. La racine redirige
vers la langue de référence par une redirection émise au build — **aucune
bascule de langue par JavaScript**, ni sur le site, ni dans l'overlay, où le
choix de langue est fait de vrais liens.

Un dossier JSON par langue :

```
src/content/pages/fr/home.json   la référence
src/content/pages/en/home.json   la traduction
```

### Ce qui se passe quand une traduction manque

Deux mécanismes, qui semblent se contredire et se complètent :

- **La page reste consultable.** Un champ absent de la traduction est repris de
  la langue de référence plutôt que de laisser un trou. Le champ est marqué,
  et la barre de l'overlay affiche « 2 textes restent à traduire sur cette
  page ».
- **Rien ne part en silence.** `npm run check` échoue sur toute clé présente
  dans une langue et absente d'une autre — dans les deux sens, y compris une
  clé traduite qui n'existe pas dans la référence et ne serait jamais affichée.

Le repli n'est donc pas une tolérance : c'est ce qui rend une page utilisable
pendant qu'on la traduit, sans masquer le travail restant.

Les items de liste se réconcilient **par identifiant** : une traduction peut
ranger ses témoignages dans un autre ordre sans que les textes ne glissent d'un
item à l'autre.

### Ajouter une langue

1. Déclarer le code dans `i18n.locales` d'[astro.config.mjs](astro.config.mjs)
   et dans `LOCALES` de [src/lib/locales.ts](src/lib/locales.ts), avec son nom
   dans `LOCALE_LABELS` — le client voit « Français », jamais « fr ».
2. Ajouter le code à `LOCALES` de
   [scripts/check-locales.mjs](scripts/check-locales.mjs).
3. Créer `src/content/pages/{code}/`. Tant que les fichiers manquent, les pages
   s'affichent dans la langue de référence et `npm run check` le signale.

---

## Déploiement

Le site est statique : n'importe quel hébergeur capable de servir des fichiers
et d'exécuter des fonctions convient. Les routes sont déclarées une seule fois,
dans [src/lib/api.ts](src/lib/api.ts), et chaque hébergeur s'y branche par un
adaptateur qui ne décide rien :

```
src/lib/api.ts             createRouter({ locales }) — la déclaration
functions/api/*.ts         hébergeur qui découvre les routes par l'arborescence
netlify/source/api.mts     Netlify — assemblé au build en ESM autonome
scripts/serve.mjs          Node seul — conteneur, VPS, autre plateforme
```

Les dossiers d'un hébergeur qu'on n'utilise pas se suppriment sans rien casser.
En ajouter un se fait dans un fichier, en appelant `api.handle(request, env)` —
voir le [README d'inline-core](packages/inline-core/README.md).

1. Connecter le dépôt à l'hébergeur. Commande de build : `npm run build`,
   dossier publié : `dist`.
2. Déclarer les variables d'environnement du tableau ci-dessus **en secrets**,
   pas en variables de build : elles ne doivent jamais atteindre le navigateur.
3. Déclarer un stockage partagé pour le comptage des tentatives : liaison
   clé-valeur `RATE_LIMIT` sur les plateformes qui en ont, stockage d'objets
   sur Netlify (voir ci-dessous).
4. Vérifier après déploiement : `curl -s https://monsite.fr/ | grep -c "votre titre"`
   doit renvoyer 1, et `curl -s -X POST https://monsite.fr/api/save` doit
   renvoyer 401.

### L'échec qui ne se voit pas

Un site déposé **sans ses fonctions** se construit, se sert et s'affiche
parfaitement. Seule l'édition échoue, au moment d'entrer la clé : `/api/auth`
répond 404 au lieu d'ouvrir une session, et rien à l'écran ne dit pourquoi. Les
soupçons se portent alors sur la clé, qui n'y est pour rien.

C'est le premier réflexe après un déploiement, quel que soit l'hébergeur :

```bash
curl -i https://monsite.fr/api/auth
```

`405 method_not_allowed` : les fonctions tournent, la clé fonctionnera. Du HTML
ou un `404` : elles ne tournent pas, et aucune clé ne marchera.

### Le piège Netlify

Sur Netlify, la commande de build est `npm run build && npm run build:netlify` :
la fonction est assemblée **par le dépôt**, en ESM autonome, et non par Netlify.

> **Ne pas déclarer `node_bundler = "esbuild"` dans `netlify.toml`.** Netlify
> produit alors du CommonJS : l'export par défaut devient `exports.default`, la
> fonction est prise pour une v1, et l'exécution appelle `handler` qui n'existe
> pas. Symptôme : **502 « handler is not a function »** au moment d'entrer la
> clé — un échec qui, lui aussi, fait soupçonner la clé. Sans cette option et
> sans assemblage préalable, Netlify devrait résoudre lui-même le TypeScript
> d'`inline-core`, publié en source, ce qu'il ne sait pas faire.

`scripts/build-netlify.mjs` vérifie son propre produit — export par défaut,
chemin `/api/*`, `GET /api/auth` qui répond 405 — et fait échouer le build
plutôt que le site déployé.

### Essayer en local, sans outil d'hébergeur

```bash
npm run build
npm run serve          # PORT et HOST se règlent par l'environnement
```

`scripts/serve.mjs` sert `dist/` et `/api/*` dans un seul processus Node, en
lisant les variables de l'environnement — complétées par `.dev.vars` puis `.env`
s'ils existent, sans jamais écraser ce qui est déjà posé. C'est aussi ce qui
permet de déposer le site sur une plateforme qui n'a pas d'adaptateur dédié.

Pas de compression, pas de TLS : derrière un proxy, c'est suffisant ; exposé
seul sur Internet, c'est un choix à assumer.

### Le stockage partagé du comptage

Le comptage des appels — tentatives de clé, publications, envois d'images — a
besoin d'un état partagé entre les instances de la fonction. Sans lui, `inline`
retombe sur un compteur en mémoire : suffisant en local, **insuffisant en
production**, où chaque instance compterait pour elle seule et où un démarrage
à froid remettrait tout à zéro.

Ce que chaque adaptateur branche :

| Adaptateur | Stockage | Partagé entre instances |
|---|---|---|
| `functions/` | liaison clé-valeur nommée `RATE_LIMIT` | oui |
| `netlify/` | stockage d'objets, activé sur le site | oui |
| `scripts/serve.mjs` | mémoire du processus | non — une seule instance |

Sur Netlify, l'adaptateur **écrit dans les journaux de la fonction** quand le
stockage est indisponible et qu'il retombe en mémoire. C'est le seul signe :
rien ne le montre à l'écran.

Les espaces clé-valeur des hébergeurs sont à cohérence différée : la protection
reste efficace contre une force brute — qui suppose des milliers d'essais —
mais n'est pas exacte à l'unité. Pour un comptage strict, viser un stockage
fortement cohérent (Durable Object ou équivalent) en implémentant
`RateLimitStore` dans [packages/inline-core/src/server/rate-limit.ts](packages/inline-core/src/server/rate-limit.ts).

---

## Rotation de la clé

À faire au départ d'un collaborateur, en cas de doute, ou périodiquement.

```bash
npm run make:key
```

1. Remplacer `EDITOR_KEY_HASH` chez l'hébergeur par la nouvelle valeur.
2. Remplacer `SESSION_SECRET` **si** vous voulez fermer immédiatement toutes les
   sessions ouvertes — c'est le cas dans un départ ou un doute. Sinon, les
   sessions en cours restent valables jusqu'à leur terme de 8 h.
3. Redéployer (les variables ne sont relues qu'au déploiement).
4. Transmettre la nouvelle clé au client.

L'ancienne clé cesse de fonctionner dès l'étape 3. Il n'y a pas de période de
recouvrement : c'est volontaire, deux clés valables en même temps est le genre
de confort dont on oublie de sortir.

---

## Comment c'est agencé

Le dépôt est séparé en deux, et c'est toute la question de l'exploitation :
ce qui est identique d'un client à l'autre est **partagé et versionné**, ce qui
lui appartient est copié puis adapté.

**Partagé — [packages/inline-core](packages/inline-core), version 2.1.0**

```
astro/                     L'intégration Astro
components/                Editable, Media, Collection
pages/                     /admin et /aide, clé en main
src/schema.ts              Schéma Zod — le build ET la fonction d'écriture
src/style-tokens.ts        Les variantes autorisées, source unique
src/safe-href.ts           Ce qu'est un lien sûr, des deux côtés
src/video.ts               Lecture d'une adresse YouTube / Vimeo
src/translate.ts           Repli de traduction (pas la liste des langues)
src/editor/                Overlay d'édition (TypeScript vanilla, 37 Ko)
src/editor/heic.ts         Décodage des photos HEIC, chargé à la demande
src/server/auth.ts         Clé de site, sessions — seul juge de l'identité
src/server/guard.ts        Débit, plafonds, chemins autorisés
src/server/rate-limit.ts   Comptage des appels, stockage interchangeable
src/server/git-provider.ts Interface du fournisseur Git
src/server/github.ts       Implémentation GitHub (version = SHA du blob)
src/server/gitlab.ts       Signature + notes, non implémenté
src/server/routes/         Les quatre routes, en fabriques configurables
src/server/router.ts       createRouter — les réunit, sans connaître d'hébergeur
styles/tokens.css          Correspondance enums du schéma → variables du thème
```

**Propre au site — le reste du dépôt**

```
src/content/config.ts        Déclaration de la collection
src/content/pages/{lang}/    Le contenu
src/content/site.json        Navigation, coordonnées — structure, pas contenu
src/lib/locales.ts           Les langues de CE site
src/styles/theme.css         La charte : palette, échelle typographique, rythme
src/components/              Les vôtres — ceux d'inline viennent du paquet
src/layouts/Base.astro       Métadonnées, éléments partagés
src/pages/[lang]/            Les pages
src/media/                   Les images téléversées
src/lib/api.ts               Les routes de CE site — une ligne, comme locales.ts
functions/api/*.ts           Adaptateur : hébergeur à découverte par arborescence
netlify/source/api.mts       Adaptateur : Netlify (assemblé par le build)
netlify.toml                 Sa configuration — pendant de wrangler.toml
scripts/build-netlify.mjs    Produit netlify/functions/api.mjs, et le vérifie
scripts/serve.mjs            Adaptateur : Node seul (conteneur, VPS, autre)
scripts/                     Contrôles et outils de test
```

Ce qui est dans `inline-core` **ne se recopie jamais**. Un correctif de
sécurité doit atteindre les dix sites en changeant un numéro de version, pas en
dix modifications à retrouver.

**Flux de lecture** : JSON → Astro → HTML statique. Aucun appel réseau à
l'exécution, aucun JavaScript nécessaire à l'affichage du contenu.

**Flux d'écriture** : overlay → `POST /api/save` → `verifyAuth` → validation
Zod → commit → reconstruction.

### Quatre points qui méritent d'être connus

**Le schéma vit dans `inline-core/schema`, pas dans `config.ts`.** La
fonction d'écriture ne peut pas importer `astro:content` : en isolant le schéma
Zod dans un fichier neutre, le build et l'écriture valident avec le *même*
objet, pas avec deux copies qui finiraient par diverger.

**Une page publique ne charge pas l'overlay.** Elle porte 175 octets de
JavaScript en ligne, qui lisent un cookie et ne font rien d'autre. Le paquet de
l'éditeur n'est téléchargé que si ce témoin est présent — donc seulement après
une authentification réussie.

**Le témoin d'édition ne donne aucun droit.** Il est lisible et falsifiable :
c'est assumé. Le forger n'affiche qu'une interface dont toutes les écritures
seront refusées côté serveur. Éditer le DOM sans clé est sans plus de
conséquence qu'avec les outils de développement du navigateur.

**Vérifier une clé coûte ~350 ms.** C'est le prix d'argon2id aux paramètres
recommandés, et c'est voulu : c'est ce qui rend la force brute impraticable. Ce
coût n'est payé qu'à la connexion, une fois par tranche de 8 h. Sur un
hébergement facturant le temps processeur, vérifiez que le forfait couvre cette
durée sur la route `/api/auth`.

### Ajouter un champ éditable

1. Ajouter la clé dans `src/content/pages/fr/home.json` :
   - texte simple → `{ "type": "text", "value": "…", "style": { … } }`
   - paragraphe avec emphase ou lien → `{ "type": "richtext", "value": "…" }`
   - image → `{ "type": "media", "kind": "image", "src": "…", "alt": "…", "width": …, "height": … }`
   - vidéo → `{ "type": "media", "kind": "video", "provider": "youtube", "videoId": "…", "title": "…" }`
2. Poser le composant correspondant dans la page :
   `<Editable data={data} path="blocks.mon.champ" as="h2" />` pour du texte,
   `<Media data={data} path="blocks.mon.visuel" />` pour un média.

Le build échoue si le chemin n'existe pas, et `npm run check` échoue si la
valeur n'arrive pas dans le HTML.

### Ce que le client peut modifier

**Sur un champ texte**, une barre apparaît au clic : taille, épaisseur,
italique, alignement, couleurs du thème. Ses boutons sont construits à partir
de `inline-core/style-tokens`, d'où le schéma Zod tire aussi ses enums — un
bouton proposant une valeur que le build refuserait est donc impossible, il n'y
a pas deux listes à tenir d'accord.

**Sur un champ richtext**, la barre propose gras, italique, lien et listes.
Rien d'autre : ce sont exactement les balises que l'assainissement laisse
passer.

**Au collage**, la mise en forme d'origine est écrasée sans exception. Un
paragraphe collé depuis Word arrive avec ses polices, ses tailles en points et
ses couleurs ; il ne reste que le texte, le gras et l'italique.

**Sur une image**, un panneau s'ouvre : choisir un fichier sur l'appareil, et un
seul champ en dessous, « Description de l'image », prérempli quand le nom du
fichier veut dire quelque chose. Le client n'a jamais à redimensionner ni à
convertir quoi que ce soit.

**Sur une vidéo**, un champ où coller un lien YouTube ou Vimeo. Toutes les
formes fonctionnent : la barre d'adresse, le bouton « Partager », le code
d'intégration collé en entier. Aucun fichier vidéo n'est jamais téléversé.

**Sur une liste**, un bouton « Ajouter » sous la liste, et au survol d'un
élément : Monter, Descendre, Dupliquer, Supprimer. Toute suppression demande
confirmation, avec la mention que les versions précédentes sont conservées.

### Ajouter une liste éditable

```astro
<Collection
  data={data}
  name="testimonials"
  item={Testimonial}
  blank={{ quote: { … }, author: { … } }}
/>
```

`Collection` rend les items **et** le `<template>` qui sert de modèle, avec le
même composant d'item. C'est ce qui garantit qu'un élément ajouté depuis la
page a exactement la structure d'un élément construit : il n'y a pas de second
rendu à tenir d'accord, et aucun moteur de rendu côté client.

Le `blank` accompagne le modèle dans la page. Sans lui, l'overlay ne saurait
pas quel JSON créer à l'ajout.

`npm run check` échoue si une collection n'a pas son `<template>` — sans lui,
le bouton « Ajouter » ne pourrait rien faire.

### Les identifiants d'items

Chaque élément porte un identifiant (`t-001`, `t-002`…) **stable et immuable** :
c'est la clé qui relie le DOM au JSON. Un identifiant n'est jamais réattribué,
même après suppression — le réutiliser rattacherait les modifications d'un
élément disparu à un élément neuf. La fonction refuse tout doublon.

### Où passe le traitement des images

Trois étapes, chacune là où elle a les moyens de se faire :

| Étape | Où | Quoi |
|---|---|---|
| Décodage, redressement, recadrage, réduction, conversion WebP | Navigateur | Une photo de 15 Mo part en quelques centaines de Ko |
| Contrôle et rangement | Fonction | Format reconnu aux octets, dimensions lues dans l'en-tête, fichier renommé |
| AVIF, WebP, jeu de largeurs | Build | `<Image />` d'`astro:assets` |

Le navigateur fait le travail sur les pixels parce que le runtime des fonctions
n'a pas de codec : la seule voie serait un module WebAssembly, et la compilation
de WebAssembly à l'exécution y est interdite. Le résultat est meilleur de toute
façon — ce qui traverse le réseau se compte en centaines de kilo-octets, et le
dépôt ne grossit pas de photos brutes.

### Les photos HEIC d'iPhone

Un iPhone photographie en HEIC par défaut. Safari sait l'afficher, Chrome et
Firefox non. Sans traitement, un client sur PC recevant une photo par AirDrop
ou par courriel se verrait refuser son fichier — c'est-à-dire qu'on lui
demanderait de le convertir, exactement ce que le projet s'interdit.

`inline` tente d'abord le décodeur du navigateur, et ne charge le décodeur HEIC
qu'en cas d'échec, sur un fichier reconnu HEIC **à ses octets**. Le module pèse
1,4 Mo et ne part que dans ce cas : un client qui ne dépose jamais de HEIC ne le
télécharge jamais. Une photo de 12 Mpx est décodée en 1,4 s environ, puis
repasse par le chemin commun — recadrage, réduction, WebP.

Le décodage complet ne peut pas être testé sans une vraie photo : aucun encodeur
HEVC n'est disponible pour en fabriquer une, et une photo personnelle n'a rien à
faire dans un dépôt. `npm run test:heic` vérifie donc toujours la
reconnaissance du format, et **saute explicitement** le décodage faute
d'échantillon. Pour l'exécuter :

```bash
INLINE_HEIC_SAMPLE=/chemin/vers/photo.heic npm run test:heic
```

**La fonction ne croit rien de ce qu'on lui déclare** : ni le type MIME annoncé,
ni le nom du fichier, ni les dimensions. Un `.jpg` qui contient un SVG est
refusé, un fichier vidéo aussi — avec un message qui dit lequel des deux
c'était.

**Les fichiers vivent dans `src/media`, pas dans `public/media`.** C'est la
seule façon pour `<Image />` de les traiter au build. Un fichier de `public/`
serait servi tel quel, sans AVIF, sans jeu de largeurs, sans dimensions.

---

## Mettre en place un site

```bash
npm create inline@latest mon-site
cd mon-site && npm install
npm run build && npm run serve:functions
```

La commande écrit le squelette, les quatre adaptateurs de routes, la charte, une
page de contenu, les contrôles et l'intégration continue — puis affiche la clé
du site, une fois. Elle **n'écrit pas** la logique d'édition : celle-ci arrive
par `inline-core`. C'est toute la différence entre un échafaudage et un
copier-coller : le jour d'un correctif de sécurité, un `npm update` suffit.

Dans un projet Astro qui existe déjà :

```js
// astro.config.mjs
import inline from 'inline-core/astro';

export default defineConfig({
  output: 'static',
  integrations: [inline({ locales: ['fr'], support: { email: 'contact@agence.fr' } })],
});
```

Trois documents pour la suite, dans l'ordre où on s'en sert :

- **[docs/nouveau-site.md](docs/nouveau-site.md)** — de la commande de création
  au site déployé : charte, contenu, variables, vérifications. Une journée.
- **[docs/migration.md](docs/migration.md)** — reprendre un site statique
  existant. Annoter le HTML, puis `npm run bootstrap` en extrait le contenu.
  Page par page : rien n'oblige à tout convertir d'un coup.
- **[docs/formation-client.md](docs/formation-client.md)** — le script de la
  capsule de six minutes livrée avec la clé.

```bash
npm run create:site -- --nom "Boulangerie Martin" --depot agence/boulangerie-martin
```

La commande affiche deux blocs qui ne voyagent pas ensemble : ce qui part chez
le client (une clé, une adresse) et ce qui part chez l'hébergeur (l'empreinte,
les secrets, le jeton), plus la liste de vérification d'avant livraison.

### Reprendre un site existant

```bash
npm run bootstrap -- --html ancien-site/accueil.html --page accueil --essai
```

L'amorçage lit les valeurs **déjà présentes** dans une page annotée et en fait
le fichier de contenu : textes et leurs variantes de style, richtext, images
avec description et dimensions, vidéos converties en fournisseur + identifiant,
listes avec leurs identifiants.

Ce qu'il ne fait pas : décider ce que le client a le droit de changer. C'est le
vrai travail d'une reprise, et il ne s'automatise pas.

Ce qu'il refuse de faire : inventer. Une image sans description fait échouer
l'amorçage plutôt que de produire un `alt` vide. Une valeur plausible inventée
à ce stade se retrouve en production, invisible en revue, et personne ne la
corrige jamais.

---

## Sécurité

**Ce qui est protégé, c'est l'écriture, pas l'interface.**

- Clé de site hachée en argon2id, jamais stockée en clair, jamais comparée dans
  le navigateur, jamais servie.
- Débit borné sur **toutes** les routes, par appelant — voir le tableau
  ci-dessous.
- Message d'erreur unique — « clé incorrecte » — quelle que soit la cause.
- Session de 8 h portée par un cookie `HttpOnly`, `Secure`, `SameSite=Strict`,
  signé en HMAC-SHA256.
- `/api/save`, `/api/upload` et `/api/content` appellent `verifyAuth` avant
  d'approcher le dépôt.
- Schéma Zod identique à celui du build, appliqué avant toute écriture.
- Chemins d'écriture restreints à `src/content/pages/{langue}/{page}.json`.
- Chemins de médias restreints à un nom en minuscules sans accent — la **même**
  liste blanche décide de ce que `/api/upload` écrit et de ce que `/api/save`
  accepte de voir référencé.
- Plafond de taille du contenu (100 Ko), de l'enveloppe complète (128 Ko), et de
  20 Mo par fichier envoyé. Le plafond est appliqué sur les octets reçus, pas
  seulement sur la taille annoncée.
- Message de publication réduit à une seule ligne : ni retour à la ligne, ni
  séparateur Unicode, ni marque d'inversion d'écriture ne peuvent servir à
  composer un historique trompeur.
- Formats d'image en liste blanche, reconnus aux octets ; nom de fichier réécrit
  systématiquement, jamais repris de ce qu'annonce le navigateur.
- Verrou optimiste : la version lue à l'ouverture est comparée avant d'écrire,
  et un écart renvoie un conflit au lieu d'écraser.
- Messages d'erreur sans détail technique côté navigateur ; le détail va dans la
  console et les journaux serveur — jamais la clé, l'empreinte, le cookie ou le
  jeton.
- Richtext assaini des deux côtés, sur une liste blanche de sept balises et d'un
  seul attribut. Une agression caractérisée — script, gestionnaire d'événement,
  `iframe`, lien `javascript:` — est refusée par la fonction, pas seulement
  nettoyée.

### Pourquoi l'assainissement serveur n'utilise pas DOMPurify

DOMPurify a besoin d'un DOM, que le runtime des fonctions ne fournit pas. Avec
un DOM en JavaScript pur (linkedom), DOMPurify **ne lève aucune erreur** : il
passe `isSupported` à faux et renvoie son entrée telle quelle. Vérifié dans le
runtime, un `<script>` et un `href="javascript:"` ressortaient intacts.

[packages/inline-core/src/server/sanitize.ts](packages/inline-core/src/server/sanitize.ts) reconstruit donc le fragment depuis son analyse
syntaxique : seule la liste blanche est réécrite, le reste n'existe pas dans le
résultat. `npm run test:sanitize` soumet le même corpus aux deux
implémentations et compare les sorties — c'est ce test qui garantit qu'elles ne
divergent pas.

### L'ordre des contrôles

Chaque route refuse dans cet ordre, et l'ordre compte autant que les règles :

1. **débit** — refuser un appelant qui insiste ne demande pas de savoir qui il
   est, et une session volée ne doit pas pouvoir marteler l'API du dépôt ;
2. **taille annoncée** — inutile de mettre 200 Mo en mémoire pour découvrir
   ensuite qu'ils dépassent le plafond ;
3. **identité** ;
4. **taille reçue**, puis forme, chemin, schéma, verrou, écriture.

Un plafond de taille placé après la lecture du corps ne protège de rien. C'est
pour cela que [scripts/test-guard.mjs](scripts/test-guard.mjs) appelle les
routes directement plutôt que de se contenter de tester les règles isolément :
c'est le seul moyen de vérifier l'ordre.

| Route | Budget | Ce qu'il protège |
|---|---|---|
| `/api/auth` | 5 par quart d'heure | la clé du site |
| `/api/content` | 60 par 5 minutes | le quota de l'API Git |
| `/api/save` | 30 par 5 minutes | le dépôt, le quota |
| `/api/upload` | 30 par quart d'heure | le dépôt, le quota |

Seul le premier protège un secret. Les autres sont larges : un humain qui édite
sa page ne les approche jamais.

### Journaux

`npm run check` refuse un `console.*` qui évaluerait un jeton, une empreinte,
un cookie, une session, ou un objet qui les contient (`env`, `headers`,
`payload`). Les chaînes de caractères sont retirées avant l'analyse : un
message en français parlant de « clé » n'est pas une fuite, `console.error(key)`
en est une.

C'est une règle qu'on respecte spontanément le jour où on l'écrit, et qu'on
enfreint six mois plus tard en ajoutant un `console.error(error)` pour
déboguer. [scripts/check-logs.mjs](scripts/check-logs.mjs) est là pour ce
jour-là.

---

## Hors périmètre

Le périmètre v1 est gelé. Ne pas implémenter sans validation explicite :
workflow de validation multi-rôles, permissions granulaires, versionnement
visuel du contenu, A/B testing, formulaires avec stockage, recherche interne,
commentaires, espace membre, éditeur de mise en page.

Si l'un de ces besoins remonte, le signaler : il indique probablement qu'un CMS
du marché serait plus adapté.

### Ce qui reste à écrire

- **GitLab.** [gitlab.ts](packages/inline-core/src/server/gitlab.ts) porte la
  signature et les six points à connaître avant de s'y mettre.
- **Un comptage de débit exact.** Celui en place s'appuie sur un espace
  clé-valeur à cohérence différée : il arrête une force brute, qui suppose des
  milliers d'essais, mais n'est pas exact à l'unité. Pour un comptage strict,
  implémenter `RateLimitStore` sur un stockage fortement cohérent.
- **Le recadrage d'image se fait au centre**, sans réglage : un visage au bord
  du cadre se retrouve coupé.
- **Les listes se réordonnent avec « Monter » et « Descendre »**, pas au
  glisser-déposer.

---

## Les autres frameworks

Astro accepte React, Vue, Svelte. `inline` aussi, à une condition qui n'est
pas celle qu'on croit.

**Un composant de framework rendu au build est parfaitement légitime**, même
pour du contenu éditable : sans directive `client:*`, il produit du HTML
statique comme un composant Astro, et l'overlay travaille dessus sans savoir ce
qui l'a produit.

**Ce qui casse, c'est l'hydratation d'une zone éditable**, pour deux raisons
distinctes qu'il vaut mieux ne pas confondre :

- `client:only` ne rend rien au build : le contenu n'est dans aucun HTML
  servi, donc dans aucun index ;
- `client:load` rend bien le contenu, mais le framework le **réaffiche** à
  l'arrivée du JavaScript, ce qui efface les modifications que le client était
  en train de faire. C'est la plus contraignante des deux, et elle ne se voit
  pas dans la source.

Une île hydratée qui n'englobe aucune zone éditable — un carousel, une carte,
un filtre — ne pose aucun problème, et `npm run check` l'accepte.
