# inline

Édition de contenu en front pour sites statiques. Le contenu vit dans des
fichiers JSON validés par Zod, il est injecté dans le HTML au moment du build,
et une interface d'édition superposée permet de le modifier directement sur la
page — sans CMS, sans serveur applicatif.

Le client reçoit une URL, `monsite.fr/admin`, et une clé. Il entre, il modifie
ses textes sur ses propres pages, il publie. Chaque publication est un commit ;
le site se reconstruit dans la minute.

**État : lots 0 à 3 livrés.** Une page, une langue : textes, richtext, images et
vidéos. Listes et multilingue arrivent avec leurs lots — voir *Ce qui n'est pas
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
npm run check            # Contenu bien dans le HTML brut + aucun secret dans le build
npm run test             # Fournisseur Git, authentification, assainissement, médias, overlay
npm run make:key         # Génère une clé de site, son empreinte, un secret de session
npm run mock:git         # Faux service Git local, pour essayer sans dépôt
```

`npm run check` doit passer avant tout commit. Il échoue si une valeur du JSON
n'est pas dans le HTML servi — c'est le filet contre une hydratation posée par
réflexe, qui sortirait le contenu de l'index des moteurs et des assistants.

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

Le comptage des tentatives de clé a besoin d'un état partagé entre les
instances de la fonction. Sans la liaison, `inline` retombe sur un compteur en
mémoire : suffisant en local, **insuffisant en production**, où chaque instance
compterait pour elle seule.

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
- 5 tentatives par appelant par quart d'heure sur `/api/auth`.
- Message d'erreur unique — « clé incorrecte » — quelle que soit la cause.
- Session de 8 h portée par un cookie `HttpOnly`, `Secure`, `SameSite=Strict`,
  signé en HMAC-SHA256.
- `/api/save` et `/api/content` appellent `verifyAuth` avant toute autre chose.
- Schéma Zod identique à celui du build, appliqué avant toute écriture.
- Chemins d'écriture restreints à `src/content/pages/{langue}/{page}.json`.
- Plafond de taille du contenu (100 Ko), et de 20 Mo par fichier envoyé.
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

Ce qui reste à faire : limitation de débit sur `/api/save` et `/api/upload`
(lot 6).

---

## Ce qui n'est pas encore là

Listes et collections (lot 4), multilingue (lot 5).
Les types correspondants existent déjà dans le schéma : le contenu qui les
utilise sera validé, mais aucun composant ne les rend et aucun bouton ne les
modifie.

Deux fichiers manquent, faute d'objet à ce stade : `check-locales.mjs` (une
seule locale) et l'implémentation GitLab — [gitlab.ts](functions/lib/gitlab.ts)
porte la signature et les six points à connaître avant de l'écrire.
