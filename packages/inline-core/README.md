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

## Démarrer

```bash
npm create inline@latest mon-site
```

Ou, dans un projet Astro existant :

```bash
npm install inline-core
```

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import inline from 'inline-core/astro';

export default defineConfig({
  output: 'static',
  integrations: [
    inline({
      locales: ['fr'],
      support: { email: 'contact@agence.fr' },
    }),
  ],
});
```

L'intégration pose `/admin` et `/aide`, construit l'overlay, injecte
l'amorce d'édition, et refuse de démarrer si la sortie n'est pas statique.
Restent à écrire : les quatre adaptateurs de `/functions` — l'hébergeur les
lit à la racine du dépôt, hors du build Astro, une intégration ne peut pas les
injecter. Vingt lignes, écrites une fois.

### Options

| Option | Rôle |
|---|---|
| `locales` | Codes des langues, la référence en premier. Obligatoire. |
| `support` | Adresse affichée au client sur `/admin` et `/aide`. |
| `theme` | Chemin de la charte. Défaut : `src/styles/theme.css`. |
| `pages` | `{ admin: false }` pour fournir la sienne. |

---

## Ce que le paquet fournit

```
astro/                 L'intégration Astro
components/            Editable, Media, Collection
pages/                 /admin et /aide, clé en main
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

Il n'est jamais importé par le site : l'intégration le construit à part, et il
se charge uniquement quand le témoin d'édition est posé. Même adresse en
développement et en production — `/editor/overlay.js` — servie par un
intermédiaire de développement plutôt que par un chemin qui dépendrait de
l'endroit d'où le paquet est chargé.

Le découpage n'est pas cosmétique : l'assainisseur et le décodeur d'images
d'iPhone ne se téléchargent qu'au moment où ils servent. Sans lui, l'overlay
dépasse largement son budget.

**L'overlay ne connaît pas les langues du site.** Quelles langues existent,
comment elles s'appellent et à quelle adresse elles répondent sont des
décisions du site : il les lit sur `data-cms-locales`, posé au build.

### Les autres frameworks

Astro accepte React, Vue, Svelte. `inline` aussi, à une condition qui n'est
pas celle qu'on croit.

**Un composant de framework rendu au build est parfaitement légitime**, même
pour du contenu éditable : sans directive `client:*`, il produit du HTML
statique comme un composant Astro, le `data-cms` se retrouve dans la page, et
l'overlay travaille dessus sans savoir ce qui l'a produit.

**Ce qui casse, c'est l'hydratation d'une zone éditable**, pour deux raisons
distinctes :

- `client:only` ne rend rien au build — le contenu n'est dans aucun HTML
  servi, donc dans aucun index ;
- `client:load` rend bien le contenu, mais le framework le **réaffiche** à
  l'arrivée du JavaScript, ce qui efface les modifications que le client était
  en train de faire. C'est la plus contraignante des deux, et elle ne se voit
  pas dans la source.

Une île hydratée qui n'englobe aucune zone éditable — un carousel, une carte,
un filtre — ne pose aucun problème. `check-html.mjs` applique exactement cette
règle.

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

---

## Licence

Business Source License 1.1 — voir [LICENSE](LICENSE).

Usage en production autorisé pour les sites que vous construisez, y compris
pour vos clients. Revendre `inline` comme service de gestion de contenu
hébergé ou managé ne l'est pas. Le 2030-08-18, la licence bascule
automatiquement en Apache 2.0.
