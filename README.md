# Édition en front pour site statique — lot 0

Preuve de chaîne de bout en bout, sur le périmètre le plus petit possible :
**une page, une langue, du texte seul → édition dans la page → publication →
reconstruction → contenu en ligne.**

Ce lot ne cherche pas à poser l'architecture définitive. Il sert à vérifier que
la chaîne tient. Le périmètre est volontairement fermé : ni médias, ni listes,
ni multilingue, ni barre de style, ni authentification. Voir *Ce qui n'est pas
là* en fin de document.

---

## Prérequis

- Node.js 20 ou plus (développé sous 22.14).
- Un dépôt Git accessible par API pour publier réellement — GitHub en lot 0.
  Un faux service local est fourni pour essayer sans dépôt (voir plus bas).

```bash
npm install
```

---

## Variables d'environnement

Toutes les variables sont documentées dans [`.env.example`](.env.example), le
seul fichier d'environnement versionné.

Pour un essai en local, copiez-le en `.dev.vars` (ignoré par Git) :

```bash
cp .env.example .dev.vars
```

| Variable | Rôle |
|---|---|
| `GIT_PROVIDER` | `github` ou `gitlab`. GitLab n'est pas implémenté en lot 0. |
| `GIT_REPO` | `proprietaire/depot` |
| `GIT_BRANCH` | Branche de publication, `main` par défaut |
| `GIT_TOKEN` | Jeton d'écriture du compte machine de l'agence |
| `GIT_API_BASE` | Facultatif : autre racine d'API (instance auto-hébergée, ou faux service local) |
| `EDITOR_ENABLED` | `true` ouvre `/api/content` et `/api/save`. Faux par défaut. |
| `EDITOR_AUTHOR_NAME`, `EDITOR_AUTHOR_EMAIL` | Attribution des publications, en attendant l'identité authentifiée du lot 1 |

**Le jeton ne quitte jamais le serveur.** Il n'est lu que par les fonctions de
`/functions`, n'apparaît dans aucune réponse HTTP, aucun fichier servi, aucun
stockage du navigateur. `npm run check` le vérifie sur le dossier de build.

Sur GitHub, utilisez un jeton à portée restreinte (*fine-grained*), limité au
seul dépôt du site, avec la permission **Contents: Read and write** et rien
d'autre.

---

## Commandes

```bash
npm run dev             # Serveur local, site seul (pas d'overlay)
npm run editor          # Serveur local avec le mode édition actif
npm run build           # Build de production (échoue si le contenu est invalide)
npm run build:editor    # Build avec l'overlay, pour essayer la publication
npm run check           # Contenu bien dans le HTML brut + aucun secret dans le build
npm run test            # Fournisseur Git + overlay
npm run serve:functions # Sert le build ET les fonctions de /functions
npm run mock:git        # Faux service Git local, pour essayer sans dépôt
```

`npm run check` doit passer avant tout commit. Il échoue si une valeur du JSON
n'est pas dans le HTML servi — c'est le filet contre une hydratation posée par
réflexe, qui sortirait le contenu de l'index des moteurs et des assistants.

---

## Essayer la publication en local

### A. Sans dépôt, avec le faux service Git

Le plus rapide pour voir la chaîne fonctionner. Les publications écrivent
directement dans les fichiers du projet, comme le ferait un commit.

Dans `.dev.vars` :

```
GIT_PROVIDER=github
GIT_REPO=agence/site-de-test
GIT_BRANCH=main
GIT_TOKEN=jeton-factice
GIT_API_BASE=http://127.0.0.1:8787
EDITOR_ENABLED=true
```

Trois terminaux :

```bash
npm run mock:git          # 1. faux service Git
npm run build:editor      # 2. construit le site avec l'overlay
npm run serve:functions   # 3. sert le tout sur http://127.0.0.1:8788
```

Ouvrez `http://127.0.0.1:8788`, cliquez sur un texte, modifiez-le, cliquez
**Publier**. Le fichier `src/content/pages/fr/home.json` change sur le disque
et le terminal du faux service affiche le message de publication.

### B. Avec un vrai dépôt

Même chose, sans `GIT_API_BASE`, avec un `GIT_REPO` et un `GIT_TOKEN` réels.
Chaque publication produit un commit du type
`content(fr): home — hero.title`. Sur un hébergement branché sur le dépôt, le
site se reconstruit dans la foulée.

Le fournisseur seul se teste sans passer par l'interface :

```bash
npm run test:git                                  # hors ligne, aucun appel réseau
GIT_REPO=… GIT_TOKEN=… npm run test:git -- --online          # lecture réelle
GIT_REPO=… GIT_TOKEN=… npm run test:git -- --online --write  # aller-retour + conflit
```

