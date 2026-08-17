# Plan de réalisation — Éditeur front pour sites statiques (Astro)

**Objectif** : permettre l'édition des textes, styles, médias et listes directement depuis le front d'un site statique, sans déployer de CMS, tout en conservant un HTML pleinement indexable par les moteurs de recherche et les crawlers IA.

**Architecture retenue** : Astro en sortie statique, contenu en JSON validé par Zod, overlay d'édition maison, une fonction serverless unique pour l'écriture, authentification déléguée à Cloudflare Access.

---

## 1. Décisions d'architecture (les non-négociables)

| Décision | Raison |
|---|---|
| Le JSON est injecté **au build**, jamais côté client | Les crawlers IA (GPTBot, ClaudeBot, PerplexityBot) ne rendent pas ou peu le JS. Un rendu client rendrait le contenu invisible pour eux. |
| `output: 'static'`, jamais SSR ni hybride | Garantit que tout le contenu est dans le HTML servi. Le mode serveur n'apporte rien ici et fragilise cette garantie. |
| Aucune directive `client:*` sur du contenu éditorial | Une hydratation posée par réflexe sort le contenu du HTML brut. Seuls l'overlay et les interactions purement visuelles y ont droit. |
| **Le token GitHub ne quitte jamais le serveur** | Le client n'a pas de compte GitHub : le token est celui de l'agence. L'exposer côté navigateur donnerait un accès en écriture à tous les dépôts. |
| Authentification **déléguée à Cloudflare Access** | Zéro ligne de code d'auth, zéro compte à créer pour le client, révocation immédiate. |
| Styles **par variantes contraintes**, pas CSS libre | Préserve la charte graphique. Le client choisit dans une liste blanche validée par Zod. |
| Git est la base de données | Historique, rollback, diff, aucune BDD à sauvegarder. |

---

## 2. Stack

- **Générateur** : Astro (`output: 'static'`).
  - *Content collections + Zod* : validation déclarative du schéma de contenu au build.
  - *i18n natif* : routage par locale, locale par défaut, helpers `hreflang`.
  - *`astro:assets`* : génération WebP/AVIF, dimensions calculées, `alt` obligatoire au niveau du type.
