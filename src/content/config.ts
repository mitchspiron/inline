import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { pageSchema } from 'inline-core/schema';

const pages = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/pages' }),
  schema: pageSchema,
});

export const collections = { pages };
