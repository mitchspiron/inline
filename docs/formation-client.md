# Capsule de formation client — script de tournage

Une seule capsule, **six minutes**, enregistrée en partage d'écran sur le site
du client lui-même. Elle est livrée avec la clé.

**Pourquoi une capsule et pas une réunion.** Le client la regarde quand il en a
besoin — c'est-à-dire trois semaines après la livraison, le jour où il veut
changer une photo. Une formation en direct est oubliée avant d'avoir servi.

**Pourquoi six minutes.** Au-delà, elle n'est pas regardée jusqu'au bout. Tout
ce qui n'y tient pas est dans la page d'aide, à `/aide`.

---

## Règles de tournage

- **Tourner sur le vrai site du client**, avec son vrai contenu. Une
  démonstration sur un site fictif ne se reconnaît pas.
- **Zéro mot technique.** Pas de « JSON », « commit », « déploiement »,
  « build », « repo », « API ». Si un mot technique sort, refaire la prise.
- **Montrer les erreurs.** La séquence 6 est la plus utile de toute la
  capsule : un client qui a vu le message de conflit une fois ne panique pas
  quand il arrive.
- **Ne jamais montrer la clé à l'écran.** La coller depuis le presse-papier,
  champ masqué. Vérifier la vidéo finale image par image sur cette séquence.
- **Rythme lent.** Marquer une pause après chaque clic. Le client suivra sur
  son propre écran en même temps.

---

## Séquencier

### 1. Entrer — 30 s

> « Voici l'adresse pour modifier votre site : votre adresse habituelle, suivie
> de barre oblique a-d-m-i-n. Vous saisissez la clé qu'on vous a transmise, et
> vous voilà sur votre site, exactement comme un visiteur — à ceci près qu'une
> barre est apparue en bas. »

Montrer : `/admin`, saisie, arrivée sur la page d'accueil, barre en bas.

### 2. Modifier un texte — 60 s

> « Vous cliquez sur le texte à changer. Il devient modifiable, comme dans un
> traitement de texte. Vous écrivez. »

Montrer aussi la barre de variantes :

> « Ces boutons changent la taille, l'épaisseur, l'alignement, la couleur. Ce
> sont les choix de votre charte : vous ne pouvez pas dépareiller la page,
> même en essayant. »

Montrer : modifier un titre, changer sa taille, la remettre.

### 3. Changer une image — 90 s

> « Vous cliquez sur l'image, vous choisissez votre fichier. Prenez la photo
> telle qu'elle sort de votre téléphone : elle peut faire huit méga-octets,
> c'est prévu. Vous n'avez rien à réduire ni à convertir. »

**Utiliser une vraie photo d'iPhone non redimensionnée.** C'est ce que le
client fera, et c'est ce qu'il faut le voir réussir.

> « Ce champ, "description de l'image", est important : c'est ce que lisent les
> personnes malvoyantes, et c'est ce qui aide votre site à être trouvé. Une
> phrase simple qui décrit ce qu'on voit. »

Montrer : envoi, recadrage, description, aperçu immédiat.

### 4. Ajouter une vidéo — 30 s

> « Pour une vidéo, on ne dépose pas de fichier : vous copiez l'adresse depuis
> YouTube et vous la collez ici. La vidéo reste hébergée là-bas, votre site
> reste rapide. »

### 5. Une liste — 60 s

> « Sur les listes — vos avis clients, ici — passez la souris dessus : des
> boutons apparaissent. Ajouter, dupliquer, déplacer, supprimer. »

Montrer : dupliquer un avis, le modifier, le remonter, **puis en supprimer un
et montrer la demande de confirmation**.

### 6. Publier, et ce qui peut aller de travers — 90 s

> « Tant que vous n'avez pas cliqué sur Publier, vous êtes seul à voir vos
> modifications. »

Fermer l'onglet, le rouvrir :

> « Elles sont toujours là. Rien n'est perdu si vous fermez la fenêtre ou si
> votre ordinateur s'éteint. »

Publier :

> « Comptez une minute avant que le site en ligne soit à jour : il se
> reconstruit. »

Puis, préparé à l'avance, **montrer un vrai message de conflit** (publier
depuis une autre fenêtre entre-temps) :

> « Si vous voyez ce message, quelqu'un d'autre a publié pendant que vous
> travailliez. Vous rechargez la page — vos modifications sont conservées — et
> vous republiez. »

### 7. Où trouver de l'aide — 30 s

> « Tout ce qu'on vient de voir est écrit sur cette page, "Aide", en bas de la
> barre. Et pour toute autre question, notre adresse y figure. »

Montrer : le lien « Aide », la page `/aide`.

---

## À livrer avec la capsule

- Le lien vers `/aide`.
- La clé, **par un canal séparé** de celui qui porte la vidéo et le lien.
- Une phrase, et une seule, sur ce qu'il ne peut pas casser :

  > « Vous ne pouvez pas casser la mise en page, et rien n'est jamais
  > définitivement perdu : chaque publication est conservée. En cas de doute,
  > écrivez-nous. »

---

## Ce qu'il ne faut pas mettre dans la capsule

- Le multilingue, si le site est monolingue.
- Le fonctionnement de la reconstruction du site.
- Le nom de l'hébergeur, du dépôt, ou quoi que ce soit sur l'infrastructure.
- Une liste des choses interdites. Le client ne peut pas les faire ; les
  énumérer ne fait que suggérer que l'outil est fragile.