- **Hébergement** : Cloudflare Pages — build sur push, CDN global, fonctions incluses.
- **Écriture** : une Pages Function → API GitHub Contents → webhook → rebuild.
- **Authentification** : Cloudflare Access (code à usage unique par e-mail, gratuit jusqu'à 50 utilisateurs).
- **Médias** : Cloudflare R2 ou Images, ou commit direct dans `/public/media` si le volume est faible.
- **Overlay** : TypeScript vanilla, aucune dépendance framework, chargé uniquement en mode édition.

---

## 3. Modèle de contenu

### Arborescence

```
/src
  /content
    config.ts             # Définition des collections + schémas Zod
    /pages
      /fr
        home.json
        services.json
      /en
        home.json
        services.json
    site.json             # Config globale : langues, navigation, pied de page
  /components             # Composants Astro (.astro), statiques par défaut
  /layouts
  /editor                 # Overlay d'édition (TypeScript vanilla)
  /styles                 # Tokens de thème, CSS
  /pages
    /[lang]/[...slug].astro
/public/media
/functions
  /api/save.ts            # Écriture : validation + commit GitHub
  /api/upload.ts          # Upload de médias
/scripts
  check-html.mjs          # Contrôle CI : le contenu est bien dans le HTML brut
```

### Schéma Zod

C'est le gain principal d'Astro : la liste blanche de styles est déclarative et bloque le build en cas de valeur non conforme.

```ts
// src/content/config.ts
import { defineCollection, z } from 'astro:content';

const style = z.object({
  size:   z.enum(['xs','sm','base','lg','xl','2xl','3xl']).default('base'),
  weight: z.enum(['thin','light','regular','medium','semibold','bold']).default('regular'),
  italic: z.boolean().default(false),
  align:  z.enum(['left','center','right']).default('left'),
  color:  z.enum(['primary','secondary','muted','accent','inverse']).default('primary'),
});

const text     = z.object({ type: z.literal('text'), value: z.string(), style });
const richtext = z.object({ type: z.literal('richtext'), value: z.string() });
const image = z.object({
  type: z.literal('media'),
  kind: z.literal('image'),
  src: z.string(),
  alt: z.string().min(1, 'description de l\'image obligatoire'),
  width: z.number(),
  height: z.number(),
});

// La vidéo n'est JAMAIS téléversée : un fichier de 200 Mo dans Git = panne assurée.
// Le client colle un lien YouTube ou Vimeo, on génère l'intégration.
const video = z.object({
  type: z.literal('media'),
  kind: z.literal('video'),
  provider: z.enum(['youtube','vimeo']),
  videoId: z.string(),
  title: z.string().min(1),
  poster: z.string().optional(),
});

const media = z.discriminatedUnion('kind', [image, video]);

const pages = defineCollection({
  type: 'data',
  schema: z.object({
    meta: z.object({
      title: z.string().max(60),
      description: z.string().max(160),
      ogImage: z.string().optional(),
    }),
    blocks: z.record(z.record(z.union([text, richtext, media]))),
    collections: z.record(z.array(z.object({ id: z.string() }).passthrough())).optional(),
  }),
});

export const collections = { pages };
```

### Exemple de contenu

```json
{
  "meta": {
    "title": "Agence — Accueil",
    "description": "Conception de sites vitrines performants."
  },
  "blocks": {
    "hero": {
      "title": {
        "type": "text",
        "value": "Nous concevons des sites qui convertissent",
        "style": { "size": "xl", "weight": "bold", "color": "primary" }
      },
      "intro": {
        "type": "richtext",
        "value": "Un accompagnement <strong>complet</strong>, du cadrage à la mise en ligne."
      },
      "visual": {
        "type": "media", "kind": "image",
        "src": "/media/hero.webp",
        "alt": "Équipe en réunion de cadrage",
        "width": 1600, "height": 900
      }
    }
  },
  "collections": {
    "testimonials": [
      {
        "id": "t-001",
        "quote":  { "type": "text", "value": "Un travail remarquable.", "style": { "size": "base" } },
        "author": { "type": "text", "value": "Marie D., Directrice", "style": { "size": "sm", "color": "muted" } }
      }
    ]
  }
}
```

Les `id` d'items de collection sont **stables et immuables** : ils servent de clé de réconciliation entre le DOM et le JSON.

### HTML autorisé en `richtext`

`strong`, `em`, `a[href]`, `br`, `ul`, `ol`, `li`. Tout le reste est supprimé — assainissement par DOMPurify côté client **et** côté fonction.

---

## 4. Ciblage des éléments sur le front

Chaque zone éditable porte un attribut pointant vers son chemin dans le JSON. Les composants Astro restent statiques : aucun `client:*`.

```astro
---
const { field, as: Tag = 'p', path } = Astro.props;
---
<Tag data-cms={path} class={styleClasses(field.style)} set:html={field.value} />
```

Utilisation :

```astro
<Editable as="h1" path="blocks.hero.title" field={page.data.blocks.hero.title} />

<div data-cms-list="collections.testimonials">
  {page.data.collections.testimonials.map(item => (
    <article data-cms-item={item.id}>
      <blockquote data-cms={`collections.testimonials.${item.id}.quote`}>{item.quote.value}</blockquote>
    </article>
  ))}
</div>

<template data-cms-template="testimonials">
  <!-- squelette d'un item vide, cloné à l'ajout -->
</template>
```

L'attribut `data-cms` est inerte en production : coût nul, aucun impact SEO, point d'ancrage de l'overlay.

Le `<template>` par collection est **indispensable** : il évite de réimplémenter un moteur de rendu côté client pour l'ajout d'items.

---

## 5. L'interface d'édition

### Parcours client (le livrable réel)

Le client est un utilisateur non technique. Il ne verra jamais le code, le dépôt, ni le JSON. Ce qu'il reçoit à la livraison : **une URL, `monsite.fr/admin`, et rien d'autre.**

1. Il ouvre l'URL, saisit son adresse e-mail, reçoit un code à six chiffres, le colle. Aucun logiciel à installer, aucun compte à créer, aucun mot de passe à retenir, rien à refaire en changeant d'ordinateur.
2. Il arrive sur **son site**, pas sur un tableau de bord. Il navigue dans ses pages via son propre menu, exactement comme un visiteur. Une bordure apparaît au survol de ce qui est modifiable.
3. **Texte** : il clique, la zone devient éditable, il tape. Une barre flottante propose gras, italique, taille et les couleurs de sa charte — rien d'autre.
4. **Image** : il clique dessus, un panneau s'ouvre, il choisit un fichier depuis son appareil. Le système accepte un JPEG de 8 Mo sorti d'un téléphone : recadrage au format attendu, conversion WebP/AVIF, dimensions calculées. Un seul champ en dessous, libellé **« Description de l'image »**, prérempli et modifiable.
5. **Vidéo** : il colle un lien YouTube ou Vimeo. Aucun téléversement.
6. **Un seul bouton : « Publier »**, avec un message indiquant que le site sera à jour dans une minute.

### Règles d'ergonomie (contraignantes)

| Règle | Raison |
|---|---|
| **Aucun jargon technique dans l'interface** | « Publier » et non « Commit », « Description de l'image » et non « alt », « Annuler mes modifications » et non « Revert ». Le mot Git n'apparaît nulle part. |
| **Aucune arborescence de contenu** | Pas de panneau latéral affichant l'arbre du JSON : c'est le moment où l'outil redevient un CMS et où le client décroche. L'édition se fait sur la page, uniquement sur la page. |
| **Sauvegarde locale permanente** | Les modifications sont conservées en continu. À la réouverture : bandeau « vous avez des modifications non publiées ». |
| **Confirmation sur toute suppression** | Et message rassurant : chaque publication étant un commit, tout est restaurable. Un client qui n'a pas peur de casser son site l'utilise. |
| **Desktop uniquement** | L'édition de texte sur mobile est techniquement pénible et le résultat mauvais. Afficher un message clair sur petit écran plutôt que livrer une expérience cassée. |
| **Frontière posée dès la livraison** | Textes et médias : le client. Structure et design : le développeur. Sans cette limite explicite, la dérive est sans fin. |

### Composants

### Boucle centrale

```ts
document.querySelectorAll<HTMLElement>('[data-cms]').forEach(el => {
  el.addEventListener('click', e => {
    if (!editMode) return;
    e.preventDefault();
    const node = resolve(draft, el.dataset.cms!);   // pointeur dans le JSON
    el.contentEditable = 'true';
    el.focus();
    el.addEventListener('input', () => {
      node.value = sanitize(el.innerHTML);
      dirty = true;
    });
  });
});
```

Tout le reste de l'overlay se greffe sur ce principe : un chemin, un pointeur, une mutation.

### Composants

- **Barre flottante** : sélecteur de langue, statut (`brouillon` / `publié`), Annuler, Publier.
- **Édition texte** : `contentEditable` + mini-barre affichant uniquement les variantes autorisées (taille, graisse, italique, alignement, pastilles de couleur du thème).
- **Édition média** : panneau latéral. *Image* → upload depuis l'appareil, traitement automatique (recadrage, WebP/AVIF, dimensions), champ « Description de l'image ». *Vidéo* → champ de collage d'un lien YouTube/Vimeo, extraction de l'identifiant, aucun téléversement.
- **Édition de listes** : sur un `data-cms-list`, boutons « + Ajouter » ; sur chaque item « Dupliquer / Supprimer / Monter / Descendre ». L'ajout clone le `<template>`.
- **Brouillon local** : sauvegarde continue en `localStorage`.

### Garde-fous

- **Verrou optimiste** : le SHA du fichier lu à l'ouverture est renvoyé au save. SHA divergent → refus + message de conflit explicite.
- Validation Zod côté fonction avant commit : un JSON invalide n'entre jamais dans le dépôt.
- Assainissement du richtext côté serveur, systématiquement.

---

## 6. Authentification et écriture

**Le client n'a pas de compte GitHub et n'en aura jamais.** Le dépôt et le token appartiennent à l'agence — idéalement un compte machine dédié (`agence-bot`) restreint aux dépôts des sites.

### Cloudflare Access

- Politique appliquée sur `/admin*` et `/api/*`.
- Le client saisit son e-mail, reçoit un code à six chiffres, entre. Aucun compte, aucun mot de passe.
- Ajouter ou retirer un accès = modifier une liste d'adresses. Révocation immédiate, sans redéploiement.
- **Zéro ligne de code d'authentification à écrire.**

### La fonction d'écriture

```
/functions/api/save.ts
  1. Lire l'identité fournie par Access (en-tête JWT vérifié)
  2. Valider le payload avec le même schéma Zod que le build
  3. Vérifier que le chemin cible est bien dans /src/content/**
  4. Assainir tous les champs richtext
  5. PUT sur l'API GitHub Contents avec le SHA attendu
  6. Attribuer le commit à l'e-mail du client authentifié
```

Une centaine de lignes, déployée avec le site, aucun serveur à administrer.

**Attention** : ne pas utiliser les endpoints API d'Astro (`src/pages/api/*`). En `output: 'static'` ils sont exécutés au build, pas à la requête. Passer par le mécanisme de fonctions de l'hébergeur, hors de `src/pages`.

---

## 7. Multilingue

Astro gère l'essentiel nativement.

- Configuration i18n : locales déclarées, locale par défaut, préfixe d'URL.
- Une URL par langue : `/fr/services/`, `/en/services/`. Jamais de bascule par JS.
- Un dossier JSON par locale, **structure de clés strictement identique**.
- `hreflang` réciproques + `x-default` générés depuis la config.
- Le sélecteur de langue de l'overlay change la locale éditée sans recharger le site.
- Un script de contrôle signale les clés présentes dans une locale et absentes d'une autre.

---

## 8. SEO et référencement dans les IA (GEO)

**Socle technique**
- Contenu intégralement présent dans le HTML servi — garanti par `output: 'static'` et l'interdiction des `client:*` sur du contenu.
- `<title>`, meta description, Open Graph et canonical pilotés depuis le bloc `meta`.
- Un seul `h1`, hiérarchie de titres sans saut de niveau.
- `sitemap.xml` (intégration officielle Astro) et `robots.txt` générés au build.
- `alt` obligatoire — imposé par Zod **et** par le composant `<Image />`.
- WebP/AVIF, `width`/`height` systématiques via `astro:assets`.

**Spécifique IA**
- **JSON-LD** (`Organization`, `LocalBusiness`, `Service`, `FAQPage`, `BreadcrumbList`) généré depuis le JSON de contenu — format le plus directement exploitable par les moteurs génératifs.
- **`llms.txt`** à la racine : résumé structuré du site et des pages clés, généré au build.
- Structure sémantique explicite : `<article>`, `<section>`, listes et tableaux réels.
- Contenu formulé en réponses directes (question/réponse, définitions courtes) : ce sont les passages les plus cités.
- `robots.txt` autorisant explicitement les crawlers IA retenus (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) — décision à prendre avec chaque client.
- TTFB bas et HTML léger : les crawlers IA ont des budgets plus courts que Googlebot.

**Contrôle en intégration continue**
```bash
# check-html.mjs : le contenu doit être dans la source, pas dans le JS
node scripts/check-html.mjs   # échoue si une phrase clé du JSON est absente du HTML construit
```
Ce test est le filet de sécurité contre une directive `client:*` posée par inadvertance.

---

## 9. Sécurité

- **Aucun secret dans le dépôt ni dans un fichier servi.** Le token GitHub vit uniquement en variable d'environnement de la fonction.
- Cloudflare Access sur `/admin*` et `/api/*` ; la fonction vérifie le JWT Access à chaque appel.
- `/api/save` : identité vérifiée, schéma Zod validé, chemin restreint à `/src/content/**`, taille du payload plafonnée, limitation de débit.
- `/api/upload` : liste blanche de types MIME, taille maximale, renommage systématique.
- Verrou optimiste par SHA sur chaque écriture.
- Ne jamais journaliser le contenu des tokens ni des JWT.

---

## 10. Lots de réalisation

| Lot | Contenu | Charge |
|---|---|---|
| **0 — POC** | 1 page, 1 langue, texte seul, édition → commit → rebuild. Token local, sans Access. Valide la chaîne de bout en bout. | 2 j |
| **1 — Socle + auth** | Projet Astro, content collections + Zod, tokens de style, déploiement Cloudflare Pages, **Access configuré**, fonction `save` avec token côté serveur. | 4 j |
| **2 — Éditeur texte** | Overlay, détection `data-cms`, `contentEditable`, barre de variantes, richtext assaini, brouillon local, verrou optimiste. | 4 j |
| **3 — Médias** | Panneau média, upload, gestion des `alt`, `astro:assets`. | 2,5 j |
| **4 — Collections** | Ajout / suppression / duplication / réordonnancement, `<template>` par collection, carousels et témoignages. | 3 j |
| **5 — Multilingue** | Config i18n, routage, `hreflang`, sélecteur de langue, contrôle de parité des clés. | 1 j |
| **6 — Durcissement** | Limitation de débit, journalisation, gestion des conflits, `check-html` en CI, tests. | 1,5 j |
| **7 — Industrialisation** | Dépôt modèle, script de création de site, script d'amorçage (extraction du JSON depuis un HTML existant), **modèle de capsule vidéo de formation client**, guide de migration. | 3 j |

**Total v1 : environ 21 jours.** Chaque site suivant : 1 à 2 jours.

L'auth remonte en lot 1 : dès qu'un client non technique entre dans le périmètre, elle devient un prérequis et non un durcissement final. Astro fait gagner sur les lots 1, 3 et 5 (validation, images, i18n natifs).

---

## 11. Risques et parades

| Risque | Parade |
|---|---|
| Directive `client:*` sur du contenu éditorial | Interdiction explicite dans CLAUDE.md + `check-html.mjs` en CI. |
| Tentation du mode SSR d'Astro | `output: 'static'` verrouillé ; toute écriture passe par `/functions`. |
| Dérive vers un CMS complet | Périmètre gelé après le lot 7. Hors périmètre = v2 documentée. |
| Client qui casse le design | Variantes contraintes validées par Zod, aucune saisie libre. |
| Délai de publication (rebuild) | Message explicite dans l'overlay + prévisualisation immédiate côté client. |
| Deux éditeurs simultanés | Verrou optimiste par SHA, message de conflit explicite. |
| Fuite du token agence | Token jamais côté client, compte machine restreint, rotation planifiée. |
| **Copier-coller depuis Word** | Injecte polices, tailles et couleurs invisibles. Le nettoyage à la saisie doit tout écraser, sans exception. À tester explicitement. |
| **Suppression accidentelle d'un item** | Confirmation obligatoire + restauration possible via l'historique Git. Le dire au client pour lever son appréhension. |
| **Téléversement d'une vidéo lourde** | Interdit par le schéma : la vidéo passe par une URL d'intégration. |
| **Photo de 8 Mo sortie d'un téléphone** | Traitement automatique côté upload. Ne jamais demander au client de redimensionner. |
| **Demande de déplacement de blocs** | Frontière annoncée à la livraison : contenu au client, structure au développeur. |
| Coût de maintenance sur N sites | Overlay en dépendance partagée versionnée, jamais dupliqué par site. |

---

## 12. Livraison au client

Ce qui est remis à chaque mise en ligne :

- **L'URL du panneau** (`monsite.fr/admin`) et l'adresse e-mail autorisée dans Cloudflare Access. Rien d'autre.
- **Une capsule vidéo de trois minutes**, enregistrée sur son propre site, montrant : modifier une accroche, remplacer une photo, ajouter un témoignage, publier. C'est le meilleur rapport temps investi / sollicitations évitées de tout le projet.
- **Une page d'aide d'un écran** accessible depuis le panneau, reprenant les mêmes gestes en texte.
- **L'énoncé explicite de la frontière** : textes, images et vidéos sont à sa main ; toute modification de structure, de mise en page ou de design passe par le développeur.

---

## 13. Hors périmètre (assumé)

Workflow de validation multi-rôles, permissions granulaires, versionnement visuel du contenu, A/B testing, formulaires avec stockage, recherche interne, commentaires, espace membre, éditeur de mise en page (déplacement ou création de blocs).

Si l'un de ces besoins remonte, il indique qu'un CMS du marché serait plus adapté que ce système.
