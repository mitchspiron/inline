/**
 * Bibliothèque d'images du site — créé par l'intégration inline, à laisser tel quel.
 *
 * Les composants du paquet ne peuvent pas chercher les images à votre place :
 * le motif doit s'exécuter ici, dans votre projet. Le motif est relatif à ce
 * fichier, jamais absolu.
 */
export const library = import.meta.glob<{ default: ImageMetadata }>(
  './**/*.{png,jpg,jpeg,webp,avif}',
  { eager: true },
);
