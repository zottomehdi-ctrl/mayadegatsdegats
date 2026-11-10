import { getStore } from "@netlify/blobs";
import DECISIONS_INITIALES from "../decisions-initiales.mjs";
import { RE_ID_MANUEL } from "../../assets/registre.js";
import { STORE_DECISIONS, STORE_MANUELLES, reponse, versionDe } from "../commun.mjs";

// Décisions de la fondatrice, stockées dans Netlify Blobs (magasin « decisions »),
// une clé par id de proposition (slug interne, jamais affiché). Le contenu des propositions n'est jamais touché.
//
//   GET  /api/decisions  ->  { "<id>": { statut, commentaire, date, renvoyeLe, historique, precedent }, ... }
//   POST /api/decisions  <-  { id, statut: "validee" | "traitee" | "refusee" | "rediscuter", commentaire, version }
//                            (« traitee » : seulement pour une proposition validée, ou déjà traitée ;
//                             « version » : pour une proposition ajoutée à la main, la date de la version lue)
//                        ->  la décision enregistrée
//   POST /api/decisions  <-  { id, annuler: "<date de la décision à annuler>" }
//                        ->  { decision }  (la décision rétablie, ou null si la proposition repasse en attente)

const STATUTS = ["validee", "traitee", "refusee", "rediscuter"];
// Slug du fichier contenu/propositions.json, ou « M-12 » pour une proposition ajoutée à la main.
const ID_VALIDE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_LONGUEUR_MAX = 100;
const COMMENTAIRE_MAX = 2000;
const HISTORIQUE_MAX = 200;

// Les décisions de départ (netlify/decisions-initiales.mjs) sont servies tant qu'aucune décision
// n'est enregistrée dans Netlify Blobs pour l'id. Une décision prise sur le site passe devant,
// et son annulation ramène à la décision de départ.

const etatDe = (decision) => ({
  statut: decision.statut,
  commentaire: decision.commentaire ?? "",
  date: decision.date,
  renvoyeLe: decision.renvoyeLe ?? null,
});

export default async (req) => {
  try {
    const store = getStore({ name: STORE_DECISIONS, consistency: "strong" });

    if (req.method === "GET") {
      const { blobs } = await store.list();
      const entrees = await Promise.all(
        blobs.map(async ({ key }) => [key, await store.get(key, { type: "json" })]),
      );
      const decisions = { ...DECISIONS_INITIALES };
      for (const [cle, valeur] of entrees) {
        if (valeur) decisions[cle] = valeur;
      }
      return reponse(decisions);
    }

    if (req.method !== "POST") return reponse({ erreur: "méthode non autorisée" }, 405);

    let corps;
    try {
      corps = await req.json();
    } catch {
      return reponse({ erreur: "requête illisible" }, 400);
    }

    const id = typeof corps?.id === "string" ? corps.id.trim() : "";
    if (!(ID_VALIDE.test(id) || RE_ID_MANUEL.test(id)) || id.length > ID_LONGUEUR_MAX) {
      return reponse({ erreur: "id de proposition invalide" }, 400);
    }

    // Proposition ajoutée à la main : on ne décide ni sur une proposition supprimée,
    // ni sur une version modifiée depuis qu'elle a été lue.
    if (RE_ID_MANUEL.test(id) && corps.annuler === undefined) {
      const manuelle = await getStore({ name: STORE_MANUELLES, consistency: "strong" }).get(id, { type: "json" });
      if (manuelle?.supprimeeLe) return reponse({ erreur: "cette proposition a été supprimée" }, 409);
      if (manuelle && corps.version !== undefined && corps.version !== versionDe(manuelle)) {
        return reponse({ erreur: "la proposition a été modifiée entre-temps : rechargez la page avant de décider" }, 409);
      }
    }

    const enregistree = await store.get(id, { type: "json" });
    const depart = DECISIONS_INITIALES[id] ?? null;
    const actuelle = enregistree ?? depart;

    // Annulation de la dernière décision (bouton « Annuler » du message de confirmation).
    // Seule une décision enregistrée s'annule ; une décision de départ ne s'annule pas.
    if (corps.annuler !== undefined) {
      if (!enregistree || enregistree.date !== corps.annuler) {
        return reponse({ erreur: "la décision a changé entre-temps et ne peut plus être annulée" }, 409);
      }
      const historique = (enregistree.historique ?? []).slice(0, -1);
      // Retour à la situation de départ : la clé est effacée, la décision de départ revient telle quelle.
      if (!enregistree.precedent || enregistree.precedent.date === depart?.date) {
        await store.delete(id);
        return reponse({ decision: depart });
      }
      const retablie = { ...enregistree.precedent, historique, precedent: null };
      await store.setJSON(id, retablie);
      return reponse({ decision: retablie });
    }

    const statut = corps.statut;
    const commentaire = typeof corps.commentaire === "string" ? corps.commentaire.trim() : "";
    if (!STATUTS.includes(statut)) return reponse({ erreur: "statut invalide" }, 400);
    if (statut === "traitee" && !["validee", "traitee"].includes(actuelle?.statut)) {
      return reponse({ erreur: "seule une proposition validée peut être marquée comme traitée" }, 409);
    }
    if (commentaire.length > COMMENTAIRE_MAX) {
      return reponse({ erreur: `commentaire trop long (${COMMENTAIRE_MAX} caractères maximum)` }, 400);
    }

    const date = new Date().toISOString();
    const dejaRenvoyee = actuelle?.statut === "rediscuter" && actuelle.renvoyeLe;
    const decision = {
      statut,
      commentaire,
      date,
      renvoyeLe: statut === "rediscuter" ? (dejaRenvoyee ? actuelle.renvoyeLe : date) : null,
      historique: [...(actuelle?.historique ?? []), { statut, commentaire, date }].slice(-HISTORIQUE_MAX),
      precedent: actuelle ? etatDe(actuelle) : null,
    };

    await store.setJSON(id, decision);
    return reponse(decision);
  } catch (err) {
    console.error(err);
    return reponse({ erreur: "le service des décisions est indisponible" }, 500);
  }
};

export const config = {
  path: "/api/decisions",
};
