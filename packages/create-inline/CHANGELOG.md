# Journal des versions — create-inline

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Versionnage sémantique, avec une règle qui lui est propre :

> Ce paquet n'est exécuté qu'une fois par site, à sa création. Une correction
> n'atteint donc **jamais** les sites déjà créés : ce qui manque au modèle reste
> manquant chez tous les clients livrés avant. Chaque entrée dit ce qu'un site
> existant doit faire pour rattraper, quand il le peut.

---

## 1.2.0

Le site créé peut être déposé chez trois familles d'hébergeurs sans qu'une ligne
de son code change. Avant, le modèle ne livrait que les adaptateurs d'un seul :
déposé ailleurs, le site s'affichait normalement et refusait la clé, sans que
rien ne dise pourquoi.

### Ajouté

- **`src/lib/api.ts`** — les routes du site, en une ligne :
  `createRouter({ locales: LOCALES })`. C'est de la configuration, comme
  `locales.ts` ; la répartition vit dans `inline-core` (≥ 2.1.0) et se met à
  jour avec lui.
- **`netlify/source/api.mts`, `netlify.toml` et `scripts/build-netlify.mjs`** —
  l'adaptateur Netlify. Une seule fonction pour les quatre routes, aucune
  redirection à écrire. Il traduit les deux seuls écarts : `process.env` au lieu
  des liaisons, et le stockage d'objets de Netlify au lieu d'un espace
  clé-valeur pour le comptage des tentatives. Si ce stockage est indisponible,
  le comptage retombe en mémoire **et le dit dans les journaux**.

  La fonction est **assemblée par le site** (`npm run build:netlify`), en ESM
  autonome, et non par Netlify. Deux raisons, et il faut connaître la première :

  - avec `node_bundler = "esbuild"`, Netlify produit du CommonJS. L'export par
    défaut devient `exports.default`, la fonction est prise pour une **v1**, et
    l'exécution appelle `handler` — qui n'existe pas. Le site répond alors
    **502 « handler is not a function »** au moment où le client entre sa clé,
    et rien n'indique que la clé n'y est pour rien ;
  - sans cette option, Netlify doit résoudre lui-même le TypeScript
    d'`inline-core`, publié en source — ce que Node ne sait pas charger.

  `build-netlify.mjs` vérifie son propre produit avant de rendre la main :
  export par défaut présent, chemin `/api/*` déclaré, `GET /api/auth` qui répond
  405. Un artefact inutilisable fait échouer le build, pas le site déployé.
- **`scripts/serve.mjs` et `npm run serve`** — le site et ses routes servis par
  Node seul, sans outil d'hébergeur : un conteneur, une machine, n'importe
  quelle plateforme qui lance un processus. C'est aussi le moyen le plus court
  d'essayer les routes en local.
- **`@netlify/blobs` en dépendance, `esbuild` en dépendance de développement**
  du site créé — pour les deux points ci-dessus.
- **`netlify/functions/` est ignoré par Git** : c'est un produit du build.

### Changé

- **Les quatre adaptateurs de `functions/api/` ne construisent plus les
  routes** : ils réexportent celles de `src/lib/api.ts`. Le comportement est
  identique ; la déclaration n'existe plus qu'à un seul endroit.
- **`check-logs.mjs` inspecte aussi `netlify/`.** Un adaptateur reçoit les
  variables : c'est du code à portée de secrets, quel que soit l'hébergeur.
- **Le message de fin rappelle la vérification d'après déploiement**
  (`curl -i https://<le-site>/api/auth` → 405). Un site déposé sans ses
  fonctions est le seul échec d'`inline` qui ne se voit pas à l'écran.
- **`inline-core` est demandé en `^2.1.0`**, version qui expose `createRouter`.

### Ce qu'un site déjà livré doit faire pour rattraper

Rien n'est cassé : un site en 1.1.0 continue de fonctionner chez son hébergeur
d'origine. Pour gagner la portabilité, quatre gestes, dans cet ordre :