`--write` crée deux commits sur un fichier de test (`.cms-probe.json`) :
à réserver à un dépôt d'essai.

### Vérifier le verrou en cas d'édition simultanée

1. Ouvrez la page en mode édition et modifiez un texte, sans publier.
2. Modifiez le même fichier ailleurs (directement dans le dépôt, ou avec le
   faux service, en éditant `home.json` puis en le republiant depuis un autre
   onglet).
3. Cliquez **Publier** dans le premier onglet.

La publication est refusée et un message invite à recharger la page. Le
contenu du dépôt n'est pas écrasé, et les modifications en cours sont
conservées : après rechargement, le bandeau de reprise les propose à nouveau.

---

## Comment c'est agencé

```
src/content/schema.ts        Schéma Zod — utilisé par le build ET par la fonction d'écriture
src/content/config.ts        Déclaration de la collection
src/content/pages/fr/home.json   Le contenu
src/components/Editable.astro    Rend un champ et pose son data-cms
src/layouts/Base.astro       Métadonnées + chargement conditionnel de l'overlay
src/pages/index.astro        La page
src/editor/                  Overlay d'édition (TypeScript vanilla, 9 Ko)
functions/lib/git-provider.ts    Interface du fournisseur Git
functions/lib/github.ts      Implémentation GitHub (version = SHA du blob)
functions/lib/gitlab.ts      Signature + notes, non implémenté
functions/api/content.ts     Lecture : contenu + version de référence
functions/api/save.ts        Écriture : validation, verrou, commit
scripts/                     Contrôles et outils de test
```

**Flux de lecture** : JSON → Astro → HTML statique. Aucun appel réseau à
l'exécution, aucun JavaScript nécessaire à l'affichage du contenu.

**Flux d'écriture** : overlay → `POST /api/save` → validation Zod → commit →
reconstruction.

### Deux points qui méritent d'être connus

**Le schéma vit dans `src/content/schema.ts`, pas dans `config.ts`.** La
fonction d'écriture ne peut pas importer `astro:content` : en isolant le schéma
Zod dans un fichier neutre, le build et l'écriture valident avec le *même*
objet, pas avec deux copies qui finiraient par diverger.

**L'overlay n'est pas dans le build normal.** Il n'est ni bundlé par Astro, ni
référencé : `build:editor` le compile à part avec esbuild et le layout ne pose
sa balise `<script>` que si `PUBLIC_EDITOR` vaut `true`. Un `npm run build`
produit un HTML sans une ligne de JavaScript.

### Ajouter un champ éditable

1. Ajouter la clé dans `src/content/pages/fr/home.json`, au format
   `{ "type": "text", "value": "…", "style": { … } }`.
2. Poser un `<Editable data={data} path="blocks.mon.champ" as="h2" />` dans la
   page.

Le build échoue si le chemin n'existe pas, et `npm run check` échoue si la
valeur n'arrive pas dans le HTML.

---

## Sécurité en lot 0 — à lire avant tout déploiement

**Les routes `/api/content` et `/api/save` ne sont pas authentifiées.** Elles
ne répondent que si `EDITOR_ENABLED=true`, et c'est leur seule protection.
L'authentification (Cloudflare Access, code à usage unique par e-mail) est le
lot 1.

Tant qu'elle n'est pas en place : **ne pas poser `EDITOR_ENABLED=true` sur un
site accessible publiquement.** Le lot 0 s'essaie en local, ou derrière une
protection d'accès.

Ce qui est déjà en place côté fonction :

- schéma Zod identique à celui du build, appliqué avant toute écriture ;
- chemins d'écriture restreints à `src/content/pages/{langue}/{page}.json` ;
- plafond de taille du contenu (100 Ko) ;
- verrou optimiste : la version lue à l'ouverture est comparée avant d'écrire,
  et un écart renvoie un conflit au lieu d'écraser ;
- messages d'erreur sans détail technique côté navigateur ; le détail va dans
  la console et dans les journaux serveur, jamais le jeton.

Ce qui reste à faire : identité vérifiée (lot 1) et limitation de débit
(lot 6).

---

## Ce qui n'est pas là

Volontairement hors du lot 0 : médias et images, listes et collections,
multilingue, barre d'outils de style (les tokens existent dans le schéma, aucun
bouton ne les change), richtext et assainissement, Cloudflare Access, tableau
de bord et arborescence de contenu.

Deux fichiers ne sont pas non plus là, faute d'objet à ce stade :
`check-locales.mjs` (une seule locale) et l'implémentation GitLab
(`functions/lib/gitlab.ts` porte la signature et les notes nécessaires).
