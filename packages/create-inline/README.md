# create-inline

**Documentation complète : [inline-docs.netlify.app](https://inline-docs.netlify.app)**
— vingt chapitres, du premier site à la mise en production.

Crée un site `inline` prêt à éditer.

```bash
npm create inline@latest mon-site
```

Avec les options :

```bash
npm create inline@latest mon-site -- --nom "Boulangerie Martin" --courriel contact@boulangerie.fr
```

| Option | Rôle | Défaut |
|---|---|---|
| `--nom` | Nom du site, affiché dans le pied de page | le nom du dossier |
| `--courriel` | Adresse de contact, affichée au client dans l'aide | `contact@exemple.fr` |
| `--langue` | Code de la langue principale, deux lettres | `fr` |

---

## Ce que ça écrit

Le squelette du site : la mise en page, une page de contenu, la charte, les
quatre adaptateurs de routes de `/functions`, les contrôles, la commande de
génération de clé et l'intégration continue. Puis la clé du site, **affichée
une seule fois** — elle est aussi posée dans `.dev.vars`, qui n'entrera jamais
dans le dépôt.

## Ce que ça n'écrit pas

La logique d'édition. Elle arrive par [`inline-core`](https://www.npmjs.com/package/inline-core),
en dépendance versionnée. C'est toute la différence entre un échafaudage et un
copier-coller : le jour d'un correctif de sécurité, un `npm update` suffit.

---

## Après la création

```bash
cd mon-site
npm install
```

Puis, dans trois terminaux à la racine du projet :

```bash
npm run mock:git         # faux dépôt local, pour publier sans rien brancher
npm run build
npm run serve            # ou « npm run serve:functions » avec l'outil de l'hébergeur
```

Ouvrez `http://127.0.0.1:8788/admin`, saisissez la clé affichée à la création,
modifiez un texte sur la page, cliquez sur Publier.

## L'hébergeur n'est pas tranché

Le site créé porte un adaptateur par famille de plateformes. Aucun ne contient
de règle : les routes sont déclarées une seule fois, dans `src/lib/api.ts`.

```
functions/api/*.ts         hébergeur qui découvre les routes par l'arborescence
netlify/source/api.mts     Netlify (assemblé au build, avec netlify.toml)
scripts/serve.mjs          Node seul — conteneur, VPS, autre plateforme
```

Les dossiers d'un hébergeur qu'on n'utilise pas se suppriment sans rien casser.

Sur Netlify, la commande de build est en deux temps —
`npm run build && npm run build:netlify` — et **`node_bundler` ne doit pas être
déclaré** dans `netlify.toml`. Netlify produirait alors du CommonJS : la
fonction serait prise pour une v1, et le site répondrait *502 « handler is not a
function »* au moment précis où le client entre sa clé. Le dépôt assemble donc
lui-même la fonction, et `build-netlify.mjs` vérifie son propre produit avant de
rendre la main.

**Après le premier déploiement, une commande avant toutes les autres :**

```bash
curl -i https://votre-site.fr/api/auth
```

`405` : les fonctions tournent. Du HTML, ou `404` : elles ne tournent pas. Un
site déposé sans ses fonctions s'affiche parfaitement et refuse la clé — c'est
le seul échec d'`inline` qui ne se voit pas à l'écran, et il fait soupçonner la
clé, qui n'y est pour rien.

## Clé perdue, clé à changer

La clé n'est stockée nulle part sous forme lisible : seule son empreinte
argon2id vit en variable d'environnement. Elle ne se retrouve donc pas, elle se
régénère — et c'est voulu.

```bash
npm run make:key
```

La commande affiche la nouvelle clé, son empreinte et un secret de session.
Ensuite : remplacer `EDITOR_KEY_HASH` chez l'hébergeur, remplacer
`SESSION_SECRET` si vous voulez fermer immédiatement les sessions ouvertes,
redéployer — les variables ne sont relues qu'au déploiement — puis transmettre
la nouvelle clé au client. L'ancienne cesse de fonctionner au redéploiement : il
n'y a pas de période de recouvrement.

## Prérequis

Node.js 18.20.8 ou plus récent.

## Versions

Voir [CHANGELOG.md](CHANGELOG.md). Ce paquet n'est exécuté qu'une fois par site,
à sa création : une correction n'atteint jamais les sites déjà créés. Chaque
entrée du journal dit donc ce qu'un site existant doit faire pour rattraper.

## Licence

Business Source License 1.1 — voir [LICENSE](LICENSE). Usage en production
autorisé pour les sites que vous construisez, y compris pour vos clients ;
revendre `inline` comme service de gestion de contenu hébergé ne l'est pas.
