import { getStore } from "@netlify/blobs";

// Décisions de la fondatrice, stockées dans Netlify Blobs (magasin « decisions »),
// une clé par identifiant de proposition. Le contenu des propositions n'est jamais touché.
//
//   GET  /api/decisions  ->  { "P-014": { statut, commentaire, date, renvoyeLe, historique }, ... }
//   POST /api/decisions  <-  { id, statut: "validee" | "refusee" | "rediscuter", commentaire }

const STATUTS = ["validee", "refusee", "rediscuter"];
const ID_VALIDE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const COMMENTAIRE_MAX = 2000;
const HISTORIQUE_MAX = 200;

// Décision de démonstration pour la proposition d'exemple EX-03.
// Elle ne sert que tant qu'aucune décision réelle n'existe pour EX-03,
// et devient sans effet une fois les exemples retirés de contenu/propositions.json.
const DECISIONS_EXEMPLE = {
  "EX-03": {
    statut: "rediscuter",
    commentaire:
      "D'accord sur le principe, mais « raison plausible » me paraît trop vague pour les nouveaux agents. On en parle à l'appel : il faudrait peut-être une liste d'exemples, ou une formation avant l'entrée en vigueur.",
    date: "2026-10-08T19:40:00.000Z",
    renvoyeLe: "2026-10-08T19:40:00.000Z",
    historique: [
      {
        statut: "rediscuter",
        commentaire:
          "D'accord sur le principe, mais « raison plausible » me paraît trop vague pour les nouveaux agents. On en parle à l'appel : il faudrait peut-être une liste d'exemples, ou une formation avant l'entrée en vigueur.",
        date: "2026-10-08T19:40:00.000Z",
      },
    ],
  },
};

const reponse = (donnees, status = 200) =>
  new Response(JSON.stringify(donnees), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });

export default async (req) => {
  try {
    const store = getStore({ name: "decisions", consistency: "strong" });

    if (req.method === "GET") {
      const { blobs } = await store.list();
      const entrees = await Promise.all(
        blobs.map(async ({ key }) => [key, await store.get(key, { type: "json" })]),
      );
      const decisions = { ...DECISIONS_EXEMPLE };
      for (const [cle, valeur] of entrees) {
        if (valeur) decisions[cle] = valeur;
      }
      return reponse(decisions);
    }

    if (req.method === "POST") {
      let corps;
      try {
        corps = await req.json();
      } catch {
        return reponse({ erreur: "requête illisible" }, 400);
      }

      const id = typeof corps?.id === "string" ? corps.id.trim() : "";
      const statut = corps?.statut;
      const commentaire = typeof corps?.commentaire === "string" ? corps.commentaire.trim() : "";

      if (!ID_VALIDE.test(id)) return reponse({ erreur: "identifiant de proposition invalide" }, 400);
      if (!STATUTS.includes(statut)) return reponse({ erreur: "statut invalide" }, 400);
      if (commentaire.length > COMMENTAIRE_MAX) {
        return reponse({ erreur: `commentaire trop long (${COMMENTAIRE_MAX} caractères maximum)` }, 400);
      }

      const precedente = (await store.get(id, { type: "json" })) ?? DECISIONS_EXEMPLE[id] ?? null;
      const date = new Date().toISOString();
      const dejaRenvoyee = precedente?.statut === "rediscuter" && precedente.renvoyeLe;

      const decision = {
        statut,
        commentaire,
        date,
        renvoyeLe: statut === "rediscuter" ? (dejaRenvoyee ? precedente.renvoyeLe : date) : null,
        historique: [...(precedente?.historique ?? []), { statut, commentaire, date }].slice(-HISTORIQUE_MAX),
      };

      await store.setJSON(id, decision);
      return reponse(decision);
    }

    return reponse({ erreur: "méthode non autorisée" }, 405);
  } catch (err) {
    console.error(err);
    return reponse({ erreur: "le service des décisions est indisponible" }, 500);
  }
};

export const config = {
  path: "/api/decisions",
};
