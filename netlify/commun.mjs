// Éléments partagés par les fonctions netlify/functions/decisions.mjs et propositions.mjs.
// Ce fichier est hors du dossier des fonctions : Netlify ne le publie pas comme une fonction.

// Magasins Netlify Blobs du site (getStore : liés au site, pas à un déploiement, ils survivent aux redéploiements).
export const STORE_DECISIONS = "decisions";
export const STORE_MANUELLES = "propositions-manuelles";

export const reponse = (donnees, status = 200) =>
  new Response(JSON.stringify(donnees), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });

// Version d'une proposition ajoutée à la main : date de sa dernière modification, sinon de son ajout.
// Elle accompagne chaque décision, pour qu'on ne tranche jamais sur un texte modifié entre-temps.
export const versionDe = (entree) => entree.modifieeLe ?? entree.ajouteeLe;
