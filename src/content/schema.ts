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

/** Tokens de style. Liste blanche stricte : aucune valeur libre, aucun repli silencieux. */
export const styleSchema = z.object({
  size: z.enum(['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl']).default('base'),
  weight: z.enum(['thin', 'light', 'regular', 'medium', 'semibold', 'bold']).default('regular'),
  italic: z.boolean().default(false),
  align: z.enum(['left', 'center', 'right']).default('left'),
  color: z.enum(['primary', 'secondary', 'muted', 'accent', 'inverse']).default('primary'),
});

/** Le seul type de champ du lot 0. `richtext` et `media` viendront avec leurs lots. */
export const textSchema = z.object({
  type: z.literal('text'),
  value: z.string(),
  style: styleSchema.default({}),
});

export const pageSchema = z.object({
  meta: z.object({
    title: z.string().max(60),
    description: z.string().max(160),
  }),
  blocks: z.record(z.record(textSchema)),
});

export type Style = z.infer<typeof styleSchema>;
export type TextField = z.infer<typeof textSchema>;
export type Page = z.infer<typeof pageSchema>;
