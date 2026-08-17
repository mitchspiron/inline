import { defineConfig } from 'astro/config';

// Sortie statique, sans exception. Aucune intégration serveur, aucun adaptateur.
// Toute route dynamique passe par /functions (voir CLAUDE.md, règles 1 et 6).
export default defineConfig({
  output: 'static',
  site: 'http://localhost:4321',
  build: {
    format: 'directory',
  },
});
