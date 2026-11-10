// Lecture et vérification des propositions.
// Partagé par le site (navigateur), par `npm run verifier` (Node) et par la fonction
// netlify/functions/propositions.mjs, qui contrôle les propositions ajoutées à la main.

export const TEXTES = [
  'Code pénal',
  'Code de procédure pénale',
  'Code de police',
  'Code de la route',
  'Code du travail',
  'Code civil',
  'Code électoral',
  'Constitution',
  'Décret',
  'Autre',
];

export const EFFETS = [
  ['lspd', 'LSPD'],
  ['doj', 'DOJ'],
  ['entreprises', 'Entreprises'],
];

export const LONGUEUR_ID_MAX = 100;
export const CHANGEMENTS_MAX = 4;
export const SALVE_MAX = 999;

// Longueurs maximales d'une proposition ajoutée à la main (en caractères).
export const LIMITES = {
  titre: 160,
  article: 120,
  resume: 500,
  changement: 400,
  pourquoi: 4000,
  effet: 800,
  avant: 12000,
  apres: 12000,
};

// Ordre des champs dans contenu/propositions.json (et dans l'export des propositions ajoutées à la main).
export const CHAMPS = ['id', 'titre', 'salve', 'texte', 'article', 'urgent', 'resume', 'changements', 'pourquoi', 'effets', 'avant', 'apres'];

// Identifiant d'une proposition ajoutée à la main : « M- » suivi d'un numéro. La majuscule le distingue
// des slugs du fichier, toujours en minuscules : aucune collision possible avec un id présent ou futur.
export const RE_ID_MANUEL = /^M-[1-9][0-9]{0,5}$/;
const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUFFIXES = '(?: (?:bis|ter|quater|quinquies|sexies))?';
// « Article 12 : », « Article 12 bis : » ou, pour un texte non numéroté, « Article Préambule : ».
const RE_ARTICLE_CONFORME = /^Article [^\s:](?:[^:]*[^\s:])? :$/;
const RE_LIGNE_ARTICLE = /^\s*Art(?:icle|\.)?\s*\d/i;
const RE_LIGNE_CONFORME = new RegExp(`^\\s*Article [^\\s:]+${SUFFIXES} :(?: |$)`);

