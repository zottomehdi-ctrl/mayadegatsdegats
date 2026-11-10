import { getStore } from "@netlify/blobs";
import DECISIONS_INITIALES from "../decisions-initiales.mjs";
import { RE_ID_MANUEL, formeCanonique, validerProposition } from "../../assets/registre.js";
import { STORE_DECISIONS, STORE_MANUELLES, reponse, versionDe } from "../commun.mjs";

// Propositions ajoutées à la main depuis l'onglet « Ajouter », stockées dans Netlify Blobs
// (magasin « propositions-manuelles »), une clé par id « M-1 », « M-2 »… Elles s'ajoutent à
// contenu/propositions.json, qui n'est jamais modifié. Les mêmes règles que le fichier s'appliquent
// (assets/registre.js), avec des longueurs limitées et le refus de tout champ inconnu.
//
//   GET  /api/propositions  ->  { propositions: [{ proposition, ajouteeLe, modifieeLe }, ...] }
//   POST /api/propositions  <-  { action: "ajouter", proposition }
//                           <-  { action: "modifier", id, version, proposition }   (sans décision prise)
//                           <-  { action: "supprimer", id, version }               (sans décision prise)
//                           <-  { action: "restaurer", id, supprimeeLe }           (bouton « Annuler »)
//                           ->  { entree } ou { id, supprimeeLe }
// « version » est la date de dernière modification (ou d'ajout) connue du navigateur : une
// modification faite entre-temps ailleurs est refusée au lieu d'être écrasée.

const MAX_PROPOSITIONS = 200;
const CORPS_MAX = 64 * 1024;
// Une suppression s'annule pendant ce délai ; ensuite, la fiche supprimée est effacée.
// Son numéro n'est jamais réutilisé : des décisions y ont pu être rattachées un jour.
const DELAI_RESTAURATION = 10 * 60 * 1000;
const CLE_COMPTEUR = "compteur";
const CHAMPS_REQUETE = {
  ajouter: ["action", "proposition"],
  modifier: ["action", "id", "version", "proposition"],
  supprimer: ["action", "id", "version"],
  restaurer: ["action", "id", "supprimeeLe"],
};

const numeroDe = (id) => Number(id.slice(2));
const publique = ({ proposition, ajouteeLe, modifieeLe }) => ({ proposition, ajouteeLe, modifieeLe: modifieeLe ?? null });

class Refus extends Error {
  constructor(status, erreur, erreurs) {
    super(erreur);
    this.status = status;
    this.erreurs = erreurs;
  }
}

export default async (req) => {
  try {
    const store = getStore({ name: STORE_MANUELLES, consistency: "strong" });

    if (req.method === "GET") {
      const entrees = await lireTout(store);
      const actives = entrees.filter(([, entree]) => !entree.supprimeeLe);
      return reponse({ propositions: actives.map(([, entree]) => publique(entree)) });
    }

    if (req.method !== "POST") return reponse({ erreur: "méthode non autorisée" }, 405);

    const corps = await lireCorps(req);
    const action = corps.action;
    if (!Object.hasOwn(CHAMPS_REQUETE, action)) throw new Refus(400, "action inconnue");
    const inconnu = Object.keys(corps).find((cle) => !CHAMPS_REQUETE[action].includes(cle));
    if (inconnu) throw new Refus(400, `champ inconnu dans la requête : « ${inconnu} »`);

    if (action === "ajouter") return await ajouter(store, req, corps);

    const id = typeof corps.id === "string" ? corps.id : "";
    if (!RE_ID_MANUEL.test(id)) throw new Refus(400, "id de proposition invalide");
    const lu = await store.getWithMetadata(id, { type: "json" });

    if (action === "restaurer") return await restaurer(store, id, lu, corps);

    const entree = lu?.data;
    if (!entree || entree.supprimeeLe) throw new Refus(404, "cette proposition n'existe pas ou a été supprimée");
    if (corps.version !== versionDe(entree)) {
      throw new Refus(409, "la proposition a été modifiée entre-temps : rechargez la page");
    }
    if (await aUneDecision(id)) {
      throw new Refus(409, "une décision a déjà été prise sur cette proposition : son texte ne peut plus changer");
    }

    const maintenant = new Date().toISOString();
    if (action === "supprimer") {
      await ecrire(store, id, { ...entree, supprimeeLe: maintenant }, lu.etag);
      return reponse({ id, supprimeeLe: maintenant });
    }

    // modifier
    const proposition = formeCanonique({ ...verifier(corps.proposition, id), id });
    const modifiee = { ...entree, proposition, modifieeLe: maintenant };
    await ecrire(store, id, modifiee, lu.etag);
    return reponse({ entree: publique(modifiee) });
  } catch (err) {
    if (err instanceof Refus) {
      return reponse(err.erreurs ? { erreur: err.message, erreurs: err.erreurs } : { erreur: err.message }, err.status);
    }
    console.error(err);
    return reponse({ erreur: "le service des propositions est indisponible" }, 500);
  }
};

