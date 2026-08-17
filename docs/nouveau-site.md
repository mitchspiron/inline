# Mettre en place un nouveau site

Compter une à deux journées, dont la moitié pour l'intégration graphique. Le
reste est mécanique.

---

## Ce qui se copie, ce qui se partage

Le dépôt est séparé en deux, et c'est toute la question :

| | Où | Par site |
|---|---|---|
| Overlay, modèle, routes, sécurité | `packages/inline-core` | **partagé, versionné** |
| Contenu, charte, composants, pages | `src/`, `functions/` | copié puis adapté |

Ce qui est dans `inline-core` **ne se recopie jamais**. Un correctif de
sécurité doit atteindre les dix sites en changeant un numéro de version, pas en
dix modifications à retrouver. C'est la seule règle qui rende l'exploitation
tenable au-delà de trois clients.

---

## 1. Partir du dépôt modèle

Le site de ce dépôt **est** le modèle : une page, deux langues, une liste, une
image, une vidéo, une charte complète. Copier tout sauf `packages/` et le
contenu :

```
astro.config.mjs      wrangler.toml       tsconfig.json
functions/api/        les quatre adaptateurs, tels quels
src/components/       Editable, Media, Collection — à garder
src/layouts/          à adapter
src/pages/            [lang]/[...slug].astro, admin.astro, aide.astro
src/styles/theme.css  à remplacer par la charte du client
src/content/          site.json + une page par gabarit
scripts/              les contrôles et les tests
.github/workflows/    les contrôles automatiques
```

Puis, dans `package.json`, dépendre du paquet publié plutôt que de l'espace de
travail local :

```json
"dependencies": { "astro": "^5.2.5", "inline-core": "^1.0.0" }
```

Un dépôt par client. Le contenu d'un client ne doit jamais côtoyer celui d'un
autre : c'est aussi ce qui circonscrit un incident.

---

## 2. Générer les accès

```bash
npm run create:site -- --nom "Boulangerie Martin" --depot agence/boulangerie-martin
```

La commande affiche deux blocs qui ne voyagent pas ensemble : ce qui part chez
le client (une clé, une adresse) et ce qui part chez l'hébergeur (l'empreinte,
les secrets, le jeton). Elle affiche aussi la liste de vérification d'avant
livraison.

La clé n'est écrite nulle part. Ce qui n'est pas copié à ce moment-là est
perdu — et c'est voulu : une clé oubliée se régénère, elle ne se retrouve pas.

Pour essayer en local tout de suite :

```bash
npm run create:site -- --nom "Essai" --ecrire
```

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

Site monolingue : ramener `LOCALES` à une seule entrée dans
`src/lib/locales.ts`, `i18n.locales` dans `astro.config.mjs`, et `LOCALES` dans
`scripts/check-locales.mjs`. Rien d'autre ne change — le repli de traduction ne
se déclenche jamais et le contrôle de parité n'a rien à comparer.

---

## 5. Déployer

1. Créer le projet chez l'hébergeur, branché sur le dépôt.
2. Poser les variables affichées par `create:site` en **secrets d'exécution**,
   jamais en variables de build : elles ne doivent pas atteindre le navigateur.
3. Déclarer la liaison clé-valeur `RATE_LIMIT`.
4. Vérifier :

```bash
curl -s https://le-site.fr/ | grep -c "un titre de la page"   # 1
curl -s -X POST https://le-site.fr/api/save                   # 401
```

Puis, à la main : cinq clés fausses de suite sur `/admin` doivent finir par un
message d'attente. Si la sixième tentative est encore refusée par « clé
incorrecte », la limitation de débit n'est pas active — ne pas livrer.

---

## 6. Livrer au client

- La capsule de formation — voir [formation-client.md](formation-client.md).
- Le lien vers `/aide`.
- La clé, par un canal séparé du reste.

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
