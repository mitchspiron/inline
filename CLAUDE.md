# CLAUDE.md

Instructions de travail pour ce dépôt. À lire avant toute modification.

---

## Le projet en une phrase

Un système d'édition en front pour sites statiques : le contenu vit dans des fichiers JSON validés par Zod, il est injecté dans le HTML **au moment du build par Astro**, et une interface d'édition superposée permet de modifier textes, styles, médias et listes directement sur la page, sans CMS ni serveur applicatif.

---

## Règles absolues

Ces règles priment sur toute autre considération. En cas de doute, demander plutôt que supposer.

1. **`output: 'static'` — jamais SSR, jamais hybride.** Aucune proposition de rendu serveur ne doit être retenue.
2. **Aucune directive `client:*` sur un composant affichant du contenu éditorial.** C'est la règle la plus facile à enfreindre par réflexe et la plus coûteuse : elle sort le contenu du HTML brut, donc de l'index des crawlers IA. Seules exceptions : l'overlay d'édition, et les interactions purement visuelles dont tous les éléments sont déjà dans le HTML (un carousel doit contenir tous ses slides en dur, le JS ne fait que les faire défiler).
3. **Le token Git ne quitte jamais le serveur.** Il appartient à l'agence, pas au client. Aucun code ne doit le placer dans une réponse, un fichier servi, `localStorage` ou `sessionStorage`.
3 bis. **La clé de site est vérifiée exclusivement côté serveur.** Ne jamais servir `EDITOR_KEY_HASH` au navigateur, ne jamais comparer la clé en JavaScript client. Un hash exposé est attaquable hors ligne.
4. **Aucun secret dans le dépôt.** Tokens et clés vivent exclusivement en variables d'environnement de la fonction serveur — l'hébergeur n'est pas tranché, aucun code ne doit en dépendre.
5. **Aucun style libre.** Les styles éditables passent uniquement par les enums Zod de `src/content/config.ts`. Pas d'hexadécimal, pas de pixels dans le JSON de contenu.
6. **Ne pas utiliser `src/pages/api/*`.** En sortie statique, ces endpoints s'exécutent au build et non à la requête. Toute route dynamique va dans `/functions`.
7. **Toute écriture est validée côté serveur** : identité, schéma Zod, chemin en liste blanche, taille, assainissement. Ne jamais se reposer sur la validation client.
8. **Aucun jargon technique dans l'interface d'édition.** Le client est non technique et ne verra jamais le code. « Publier » et non « Commit », « Description de l'image » et non « alt », « Annuler mes modifications » et non « Revert ». Le mot Git, le SHA, le JSON et le nom du dépôt ne doivent apparaître nulle part à l'écran.
9. **Aucune arborescence de contenu dans l'overlay.** Pas de panneau latéral affichant l'arbre du JSON ni de liste de fichiers. L'édition se fait sur la page, uniquement sur la page. C'est ce qui distingue cet outil d'un CMS.
10. **Les vidéos ne sont jamais téléversées.** Le schéma n'accepte qu'un `provider` + `videoId` (YouTube/Vimeo). Ne pas ajouter d'upload vidéo : un fichier lourd dans Git casse le dépôt et les builds.
11. **Ne pas élargir le périmètre.** Voir « Hors périmètre ». Les demandes qui en relèvent se signalent, ne s'implémentent pas.

---

## Architecture

```
/src
  /content
    config.ts             Collections + schémas Zod (source de vérité du modèle)
    site.json             Config globale : langues, navigation, pied de page
    /pages/{lang}/*.json  Contenu par page et par locale
  /components             Composants .astro — statiques par défaut
  /layouts
  /editor                 Overlay d'édition (TypeScript vanilla)
  /styles                 Tokens de thème
  /pages/[lang]/[...slug].astro
/public/media
/functions
  /lib/auth.ts            verifyAuth / createSession
  /lib/git-provider.ts    Abstraction GitHub / GitLab
  /api/auth.ts            Vérification de la clé de site → cookie signé
  /api/save.ts            Écriture : verifyAuth + Zod + commit
  /api/upload.ts          Upload de médias
/scripts
  check-html.mjs          CI : vérifie que le contenu est dans le HTML brut
  check-locales.mjs       CI : parité des clés entre locales
```

**Flux de lecture** : JSON → Astro → HTML statique sur CDN. Aucun appel réseau à l'exécution.

**Flux d'écriture** : overlay → `POST /api/save` → `verifyAuth` (cookie de session) → Zod → commit via `git-provider` → webhook → rebuild. Publication en 30 à 60 s.

**Deux points de couplage isolés**, et deux seulement :
```
functions/lib/git-provider.ts   readFile / writeFile        (GitHub | GitLab)
functions/lib/auth.ts           verifyAuth / createSession  (clé de site | délégué)
```
Aucune vérification d'identité ni appel à une API Git ailleurs dans le code.

