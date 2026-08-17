# Journal des versions — inline-core

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Versionnage sémantique, avec une règle qui lui est propre :

> Une modification du schéma qui invalide du contenu déjà publié est une
> version **majeure**, même si le code compile. C'est le contenu des clients
> qui casse, pas le nôtre.

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
