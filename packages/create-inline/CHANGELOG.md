# Journal des versions — create-inline

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Versionnage sémantique, avec une règle qui lui est propre :

> Ce paquet n'est exécuté qu'une fois par site, à sa création. Une correction
> n'atteint donc **jamais** les sites déjà créés : ce qui manque au modèle reste
> manquant chez tous les clients livrés avant. Chaque entrée dit ce qu'un site
> existant doit faire pour rattraper, quand il le peut.

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
