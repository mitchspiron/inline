import { defineConfig } from 'astro/config';
import inline from 'inline-core/astro';

// Sortie statique, sans exception. Aucune intégration serveur, aucun adaptateur.
// Toute route dynamique passe par /functions (voir CLAUDE.md, règles 1 et 6).
export default defineConfig({
  // L'intégration pose /admin, /aide, l'amorce d'édition et la construction de
  // l'overlay. Elle refuse de démarrer si la sortie n'est pas statique.
  integrations: [
    inline({
      locales: ['fr'],
      support: { email: 'bonjour@exemple.fr' },
    }),
  ],

  output: 'static',
  site: 'http://localhost:4321',
  build: {
    format: 'directory',
  },

  /**
   * Une URL par langue, préfixe compris pour la langue par défaut.
   *
   * `prefixDefaultLocale: true` évite la page servie sous deux adresses — la
   * racine et le préfixe — qui obligerait à arbitrer une canonique entre deux
   * URL identiques.
   */
  i18n: {
    locales: ['fr'],
    defaultLocale: 'fr',
    routing: {
      prefixDefaultLocale: true,
    },
  },

  // La racine mène à la langue par défaut. Redirection émise au build, sans
  // une ligne de JavaScript.
  redirects: {
    '/': '/fr/',
  },
});