---

## Modèle de contenu

Trois types de champs, pas un de plus. Définis dans `src/content/config.ts`, qui fait autorité.

| Type | Forme | Usage |
|---|---|---|
| `text` | `{ type, value, style }` | Titres, labels, paragraphes simples |
| `richtext` | `{ type, value }` — HTML restreint | Paragraphes avec emphase ou liens |
| `media` (image) | `{ type, kind:'image', src, alt, width, height }` | Images |
| `media` (video) | `{ type, kind:'video', provider, videoId, title }` | Vidéos YouTube/Vimeo — **jamais de fichier** |

Les listes vivent sous `collections`. Chaque item porte un `id` **stable et immuable** (`t-001`, `t-002`…) : c'est la clé de réconciliation DOM ↔ JSON. Ne jamais réattribuer un `id` existant.

### Tokens de style

```
size    : xs | sm | base | lg | xl | 2xl | 3xl
weight  : thin | light | regular | medium | semibold | bold
italic  : true | false
align   : left | center | right
color   : primary | secondary | muted | accent | inverse
```

Ces enums sont dans le schéma Zod : une valeur hors liste fait échouer le build. Ne pas ajouter de repli silencieux.

### HTML autorisé en `richtext`

`strong`, `em`, `a[href]`, `br`, `ul`, `ol`, `li`. Assainissement par DOMPurify côté client **et** côté fonction. Jamais côté client seul.

---

## Conventions de code

- **Composants Astro** pour le rendu. **TypeScript vanilla** pour l'overlay — pas de framework, pas de bundler lourd, cible sous 50 Ko.
- Zone éditable : `data-cms="chemin.vers.la.cle"`. Liste : `data-cms-list="collections.xxx"`. Item : `data-cms-item="{id}"`. Modèle d'item : `<template data-cms-template="xxx">`.
- Chaque collection éditable **doit** avoir son `<template>` dans la page : sans lui, l'ajout d'item obligerait à réimplémenter un moteur de rendu côté client.
- Images : toujours `<Image />` d'`astro:assets`, jamais `<img>` brut pour du contenu éditable.
- Le build échoue si un `data-cms` pointe vers une clé absente. Contrôle volontaire, ne pas l'assouplir.
- Fichiers médias en minuscules, sans accent ni espace. Renommage automatique à l'upload.
- Messages de commit générés par l'éditeur : `content(fr): home — hero.title`.

---

## Commandes

```bash
npm run dev             # Serveur Astro local
npm run build           # Build de production (échoue si Zod invalide)
npm run check           # check-html + check-locales
npm run editor          # Dev local avec mode édition actif
wrangler pages dev      # Test local des fonctions
```

---

## Authentification

**Un seul auteur par site.** Le client n'a ni compte Git ni compte tiers. Le dépôt et le token appartiennent à l'agence.

**Ce qui est protégé, c'est l'écriture, pas l'interface.** Quelqu'un qui ouvre l'overlay sans la clé modifie le DOM de son propre navigateur — sans conséquence, exactement comme avec les outils de développement. Ne pas dépenser d'effort à verrouiller l'overlay ; tout l'effort va sur les routes `/api/*`.

**Mécanique**
1. Clé saisie dans le panneau → `POST /api/auth`.
2. Comparaison à `EDITOR_KEY_HASH` (argon2id) **en temps constant**.
3. Si valide → cookie de session signé : `HttpOnly`, `Secure`, `SameSite=Strict`, 8 h.
4. `/api/save` et `/api/upload` appellent `verifyAuth` avant tout accès au dépôt.

**Non négociable**
- **Limitation de débit sur `/api/auth`** : 5 tentatives par IP par 15 min. C'est le point de sécurité le plus critique du projet — sans elle, la clé tombe en force brute.
- Hachage, jamais chiffrement : on vérifie, on ne retrouve pas.
- Une clé distincte par site (`openssl rand -base64 24`), jamais de clé d'agence.
- Auteur des commits : `EDITOR_NAME` / `EDITOR_EMAIL` en variables d'environnement.
- Procédure de rotation documentée dans le README (nouvelle valeur → redéploiement → transmission).

**Option multi-utilisateurs** : remplacer l'implémentation de `auth.ts` par Cloudflare Access ou Supabase Auth. Hors périmètre v1 — ne pas l'implémenter, mais ne rien écrire qui empêche la bascule.

---

## Ergonomie client (contraintes de développement)

Le client accède au site livré via une seule URL, `/admin`, saisit la clé de son site, et édite directement sur ses pages. Il ne voit ni tableau de bord, ni arborescence, ni terminologie technique.