export function sansAccents(texte) {
  return String(texte ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// « 12 », « Article 12 », « Art. 12 - » deviennent tous « Article 12 : ».
export function normaliserArticle(valeur) {
  if (valeur === undefined || valeur === null) return '';
  const numero = String(valeur)
    .trim()
    .replace(/^art(?:icle|\.)?\s*/i, '')
    .replace(/[\s:.\-–—]+$/, '')
    .trim();
  return numero ? `Article ${numero} :` : '';
}

// Analyse le contenu brut du fichier.
// Renvoie { propositions, erreurs, remarques, fatal } :
// - erreurs : propositions écartées (JSON mal formé, champ obligatoire manquant ou invalide) ;
// - remarques : écarts de format sans conséquence sur l'affichage ;
// - fatal : aucune proposition n'a pu être lue.
export function analyserRegistre(source) {
  const erreurs = [];
  const remarques = [];
  const texte = String(source ?? '').replace(/^﻿/, '');
  let elements;

  try {
    const donnees = JSON.parse(texte);
    if (!Array.isArray(donnees)) {
      erreurs.push('Le fichier doit contenir une liste de propositions entre crochets [ ].');
      return { propositions: [], erreurs, remarques, fatal: true };
    }
    elements = donnees.map((valeur, index) => ({ valeur, numero: index + 1 }));
  } catch (err) {
    const morceaux = decouperListe(texte);
    if (!morceaux) {
      erreurs.push(`Le fichier est mal formé${situer(texte, 0, err)} : aucune proposition ne peut être lue. Vérifiez les virgules, les guillemets et les crochets. (${err.message})`);
      return { propositions: [], erreurs, remarques, fatal: true };
    }
    elements = [];
    let numero = 0;
    for (const morceau of morceaux) {
      if (!morceau.texte.trim()) {
        erreurs.push(`Virgule en trop dans la liste, ligne ${ligneDe(texte, morceau.debut)}.`);
        continue;
      }
      numero += 1;
      try {
        elements.push({ valeur: JSON.parse(morceau.texte), numero });
      } catch (errMorceau) {
        const titre = morceau.texte.match(/"titre"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        const nom = `Proposition n° ${numero}${titre ? ` (« ${titre[1]} »)` : ''}`;
        erreurs.push(`${nom} : JSON mal formé${situer(texte, morceau.brut, errMorceau, morceau.texte)}. Vérifiez les virgules et les guillemets. (${errMorceau.message})`);
      }
    }
  }

  const propositions = [];
  const ids = new Map();
  for (const { valeur, numero } of elements) {
    const resultat = validerProposition(valeur, { numero });
    remarques.push(...resultat.remarques.map((r) => `${resultat.nom} : ${r.message}`));
    if (resultat.erreurs.length) {
      erreurs.push(...resultat.erreurs.map((e) => `${resultat.nom} : ${e.message}`));
      continue;
    }
    const p = resultat.proposition;
    if (ids.has(p.id)) {
      erreurs.push(`${resultat.nom} : son id est déjà utilisé par la proposition n° ${ids.get(p.id)}. Chaque id doit être unique.`);
      continue;
    }
    ids.set(p.id, numero);
    propositions.push(p);
  }

  return { propositions, erreurs, remarques, fatal: propositions.length === 0 && erreurs.length > 0 };
}

// Vérifie une proposition.
// Renvoie { erreurs, remarques, nom, apercu, proposition } :
// - erreurs et remarques : { champ, message, aide } ; « message » est rédigé pour le fichier JSON
//   (repris par npm run verifier), « aide » pour le formulaire du site ;
// - apercu : la proposition lue au mieux, même incomplète (aperçu en direct du formulaire) ;
// - proposition : la même, seulement s'il n'y a aucune erreur.
// Avec { manuelle: true } (proposition ajoutée à la main, contrôlée par le formulaire et par le serveur) :
// l'id est facultatif (attribué par le serveur), tout champ inconnu est refusé et les longueurs sont limitées.
export function validerProposition(brut, { numero = 1, manuelle = false } = {}) {
  const erreurs = [];
  const remarques = [];
  const titreBrut = brut && typeof brut === 'object' && typeof brut.titre === 'string' ? brut.titre.trim() : '';
  const nom = `Proposition n° ${numero}${titreBrut ? ` (« ${titreBrut} »)` : ''}`;
  const erreur = (champ, message, aide = message) => erreurs.push({ champ, message, aide });
  const remarque = (champ, message, aide = message) => remarques.push({ champ, message, aide });
  const enErreur = (champ) => erreurs.some((e) => e.champ === champ);
  const OBLIGATOIRE = 'Ce champ est obligatoire.';

  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) {
    erreur('', 'doit être un objet entre accolades { }.', 'La proposition est illisible.');
    return { erreurs, remarques, nom, apercu: null, proposition: null };
  }

  for (const cle of Object.keys(brut)) {
    if (!CHAMPS.includes(cle)) {
      if (manuelle) erreur(cle, `champ inconnu « ${cle} ».`, `Champ inconnu : « ${cle} ».`);
      else remarque(cle, `champ inconnu « ${cle} », ignoré.`);
    } else if (brut[cle] === '' && !manuelle) {
      remarque(cle, `le champ « ${cle} » est vide : omettez-le plutôt que de le laisser à "".`);
    }
  }

  const limiter = (cle, chaine, limite = LIMITES[cle]) => {
    if (manuelle && limite && chaine.length > limite) {
      erreur(cle, `le champ « ${cle} » dépasse ${limite} caractères (${chaine.length}).`, `Ce texte est trop long : ${chaine.length} caractères, pour ${limite} au plus.`);
    }
  };

  const lireTexte = (cle, { obligatoire = false, garderEspaces = false, aide = OBLIGATOIRE } = {}) => {
    const valeur = brut[cle];
    if (valeur === undefined || valeur === null || valeur === '') {
      if (obligatoire) erreur(cle, `il manque le champ « ${cle} ».`, aide);
      return '';
    }
    let chaine;
    if (typeof valeur === 'string') {
      chaine = valeur;
    } else if (!manuelle && Array.isArray(valeur) && valeur.every((ligne) => typeof ligne === 'string')) {
      remarque(cle, `le champ « ${cle} » est une liste de lignes : écrivez plutôt une seule chaîne avec \\n.`);
      chaine = valeur.join('\n');
    } else {
      erreur(cle, `le champ « ${cle} » doit être un texte entre guillemets.`, 'Ce champ doit être un texte.');
      return '';
    }
    chaine = chaine.replace(/\r\n?/g, '\n');
    if (!garderEspaces) chaine = chaine.trim();
    if (obligatoire && !chaine.trim()) erreur(cle, `le champ « ${cle} » est vide.`, aide);
    limiter(cle, chaine);
    return chaine;
  };

  // id : clé interne, jamais affichée. Slug en minuscules, ou « M-12 » pour une proposition ajoutée à la main.
  let id = '';
  if (brut.id === undefined || brut.id === null || brut.id === '') {
    if (!manuelle) erreur('id', 'il manque le champ « id ».');
  } else if (manuelle && (typeof brut.id !== 'string' || !RE_ID_MANUEL.test(brut.id))) {
    erreur('id', 'le champ « id » d\'une proposition ajoutée à la main est de la forme M-12.', 'Identifiant invalide.');
  } else if (typeof brut.id !== 'string' || !(RE_SLUG.test(brut.id) || RE_ID_MANUEL.test(brut.id)) || brut.id.length > LONGUEUR_ID_MAX) {
    erreur('id', `le champ « id » doit être un slug en minuscules, chiffres et tirets (par exemple vol-a-main-armee), de ${LONGUEUR_ID_MAX} caractères au plus.`);
  } else {
    id = brut.id;
  }

  const titre = lireTexte('titre', { obligatoire: true, aide: 'Indiquez un titre court.' });

  // texte concerné
  let texteConcerne = '';
  if (brut.texte === undefined || brut.texte === null || brut.texte === '') {
    erreur('texte', `il manque le champ « texte » (${TEXTES.join(', ')}).`, 'Choisissez le texte concerné.');
  } else if (typeof brut.texte !== 'string') {
    erreur('texte', `le champ « texte » doit être l'une de ces valeurs : ${TEXTES.join(', ')}.`, 'Choisissez le texte concerné dans la liste.');
  } else {
    texteConcerne = TEXTES.find((t) => t === brut.texte.trim()) ?? '';
    if (!texteConcerne) {
      const approchant = TEXTES.find((t) => sansAccents(t) === sansAccents(brut.texte.trim()));
      if (approchant && !manuelle) {
        texteConcerne = approchant;
        remarque('texte', `« texte » vaut « ${brut.texte} » : écrivez exactement « ${approchant} ».`);
      } else {
        erreur('texte', `le champ « texte » vaut « ${brut.texte} » ; valeurs possibles : ${TEXTES.join(', ')}.`, 'Choisissez le texte concerné dans la liste.');
      }
    }
  }

  // article : obligatoire sauf pour un décret
  let article = '';
  if (brut.article === undefined || brut.article === null || brut.article === '') {
    if (texteConcerne && texteConcerne !== 'Décret') {
      erreur('article', 'il manque le champ « article » (par exemple « Article 12 : »).', 'Indiquez l\'article, par exemple « Article 12 : ». Il n\'est facultatif que pour un décret.');
    }
  } else if (typeof brut.article !== 'string' && typeof brut.article !== 'number') {
    erreur('article', 'le champ « article » doit être un texte, par exemple « Article 12 : ».', 'Indiquez l\'article sous la forme « Article 12 : ».');
  } else {
    article = normaliserArticle(brut.article);
    if (!article) {
      erreur('article', 'le champ « article » est vide.', 'Indiquez l\'article sous la forme « Article 12 : ».');
    } else if (String(brut.article).trim() !== article || !RE_ARTICLE_CONFORME.test(article)) {
      remarque('article', `l'article « ${brut.article} » est affiché « ${article} » : écrivez-le directement sous cette forme.`, `Sera enregistré sous la forme « ${article} ».`);
    }
    limiter('article', article);
  }

  // urgent
  if (brut.urgent !== undefined && typeof brut.urgent !== 'boolean') {
    if (manuelle) erreur('urgent', '« urgent » doit valoir true ou false.', 'Valeur invalide.');
    else remarque('urgent', '« urgent » doit valoir true ou false, sans guillemets. La proposition est traitée comme non urgente.');
  }
  const urgent = brut.urgent === true;

  // salve : entier ≥ 1, facultatif (1 par défaut)
  let salve = 1;
  if (brut.salve !== undefined && brut.salve !== null) {
    if (typeof brut.salve !== 'number' || !Number.isInteger(brut.salve) || brut.salve < 1) {
      erreur('salve', `« salve » vaut ${JSON.stringify(brut.salve)} : ce doit être un nombre entier supérieur ou égal à 1, sans guillemets (par exemple 2).`, 'La salve est un nombre entier, 1 ou plus.');
    } else if (manuelle && brut.salve > SALVE_MAX) {
      erreur('salve', `« salve » vaut ${brut.salve} : ${SALVE_MAX} au plus.`, `La salve ne peut pas dépasser ${SALVE_MAX}.`);
    } else {
      salve = brut.salve;
    }
  }

  const resume = lireTexte('resume', { obligatoire: true, aide: 'Résumez le changement en une phrase.' });

  // changements : 1 à 4 points
  let changements = [];
  const AIDE_CHANGEMENTS = 'Indiquez au moins un point concret.';
  if (brut.changements === undefined || brut.changements === null || brut.changements === '') {
    erreur('changements', 'il manque le champ « changements » (1 à 4 points).', AIDE_CHANGEMENTS);
  } else if (typeof brut.changements === 'string' && !manuelle) {
    remarque('changements', '« changements » doit être une liste de points entre crochets [ ].');
    changements = [brut.changements.trim()].filter(Boolean);
  } else if (Array.isArray(brut.changements)) {
    if (brut.changements.some((point) => typeof point !== 'string')) {
      erreur('changements', 'chaque point de « changements » doit être un texte entre guillemets.', 'Chaque point doit être un texte.');
    } else {
      changements = brut.changements.map((point) => point.replace(/\r\n?/g, '\n').trim()).filter(Boolean);
      if (changements.length < brut.changements.length && !manuelle) remarque('changements', '« changements » contient des points vides, ignorés.');
      if (manuelle) {
        for (const point of changements) limiter('changements', point, LIMITES.changement);
      }
    }
  } else {
    erreur('changements', '« changements » doit être une liste de points entre crochets [ ].', AIDE_CHANGEMENTS);
  }
  if (Array.isArray(brut.changements) || typeof brut.changements === 'string') {
    if (!changements.length && !enErreur('changements')) erreur('changements', '« changements » doit contenir au moins un point.', AIDE_CHANGEMENTS);
    if (changements.length > CHANGEMENTS_MAX) {
      if (manuelle) erreur('changements', `« changements » contient ${changements.length} points ; ${CHANGEMENTS_MAX} au plus.`, `${CHANGEMENTS_MAX} points au plus.`);
      else remarque('changements', `« changements » contient ${changements.length} points ; ${CHANGEMENTS_MAX} au plus sont conseillés.`);
    }
  }

  const pourquoi = lireTexte('pourquoi', { obligatoire: true, aide: 'Expliquez pourquoi en quelques lignes.' });

  // effets en jeu : sous-champs facultatifs
  const effets = [];
  if (brut.effets !== undefined && brut.effets !== null) {
    if (typeof brut.effets !== 'object' || Array.isArray(brut.effets)) {
      if (manuelle) erreur('effets', '« effets » doit être un objet avec lspd, doj et/ou entreprises.', 'Valeur invalide.');
      else remarque('effets', '« effets » doit être un objet avec lspd, doj et/ou entreprises. Il est ignoré.');
    } else {
      for (const cle of Object.keys(brut.effets)) {
        if (!EFFETS.some(([connu]) => connu === cle)) {
          if (manuelle) erreur('effets', `« effets » contient un sous-champ inconnu « ${cle} ».`, `Champ inconnu : « effets.${cle} ».`);
          else remarque('effets', `« effets » contient un sous-champ inconnu « ${cle} », ignoré.`);
        }
      }
      for (const [cle, libelle] of EFFETS) {
        const valeur = brut.effets[cle];
        if (valeur === undefined || valeur === null) continue;
        if (typeof valeur !== 'string') {
          if (manuelle) erreur(`effets.${cle}`, `« effets.${cle} » doit être un texte.`, 'Ce champ doit être un texte.');
          else remarque(`effets.${cle}`, `« effets.${cle} » doit être un texte. Il est ignoré.`);
        } else if (!valeur.trim()) {
          if (!manuelle) remarque(`effets.${cle}`, `« effets.${cle} » est vide : omettez-le.`);
        } else {
          const texteEffet = valeur.replace(/\r\n?/g, '\n').trim();
          limiter(`effets.${cle}`, texteEffet, LIMITES.effet);
          effets.push([cle, libelle, texteEffet]);
        }
      }
      if (!Object.keys(brut.effets).length && !manuelle) remarque('effets', '« effets » est vide : omettez-le.');
    }
  }

  // avant / après : les espaces et alinéas sont conservés tels quels
  const avant = lireTexte('avant', { garderEspaces: true });
  const apres = lireTexte('apres', { garderEspaces: true });
  if (!apres.trim() && !avant.trim() && !enErreur('apres')) {
    erreur('apres', 'il manque le champ « apres » (le texte proposé).', 'Indiquez le texte proposé. Pour une abrogation, remplissez seulement le texte actuel.');
  }

  for (const [cle, valeur] of [['avant', avant], ['apres', apres]]) {
    valeur.split('\n').forEach((ligne, n) => {
      if (RE_LIGNE_ARTICLE.test(ligne) && !RE_LIGNE_CONFORME.test(ligne)) {
        remarque(cle, `« ${cle} », ligne ${n + 1} : « ${ligne.trim().slice(0, 48)} » ne suit pas le format « Article 12 : ».`, `Ligne ${n + 1} : « ${ligne.trim().slice(0, 48)} » ne suit pas le format « Article 12 : ».`);
      }
    });
  }
  if (article && /^\s*Article\b/.test(apres)) {
    remarque('apres', '« apres » commence par « Article » alors que le champ « article » est rempli : l\'en-tête risque d\'apparaître deux fois.', 'Le texte commence par « Article » alors que l\'article est déjà indiqué : l\'en-tête risque d\'apparaître deux fois.');
  }

  const apercu = {
    id,
    titre,
    texte: texteConcerne,
    groupe: texteConcerne === 'Décret' ? 'Décrets' : texteConcerne,
    article,
    urgent,
    salve,
    resume,
    changements,
    pourquoi,
    effets,
    avant: avant.trim() ? avant : '',
    apres: apres.trim() ? apres : '',
    numero,
  };

  return { erreurs, remarques, nom, apercu, proposition: erreurs.length ? null : apercu };
}

// Forme d'une proposition vérifiée, telle qu'elle s'écrit dans contenu/propositions.json :
// champs dans l'ordre du fichier, champs vides omis, « urgent » seulement s'il est vrai.
export function formeCanonique(p) {
  const objet = {};
  if (p.id) objet.id = p.id;
  objet.titre = p.titre;
  objet.salve = p.salve;
  objet.texte = p.texte;
  if (p.article) objet.article = p.article;
  if (p.urgent) objet.urgent = true;
  objet.resume = p.resume;
  objet.changements = [...p.changements];
  objet.pourquoi = p.pourquoi;
  if (p.effets.length) objet.effets = Object.fromEntries(p.effets.map(([cle, , texte]) => [cle, texte]));
  if (p.avant) objet.avant = p.avant;
  if (p.apres) objet.apres = p.apres;
  return objet;
}

// Découpe une liste JSON mal formée en éléments de premier niveau, pour lire
// les propositions valides même si l'une d'elles est cassée.
// Renvoie null si la structure générale ([ ... ]) est elle-même illisible.
function decouperListe(texte) {
  let i = 0;
  while (i < texte.length && /\s/.test(texte[i])) i++;
  if (texte[i] !== '[') return null;

  const morceaux = [];
  let debut = i + 1;
  let profondeur = 0;
  let dansChaine = false;
  let echappe = false;

  for (let j = i + 1; j < texte.length; j++) {
    const c = texte[j];
    if (dansChaine) {
      if (echappe) echappe = false;
      else if (c === '\\') echappe = true;
      else if (c === '"') dansChaine = false;
      else if (c === '\n') dansChaine = false; // une chaîne JSON tient sur une ligne : on se resynchronise
      continue;
    }
    if (c === '"') {
      dansChaine = true;
    } else if (c === '{' || c === '[') {
      profondeur++;
    } else if (c === '}' || c === ']') {
      if (profondeur === 0) {
        if (c !== ']') return null;
        const dernier = texte.slice(debut, j);
        if (dernier.trim() || morceaux.length) morceaux.push({ texte: dernier, brut: debut, debut: debutUtile(texte, debut) });
        if (texte.slice(j + 1).trim()) return null;
        return morceaux;
      }
      profondeur--;
    } else if (c === ',' && profondeur === 0) {
      morceaux.push({ texte: texte.slice(debut, j), brut: debut, debut: debutUtile(texte, debut) });
      debut = j + 1;
    }
  }
  return null;
}

function debutUtile(texte, depuis) {
  let k = depuis;
  while (k < texte.length && /\s/.test(texte[k])) k++;
  return k;
}

function ligneDe(texte, position) {
  return texte.slice(0, position).split('\n').length;
}

// Situe une erreur JSON.parse dans le fichier : « (ligne 12, colonne 5) ».
// debutBrut : position, dans le fichier, du premier caractère du texte analysé.
function situer(texteComplet, debutBrut, err, texteAnalyse = texteComplet) {
  const message = String(err?.message ?? '');
  let decalage = null;
  const pos = message.match(/position (\d+)/i);
  const lc = message.match(/line (\d+) column (\d+)/i);
  if (pos) {
    decalage = Number(pos[1]);
  } else if (lc) {
    const lignes = texteAnalyse.split('\n');
    const ligne = Math.min(Number(lc[1]), lignes.length);
    decalage = lignes.slice(0, ligne - 1).reduce((somme, l) => somme + l.length + 1, 0) + Number(lc[2]) - 1;
  }
  if (decalage === null) {
    return debutBrut ? ` (à partir de la ligne ${ligneDe(texteComplet, debutUtile(texteComplet, debutBrut))})` : '';
  }
  const absolue = Math.min(debutBrut + decalage, texteComplet.length);
  const avant = texteComplet.slice(0, absolue);
  const ligne = avant.split('\n').length;
  const colonne = absolue - avant.lastIndexOf('\n');
  return ` (ligne ${ligne}, colonne ${colonne})`;
}
