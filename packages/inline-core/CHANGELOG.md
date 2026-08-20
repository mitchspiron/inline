# Journal des versions — inline-core

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Versionnage sémantique, avec une règle qui lui est propre :

> Une modification du schéma qui invalide du contenu déjà publié est une
> version **majeure**, même si le code compile. C'est le contenu des clients
> qui casse, pas le nôtre.

---

## 2.1.0

L'hébergeur cesse d'être un choix qu'on fait une fois. Avant, les quatre routes
n'existaient que sous la forme qu'attend un hébergeur précis — un fichier par
route, des exports nommés `onRequest<Méthode>`. Le site marchait chez celui-là,
et nulle part ailleurs sans réécrire ses adaptateurs.

C'est une addition : rien de ce qui existait ne change de comportement.

### Ajouté

- **`createRouter({ locales })`**, exporté par `inline-core/server`. Il renvoie
  les quatre routes sous deux formes, au choix de l'hébergeur :

  - `routes` — la table, pour ceux qui veulent un fichier par route et des
    exports nommés ;
  - `handle(request, env)` — un point d'entrée unique, pour tous les autres ;
  - `find(pathname)` — la route servant un chemin, barre oblique finale
    ignorée, pour séparer l'API du statique dans un serveur maison.

  La répartition — quelle méthode, quel gestionnaire, 404 ou 405 — vit
  désormais dans le paquet et non plus dans chaque site. Un site n'en garde que
  sa configuration : `createRouter({ locales: LOCALES })`, une ligne.

- **`ROUTE_PATHS`**, la liste des chemins servis. Utile à un adaptateur qui doit
  déclarer ses routes à l'avance.

- **Les types `Router`, `Route`, `RouteHandler`.**

### Inchangé, et volontairement

- **Le paquet ne connaît toujours aucun hébergeur** — règle 4. `createRouter`
  ignore les conventions de fichiers, les liaisons et les variables de chacun
  d'eux ; un contrôle de la suite de tests refuse qu'un nom de produit
  apparaisse dans `router.ts`. Ce qui est propre à un hébergeur reste dans le
  site, où le choix se fait.
- **Les fabriques `createAuthRoute`, `createContentRoute`, `createSaveRoute`,
  `createUploadRoute` restent exportées** et se comportent à l'identique. Un
  site en 2.0.x n'a rien à changer.

### Pour en profiter dans un site existant

`npm update inline-core`, puis remplacer le contenu des quatre adaptateurs de
`functions/api/` par un branchement sur un `src/lib/api.ts` d'une ligne. Voir le
README, section « Le déploiement ». Rien n'y oblige : les anciens adaptateurs
continuent de fonctionner.

---

## 2.0.1

Rien dans le code : les fichiers publiés sont identiques à ceux de la 2.0.0.

### Changé

- **La documentation a une adresse** : <https://inline-docs.netlify.app>. Elle
  devient la page d'accueil du paquet sur npm, et s'affiche en tête du README.
  Une version était nécessaire pour cela seul — npm ne relit les métadonnées
  qu'à la publication.

---

## 2.0.0

`inline-core` devient utilisable depuis n'importe quel projet Astro : une
intégration, des composants, une commande de création. Avant, démarrer un site
voulait dire recopier une liste de fichiers depuis un dépôt de référence.

Le saut de version majeure est une affaire de rigueur, pas de migration :
la 1.0.0 n'a jamais quitté le dépôt, aucun site ne la consomme.

### Ajouté

- **Intégration Astro** (`inline-core/astro`). Elle pose `/admin` et
  `/aide`, construit l'overlay en dev comme en production, injecte l'amorce
  d'édition, et **refuse de démarrer si la sortie n'est pas statique**. Un site
  déclare ses langues et sa charte, rien d'autre.
- **Composants** (`inline-core/components/*.astro`) : `Editable`, `Media`
  et `Collection` ne sont plus recopiés site par site. C'était la dernière
  duplication qui subsistait.
- **Pages clé en main** : `/admin` et `/aide`, habillées par la charte du
  site. Un site qui veut les siennes passe `pages: { admin: false }`.
- **`create-inline`** : `npm create inline@latest mon-site` produit un site
  qui construit, avec sa clé, en une commande.

### Changé

- **`isAllowedPath(path, locales)`** prend désormais les langues en
  paramètre : le paquet ne peut pas les deviner, et une liste figée dans le
  code partagé serait une décision du site prise au mauvais endroit.
- **L'overlay lit les libellés de langue sur la page** (`data-cms-locales`)
  au lieu de les importer. Un paquet partagé ne peut pas connaître les langues
  d'un site en particulier.
- **Le contrôle d'hydratation porte sur les zones éditables**, plus sur la page
  entière. Un composant React, Vue ou Svelte rendu au build est légitime ; une
  île hydratée qui n'englobe aucune zone éditable aussi. Ce qui reste refusé,
  c'est une zone éditable **à l'intérieur** d'une île : le framework la
  réaffiche au chargement et efface les modifications en cours.

---

## 1.0.0

Première version publiable. Ce qui était réparti entre `src/` et `functions/`
d'un site devient un paquet versionné, consommé par chaque site.

### Ajouté

- **Modèle de contenu** (`schema`) : `text`, `richtext`, `media` (image ou
  vidéo), listes à identifiants stables. Le même objet Zod sert au build et à
  la fonction d'écriture — un contenu qui casserait la production n'entre pas
  dans le dépôt.
- **Variantes de style** (`style-tokens`) : source unique dont le schéma dérive
  ses enums *et* dont la barre d'outils construit ses boutons. Un bouton hors
  enum est impossible par construction.
- **Overlay** (`editor`) : édition de texte et de richtext sur la page, barre
  de variantes, panneau média avec recadrage et conversion dans le navigateur,
  décodage des photos HEIC d'iPhone, gestion des listes, brouillon local,
  verrou optimiste. Sous 50 Ko une fois découpé.
- **Serveur** (`server`) : identité par clé de site (argon2id, comparaison en
  temps constant, session signée de 8 h), limitation de débit sur toutes les
  routes, plafonds de taille, chemins en liste blanche, assainissement,
  abstraction du fournisseur Git.
- **Routes en fabriques** : `createAuthRoute`, `createContentRoute`,
  `createSaveRoute`, `createUploadRoute`. Un site n'écrit que des adaptateurs.
- **Repli de traduction** (`translate`) : un champ non traduit s'affiche dans
  la langue de référence et se signale, sans dispenser du contrôle de parité.
- **Correspondance des styles** (`styles/tokens.css`) : une classe par valeur
  du schéma, sans aucune valeur en dur.

### Décidé

- **GitLab n'est pas implémenté.** `server/gitlab.ts` porte la signature et les
  six points à connaître avant de l'écrire — notamment `last_commit_id` à la
  place du SHA, et le chemin encodé dans l'URL.
- **L'overlay ignore les langues du site.** Il lit `data-cms-locales`, posé au
  build : le paquet n'a pas à savoir combien de langues existent ni comment
  elles s'appellent.
- **L'assainissement serveur n'utilise pas DOMPurify** — il ne fait rien, sans
  le dire, dans un runtime sans DOM. Voir le README.
- **Le comptage de débit s'appuie sur `RateLimitStore`**, à cohérence différée
  chez les hébergeurs courants : il arrête une force brute, il n'est pas exact
  à l'unité.
