/**
 * Source de vérité du modèle de contenu.
 *
 * Ce fichier n'importe PAS `astro:content` : il doit rester consommable
 * par la fonction d'écriture (/functions/api/save.ts), qui s'exécute hors
 * du contexte Astro. C'est ce qui garantit qu'un même schéma valide le
 * contenu au build ET à l'écriture — pas deux copies qui divergent.
 *
 * `zod` est ici la même instance que celle réexportée par `astro:content`.
 */
import { z } from 'zod';
import { ALIGNMENTS, COLORS, SIZES, WEIGHTS } from '../lib/style-tokens';

/**
 * Tokens de style. Liste blanche stricte : aucune valeur libre, aucun repli
 * silencieux. Les valeurs viennent de `src/lib/style-tokens.ts`, d'où la barre
 * d'outils de l'overlay tire aussi ses boutons — un bouton hors enum est donc
 * impossible par construction, pas par vigilance.
 */
export const styleSchema = z.object({
  size: z.enum(SIZES).default('base'),
  weight: z.enum(WEIGHTS).default('regular'),
  italic: z.boolean().default(false),
  align: z.enum(ALIGNMENTS).default('left'),
  color: z.enum(COLORS).default('primary'),
});

/** Texte simple : titres, labels, paragraphes sans mise en forme. */
export const textSchema = z.object({
  type: z.literal('text'),
  value: z.string(),
  style: styleSchema.default({}),
});

/**
 * Texte avec emphase ou liens. Le HTML autorisé est restreint à
 * `strong`, `em`, `a[href]`, `br`, `ul`, `ol`, `li`.
 * L'assainissement est appliqué côté client ET côté fonction — lot 2.
 */
export const richtextSchema = z.object({
  type: z.literal('richtext'),
  value: z.string(),
});

export const imageSchema = z.object({
  type: z.literal('media'),
  kind: z.literal('image'),
  src: z.string().min(1),
  // Libellé côté client : « Description de l'image ». Obligatoire, pas de repli.
  alt: z.string().min(1, "la description de l'image est obligatoire"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/**
 * La vidéo n'est JAMAIS téléversée : un fichier lourd dans Git casse le dépôt
 * et les builds. Le client colle un lien, on en extrait le fournisseur et
 * l'identifiant.
 */
export const videoSchema = z.object({
  type: z.literal('media'),
  kind: z.literal('video'),
  provider: z.enum(['youtube', 'vimeo']),
  videoId: z.string().min(1),
  title: z.string().min(1),
  poster: z.string().optional(),
});

export const mediaSchema = z.discriminatedUnion('kind', [imageSchema, videoSchema]);

/** Les trois types de champs, et pas un de plus. */
export const fieldSchema = z.union([textSchema, richtextSchema, mediaSchema]);

export const pageSchema = z.object({
  meta: z.object({
    title: z.string().max(60),
    description: z.string().max(160),
    ogImage: z.string().optional(),
  }),
  blocks: z.record(z.record(fieldSchema)),
});

/**
 * Configuration partagée par toutes les pages.
 *
 * Structure — navigation, coordonnées, mentions — donc du ressort du
 * développeur, pas du client : ce fichier n'est pas dans la liste blanche
 * d'écriture. La frontière est posée dès la livraison.
 */
export const siteSchema = z.object({
  name: z.string().min(1),
  locale: z.string().min(2),
  navigation: z.array(
    z.object({
      label: z.string().min(1),
      href: z.string().min(1),
    }),
  ),
  contact: z.object({
    email: z.string().email(),
    phone: z.string().optional(),
    address: z.string().optional(),
  }),
  footer: z.object({
    legal: z.string().min(1),
  }),
});

export type Style = z.infer<typeof styleSchema>;
export type TextField = z.infer<typeof textSchema>;
export type RichtextField = z.infer<typeof richtextSchema>;
export type ImageField = z.infer<typeof imageSchema>;
export type VideoField = z.infer<typeof videoSchema>;
export type MediaField = z.infer<typeof mediaSchema>;
export type Field = z.infer<typeof fieldSchema>;
export type Page = z.infer<typeof pageSchema>;
export type Site = z.infer<typeof siteSchema>;