async function ajouter(store, req, corps) {
  if (corps.proposition && typeof corps.proposition === "object" && Object.hasOwn(corps.proposition, "id")) {
    throw new Refus(400, "la proposition contient des erreurs", [{ champ: "id", message: "L'identifiant est attribué automatiquement." }]);
  }
  const normalisee = verifier(corps.proposition);

  const entrees = await purger(store, await lireTout(store));
  if (entrees.filter(([, entree]) => !entree.supprimeeLe).length >= MAX_PROPOSITIONS) {
    throw new Refus(409, `le nombre maximal de propositions ajoutées à la main (${MAX_PROPOSITIONS}) est atteint`);
  }

  // Numéro suivant : jamais réutilisé, et toujours au-delà des « M-… » déjà intégrés au fichier.
  const compteur = (await store.get(CLE_COMPTEUR, { type: "json" }))?.dernier ?? 0;
  let numero = Math.max(compteur, ...entrees.map(([id]) => numeroDe(id)), await plusGrandNumeroDuFichier(req)) + 1;
  const maintenant = new Date().toISOString();
  for (let essai = 0; essai < 25; essai++, numero++) {
    const id = `M-${numero}`;
    const entree = { proposition: formeCanonique({ ...normalisee, id }), ajouteeLe: maintenant, modifieeLe: null, supprimeeLe: null };
    const { modified } = await store.setJSON(id, entree, { onlyIfNew: true });
    if (modified) {
      await avancerCompteur(store, numero);
      return reponse({ entree: publique(entree) }, 201);
    }
  }
  throw new Refus(409, "impossible d'attribuer un numéro à la proposition : réessayez");
}

async function restaurer(store, id, lu, corps) {
  const entree = lu?.data;
  const date = Date.parse(entree?.supprimeeLe ?? "");
  if (!entree || !entree.supprimeeLe || entree.supprimeeLe !== corps.supprimeeLe || Date.now() - date > DELAI_RESTAURATION) {
    throw new Refus(409, "cette suppression ne peut plus être annulée");
  }
  const actives = (await lireTout(store)).filter(([, e]) => !e.supprimeeLe).length;
  if (actives >= MAX_PROPOSITIONS) {
    throw new Refus(409, `le nombre maximal de propositions ajoutées à la main (${MAX_PROPOSITIONS}) est atteint`);
  }
  const restauree = { ...entree, supprimeeLe: null };
  await ecrire(store, id, restauree, lu.etag);
  return reponse({ entree: publique(restauree) });
}

// Mêmes règles que le fichier (assets/registre.js), en mode « ajoutée à la main ».
// Renvoie la proposition lue (non canonique), sans id : l'id est fixé par le serveur.
function verifier(brut, id) {
  const { erreurs, proposition } = validerProposition(brut, { manuelle: true });
  if (erreurs.length) {
    throw new Refus(400, "la proposition contient des erreurs", erreurs.map(({ champ, aide }) => ({ champ, message: aide })));
  }
  if (id !== undefined && proposition.id && proposition.id !== id) {
    throw new Refus(400, "la proposition contient des erreurs", [{ champ: "id", message: "L'identifiant ne peut pas être changé." }]);
  }
  return { ...proposition, id: "" };
}

// Le compteur ne fait qu'avancer, même si deux ajouts arrivent en même temps.
async function avancerCompteur(store, numero) {
  for (let essai = 0; essai < 10; essai++) {
    const lu = await store.getWithMetadata(CLE_COMPTEUR, { type: "json" });
    if ((lu?.data?.dernier ?? 0) >= numero) return;
    const { modified } = await store.setJSON(CLE_COMPTEUR, { dernier: numero }, lu ? { onlyIfMatch: lu.etag } : { onlyIfNew: true });
    if (modified) return;
  }
}

async function lireCorps(req) {
  const texte = await req.text();
  if (texte.length > CORPS_MAX) throw new Refus(413, "requête trop volumineuse");
  let corps;
  try {
    corps = JSON.parse(texte);
  } catch {
    throw new Refus(400, "requête illisible");
  }
  if (!corps || typeof corps !== "object" || Array.isArray(corps)) throw new Refus(400, "requête illisible");
  return corps;
}

async function lireTout(store) {
  const { blobs } = await store.list();
  const ids = blobs.map(({ key }) => key).filter((key) => RE_ID_MANUEL.test(key));
  const entrees = await Promise.all(ids.map(async (id) => [id, await store.get(id, { type: "json" })]));
  return entrees.filter(([, entree]) => entree).sort(([a], [b]) => numeroDe(a) - numeroDe(b));
}

// Efface les fiches supprimées depuis plus longtemps que le délai d'annulation.
async function purger(store, entrees) {
  const limite = Date.now() - DELAI_RESTAURATION;
  const gardees = [];
  for (const [id, entree] of entrees) {
    if (entree.supprimeeLe && Date.parse(entree.supprimeeLe) < limite) await store.delete(id);
    else gardees.push([id, entree]);
  }
  return gardees;
}

async function ecrire(store, id, entree, etag) {
  const { modified } = await store.setJSON(id, entree, etag ? { onlyIfMatch: etag } : {});
  if (!modified) throw new Refus(409, "la proposition a été modifiée entre-temps : rechargez la page");
}

async function aUneDecision(id) {
  const decisions = getStore({ name: STORE_DECISIONS, consistency: "strong" });
  return Boolean((await decisions.get(id, { type: "json" })) ?? DECISIONS_INITIALES[id]);
}

// Plus grand numéro « M-… » déjà présent dans contenu/propositions.json (propositions exportées puis
// intégrées au fichier), lu sur le site lui-même. En cas d'échec, le compteur suffit.
async function plusGrandNumeroDuFichier(req) {
  try {
    const url = new URL("/contenu/propositions.json", req.url);
    const reponseFichier = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!reponseFichier.ok) return 0;
    const liste = await reponseFichier.json();
    if (!Array.isArray(liste)) return 0;
    return Math.max(0, ...liste.map((p) => (typeof p?.id === "string" && RE_ID_MANUEL.test(p.id) ? numeroDe(p.id) : 0)));
  } catch {
    return 0;
  }
}

export const config = {
  path: "/api/propositions",
};
