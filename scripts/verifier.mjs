// Vérifie contenu/propositions.json avant publication : npm run verifier
import { readFileSync } from "node:fs";

const FICHIER = new URL("../contenu/propositions.json", import.meta.url);
const TYPES = ["Décret", "Amendement"];
const CODES = ["Code pénal", "Code de police", "Code de la route", "Code du travail", "Code civil", "Constitution", "Autre"];
const PRIORITES = ["normale", "urgente"];
const CHAMPS = ["id", "type", "code", "titre", "article", "texteActuel", "textePropose", "justification", "priorite"];
const ID_VALIDE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const RESSEMBLE_ARTICLE = /^\s*Art(?:icle|\.)\s*\d/i;
const ARTICLE_CONFORME = /^\s*Article \S+(?: (?:bis|ter|quater|quinquies|sexies))? :(?: |$)/;

const erreurs = [];
const avertissements = [];

let propositions;
try {
  propositions = JSON.parse(readFileSync(FICHIER, "utf8"));
} catch (err) {
  console.error(`ERREUR  contenu/propositions.json n'est pas un JSON valide : ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(propositions)) {
  console.error("ERREUR  contenu/propositions.json doit contenir une liste [ ... ] de propositions.");
  process.exit(1);
}

const texte = (valeur) => (Array.isArray(valeur) ? valeur.join("\n") : typeof valeur === "string" ? valeur : "");
const ids = new Set();

propositions.forEach((p, index) => {
  const ref = p?.id ? String(p.id) : `proposition n° ${index + 1}`;
  const erreur = (message) => erreurs.push(`${ref} : ${message}`);
  const avertir = (message) => avertissements.push(`${ref} : ${message}`);

  if (!p || typeof p !== "object" || Array.isArray(p)) {
    erreur("doit être un objet { ... }");
    return;
  }

  if (!ID_VALIDE.test(String(p.id ?? ""))) erreur("identifiant manquant ou invalide (lettres, chiffres et tirets, par exemple P-014)");
  else if (ids.has(p.id)) erreur("identifiant en double");
  else ids.add(p.id);

  if (!TYPES.includes(p.type)) erreur("type invalide (« Décret » ou « Amendement »)");
  if (p.type === "Amendement" && !CODES.includes(p.code)) erreur(`code invalide (${CODES.join(", ")})`);
  if (p.type === "Décret" && p.code) avertir("un décret n'a pas de code : le champ « code » est ignoré");
  if (!String(p.titre ?? "").trim()) erreur("titre manquant");
  if (!PRIORITES.includes(p.priorite)) erreur("priorité invalide (« normale » ou « urgente »)");

  const actuel = texte(p.texteActuel);
  const propose = texte(p.textePropose);
  if (!propose.trim() && !actuel.trim()) erreur("texte proposé manquant");
  if (!propose.trim() && actuel.trim()) avertir("texte proposé vide : la proposition sera présentée comme une abrogation");
  if (actuel.trim() && p.type === "Amendement" && !String(p.article ?? "").trim()) avertir("texte actuel fourni sans numéro d'article");
  if (!texte(p.justification).trim()) avertir("justification vide");
  if (String(p.article ?? "").trim() && /^\s*Article\b/.test(propose)) {
    avertir("le texte proposé commence par « Article » alors que le champ « article » est rempli : l'en-tête apparaîtra deux fois");
  }

  for (const [champ, valeur] of [["texteActuel", actuel], ["textePropose", propose]]) {
    valeur.split("\n").forEach((ligne, n) => {
      if (RESSEMBLE_ARTICLE.test(ligne) && !ARTICLE_CONFORME.test(ligne)) {
        avertir(`${champ}, ligne ${n + 1} : « ${ligne.trim().slice(0, 48)} » ne suit pas le format « Article 12 : »`);
      }
    });
  }

  for (const cle of Object.keys(p)) {
    if (!CHAMPS.includes(cle)) avertir(`champ inconnu « ${cle} », ignoré par le site`);
  }
});

for (const message of erreurs) console.error(`ERREUR     ${message}`);
for (const message of avertissements) console.warn(`ATTENTION  ${message}`);

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
console.log(
  `${pluriel(propositions.length, "proposition")} vérifiée${propositions.length > 1 ? "s" : ""} : ` +
    `${pluriel(erreurs.length, "erreur")}, ${pluriel(avertissements.length, "avertissement")}.`,
);
process.exit(erreurs.length ? 1 : 0);
