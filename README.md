# inline

Édition de contenu en front pour sites statiques. Le contenu vit dans des
fichiers JSON validés par Zod, il est injecté dans le HTML au moment du build,
et une interface d'édition superposée permet de le modifier directement sur la
page — sans CMS, sans serveur applicatif.

Le client reçoit une URL, `monsite.fr/admin`, et une clé. Il entre, il modifie
ses textes sur ses propres pages, il publie. Chaque publication est un commit ;
le site se reconstruit dans la minute.

**État : lots 0 à 6 livrés.** Textes, richtext, images, vidéos, listes,
multilingue et durcissement. Reste l'industrialisation — voir *Ce qui n'est pas
encore là*.

---

## Prérequis

- Node.js 20 ou plus (développé sous 22.14).
- Un dépôt Git accessible par API pour publier — GitHub aujourd'hui.
  Un faux service local est fourni pour essayer sans dépôt.

---

## Mise en route

```bash
npm install
npm run make:key      # génère la clé du site, son empreinte et le secret de session
cp .env.example .dev.vars
```

Reportez dans `.dev.vars` les deux lignes affichées par `make:key`
(`EDITOR_KEY_HASH` et `SESSION_SECRET`), puis vos accès au dépôt. **La clé
elle-même n'est stockée nulle part** : copiez-la, c'est elle que le client
saisira. Une clé perdue se régénère, elle ne se retrouve pas.

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
npm run serve:functions  # Site + fonctions : c'est ici qu'on édite en local
npm run check            # HTML brut + parité des langues + journaux + aucun secret
npm run test             # Git, authentification, durcissement, assainissement, médias, HEIC, langues, overlay
npm run make:key         # Génère une clé de site, son empreinte, un secret de session
npm run mock:git         # Faux service Git local, pour essayer sans dépôt
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
et d'exécuter des fonctions convient. La configuration livrée vise Cloudflare
Pages ([wrangler.toml](wrangler.toml)) ; le dossier `/functions` se transpose
sur les autres plateformes en adaptant la signature des handlers.

1. Connecter le dépôt à l'hébergeur. Commande de build : `npm run build`,
   dossier publié : `dist`.
2. Déclarer les variables d'environnement du tableau ci-dessus **en secrets**,
   pas en variables de build : elles ne doivent jamais atteindre le navigateur.
3. Déclarer une liaison clé-valeur nommée `RATE_LIMIT` (voir ci-dessous).
4. Vérifier après déploiement : `curl -s https://monsite.fr/ | grep -c "votre titre"`
   doit renvoyer 1, et `curl -s -X POST https://monsite.fr/api/save` doit
   renvoyer 401.

### La liaison `RATE_LIMIT`

Le comptage des appels — tentatives de clé, publications, envois d'images — a
besoin d'un état partagé entre les instances de la fonction. Sans la liaison,
`inline` retombe sur un compteur en mémoire : suffisant en local,
**insuffisant en production**, où chaque instance compterait pour elle seule et
où un démarrage à froid remettrait tout à zéro.

Les espaces clé-valeur des hébergeurs sont à cohérence différée : la protection
reste efficace contre une force brute — qui suppose des milliers d'essais —
mais n'est pas exacte à l'unité. Pour un comptage strict, viser un stockage
fortement cohérent (Durable Object ou équivalent) en implémentant
`RateLimitStore` dans [functions/lib/rate-limit.ts](functions/lib/rate-limit.ts).

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

```
src/content/schema.ts        Schéma Zod — utilisé par le build ET par la fonction d'écriture
src/content/config.ts        Déclaration de la collection
src/content/pages/fr/*.json  Le contenu
src/content/site.json        Navigation, coordonnées, mentions — structure, pas contenu
src/styles/theme.css         La charte : palette, échelle typographique, rythme
src/styles/tokens.css        Correspondance enums du schéma → thème
src/components/Editable.astro    Rend un champ et pose son data-cms
src/layouts/Base.astro       Métadonnées, éléments partagés, amorce d'édition
src/pages/index.astro        La page
src/pages/admin.astro        La saisie de la clé, et rien d'autre
src/editor/heic.ts           Décodage des photos HEIC, chargé à la demande
src/editor/                  Overlay d'édition (TypeScript vanilla, 9 Ko)
functions/lib/auth.ts        Clé de site, sessions — seul juge de l'identité
functions/lib/rate-limit.ts  Comptage des tentatives, stockage interchangeable
functions/lib/git-provider.ts    Interface du fournisseur Git
functions/lib/github.ts      Implémentation GitHub (version = SHA du blob)
functions/lib/gitlab.ts      Signature + notes, non implémenté
functions/api/auth.ts        Ouverture et fermeture de session
functions/api/content.ts     Lecture : contenu + version de référence
functions/api/save.ts        Écriture : validation, verrou, commit
scripts/                     Contrôles et outils de test
```

**Flux de lecture** : JSON → Astro → HTML statique. Aucun appel réseau à
l'exécution, aucun JavaScript nécessaire à l'affichage du contenu.

**Flux d'écriture** : overlay → `POST /api/save` → `verifyAuth` → validation
Zod → commit → reconstruction.

### Quatre points qui méritent d'être connus

**Le schéma vit dans `src/content/schema.ts`, pas dans `config.ts`.** La
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
de `src/lib/style-tokens.ts`, d'où le schéma Zod tire aussi ses enums — un
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

`functions/lib/sanitize.ts` reconstruit donc le fragment depuis son analyse
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

## Ce qui n'est pas encore là

Industrialisation (lot 7) : dépôt modèle, overlay partagé et versionné, script
de création de site, amorçage d'un site existant.

L'implémentation GitLab reste à écrire — [gitlab.ts](functions/lib/gitlab.ts)
porte la signature et les six points à connaître avant de s'y mettre.

Le comptage de débit s'appuie sur un espace clé-valeur à cohérence différée : il
arrête une force brute, qui suppose des milliers d'essais, mais n'est pas exact
à l'unité. Pour un comptage strict, implémenter `RateLimitStore` sur un
stockage fortement cohérent.