1. `npm update inline-core` (≥ 2.1.0) ;
2. créer `src/lib/api.ts` avec la ligne `createRouter` ;
3. y brancher les quatre fichiers de `functions/api/` ;
4. copier `netlify/`, `netlify.toml`, `scripts/serve.mjs` et
   `scripts/build-netlify.mjs` depuis un site créé avec cette version, et
   régler la commande de build de Netlify sur
   `npm run build && npm run build:netlify`.

Le plus simple reste de générer un site neuf à côté et d'y prendre les fichiers.

---

## 1.1.0

Le site créé sait régénérer sa propre clé. Avant, la commande n'existait que
dans le dépôt de référence — c'est-à-dire nulle part, pour qui a reçu un site
livré et perdu sa clé.

### Ajouté

- **`npm run make:key` dans le site créé.** Le script
  `scripts/make-key.mjs` est désormais livré avec le modèle, et déclaré dans le
  `package.json` produit. Il affiche une nouvelle clé, son empreinte argon2id et
  un secret de session ; il n'écrit rien sur disque.
- **`@noble/hashes` en dépendance de développement du site créé.** Le paquet
  arrive déjà dans l'arbre par `inline-core`, mais rien ne garantit qu'il soit
  hissé à la racine : sous pnpm, ou sous npm en stratégie imbriquée,
  `make:key` échouerait sur un module introuvable. La déclaration est explicite
  plutôt que laissée au hasard.
- **Une section « Clé perdue, clé à changer »** dans le README du paquet : la
  procédure de rotation complète, jusqu'au redéploiement et à la transmission.
- **Le message de fin de création** renvoie vers `npm run make:key` pour la mise
  en production et pour la rotation.

### Rattrapage pour un site créé avant cette version

Deux lignes à ajouter, et rien d'autre :

```bash
# 1. copier le script depuis un site récent, ou depuis le dépôt de référence
cp ../site-recent/scripts/make-key.mjs scripts/make-key.mjs

# 2. déclarer la commande et la dépendance
npm pkg set scripts.make:key="node scripts/make-key.mjs"
npm install --save-dev @noble/hashes@^2.3.0
```

Sans cette reprise, la rotation reste possible depuis le dépôt de référence avec
`npm run make:key` : c'est la même empreinte, calculée avec les mêmes
paramètres.

### Contrôlé

- `scripts/test-scaffold.mjs` vérifie désormais que le script est livré, que la
  commande est déclarée, que le mode d'emploi la mentionne, et — dans le site
  fraîchement installé — que `npm run make:key` sort bien une empreinte
  `$argon2id$v=19$…`. Le dernier contrôle porte autant sur la commande que sur
  la dépendance : c'est lui qui aurait attrapé l'oubli.

---

## 1.0.0

Première version publiable. `npm create inline@latest mon-site` produit un site
qui construit, avec sa clé, en une commande.

### Ajouté

- **L'échafaudage** : configuration Astro, intégration `inline`, mise en page,
  une page de contenu, la charte, la déclaration de la collection, les quatre
  adaptateurs de routes de `/functions`, les contrôles et l'intégration
  continue.
- **Les accès d'essai** : la clé du site est générée, affichée **une seule
  fois**, et posée dans un `.dev.vars` qui n'entrera jamais dans le dépôt. Avec
  le faux dépôt local, on peut publier dès la première minute, sans dépôt
  distant ni hébergeur.
- **Les options** `--nom`, `--courriel` et `--langue` : le nom du site, l'adresse
  de contact montrée au client, et le code de la langue principale.

### Décidé

- **La logique d'édition n'est pas recopiée.** Elle arrive par `inline-core`, en
  dépendance versionnée. C'est toute la différence entre un échafaudage et un
  copier-coller : le jour d'un correctif de sécurité, un `npm update` suffit.
- **Un dossier existant et non vide n'est jamais écrasé.** La commande refuse
  plutôt que d'effacer.
