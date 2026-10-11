// Lecture et vérification de contenu/propositions.json.
// Partagé par le site (navigateur) et par `npm run verifier` (Node).

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

const CHAMPS = ['id', 'titre', 'texte', 'article', 'urgent', 'resume', 'changements', 'pourquoi', 'effets', 'avant', 'apres'];
const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUFFIXES = '(?: (?:bis|ter|quater|quinquies|sexies))?';
const RE_ARTICLE_CONFORME = new RegExp(`^Article [^\\s:]+${SUFFIXES} :$`);
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
    .replace(/\s*[:.\-–—]+\s*$/, '')
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
    const resultat = validerProposition(valeur, numero);
    remarques.push(...resultat.remarques);
    if (resultat.erreurs.length) {
      erreurs.push(...resultat.erreurs);
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

function validerProposition(brut, numero) {
  const erreurs = [];
  const remarques = [];
  const titreBrut = brut && typeof brut === 'object' && typeof brut.titre === 'string' ? brut.titre.trim() : '';
  const nom = `Proposition n° ${numero}${titreBrut ? ` (« ${titreBrut} »)` : ''}`;
  const erreur = (message) => erreurs.push(`${nom} : ${message}`);
  const remarque = (message) => remarques.push(`${nom} : ${message}`);

  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) {
    erreur('doit être un objet entre accolades { }.');
    return { erreurs, remarques, nom };
  }

  for (const cle of Object.keys(brut)) {
    if (!CHAMPS.includes(cle)) remarque(`champ inconnu « ${cle} », ignoré.`);
    else if (brut[cle] === '') remarque(`le champ « ${cle} » est vide : omettez-le plutôt que de le laisser à "".`);
  }

  const lireTexte = (cle, { obligatoire = false, garderEspaces = false } = {}) => {
    const valeur = brut[cle];
    if (valeur === undefined || valeur === null || valeur === '') {
      if (obligatoire) erreur(`il manque le champ « ${cle} ».`);
      return '';
    }
    let chaine;
    if (typeof valeur === 'string') {
      chaine = valeur;
    } else if (Array.isArray(valeur) && valeur.every((ligne) => typeof ligne === 'string')) {
      remarque(`le champ « ${cle} » est une liste de lignes : écrivez plutôt une seule chaîne avec \\n.`);
      chaine = valeur.join('\n');
    } else {
      erreur(`le champ « ${cle} » doit être un texte entre guillemets.`);
      return '';
    }
    chaine = chaine.replace(/\r\n?/g, '\n');
    if (!garderEspaces) chaine = chaine.trim();
    if (obligatoire && !chaine.trim()) erreur(`le champ « ${cle} » est vide.`);
    return chaine;
  };

  // id : clé interne, jamais affichée
  let id = '';
  if (brut.id === undefined || brut.id === null || brut.id === '') {
    erreur('il manque le champ « id ».');
  } else if (typeof brut.id !== 'string' || !RE_SLUG.test(brut.id) || brut.id.length > LONGUEUR_ID_MAX) {
    erreur(`le champ « id » doit être un slug en minuscules, chiffres et tirets (par exemple vol-a-main-armee), de ${LONGUEUR_ID_MAX} caractères au plus.`);
  } else {
    id = brut.id;
  }

  const titre = lireTexte('titre', { obligatoire: true });

  // texte concerné
  let texteConcerne = '';
  if (brut.texte === undefined || brut.texte === null || brut.texte === '') {
    erreur(`il manque le champ « texte » (${TEXTES.join(', ')}).`);
  } else if (typeof brut.texte !== 'string') {
    erreur(`le champ « texte » doit être l'une de ces valeurs : ${TEXTES.join(', ')}.`);
  } else {
    texteConcerne = TEXTES.find((t) => t === brut.texte.trim()) ?? '';
    if (!texteConcerne) {
      const approchant = TEXTES.find((t) => sansAccents(t) === sansAccents(brut.texte.trim()));
      if (approchant) {
        texteConcerne = approchant;
        remarque(`« texte » vaut « ${brut.texte} » : écrivez exactement « ${approchant} ».`);
      } else {
        erreur(`le champ « texte » vaut « ${brut.texte} » ; valeurs possibles : ${TEXTES.join(', ')}.`);
      }
    }
  }

  // article : obligatoire sauf pour un décret
  let article = '';
  if (brut.article === undefined || brut.article === null || brut.article === '') {
    if (texteConcerne && texteConcerne !== 'Décret') erreur('il manque le champ « article » (par exemple « Article 12 : »).');
  } else if (typeof brut.article !== 'string' && typeof brut.article !== 'number') {
    erreur('le champ « article » doit être un texte, par exemple « Article 12 : ».');
  } else {
    article = normaliserArticle(brut.article);
    if (!article) {
      erreur('le champ « article » est vide.');
    } else if (!RE_ARTICLE_CONFORME.test(String(brut.article).trim())) {
      remarque(`l'article « ${brut.article} » est affiché « ${article} » : écrivez-le directement sous cette forme.`);
    }
  }

  // urgent
  if (brut.urgent !== undefined && typeof brut.urgent !== 'boolean') {
    remarque('« urgent » doit valoir true ou false, sans guillemets. La proposition est traitée comme non urgente.');
  }
  const urgent = brut.urgent === true;

  const resume = lireTexte('resume', { obligatoire: true });

  // changements : 1 à 4 points
  let changements = [];
  if (brut.changements === undefined || brut.changements === null || brut.changements === '') {
    erreur('il manque le champ « changements » (1 à 4 points).');
  } else if (typeof brut.changements === 'string') {
    remarque('« changements » doit être une liste de points entre crochets [ ].');
    changements = [brut.changements.trim()].filter(Boolean);
  } else if (Array.isArray(brut.changements)) {
    if (brut.changements.some((point) => typeof point !== 'string')) {
      erreur('chaque point de « changements » doit être un texte entre guillemets.');
    } else {
      changements = brut.changements.map((point) => point.replace(/\r\n?/g, '\n').trim()).filter(Boolean);
      if (changements.length < brut.changements.length) remarque('« changements » contient des points vides, ignorés.');
    }
  } else {
    erreur('« changements » doit être une liste de points entre crochets [ ].');
  }
  if (Array.isArray(brut.changements) || typeof brut.changements === 'string') {
    if (!changements.length && !erreurs.some((e) => e.includes('changements'))) erreur('« changements » doit contenir au moins un point.');
    if (changements.length > CHANGEMENTS_MAX) remarque(`« changements » contient ${changements.length} points ; ${CHANGEMENTS_MAX} au plus sont conseillés.`);
  }

  const pourquoi = lireTexte('pourquoi', { obligatoire: true });

  // effets en jeu : sous-champs facultatifs
  const effets = [];
  if (brut.effets !== undefined && brut.effets !== null) {
    if (typeof brut.effets !== 'object' || Array.isArray(brut.effets)) {
      remarque('« effets » doit être un objet avec lspd, doj et/ou entreprises. Il est ignoré.');
    } else {
      for (const cle of Object.keys(brut.effets)) {
        if (!EFFETS.some(([connu]) => connu === cle)) remarque(`« effets » contient un sous-champ inconnu « ${cle} », ignoré.`);
      }
      for (const [cle, libelle] of EFFETS) {
        const valeur = brut.effets[cle];
        if (valeur === undefined || valeur === null) continue;
        if (typeof valeur !== 'string') {
          remarque(`« effets.${cle} » doit être un texte. Il est ignoré.`);
        } else if (!valeur.trim()) {
          remarque(`« effets.${cle} » est vide : omettez-le.`);
        } else {
          effets.push([cle, libelle, valeur.replace(/\r\n?/g, '\n').trim()]);
        }
      }
      if (!Object.keys(brut.effets).length) remarque('« effets » est vide : omettez-le.');
    }
  }

  // avant / après : les espaces et alinéas sont conservés tels quels
  const avant = lireTexte('avant', { garderEspaces: true });
  const apres = lireTexte('apres', { garderEspaces: true });
  if (!apres.trim() && !avant.trim() && !erreurs.some((e) => e.includes('« apres »'))) {
    erreur('il manque le champ « apres » (le texte proposé).');
  }

  for (const [cle, valeur] of [['avant', avant], ['apres', apres]]) {
    valeur.split('\n').forEach((ligne, n) => {
      if (RE_LIGNE_ARTICLE.test(ligne) && !RE_LIGNE_CONFORME.test(ligne)) {
        remarque(`« ${cle} », ligne ${n + 1} : « ${ligne.trim().slice(0, 48)} » ne suit pas le format « Article 12 : ».`);
      }
    });
  }
  if (article && /^\s*Article\b/.test(apres)) {
    remarque('« apres » commence par « Article » alors que le champ « article » est rempli : l\'en-tête risque d\'apparaître deux fois.');
  }

  if (erreurs.length) return { erreurs, remarques, nom };

  return {
    erreurs,
    remarques,
    nom,
    proposition: {
      id,
      titre,
      texte: texteConcerne,
      groupe: texteConcerne === 'Décret' ? 'Décrets' : texteConcerne,
      article,
      urgent,
      resume,
      changements,
      pourquoi,
      effets,
      avant: avant.trim() ? avant : '',
      apres: apres.trim() ? apres : '',
      numero,
    },
  };
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
