# Mettre en place un nouveau site

Compter une journée, dont la plus grande part pour l'intégration graphique.
Le reste est mécanique.

---

## Ce qui se copie, ce qui se partage

Le dépôt est séparé en deux, et c'est toute la question :

| | Où | Par site |
|---|---|---|
| Overlay, modèle, composants, routes, sécurité | `inline-core` | **dépendance versionnée** |
| Contenu, charte, mise en page, adaptateurs | le projet | créé une fois, puis adapté |

Ce qui est dans `inline-core` **ne se recopie jamais**. Un correctif de
sécurité doit atteindre les dix sites en changeant un numéro de version, pas en
dix modifications à retrouver. C'est la seule règle qui rende l'exploitation
tenable au-delà de trois clients.

---

## 1. Créer le projet

```bash
npm create inline@latest boulangerie-martin -- \
  --nom "Boulangerie Martin" --courriel contact@boulangerie-martin.fr
```

La commande écrit le squelette et affiche la clé du site, une fois. Elle pose
aussi un `.dev.vars` prêt à l'emploi, pour éditer dès la première minute sans
dépôt ni hébergeur :

```bash
cd boulangerie-martin && npm install
npm run build
npm run serve:functions
```

Ouvrir `http://127.0.0.1:8788/admin`, saisir la clé, modifier un texte,
publier.

Un dépôt par client. Le contenu d'un client ne doit jamais côtoyer celui d'un
autre : c'est aussi ce qui circonscrit un incident.

### Ce que le projet contient — et ne contient pas

Il contient sa configuration, son contenu, sa charte, ses pages, et quatre
adaptateurs de routes de cinq lignes. Il ne contient **aucune** logique
d'édition : ni overlay, ni schéma, ni vérification d'identité. Tout cela vient
d'`inline-core`, en dépendance versionnée.

C'est ce qui rend l'exploitation tenable : un correctif de sécurité atteint les
dix sites par un `npm update`, pas par dix modifications à retrouver.

---

## 2. Les accès de production

Ceux du projet créé ne valent que pour l'essai local. Pour la mise en ligne :

```bash
npm run create:site -- --nom "Boulangerie Martin" --depot agence/boulangerie-martin
```

La commande affiche deux blocs qui ne voyagent pas ensemble : ce qui part chez
le client (une clé, une adresse) et ce qui part chez l'hébergeur (l'empreinte,
les secrets, le jeton). Elle affiche aussi la liste de vérification d'avant
livraison.

La clé n'est écrite nulle part. Ce qui n'est pas copié à ce moment-là est
perdu — et c'est voulu : une clé oubliée se régénère, elle ne se retrouve pas.

---

## 3. Poser la charte

Un seul fichier : `src/styles/theme.css`. Il définit les variables que
`inline-core/styles/tokens.css` consomme — couleurs, échelle typographique,
rythme.

Ne pas toucher à `tokens.css` : il fait le lien entre les enums du schéma et
ces variables. Une classe qui y manquerait donnerait un contenu valide qui ne
s'affiche pas.

---

## 4. Le contenu

Site neuf : partir des fichiers du modèle et les remplir.

Site existant : voir [migration.md](migration.md) — annoter le HTML, puis
`npm run bootstrap`.

Le projet créé est monolingue. Pour ajouter une langue : déclarer son code
dans `locales` de l'intégration, dans `LOCALES` de `src/lib/locales.ts` avec
son nom dans `LOCALE_LABELS`, dans `i18n.locales` d'`astro.config.mjs` et
dans `scripts/check-locales.mjs`. Puis créer `src/content/pages/{code}/`.

Tant que les fichiers manquent, les pages s'affichent dans la langue de
référence et `npm run check` le signale.

---

## 5. Déployer

Le site porte un adaptateur par famille d'hébergeurs. Choisir celui de la
plateforme visée ; les autres dossiers se suppriment sans rien casser.

| Plateforme | Ce qui sert les routes | Comptage des tentatives |
|---|---|---|
| découverte par arborescence | `functions/` + `wrangler.toml` | liaison `RATE_LIMIT` |
| Netlify | `netlify/` + `netlify.toml` | stockage d'objets du site |
| conteneur, VPS, autre | `npm run serve` | mémoire — **une seule instance** |

