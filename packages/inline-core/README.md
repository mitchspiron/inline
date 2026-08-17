# inline-core

La partie d'`inline` qui est identique d'un site à l'autre : l'overlay
d'édition, le modèle de contenu, les routes serveur et les deux points de
couplage.

**Pourquoi un paquet et pas un dossier recopié.** Un correctif de sécurité sur
l'assainissement, une largeur de plafond, un message d'erreur mal formulé : à
trois sites, chaque changement se recopie trois fois et diverge à la quatrième.
Le jour où un site tourne avec une version de l'overlay que personne ne
retrouve, la maintenance est finie. Le paquet est versionné pour que la
question « quelle version tourne chez ce client ? » ait une réponse.

---

## Ce que le paquet fournit

```
src/schema.ts          Le modèle de contenu (Zod) — build ET fonction serveur
src/style-tokens.ts    Les variantes autorisées, source unique
src/safe-href.ts       Ce qu'est un lien sûr, des deux côtés
src/video.ts           Lecture d'une adresse YouTube / Vimeo
src/translate.ts       Repli de traduction (pas la liste des langues)
src/editor/            L'overlay — TypeScript sans framework, sous 50 Ko
src/server/            Identité, débit, plafonds, chemins, dépôt Git
src/server/routes/     Les quatre routes, en fabriques configurables
styles/tokens.css      Une classe par valeur du schéma
```

## Ce que le site fournit

Trois choses, et trois seulement :

1. **Sa configuration** — les langues, dans `SiteConfig`.
2. **Son contenu** — `src/content/pages/{langue}/{page}.json`.
3. **Son apparence** — les variables CSS qu'attend `styles/tokens.css`, ses
   composants Astro, sa mise en page.

Si `SiteConfig` s'allonge, c'est le signe qu'une décision du paquet a fuité
vers les sites.

---

## Utilisation

### Les routes serveur

L'hébergeur découvre les routes par l'arborescence de `/functions`. Chaque
fichier y est un adaptateur, jamais une règle :

```ts
// functions/api/save.ts
import { createSaveRoute } from 'inline-core/server';
import { LOCALES } from '../../src/lib/locales';

const route = createSaveRoute({ locales: LOCALES });

export const onRequest = route.onRequest;
export const onRequestPost = route.onRequestPost;
```

Quatre routes : `createAuthRoute()`, `createContentRoute(config)`,
`createSaveRoute(config)`, `createUploadRoute()`.

### Le modèle et les styles

```ts
// src/content/config.ts
import { pageSchema } from 'inline-core/schema';
```

```astro
---
import 'inline-core/styles/tokens.css';
import '../styles/theme.css';   // les variables de VOTRE charte
---
```

`tokens.css` ne contient aucune valeur en dur : il traduit les enums du schéma
en classes qui pointent vers vos variables. Il vit ici et non dans le site
parce qu'une classe manquante d'un côté et un token accepté de l'autre
donneraient un contenu valide qui ne s'affiche pas.

### L'overlay

Il n'est jamais importé par le site : il se construit à part et se charge
uniquement quand le témoin d'édition est posé.

```json
"bundle:editor": "esbuild packages/inline-core/src/editor/index.ts --bundle --minify --format=esm --target=es2020 --splitting --outdir=dist/editor --entry-names=overlay --chunk-names=[name]-[hash]"
```

Le découpage (`--splitting`) n'est pas cosmétique : l'assainisseur et le
décodeur d'images d'iPhone ne se téléchargent qu'au moment où ils servent. Sans
lui, l'overlay dépasse largement son budget.

**L'overlay ne connaît pas les langues du site.** Quelles langues existent,
comment elles s'appellent et à quelle adresse elles répondent sont des
décisions du site : il les lit sur `data-cms-locales`, posé au build.

---

## Les deux points de couplage

```
src/server/git-provider.ts   readFile / writeFile        (GitHub | GitLab)
src/server/auth.ts           verifyAuth / createSession  (clé de site | délégué)
```

Aucune vérification d'identité ni appel à une API Git ailleurs. Changer de
fournisseur Git, ou passer d'une clé de site à une authentification déléguée,
se fait en remplaçant une implémentation — pas en parcourant le code.

---

## Deux choses qui ne marchent pas dans un runtime de périphérie

Elles ont coûté assez cher pour être écrites ici plutôt que redécouvertes.

**Pas de WebAssembly compilé à l'exécution.** `WebAssembly.compile()` est
interdit par l'hôte. Toute bibliothèque de hachage qui s'appuie dessus échoue
au premier appel, en production. D'où argon2id en JavaScript pur.

**DOMPurify ne fait rien, sans le dire.** Sans DOM, il passe `isSupported` à
faux et **renvoie son entrée telle quelle**, sans lever d'erreur : un
`<script>` et un `href="javascript:"` ressortent intacts. `src/server/sanitize.ts`
reconstruit donc le fragment depuis son analyse syntaxique. Le test
d'assainissement soumet le même corpus aux deux implémentations et compare les
sorties — c'est lui qui garantit qu'elles ne divergent pas.

---

## Versions

Voir [CHANGELOG.md](CHANGELOG.md). Le paquet suit le versionnage sémantique :

- **majeure** — le site doit être modifié (signature de `SiteConfig`, forme du
  schéma, contrat des `data-cms`) ;
- **mineure** — nouveau champ, nouveau geste d'édition, rien à faire ;
- **corrective** — correction sans changement de contrat.

Une modification du schéma qui invalide du contenu existant est **toujours**
une version majeure, même si le code compile : c'est le contenu des clients qui
casse, pas le nôtre.
