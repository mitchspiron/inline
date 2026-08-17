# Reprendre un site existant

Comment faire passer un site déjà en ligne — statique, HTML en dur, contenu
écrit dans le balisage — sous `inline`, sans le refaire.

L'opération se fait **page par page**. Rien n'oblige à tout convertir d'un
coup : une page reprise et une page non reprise cohabitent sans se gêner.

---

## Ce que ça n'est pas

Ce n'est pas une conversion automatique. L'outil sait extraire des valeurs
d'une page annotée ; il ne sait pas décider **ce que le client a le droit de
changer**. Cette décision est le vrai travail, et elle ne s'automatise pas :

- un titre de section, oui ; le nom de l'entreprise en pied de page, sans doute
  pas ;
- un témoignage, oui ; la structure de la grille qui les affiche, non ;
- une photo d'illustration, oui ; le logo, à discuter.

Compter une heure par page pour ce tri, et quelques minutes pour le reste.

---

## 1. Annoter la page

Sur le HTML existant, poser des attributs. **Rien d'autre ne change** : pas une
balise déplacée, pas une classe retirée.

```html
<h1 data-cms="blocks.hero.title">Le pain au levain, tous les matins</h1>

<p data-cms="blocks.about.body" data-cms-type="richtext">
  Nous <strong>pétrissons</strong> chaque nuit.
</p>

<img data-cms="blocks.about.photo" data-cms-type="media"
     src="/img/fournil.jpg" alt="Le fournil au petit matin"
     width="1600" height="900" />

<figure data-cms="blocks.about.film" data-cms-type="media">
  <iframe src="https://www.youtube.com/embed/aqz-KE-bpKQ" title="Une nuit au fournil"></iframe>
</figure>

<ul data-cms-list="collections.avis">
  <li data-cms-item="a-001">
    <blockquote data-cms="collections.avis.a-001.quote">Le meilleur pain de la ville.</blockquote>
    <cite data-cms="collections.avis.a-001.author">Claire D.</cite>
  </li>
</ul>
```

Trois règles :

- un champ simple vit sous `blocks.` ; un champ de liste sous
  `collections.{liste}.{id}.` ;
- chaque item porte un identifiant **stable et jamais réattribué** (`a-001`,
  `a-002`). C'est le lien entre la page et le contenu : le réutiliser pour un
  autre item fait perdre les modifications ;
- une image a besoin d'un `alt`, d'un `width` et d'un `height`. Sans eux,
  l'amorçage refuse d'écrire — c'est délibéré, voir plus bas.

Un exemple complet est versionné :
[scripts/fixtures/site-existant.html](../scripts/fixtures/site-existant.html).

---

## 2. Extraire le contenu

```bash
npm run bootstrap -- --html ancien-site/accueil.html --page accueil --langue fr --essai
```

`--essai` n'écrit rien et affiche ce qui serait produit, plus la liste de ce
qui n'a pas pu être déduit. Relancer sans `--essai` écrit
`src/content/pages/fr/accueil.json`.

Ce qui est repris automatiquement : les textes et leurs variantes de style
(relues depuis les classes `cms-*`), le richtext avec son balisage autorisé,
les images avec leur description et leurs dimensions, les vidéos converties en
fournisseur + identifiant, les listes avec leurs identifiants, le titre et la
meta description de la page.

**Un fichier existant n'est jamais écrasé.** Un amorçage relancé par erreur ne
doit pas effacer ce que le client a déjà modifié.

### Pourquoi ça refuse d'écrire

Si une image n'a pas de description, l'amorçage échoue au lieu de mettre une
chaîne vide. Une valeur plausible inventée à ce stade se retrouve en
production, invisible en revue, et personne ne la corrige jamais. Le schéma
appliqué ici est celui du build et de la publication : ce qui passe ici passera
partout.

---

## 3. Rendre la page avec Astro

Le HTML annoté sert de modèle. Chaque `data-cms` devient un composant qui lit
le contenu :

```astro
<Editable page={page} path="blocks.hero.title" as="h1" />
<Media page={page} path="blocks.about.photo" />
<Collection page={page} name="avis" item={Avis} />
```

Deux points à ne pas manquer :

- **aucune directive `client:*`** sur un composant qui affiche du contenu. Le
  texte doit être dans le HTML brut, sinon il sort de l'index des moteurs et
  des assistants. `npm run check` échoue si c'est le cas ;
- **chaque liste a besoin de son `<template>`** dans la page, sinon l'ajout
  d'un item obligerait à réimplémenter un moteur de rendu côté navigateur.
  `npm run check` le vérifie aussi.

---

## 4. Les images

Copier les fichiers dans `src/media/`, en minuscules, sans accent ni espace —
l'amorçage a déjà normalisé les noms dans le JSON, il faut que les fichiers
suivent. Le build produit ensuite les formats et les largeurs.

Ne pas les mettre dans `public/` : `<Image />` ne les traiterait pas.

---

## 5. Vérifier

```bash
npm run build && npm run check
```

Puis, sur le site déployé :

```bash
curl -s https://le-site.fr/ | grep -c "un titre de la page"   # doit renvoyer 1
```

Si ça renvoie 0, le contenu n'est pas dans le HTML brut : chercher une
directive `client:*`.

---

## Ce qui ne se reprend pas

- **Les formulaires.** Hors périmètre. Ils restent ce qu'ils étaient.
- **Le contenu généré côté navigateur.** S'il n'est pas dans le HTML, il n'y a
  rien à extraire — et c'est un problème de référencement avant d'être un
  problème de reprise.
- **Les pages dont la structure change à chaque visite.** Un carousel doit
  contenir tous ses éléments en dur ; le JavaScript ne fait que les faire
  défiler.

Si le site repose largement sur ces trois points, la reprise n'est pas le bon
outil : c'est le signe qu'il faut d'abord le rendre statique.