1. Créer le projet chez l'hébergeur, branché sur le dépôt. Dossier publié :
   `dist`. Commande de build : `npm run build` — **sur Netlify,
   `npm run build && npm run build:netlify`**, qui assemble la fonction. Ne pas
   déclarer `node_bundler` dans `netlify.toml` : la fonction serait prise pour
   une v1 et l'exécution répondrait 502 « handler is not a function ».
2. Poser les variables affichées par `create:site` en **secrets d'exécution**,
   jamais en variables de build : elles ne doivent pas atteindre le navigateur.
3. Activer le stockage partagé du comptage, selon la colonne ci-dessus.
4. Vérifier **d'abord que les fonctions tournent** :

```bash
curl -i https://le-site.fr/api/auth        # 405 method_not_allowed
```

   C'est le contrôle qui vient en premier, avant tous les autres. Un site
   déposé en statique sans ses fonctions s'affiche parfaitement et refuse la
   clé : si cette commande renvoie du HTML ou un 404, rien d'autre ne sert à
   être testé, et aucune clé ne marchera.

5. Puis le reste :

```bash
curl -s https://le-site.fr/ | grep -c "un titre de la page"   # 1
curl -s -X POST https://le-site.fr/api/save                   # 401
```

Puis, à la main : cinq clés fausses de suite sur `/admin` doivent finir par un
message d'attente. Si la sixième tentative est encore refusée par « clé
incorrecte », la limitation de débit n'est pas active — ne pas livrer.

Sur Netlify, ce cas a une cause fréquente et un signe précis : le stockage
d'objets n'est pas activé, et l'adaptateur l'écrit dans les journaux de la
fonction en retombant sur un compteur en mémoire.

---

## 6. Livrer au client

- La capsule de formation — voir [formation-client.md](formation-client.md).
- Le lien vers `/aide`.
- La clé, par un canal séparé du reste.

---

## Essayer les paquets avant de les publier

`inline-core` et `create-inline` ne sont pas encore sur un registre. Deux
façons de les mettre à l'épreuve, qui ne répondent pas à la même question.

**Est-ce que le code marche ?**

```bash
npm run test:scaffold
```

Crée un site, installe le paquet **par son chemin dans le dépôt**, construit,
lance les contrôles.

**Est-ce que ce qui partirait au registre marche ?**

```bash
npm run test:pack
```

Même chose, mais en passant par `npm pack` : les archives exactes qu'une
publication produirait. C'est le seul mode qui attrape un fichier oublié dans
`files` ou un chemin absent d'`exports` — des erreurs invisibles tant qu'on
installe depuis un dossier, et qui cassent le premier site d'un tiers.

À lancer avant toute publication.

### À la main

Pour voir le résultat plutôt qu'un rapport :

```bash
# 1. fabriquer les archives
npm pack ./packages/inline-core   --pack-destination /tmp/inline
npm pack ./packages/create-inline --pack-destination /tmp/inline

# 2. créer un site depuis l'archive de création
cd /tmp/inline && mkdir atelier && cd atelier
npm exec --yes -- "file:/tmp/inline/create-inline-1.0.0.tgz" mon-site --nom "Essai"

# 3. installer le cœur depuis son archive, puis construire
cd mon-site
npm install "file:/tmp/inline/inline-core-2.0.0.tgz"
npm run build && npm run serve:functions
```

Deux pièges rencontrés :

- **`npx <archive>` résout le chemin relatif depuis un dossier inattendu.**
  Passer par `npm exec --yes -- "file:<chemin absolu>"`.
- **Installer `inline-core` par son *dossier* impose que le projet d'essai soit
  sur le même disque que le dépôt** : npm pose alors un lien symbolique, et
  Astro calcule le chemin d'une route injectée avec `path.relative`, qui
  n'existe pas d'un disque à l'autre. Installer l'*archive* copie le paquet et
  lève la contrainte — une raison de plus de préférer ce mode.

`npm link` fonctionne aussi, mais dédouble Astro entre les deux projets et
produit des erreurs déroutantes. Les archives sont plus fidèles et plus sûres.

---

## Mettre à jour un site

```bash
npm update inline-core
npm test && npm run check
```

Le [journal des versions](../packages/inline-core/CHANGELOG.md) dit ce qui
change. Une version majeure demande une intervention sur le site ; une mineure
ou une corrective, rien.

Une modification du schéma qui invaliderait du contenu déjà publié est toujours
une version majeure, même si le code compile : c'est le contenu du client qui
casse, pas le nôtre.
