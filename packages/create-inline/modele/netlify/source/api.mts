/**
 * Adaptateur de route pour Netlify.
 *
 * Netlify ne lit pas /functions et ne connaît pas les exports
 * `onRequest<Méthode>` : il attend un export par défaut et un chemin déclaré.
 * Une seule fonction suffit donc pour les quatre routes — c'est le répartiteur
 * d'`inline-core` qui les distingue, exactement comme ailleurs.
 *
 * Comme les autres adaptateurs, ce fichier ne contient aucune règle. Il ne fait
 * que deux traductions :
 *
 *   1. les variables — `context.env` ailleurs, `process.env` ici ;
 *   2. le comptage des tentatives — une liaison clé-valeur ailleurs, le
 *      stockage d'objets de Netlify ici.
 *
 * Tout fichier posé à la racine de netlify/functions devient une fonction : les
 * deux traductions vivent donc ici et non dans un fichier voisin.
 *
 * Ce fichier n'est PAS la fonction déployée : il en est la source. Le build
 * l'assemble en un module ESM autonome, netlify/functions/api.mjs, et c'est
 * celui-là que Netlify déploie — voir scripts/build-netlify.mjs.
 *
 * Pourquoi cet assemblage n'est pas laissé à Netlify. Son option
 * « node_bundler = esbuild » produit du CommonJS : l'export par défaut devient
 * « exports.default », la fonction est prise pour une v1, et l'exécution
 * appelle « handler » qui n'existe pas — 502, « handler is not a function ».
 * Sans cette option, Netlify n'assemble pas et doit résoudre lui-même le
 * TypeScript d'`inline-core`, publié en source, ce qu'il ne sait pas faire.
 * Un module déjà assemblé écarte les deux problèmes.
 *
 * Site déposé ailleurs ? Ce dossier ne gêne pas, et se supprime.
 */
import { api } from '../../src/lib/api';

/** Fourni par l'exécution Node de Netlify ; évite d'exiger @types/node. */
declare const process: { env: Record<string, string | undefined> };

/**
 * Une route unique pour les quatre chemins.
 *
 * Netlify évalue ce motif avant de servir un fichier statique, et le site n'en
 * produit aucun sous /api : aucune redirection à écrire dans netlify.toml.
 */
export const config = { path: '/api/*' };

/**
 * Le contrat que `inline-core` attend d'un espace clé-valeur.
 * Volontairement minuscule : deux méthodes, rien de propre à un hébergeur.
 */
interface KeyValueStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** Repli si le TTL n'est pas transmis : le plus long plafond d'`inline`. */
const DEFAULT_TTL_SECONDS = 900;

/**
 * Adapte le stockage d'objets de Netlify au contrat ci-dessus.
 *
 * Deux écarts à connaître :
 *
 *   - Il n'y a pas d'expiration native. La date de péremption est donc écrite
 *     dans la valeur et vérifiée à la lecture : une entrée périmée est un
 *     compteur remis à zéro. L'entrée elle-même reste en place jusqu'à sa
 *     prochaine écriture, ce qui borne le stockage au nombre d'appelants
 *     distincts et non au nombre de tentatives.
 *   - La cohérence forte est demandée explicitement. Par défaut, deux
 *     tentatives quasi simultanées peuvent lire le même compteur ; ici, la
 *     lecture voit toujours la dernière écriture.
 */
async function openSharedCounter(): Promise<KeyValueStore | undefined> {
  try {
    const { getStore } = await import('@netlify/blobs');
    const blobs = getStore({ name: 'inline-rate-limit', consistency: 'strong' });

    // Sonde : `getStore` peut réussir alors que le stockage n'est pas gréé sur
    // le site. Mieux vaut le découvrir au démarrage qu'au milieu d'un appel.
    await blobs.get('sonde-de-disponibilite', { type: 'text' });

    return {
      async get(key) {
        let entry: unknown;
        try {
          entry = await blobs.get(key, { type: 'json' });
        } catch {
          return null; // Entrée illisible : comptée comme absente.
        }
        if (!entry || typeof entry !== 'object') return null;

        const { value, expires } = entry as { value?: unknown; expires?: unknown };
        if (typeof value !== 'string' || typeof expires !== 'number') return null;
        if (expires <= Date.now()) return null;

        return value;
      },

      async put(key, value, options) {
        const seconds = options?.expirationTtl ?? DEFAULT_TTL_SECONDS;
        await blobs.setJSON(key, { value, expires: Date.now() + seconds * 1000 });
      },
    };
  } catch {
    return undefined;
  }
}

/**
 * Ouvert une seule fois par instance, pas une fois par requête.
 * `inline-core` retombe seul sur un compteur en mémoire si le résultat est
 * absent — suffisant pour un essai, jamais pour la production.
 */
let sharedCounter: Promise<KeyValueStore | undefined> | undefined;

function counter(): Promise<KeyValueStore | undefined> {
  if (!sharedCounter) {
    sharedCounter = openSharedCounter().then((store) => {
      if (!store) {
        console.warn(
          'inline : stockage partagé indisponible, comptage des tentatives en mémoire — ' +
            'la protection contre la force brute est incomplète sur plusieurs instances.',
        );
      }
      return store;
    });
  }
  return sharedCounter;
}

export default async function handler(request: Request): Promise<Response> {
  const store = await counter();

  return api.handle(request, {
    ...process.env,
    // Le nom qu'`inline-core` cherche ; absent, il compte en mémoire.
    ...(store ? { RATE_LIMIT: store } : {}),
  });
}