- **Upload d'image** : accepter tout ce qui sort d'un appareil grand public (JPEG/PNG/HEIC jusqu'à ~20 Mo). Recadrage au ratio attendu, conversion WebP/AVIF, dimensions calculées côté serveur. **Ne jamais demander au client de redimensionner ou convertir.**
- **Champ `alt`** : toujours libellé « Description de l'image », prérempli quand c'est possible.
- **Vidéo** : un champ de collage d'URL. Extraire `provider` et `videoId` de l'URL collée, accepter toutes les variantes de format (`youtu.be`, `watch?v=`, `/embed/`).
- **Collage depuis Word** : le nettoyage à la saisie doit écraser polices, tailles et couleurs inline sans exception. À couvrir par un test dédié.
- **Suppression** : confirmation obligatoire sur tout retrait d'item de collection.
- **Brouillon local** : sauvegarde continue en `localStorage`, bandeau de reprise à la réouverture.
- **Petit écran** : afficher un message expliquant que l'édition nécessite un ordinateur, plutôt que livrer une interface dégradée.
- **Messages d'erreur en langage courant** : « Cette modification n'a pas pu être enregistrée, réessayez » plutôt que le code HTTP ou le message de l'API GitHub. Les détails techniques vont dans la console, pas à l'écran.

---

## SEO et référencement IA

À vérifier sur chaque page produite :

- Contenu intégralement présent dans le HTML brut. Contrôle : `curl` la page, le texte doit y être. Automatisé par `check-html.mjs`.
- Un seul `h1`, hiérarchie de titres sans saut de niveau.
- `title`, meta description, canonical et Open Graph issus du bloc `meta`.
- `alt` présent partout — imposé par Zod et par `<Image />`.
- `hreflang` réciproques entre locales + `x-default`.
- JSON-LD généré depuis le contenu (`Organization`, `Service`, `FAQPage`, `BreadcrumbList` selon la page).
- `sitemap.xml`, `robots.txt` et `llms.txt` générés au build.
- WebP/AVIF, `width` et `height` sur toutes les images.

---

## Sécurité

- `/api/auth` : comparaison en temps constant, limitation de débit, aucun détail dans le message d'erreur (« clé incorrecte », rien de plus).
- `/api/save` : appeler `verifyAuth`, valider avec le **même** schéma Zod que le build, restreindre les chemins à `/src/content/**`, plafonner la taille, limiter le débit.
- `/api/upload` : liste blanche de types MIME, taille maximale, renommage systématique.
- **Verrou optimiste** : le SHA lu à l'ouverture est renvoyé au save ; en cas de divergence, refuser et remonter un conflit explicite plutôt qu'écraser.
- Ne jamais journaliser la clé, le hash, le cookie de session ou le token Git.

---

## Hors périmètre

Ne pas implémenter sans validation explicite : workflow de validation multi-rôles, permissions granulaires, versionnement visuel du contenu, A/B testing, formulaires avec stockage, recherche interne, commentaires, espace membre, éditeur de mise en page.

Si l'un de ces besoins remonte, le signaler : il indique probablement qu'un CMS du marché serait plus adapté.

---

## Pièges connus

- **`client:load` posé par réflexe** sur un composant de contenu. C'est le piège numéro un du projet. `check-html.mjs` est le filet, mais la vigilance en revue passe avant.
- **Tentation du mode SSR** pour « simplifier » une route dynamique. Toujours passer par `/functions`.
- **Endpoints `src/pages/api/*`** qui semblent fonctionner en dev et ne font rien en production statique.
- **Ajout d'un champ dans une seule locale** : `check-locales.mjs` doit le détecter avant le commit.
- **Réattribution d'un `id`** dans une collection : casse le lien DOM/JSON et fait perdre les modifications de l'item.
- **Collection sans `<template>`** : l'ajout d'item devient impossible sans réécrire du rendu côté client.
- **Duplication de l'overlay site par site** : il doit rester une dépendance partagée et versionnée, sinon la maintenance devient ingérable au-delà de trois sites.
- **Copier-coller depuis Word** : le client le fera dès la première semaine. Sans écrasement complet des styles inline, la page se retrouve avec du Calibri 11 pt en plein milieu de la charte.
- **Photo de 8 Mo en 4032 × 3024** : cas nominal, pas cas limite. Le pipeline d'upload doit l'absorber sans intervention.
- **Fuite de jargon dans un message d'erreur** : c'est par là que le vocabulaire technique revient dans l'interface. Vérifier chaque chaîne affichée.
- **Vérification de la clé côté client** : raccourci tentant lors du développement de l'overlay, et faille totale. La clé part vers `/api/auth`, jamais ailleurs.
- **Oubli de la limitation de débit** : le code fonctionne parfaitement sans elle, ce qui la rend facile à repousser « pour plus tard ». Elle fait partie du lot 1, pas du lot 6.
