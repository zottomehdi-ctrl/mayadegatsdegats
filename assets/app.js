import { diffTextes } from './diff.js';
import { analyserRegistre, sansAccents } from './registre.js';

const STATUTS = {
  attente: { libelle: 'En attente', compteur: 'En attente' },
  validee: { libelle: 'Validée', compteur: 'Validées' },
  refusee: { libelle: 'Refusée', compteur: 'Refusées' },
  rediscuter: { libelle: 'À rediscuter', compteur: 'À rediscuter' },
};
const ORDRE_STATUTS = ['attente', 'validee', 'refusee', 'rediscuter'];
const GROUPES = ['Code pénal', 'Code de police', 'Code de la route', 'Code du travail', 'Code civil', 'Code électoral', 'Constitution', 'Décrets', 'Autre'];

const DECISIONS = {
  validee: {
    libelle: 'Valider la proposition',
    message: 'proposition validée',
    aide: "Le texte est adopté et rejoint « Textes validés », prêt à être publié. Vous pourrez changer d'avis.",
  },
  refusee: {
    libelle: 'Refuser définitivement',
    message: 'proposition refusée',
    aide: "Refus catégorique : la proposition est écartée et ne repasse pas en appel. Vous pourrez changer d'avis.",
  },
  rediscuter: {
    libelle: 'À rediscuter en appel',
    message: 'proposition renvoyée en appel',
    aide: 'La proposition est mise de côté pour le prochain appel, avec votre commentaire. Elle apparaît dans « À rediscuter ».',
  },
};

const PALETTES = [
  { cle: 'bleu-nuit', nom: 'Bleu nuit', mode: 'clair' },
  { cle: 'bordeaux-ivoire', nom: 'Bordeaux & ivoire', mode: 'clair' },
  { cle: 'vert-sapin', nom: 'Vert sapin', mode: 'clair' },
  { cle: 'ardoise', nom: 'Ardoise', mode: 'clair' },
  { cle: 'bleu-petrole', nom: 'Bleu pétrole', mode: 'clair' },
  { cle: 'sable-brun', nom: 'Sable & brun', mode: 'clair' },
  { cle: 'prune', nom: 'Prune', mode: 'clair' },
  { cle: 'terracotta', nom: 'Terracotta', mode: 'clair' },
  { cle: 'graphite', nom: 'Graphite', mode: 'sombre' },
  { cle: 'nuit-marine', nom: 'Nuit marine', mode: 'sombre' },
  { cle: 'anthracite-or', nom: 'Anthracite & or pâle', mode: 'sombre' },
  { cle: 'bordeaux-nocturne', nom: 'Bordeaux nocturne', mode: 'sombre' },
];
const PALETTE_DEFAUT = 'bleu-nuit';
const PALETTES_AUTO = { clair: 'bleu-nuit', sombre: 'nuit-marine' };

const CLES = {
  palette: 'liaison-maya:palette',
  mode: 'liaison-maya:mode-rediscuter',
  vues: 'liaison-maya:vues',
  accueil: 'liaison-maya:accueil-ferme',
};

const TITRES = {
  recap: 'Récapitulatif',
  rediscuter: 'À rediscuter',
  valides: 'Textes validés',
};

const DELAI_ANNULATION = 5000;
const LIMITE_DISCORD = 2000;
const RE_ARTICLE = /^(\s*)(Article\s+[^\s:]+(?:\s+(?:bis|ter|quater|quinquies|sexies))?\s*:)(.*)$/;

const svg = (contenu) => `<svg class="icone" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${contenu}</svg>`;
const ICONES = {
  attente: svg('<circle cx="8" cy="8" r="5.75"/><path d="M8 5.2V8l1.9 1.3"/>'),
  validee: svg('<path d="M3.4 8.4l3.1 3 6.1-6.6"/>'),
  refusee: svg('<path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8"/>'),
  rediscuter: svg('<path d="M6 3.8L3.4 6.4 6 9"/><path d="M3.6 6.4h6.1a2.9 2.9 0 0 1 0 5.8H7.2"/>'),
  recherche: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4l3.1 3.1"/>'),
  fermer: svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>'),
  alerte: svg('<circle cx="8" cy="8" r="5.75"/><path d="M8 5v3.4M8 10.8v.1"/>'),
  coche: svg('<path d="M3.4 8.4l3.1 3 6.1-6.6"/>'),
};

const FMT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const FMT_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

const schemaSombre = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

const etat = {
  propositions: [],
  decisions: {},
  erreurs: [],
  remarques: [],
  fatal: false,
  chargement: true,
  erreurDecisions: null,
  filtre: 'tous',
  recherche: '',
  unParUn: lire(CLES.mode) === 'unparun',
  indexPoint: 0,
  seance: new Set(),
  enCours: null,
  brouillons: {},
  derniereListe: '#/',
  derniereVue: null,
  vues: lireVues(),
  accueil: lire(CLES.accueil) !== '1',
  palette: lirePalette(),
};

const toast = { minuteur: null, annuler: null };

/* Démarrage */

async function demarrer() {
  window.addEventListener('hashchange', () => rendre());
  document.addEventListener('click', surClic);
  document.addEventListener('input', surSaisie);
  document.addEventListener('keydown', surTouche);
  initialiserPalettes();
  rendre();
  await charger();
  rendre();
}

async function charger() {
  const [contenu, decisions] = await Promise.allSettled([
    chargerTexte('contenu/propositions.json'),
    chargerJson('/api/decisions'),
  ]);

  if (contenu.status === 'fulfilled') {
    const resultat = analyserRegistre(contenu.value);
    etat.propositions = resultat.propositions.map((p) => ({
      ...p,
      recherche: sansAccents(`${p.titre} ${p.article} ${p.texte} ${p.groupe}`),
    }));
    etat.erreurs = resultat.erreurs;
    etat.remarques = resultat.remarques;
    etat.fatal = resultat.fatal;
  } else {
    etat.erreurs = [`Impossible de lire contenu/propositions.json : ${contenu.reason.message}.`];
    etat.fatal = true;
  }

  if (decisions.status === 'fulfilled' && decisions.value && typeof decisions.value === 'object') {
    etat.decisions = decisions.value;
  } else {
    etat.erreurDecisions = "Les décisions n'ont pas pu être chargées et ne peuvent pas être enregistrées. Le site doit être servi par Netlify, ou par « netlify dev » en local.";
  }

  etat.chargement = false;
}

async function chargerTexte(url) {
  const reponse = await fetch(url, { cache: 'no-store' });
  if (!reponse.ok) throw new Error(`erreur ${reponse.status}`);
  return reponse.text();
}

async function chargerJson(url) {
  const reponse = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!reponse.ok) throw new Error(`erreur ${reponse.status}`);
  return reponse.json();
}

/* Données */

const trouver = (id) => etat.propositions.find((p) => p.id === id);
const decisionDe = (id) => etat.decisions[id] ?? null;

function statutDe(id) {
  const statut = decisionDe(id)?.statut;
  return STATUTS[statut] ? statut : 'attente';
}

function aRediscuter() {
  return etat.propositions
    .filter((p) => statutDe(p.id) === 'rediscuter')
    .sort((a, b) => {
      const da = decisionDe(a.id);
      const db = decisionDe(b.id);
      return horodatage(da.renvoyeLe ?? da.date) - horodatage(db.renvoyeLe ?? db.date) || a.numero - b.numero;
    });
}

function grouper(liste) {
  const groupes = new Map(GROUPES.map((nom) => [nom, []]));
  for (const p of liste) (groupes.get(p.groupe) ?? groupes.get('Autre')).push(p);
  return [...groupes].filter(([, items]) => items.length > 0);
}

function filtrer() {
  const termes = sansAccents(etat.recherche).split(/\s+/).filter(Boolean);
  return etat.propositions.filter((p) => (etat.filtre === 'tous' || statutDe(p.id) === etat.filtre)
    && termes.every((terme) => p.recherche.includes(terme)));
}

function estNouvelle(id) {
  return etat.vues ? !etat.vues.has(id) : false;
}

function marquerVue(id) {
  if (!etat.vues || etat.vues.has(id)) return;
  etat.vues.add(id);
  ecrire(CLES.vues, JSON.stringify([...etat.vues]));
}

/* Rendu */

function lireRoute() {
  const morceaux = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (morceaux[0] === 'rediscuter') return { vue: 'rediscuter' };
  if (morceaux[0] === 'valides') return { vue: 'valides' };
  if (morceaux[0] === 'proposition' && morceaux[1]) {
    let id = morceaux[1];
    try { id = decodeURIComponent(id); } catch { /* id laissé tel quel */ }
    return { vue: 'detail', id };
  }
  return { vue: 'recap' };
}

function rendre({ garderPosition = false } = {}) {
  const route = lireRoute();
  majNav(route.vue);
  if (etat.chargement) return;

  const cle = `${route.vue}:${route.id ?? ''}`;
  const nouvelleVue = cle !== etat.derniereVue;
  if (route.vue !== 'detail') etat.derniereListe = location.hash || '#/';

  let contenu;
  let titre = TITRES[route.vue];
  if (route.vue === 'rediscuter') {
    contenu = vueRediscuter();
  } else if (route.vue === 'valides') {
    contenu = vueValides();
  } else if (route.vue === 'detail') {
    const p = trouver(route.id);
    titre = p ? p.titre : 'Proposition introuvable';
    contenu = vueDetail(route.id);
  } else {
    contenu = vueRecap();
  }

  const focus = cleFocus(document.activeElement);
  document.getElementById('app').innerHTML = `<div class="${nouvelleVue ? 'apparition' : ''}">${bandeauAccueil()}${bandeaux()}${contenu}</div>`;
  document.title = `${titre} · Liaison Maya`;
  majRaccourcis(route);

  if (focus) {
    const element = document.querySelector(focus);
    if (element) {
      element.focus({ preventScroll: true });
      if (typeof element.setSelectionRange === 'function' && typeof element.value === 'string') {
        element.setSelectionRange(element.value.length, element.value.length);
      }
    }
  }
  if (nouvelleVue) {
    etat.derniereVue = cle;
    if (!garderPosition) window.scrollTo(0, 0);
  }
}

function majNav(vue) {
  document.querySelectorAll('.nav-lien').forEach((lien) => {
    if (lien.dataset.vue === vue) lien.setAttribute('aria-current', 'page');
    else lien.removeAttribute('aria-current');
  });
  const compte = etat.chargement ? 0 : aRediscuter().length;
  const pastilleNav = document.getElementById('compte-rediscuter');
  pastilleNav.textContent = compte ? String(compte) : '';
  if (compte) pastilleNav.setAttribute('aria-label', `${compte} ${compte > 1 ? 'points restants' : 'point restant'}`);
  else pastilleNav.removeAttribute('aria-label');
}

function majRaccourcis(route) {
  const visible = route.vue === 'rediscuter' && etat.unParUn && !etat.chargement && aRediscuter().length > 0;
  document.getElementById('raccourcis').hidden = !visible;
  document.body.classList.toggle('avec-raccourcis', visible);
}

function bandeauAccueil() {
  if (!etat.accueil) return '';
  return `
    <section class="accueil" id="accueil" aria-labelledby="accueil-titre">
      <h2 class="accueil-titre" id="accueil-titre" tabindex="-1">Bienvenue sur Liaison Maya</h2>
      <p class="accueil-sous">Trois étapes pour traiter les propositions de textes.</p>
      <ol class="etapes">
        <li class="etape">
          <span class="etape-numero" aria-hidden="true">1</span>
          <span class="etape-titre">Lire</span>
          <span class="etape-texte">Ouvrez une proposition : le résumé en une phrase, ce qui change, puis l'avant / après.</span>
        </li>
        <li class="etape">
          <span class="etape-numero" aria-hidden="true">2</span>
          <span class="etape-titre">Décider</span>
          <span class="etape-texte">Validez ou refusez, avec un commentaire si besoin. Vous pourrez toujours changer d'avis.</span>
        </li>
        <li class="etape">
          <span class="etape-numero" aria-hidden="true">3</span>
          <span class="etape-titre">Rediscuter en appel</span>
          <span class="etape-texte">Un doute ? Choisissez « À rediscuter en appel » : le point vous attend dans la section dédiée pour l'appel.</span>
        </li>
      </ol>
      <div class="accueil-pied">
        <button type="button" class="btn btn--plein" data-action="fermer-accueil">Compris</button>
      </div>
      <button type="button" class="bouton-fermer" data-action="fermer-accueil" aria-label="Fermer l'aide">${ICONES.fermer}</button>
    </section>`;
}

function bandeaux() {
  let html = '';
  if (etat.erreurDecisions) {
    html += `<p class="bandeau bandeau--erreur" role="alert"><span class="bandeau-titre">${ICONES.alerte}${esc(etat.erreurDecisions)}</span></p>`;
  }
  if (etat.erreurs.length) {
    const n = etat.erreurs.length;
    const titre = etat.fatal
      ? "Le fichier des propositions n'a pas pu être lu"
      : (n > 1 ? `${n} problèmes dans le fichier des propositions` : 'Un problème dans le fichier des propositions');
    const note = etat.fatal
      ? 'Corrigez contenu/propositions.json, puis redéployez le site.'
      : 'Les propositions valides s\'affichent normalement. Corrigez contenu/propositions.json, puis redéployez le site.';
    html += `
      <section class="bandeau bandeau--erreur" role="alert">
        <p class="bandeau-titre">${ICONES.alerte}${titre}</p>
        <ul>${etat.erreurs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
        <p class="bandeau-note">${note}</p>
      </section>`;
  }
  if (etat.remarques.length) {
    const n = etat.remarques.length;
    html += `
      <details class="bandeau bandeau--remarque">
        <summary>${n} ${n > 1 ? 'remarques' : 'remarque'} de format sur le fichier des propositions</summary>
        <ul>${etat.remarques.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      </details>`;
  }
  return html;
}

/* Récapitulatif */

function vueRecap() {
  const total = etat.propositions.length;
  const comptes = Object.fromEntries(ORDRE_STATUTS.map((s) => [s, 0]));
  for (const p of etat.propositions) comptes[statutDe(p.id)]++;
  const prioritaires = etat.propositions.filter((p) => p.urgent && statutDe(p.id) === 'attente');

  const compteur = (cle, libelle, nombre) => `
    <button type="button" class="compteur ${cle === 'tous' ? 'compteur--tous' : `st-${cle}`}" data-action="filtre" data-statut="${cle}" aria-pressed="${etat.filtre === cle}">
      <span class="compteur-libelle">${cle === 'tous' ? '' : ICONES[cle]}${libelle}</span>
      <span class="compteur-nombre">${nombre}</span>
    </button>`;

  return `
    <header class="page-tete">
      <h1>Récapitulatif</h1>
      <p class="chapo">Toutes les propositions soumises, groupées par texte. Les compteurs filtrent la liste par statut.</p>
    </header>
    <section class="priorite" aria-labelledby="titre-priorite">
      <div class="section-tete">
        <h2 id="titre-priorite">À traiter en priorité</h2>
        <span class="compte">${prioritaires.length}</span>
      </div>
      ${prioritaires.length
        ? `<ul class="liste">${prioritaires.map((p) => `<li>${ligne(p, true)}</li>`).join('')}</ul>`
        : '<p class="priorite-vide">Aucune proposition urgente en attente.</p>'}
    </section>
    <div class="compteurs" role="group" aria-label="Filtrer par statut">
      ${compteur('tous', 'Toutes', total)}
      ${ORDRE_STATUTS.map((s) => compteur(s, STATUTS[s].compteur, comptes[s])).join('')}
    </div>
    <div class="recherche" role="search">
      <label class="champ-label" for="recherche">Rechercher</label>
      <div class="recherche-champ">
        ${ICONES.recherche}
        <input type="search" id="recherche" class="champ" value="${esc(etat.recherche)}" placeholder="Titre, article ou texte (ex. Code pénal)" autocomplete="off" spellcheck="false">
      </div>
      <p class="recherche-statut" id="recherche-statut" role="status">${statutRecherche()}</p>
    </div>
    <div id="recap-liste">${listeRecap()}</div>`;
}

function statutRecherche() {
  if (!etat.recherche.trim()) return '';
  const n = filtrer().length;
  return n ? `${n} ${n > 1 ? 'résultats' : 'résultat'}` : '';
}

function listeRecap() {
  if (!etat.propositions.length) {
    return vide("Aucune proposition pour l'instant.", 'Elles apparaîtront ici dès que le fichier contenu/propositions.json en contiendra.');
  }
  const visibles = filtrer();
  if (!visibles.length) {
    if (etat.recherche.trim()) {
      const precision = etat.filtre === 'tous' ? '' : ` parmi les propositions « ${STATUTS[etat.filtre].libelle} »`;
      return vide(`Aucun résultat pour « ${esc(etat.recherche.trim())} »${precision}.`, 'La recherche porte sur le titre, l\'article et le texte concerné.', '<button type="button" class="btn" data-action="effacer-recherche">Effacer la recherche</button>');
    }
    return vide(`Aucune proposition « ${STATUTS[etat.filtre].libelle} » pour l'instant.`);
  }
  return grouper(visibles).map(([nom, items]) => `
    <section class="groupe" aria-labelledby="groupe-${slug(nom)}">
      <div class="section-tete">
        <h2 id="groupe-${slug(nom)}">${esc(nom)}</h2>
        <span class="compte">${items.length}</span>
      </div>
      <ul class="liste">${items.map((p) => `<li>${ligne(p, false)}</li>`).join('')}</ul>
    </section>`).join('');
}

function majListeRecap() {
  const liste = document.getElementById('recap-liste');
  if (liste) liste.innerHTML = listeRecap();
  const statut = document.getElementById('recherche-statut');
  if (statut) statut.textContent = statutRecherche();
}

function ligne(p, avecTexte) {
  const sous = [avecTexte ? esc(p.texte) : '', p.article ? `<span class="mono">${esc(p.article)}</span>` : '']
    .filter(Boolean)
    .join('<span class="sep" aria-hidden="true">·</span>');
  const marques = `${estNouvelle(p.id) ? badgeNouveau() : ''}${p.urgent ? badgeUrgent() : ''}`;
  return `
    <a class="ligne" href="${lienFiche(p.id)}">
      <span class="ligne-corps">
        <span class="ligne-titre">${esc(p.titre)}</span>
        ${sous ? `<span class="ligne-sous">${sous}</span>` : ''}
      </span>
      <span class="ligne-marques">${marques}</span>
      ${pastille(statutDe(p.id))}
    </a>`;
}

/* Fiche d'une proposition */

function vueDetail(id) {
  const p = trouver(id);
  if (!p) {
    return `${lienRetour()}${vide("Cette proposition n'existe pas ou a été retirée du registre.", '', `<a class="btn" href="${esc(etat.derniereListe)}">Revenir à la liste</a>`)}`;
  }
  marquerVue(p.id);
  return `
    <article class="fiche">
      ${lienRetour()}
      <header>
        <div class="meta">
          ${metaTexte(p)}
          ${p.urgent ? badgeUrgent() : ''}
          ${pastille(statutDe(p.id))}
        </div>
        <h1 class="fiche-titre">${esc(p.titre)}</h1>
      </header>
      ${blocsProposition(p, 2)}
      ${blocDecision(p)}
      ${blocHistorique(p)}
    </article>`;
}

function lienRetour() {
  const libelles = { '#/rediscuter': 'À rediscuter', '#/valides': 'Textes validés' };
  const libelle = libelles[etat.derniereListe] ?? 'Récapitulatif';
  return `<a class="retour" href="${esc(etat.derniereListe)}"><span aria-hidden="true">←</span> ${libelle}</a>`;
}

function metaTexte(p) {
  return `<span class="meta-texte">${esc(p.texte)}</span>${p.article ? `<span class="article">${esc(p.article)}</span>` : ''}`;
}

// Ordre fixe : En une phrase, Ce qui change, Pourquoi, Effet en jeu, Avant / Après.
function blocsProposition(p, niveau) {
  const h = `h${niveau}`;
  const bloc = (titre, contenu) => `
    <section class="bloc">
      <${h} class="bloc-titre">${titre}</${h}>
      <div class="bloc-contenu">${contenu}</div>
    </section>`;
  const effets = p.effets.length
    ? bloc('Effet en jeu', `<dl class="effets">${p.effets.map(([, libelle, texte]) => `<div class="effet"><dt>${libelle}</dt><dd>${esc(texte)}</dd></div>`).join('')}</dl>`)
    : '';
  return `
    <div class="blocs">
      ${bloc('En une phrase', `<p class="resume">${esc(p.resume)}</p>`)}
      ${bloc('Ce qui change', `<ul class="changements">${p.changements.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`)}
      ${bloc('Pourquoi', `<p class="prose">${esc(p.pourquoi)}</p>`)}
      ${effets}
      ${blocAvantApres(p, niveau)}
    </div>`;
}

function blocAvantApres(p, niveau) {
  const h = `h${niveau}`;
  const hc = `h${niveau + 1}`;
  const colonne = (type, titre, contenu) => `
    <div class="colonne">
      <${hc} class="colonne-titre colonne-titre--${type}">${titre}</${hc}>
      ${contenu}
    </div>`;
  const article = p.article ? `<span class="article">${esc(p.article)}</span>` : '';
  let corps;
  let legende = '<p class="legende" aria-hidden="true"><del>Supprimé</del><ins>Ajouté</ins></p>';

  if (p.avant && p.apres) {
    const { avant, apres } = diffHtml(p.avant, p.apres);
    corps = `<div class="comparaison">${colonne('avant', 'Texte actuel', `<div class="corps">${avant}</div>`)}${colonne('apres', 'Texte proposé', `<div class="corps">${apres}</div>`)}</div>`;
  } else if (p.avant) {
    const { avant } = diffHtml(p.avant, '');
    const abroge = p.article ? "L'article est abrogé." : 'Le texte est abrogé.';
    corps = `<div class="comparaison">${colonne('avant', 'Texte actuel', `<div class="corps">${avant}</div>`)}${colonne('apres', 'Texte proposé', `<p class="abroge">${abroge}</p>`)}</div>`;
  } else {
    legende = '';
    corps = `<div class="comparaison comparaison--seule">${colonne('apres', 'Texte ajouté (aucun texte actuel)', `<div class="corps">${corpsHtml(p.apres)}</div>`)}</div>`;
  }

  return `
    <section class="bloc bloc--large">
      <div class="bloc-tete">
        <div class="bloc-tete-gauche"><${h} class="bloc-titre">Avant / Après</${h}>${article}</div>
        ${legende}
      </div>
      ${corps}
    </section>`;
}

function blocDecision(p) {
  const decision = decisionDe(p.id);
  const statut = statutDe(p.id);
  const situation = decision
    ? `${pastille(statut)}<span>depuis le ${dateHeure(decision.date)}</span>`
    : `${pastille('attente')}<span>Aucune décision pour le moment</span>`;
  const commentaire = decision?.commentaire
    ? `<p class="decision-commentaire st-${statut}">${esc(decision.commentaire)}</p>`
    : '';

  return `
    <section class="decision" aria-labelledby="titre-decision">
      <h2 class="decision-titre" id="titre-decision">Votre décision</h2>
      <p class="decision-etat">${situation}</p>
      ${commentaire}
      ${champCommentaire(p.id)}
      <div class="boutons">
        ${['validee', 'refusee', 'rediscuter'].map((s) => boutonDecision(p.id, s, statut === s)).join('')}
      </div>
    </section>`;
}

function champCommentaire(id) {
  return `
    <label class="champ-label" for="commentaire-${id}">Commentaire (facultatif)</label>
    <textarea class="champ" id="commentaire-${id}" data-brouillon="${esc(id)}" rows="3" maxlength="2000" placeholder="Précisions, réserves, points à revoir">${esc(etat.brouillons[id] ?? '')}</textarea>`;
}

function boutonDecision(id, statut, actif) {
  const bloque = Boolean(etat.erreurDecisions || etat.enCours);
  const aide = `aide-${statut}-${id}`;
  return `
    <span class="choix">
      <button type="button" class="btn-decision st-${statut}" data-action="decider" data-id="${esc(id)}" data-statut="${statut}" aria-pressed="${actif}" aria-describedby="${aide}"${bloque ? ' disabled' : ''}>${ICONES[statut]}<span>${DECISIONS[statut].libelle}</span></button>
      <span class="infobulle" role="tooltip" id="${aide}">${DECISIONS[statut].aide}</span>
    </span>`;
}

function blocHistorique(p) {
  const historique = decisionDe(p.id)?.historique ?? [];
  if (!historique.length) return '';
  const entrees = [...historique].reverse().map((entree) => {
    const statut = STATUTS[entree.statut] ? entree.statut : 'attente';
    return `
      <li class="st-${statut}">
        <div class="histo-ligne">
          <time datetime="${esc(entree.date)}">${dateHeure(entree.date)}</time>
          ${pastille(statut)}
        </div>
        ${entree.commentaire ? `<p class="histo-commentaire">${esc(entree.commentaire)}</p>` : ''}
      </li>`;
  }).join('');
  return `
    <section class="historique">
      <h2 class="bloc-titre">Historique</h2>
      <ol class="histo">${entrees}</ol>
    </section>`;
}

/* À rediscuter */

function vueRediscuter() {
  const points = aRediscuter();
  points.forEach((p) => etat.seance.add(p.id));
  const seance = [...etat.seance].filter((id) => trouver(id));
  const traites = seance.filter((id) => statutDe(id) !== 'rediscuter').length;
  const total = points.length;

  const tete = `
    <header class="page-tete page-tete--scinde">
      <div>
        <h1>À rediscuter</h1>
        <p class="chapo">Les points renvoyés en appel, dans l'ordre où ils ont été renvoyés. Un point tranché quitte la liste.</p>
      </div>
      <p class="restants" aria-live="polite">
        <span class="restants-nombre">${total}</span>
        <span class="restants-libelle">${total > 1 ? 'points restants' : 'point restant'}</span>
      </p>
    </header>`;

  if (!total) {
    const bilan = traites
      ? `Vous avez tranché ${traites} ${traites > 1 ? 'points' : 'point'} pendant cette séance.`
      : 'Les propositions renvoyées en appel apparaîtront ici.';
    return tete + vide("Rien à rediscuter pour l'instant.", bilan, '<a class="btn" href="#/">Voir le récapitulatif</a>');
  }

  etat.indexPoint = Math.min(Math.max(etat.indexPoint, 0), total - 1);

  let outils = '';
  if (etat.unParUn) {
    const ratio = seance.length ? traites / seance.length : 0;
    outils = `
      <div class="progression">
        <p class="progression-texte"><strong>${traites} / ${seance.length}</strong> traités</p>
        <div class="progression-barre" role="progressbar" aria-label="Points traités" aria-valuemin="0" aria-valuemax="${seance.length}" aria-valuenow="${traites}">
          <span style="transform: scaleX(${ratio.toFixed(3)})"></span>
        </div>
      </div>
      <div class="pager">
        <button type="button" class="btn" data-action="precedent"${etat.indexPoint === 0 ? ' disabled' : ''}><span aria-hidden="true">←</span> Précédent</button>
        <span class="pager-pos">${etat.indexPoint + 1} sur ${total}</span>
        <button type="button" class="btn btn--plein" data-action="suivant"${etat.indexPoint >= total - 1 ? ' disabled' : ''}>Suivant <span aria-hidden="true">→</span></button>
      </div>`;
  }

  const barre = `
    <div class="barre-mode${etat.unParUn ? ' barre-mode--collante' : ''}">
      <div class="segment" role="group" aria-label="Affichage">
        <button type="button" data-action="mode" data-mode="liste" aria-pressed="${!etat.unParUn}">Tous les points</button>
        <button type="button" data-action="mode" data-mode="unparun" aria-pressed="${etat.unParUn}">Un point à la fois</button>
      </div>
      ${outils}
    </div>`;

  const affiches = etat.unParUn
    ? [[points[etat.indexPoint], etat.indexPoint]]
    : points.map((p, i) => [p, i]);

  return tete + barre + affiches.map(([p, i]) => cartePoint(p, i)).join('');
}

function cartePoint(p, index) {
  const decision = decisionDe(p.id);
  const nouvelle = estNouvelle(p.id);
  marquerVue(p.id);
  const commentaire = decision?.commentaire
    ? `<div class="commentaire-fondatrice">
        <p class="commentaire-fondatrice-titre">${ICONES.rediscuter}Commentaire de la fondatrice</p>
        <p class="commentaire-fondatrice-texte">${esc(decision.commentaire)}</p>
      </div>`
    : `<div class="commentaire-fondatrice commentaire-fondatrice--vide">
        <p class="commentaire-fondatrice-titre">${ICONES.rediscuter}Commentaire de la fondatrice</p>
        <p class="commentaire-fondatrice-texte">Aucun commentaire n'accompagne ce renvoi.</p>
      </div>`;

  return `
    <article class="point" data-point="${esc(p.id)}" aria-labelledby="point-${p.id}">
      <header class="point-tete">
        <span class="point-num" aria-hidden="true">${index + 1}</span>
        <div>
          <div class="meta">
            ${metaTexte(p)}
            ${nouvelle ? badgeNouveau() : ''}
            ${p.urgent ? badgeUrgent() : ''}
          </div>
          <h2 class="point-titre" id="point-${p.id}"><a href="${lienFiche(p.id)}">${esc(p.titre)}</a></h2>
          <p class="point-date">Renvoyée le ${dateHeure(decision.renvoyeLe ?? decision.date)}</p>
        </div>
      </header>
      ${commentaire}
      ${blocsProposition(p, 3)}
      <div class="point-decision">
        ${champCommentaire(p.id)}
        <div class="boutons">
          ${boutonDecision(p.id, 'validee', false)}
          ${boutonDecision(p.id, 'refusee', false)}
        </div>
      </div>
    </article>`;
}

/* Textes validés */

function vueValides() {
  const valides = etat.propositions
    .filter((p) => statutDe(p.id) === 'validee')
    .sort((a, b) => horodatage(decisionDe(a.id).date) - horodatage(decisionDe(b.id).date) || a.numero - b.numero);

  const tete = `
    <header class="page-tete">
      <h1>Textes validés</h1>
      <p class="chapo">Les propositions validées, classées par texte puis par date de validation, prêtes à coller sur Discord.</p>
    </header>`;

  if (!valides.length) {
    return tete + vide("Aucun texte validé pour l'instant.", 'Les propositions que vous validez apparaîtront ici.');
  }

  return tete + grouper(valides).map(([nom, items]) => `
    <section class="groupe" aria-labelledby="valides-${slug(nom)}">
      <div class="section-tete">
        <h2 id="valides-${slug(nom)}">${esc(nom)}</h2>
        <span class="compte">${items.length}</span>
      </div>
      ${items.map(carteValide).join('')}
    </section>`).join('');
}

function carteValide(p) {
  const decision = decisionDe(p.id);
  const longueur = [...texteDiscord(p)].length;
  const article = p.article ? `<strong class="corps-article">${esc(p.article)}</strong>\n` : '';
  const texte = p.apres
    ? corpsHtml(p.apres)
    : `<span class="abroge">${p.article ? "L'article est abrogé." : 'Le texte est abrogé.'}</span>`;
  const alerte = longueur > LIMITE_DISCORD
    ? `<p class="alerte-discord">Ce texte fait ${longueur.toLocaleString('fr-FR')} caractères une fois mis en forme. Discord limite un message à 2 000 caractères (4 000 avec Nitro) : il faudra le publier en plusieurs messages.</p>`
    : '';

  return `
    <article class="valide">
      <div class="valide-tete">
        <div>
          <div class="meta">
            ${metaTexte(p)}
            <span>Validée le ${dateLongue(decision.date)}</span>
          </div>
          <h3 class="valide-titre"><a href="${lienFiche(p.id)}" class="lien-discret">${esc(p.titre)}</a></h3>
        </div>
        <button type="button" class="btn" data-action="copier" data-id="${esc(p.id)}">Copier le texte</button>
      </div>
      <div class="corps">${article}${texte}</div>
      ${alerte}
    </article>`;
}

// Rendu Discord : titre en gras, texte concerné, en-têtes d'articles en gras, mise en forme conservée.
function texteDiscord(p) {
  const decision = decisionDe(p.id);
  const lignes = [`**${echapperDiscord(p.titre)}**`, p.texte, ''];
  if (p.article) lignes.push(`**${p.article}**`);
  lignes.push(p.apres
    ? formaterDiscord(p.apres)
    : (p.article ? "L'article est abrogé." : 'Le texte est abrogé.'));
  if (decision?.date) lignes.push('', `-# Texte validé le ${dateLongue(decision.date)}`);
  return lignes.join('\n');
}

// Neutralise la syntaxe Markdown de Discord pour que le texte s'affiche tel quel.
function echapperDiscord(texte) {
  return texte
    .split('\n')
    .map((ligneTexte) => ligneTexte
      .replace(/[\\*_~`|]/g, '\\$&')
      .replace(/@(everyone|here)/g, '@​$1')
      .replace(/^(\s*)(#{1,3}\s|-#\s|>|[-+]\s|\d+[.)]\s)/, '$1\\$2'))
    .join('\n');
}

function formaterDiscord(texte) {
  return echapperDiscord(texte)
    .split('\n')
    .map((ligneTexte) => {
      const m = ligneTexte.match(RE_ARTICLE);
      return m ? `${m[1]}**${m[2]}**${m[3]}` : ligneTexte;
    })
    .join('\n');
}

async function copier(id, bouton) {
  const p = trouver(id);
  if (!p) return;
  const texte = texteDiscord(p);
  let reussi = false;
  try {
    await navigator.clipboard.writeText(texte);
    reussi = true;
  } catch {
    const zone = document.createElement('textarea');
    zone.value = texte;
    zone.setAttribute('readonly', '');
    zone.style.position = 'fixed';
    zone.style.opacity = '0';
    document.body.appendChild(zone);
    zone.select();
    try { reussi = document.execCommand('copy'); } catch { reussi = false; }
    zone.remove();
  }
  if (!reussi) {
    afficherToast('La copie a échoué. Sélectionnez le texte et copiez-le manuellement.', { erreur: true });
    return;
  }
  bouton.textContent = 'Texte copié';
  clearTimeout(bouton.minuteur);
  bouton.minuteur = setTimeout(() => { bouton.textContent = 'Copier le texte'; }, 2000);
  afficherToast('Texte copié, prêt à coller sur Discord.');
}

/* Décisions */

async function envoyer(donnees) {
  const reponse = await fetch('/api/decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(donnees),
  });
  const corps = await reponse.json().catch(() => null);
  if (!reponse.ok || !corps) throw new Error(corps?.erreur ?? `erreur ${reponse.status}`);
  return corps;
}

async function decider(id, statut) {
  if (etat.enCours || etat.erreurDecisions) return;
  const p = trouver(id);
  if (!p) return;
  const vue = lireRoute().vue;
  const commentaire = (etat.brouillons[id] ?? '').trim();
  etat.enCours = id;
  document.querySelectorAll('[data-action="decider"]').forEach((b) => { b.disabled = true; });

  try {
    const decision = await envoyer({ id, statut, commentaire });
    if (vue === 'rediscuter' && statut !== 'rediscuter') await faireSortir(id);
    etat.decisions[id] = decision;
    delete etat.brouillons[id];
    afficherToast(`« ${tronquer(p.titre)} » : ${DECISIONS[statut].message}.`, {
      annuler: () => annulerDecision(id, decision.date, commentaire),
    });
  } catch (err) {
    afficherToast(`La décision n'a pas été enregistrée : ${err.message}.`, { erreur: true });
  } finally {
    etat.enCours = null;
    rendre({ garderPosition: true });
  }
}

async function annulerDecision(id, date, commentaire) {
  if (etat.enCours) return;
  etat.enCours = id;
  try {
    const { decision } = await envoyer({ id, annuler: date });
    if (decision) etat.decisions[id] = decision;
    else delete etat.decisions[id];
    if (commentaire && !etat.brouillons[id]) etat.brouillons[id] = commentaire;
    if (lireRoute().vue === 'rediscuter' && etat.unParUn) {
      const index = aRediscuter().findIndex((p) => p.id === id);
      if (index >= 0) etat.indexPoint = index;
    }
    afficherToast('Décision annulée.');
  } catch (err) {
    afficherToast(`L'annulation a échoué : ${err.message}.`, { erreur: true });
  } finally {
    etat.enCours = null;
    rendre({ garderPosition: true });
  }
}

function faireSortir(id) {
  const carte = document.querySelector(`[data-point="${CSS.escape(id)}"]`);
  if (!carte || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  carte.classList.add('point--sortant');
  return new Promise((resolve) => { setTimeout(resolve, 220); });
}

function changerPoint(delta) {
  const total = aRediscuter().length;
  const index = Math.min(Math.max(etat.indexPoint + delta, 0), total - 1);
  if (index === etat.indexPoint) return;
  etat.indexPoint = index;
  rendre({ garderPosition: true });
  const carte = document.querySelector('.point');
  const barre = document.querySelector('.barre-mode');
  if (!carte || !barre) return;
  const haut = carte.getBoundingClientRect().top + window.scrollY - barre.offsetHeight - 16;
  if (window.scrollY > haut) window.scrollTo(0, haut);
}

/* Message de confirmation */

function afficherToast(message, { erreur = false, annuler = null } = {}) {
  const element = document.getElementById('toast');
  element.querySelector('.toast-message').textContent = message;
  element.querySelector('.toast-annuler').hidden = !annuler;
  element.classList.remove('toast--visible', 'toast--annulable');
  void element.offsetWidth; // relance l'animation du délai
  element.classList.toggle('toast--erreur', erreur);
  element.classList.toggle('toast--annulable', Boolean(annuler));
  element.classList.add('toast--visible');
  toast.annuler = annuler;
  clearTimeout(toast.minuteur);
  toast.minuteur = setTimeout(masquerToast, annuler ? DELAI_ANNULATION : (erreur ? 6000 : 2600));
}

function masquerToast() {
  clearTimeout(toast.minuteur);
  document.getElementById('toast').classList.remove('toast--visible');
  toast.annuler = null;
}

/* Palettes */

function lirePalette() {
  const valeur = lire(CLES.palette);
  return valeur === 'auto' || PALETTES.some((p) => p.cle === valeur) ? valeur : PALETTE_DEFAUT;
}

function resoudrePalette(cle) {
  if (cle === 'auto') return schemaSombre?.matches ? PALETTES_AUTO.sombre : PALETTES_AUTO.clair;
  return PALETTES.some((p) => p.cle === cle) ? cle : PALETTE_DEFAUT;
}

function poserPalette(cle) {
  const palette = resoudrePalette(cle);
  const racine = document.documentElement;
  if (racine.dataset.palette === palette) return;
  racine.dataset.palette = palette;
  const fond = getComputedStyle(racine).getPropertyValue('--bg').trim();
  if (fond) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', fond);
}

function appliquerPalette(cle) {
  etat.palette = cle;
  ecrire(CLES.palette, cle);
  poserPalette(cle);
  majCartesPalettes();
}

function majCartesPalettes() {
  document.querySelectorAll('[data-palette-choix]').forEach((carte) => {
    carte.setAttribute('aria-pressed', String(carte.dataset.paletteChoix === etat.palette));
  });
}

function initialiserPalettes() {
  document.documentElement.dataset.palette = '';
  poserPalette(etat.palette);
  schemaSombre?.addEventListener?.('change', () => {
    if (etat.palette === 'auto') {
      document.documentElement.dataset.palette = '';
      poserPalette('auto');
    }
  });

  const panneau = document.getElementById('panneau-palettes');
  panneau.addEventListener('close', () => poserPalette(etat.palette));
  panneau.addEventListener('click', (e) => {
    if (e.target === panneau) fermerPalettes();
  });
  // Survol : prévisualisation en direct ; sortie : retour à la palette appliquée.
  panneau.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const carte = e.target.closest('.carte-palette');
    if (carte) poserPalette(carte.dataset.paletteChoix);
  });
  panneau.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch') return;
    const carte = e.target.closest('.carte-palette');
    if (carte && !carte.contains(e.relatedTarget)) poserPalette(etat.palette);
  });
  panneau.addEventListener('focusin', (e) => {
    const carte = e.target.closest('.carte-palette');
    if (carte) poserPalette(carte.dataset.paletteChoix);
  });
  panneau.addEventListener('focusout', (e) => {
    const carte = e.target.closest('.carte-palette');
    if (carte && !e.relatedTarget?.closest?.('.carte-palette')) poserPalette(etat.palette);
  });
}

function ouvrirPalettes() {
  const panneau = document.getElementById('panneau-palettes');
  if (!panneau.dataset.construit) {
    panneau.innerHTML = contenuPanneau();
    panneau.dataset.construit = '1';
  }
  majCartesPalettes();
  if (typeof panneau.showModal === 'function') panneau.showModal();
  else panneau.setAttribute('open', '');
  panneau.querySelector('.carte-palette[aria-pressed="true"]')?.focus();
}

function fermerPalettes() {
  const panneau = document.getElementById('panneau-palettes');
  if (typeof panneau.close === 'function' && panneau.open) panneau.close();
  else panneau.removeAttribute('open');
  poserPalette(etat.palette);
}

function contenuPanneau() {
  const carte = (p) => `
    <button type="button" class="carte-palette" data-palette-choix="${p.cle}" aria-pressed="false">
      <span class="carte-apercus">${apercuPalette(p.cle)}</span>
      <span class="carte-pied">
        <span class="carte-pastilles" data-palette="${p.cle}" aria-hidden="true">${['--bg', '--surface', '--text', '--muted', '--accent'].map((v) => `<span style="background: var(${v})"></span>`).join('')}</span>
        <span class="carte-nom">${esc(p.nom)}</span>
        <span class="carte-active">${ICONES.coche}Active</span>
      </span>
    </button>`;
  const automatique = `
    <button type="button" class="carte-palette carte-palette--auto" data-palette-choix="auto" aria-pressed="false">
      <span class="carte-apercus">${apercuPalette(PALETTES_AUTO.clair)}${apercuPalette(PALETTES_AUTO.sombre)}</span>
      <span class="carte-pied">
        <span class="carte-nom">Automatique<span class="carte-detail">Bleu nuit ou Nuit marine, selon le réglage clair ou sombre de l'appareil</span></span>
        <span class="carte-active">${ICONES.coche}Active</span>
      </span>
    </button>`;
  return `
    <div class="panneau-tete">
      <div>
        <h2 id="titre-palettes">Palette de couleurs</h2>
        <p>Survolez une palette pour la voir sur le site, cliquez pour l'appliquer. Le choix est mémorisé sur cet appareil.</p>
      </div>
      <button type="button" class="bouton-fermer" data-action="fermer-palettes" aria-label="Fermer le panneau des palettes">${ICONES.fermer}</button>
    </div>
    <div class="panneau-corps">
      <section class="panneau-groupe" aria-labelledby="groupe-automatique">
        <h3 id="groupe-automatique">Automatique</h3>
        ${automatique}
      </section>
      <section class="panneau-groupe" aria-labelledby="groupe-clair">
        <h3 id="groupe-clair">Clair</h3>
        <div class="grille-palettes">${PALETTES.filter((p) => p.mode === 'clair').map(carte).join('')}</div>
      </section>
      <section class="panneau-groupe" aria-labelledby="groupe-sombre">
        <h3 id="groupe-sombre">Sombre</h3>
        <div class="grille-palettes">${PALETTES.filter((p) => p.mode === 'sombre').map(carte).join('')}</div>
      </section>
    </div>
    <div class="panneau-pied">
      <button type="button" class="btn btn--plein" data-action="fermer-palettes">Fermer</button>
    </div>`;
}

function apercuPalette(cle) {
  return `
    <span class="carte-apercu" data-palette="${cle}" aria-hidden="true">
      <span class="apercu-surface">
        <span class="apercu-titre">Révision des peines</span>
        <span class="apercu-texte">Le vol est puni d'une amende de 7 500 $.</span>
        <span class="apercu-bouton">Valider</span>
        <span class="apercu-statuts">${ORDRE_STATUTS.map(pastille).join('')}</span>
      </span>
    </span>`;
}

/* Événements */

function surClic(e) {
  const choix = e.target.closest('[data-palette-choix]');
  if (choix) {
    appliquerPalette(choix.dataset.paletteChoix);
    return;
  }

  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const { action } = el.dataset;

  if (action === 'filtre') {
    etat.filtre = el.dataset.statut;
    rendre({ garderPosition: true });
  } else if (action === 'effacer-recherche') {
    etat.recherche = '';
    const champ = document.getElementById('recherche');
    if (champ) {
      champ.value = '';
      champ.focus();
    }
    majListeRecap();
  } else if (action === 'decider') {
    decider(el.dataset.id, el.dataset.statut);
  } else if (action === 'mode') {
    etat.unParUn = el.dataset.mode === 'unparun';
    ecrire(CLES.mode, etat.unParUn ? 'unparun' : 'liste');
    rendre({ garderPosition: true });
  } else if (action === 'precedent') {
    changerPoint(-1);
  } else if (action === 'suivant') {
    changerPoint(1);
  } else if (action === 'copier') {
    copier(el.dataset.id, el);
  } else if (action === 'aide') {
    etat.accueil = true;
    rendre({ garderPosition: true });
    const accueil = document.getElementById('accueil');
    if (accueil) {
      const doux = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      accueil.scrollIntoView({ block: 'start', behavior: doux ? 'smooth' : 'auto' });
      document.getElementById('accueil-titre')?.focus({ preventScroll: true });
    }
  } else if (action === 'fermer-accueil') {
    etat.accueil = false;
    ecrire(CLES.accueil, '1');
    rendre({ garderPosition: true });
    document.querySelector('.bouton-aide')?.focus({ preventScroll: true });
  } else if (action === 'ouvrir-palettes') {
    ouvrirPalettes();
  } else if (action === 'fermer-palettes') {
    fermerPalettes();
  } else if (action === 'annuler-toast') {
    const annuler = toast.annuler;
    masquerToast();
    annuler?.();
  }
}

function surSaisie(e) {
  if (e.target.id === 'recherche') {
    etat.recherche = e.target.value;
    majListeRecap();
    return;
  }
  const champ = e.target.closest?.('[data-brouillon]');
  if (champ) etat.brouillons[champ.dataset.brouillon] = champ.value;
}

function surTouche(e) {
  if (document.querySelector('dialog[open]')) return;
  if (lireRoute().vue !== 'rediscuter' || !etat.unParUn || etat.chargement) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target.closest?.('textarea, input, select, [contenteditable="true"]')) return;
  const point = aRediscuter()[etat.indexPoint];
  if (!point) return;
  const touche = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (touche === 'ArrowRight') {
    e.preventDefault();
    changerPoint(1);
  } else if (touche === 'ArrowLeft') {
    e.preventDefault();
    changerPoint(-1);
  } else if ((touche === 'v' || touche === 'r') && !e.repeat) {
    e.preventDefault();
    decider(point.id, touche === 'v' ? 'validee' : 'refusee');
  }
}

/* Utilitaires */

function diffHtml(avant, apres) {
  let gauche = '';
  let droite = '';
  for (const op of diffTextes(avant, apres)) {
    if (op.type === 'egal') {
      gauche += esc(op.texte);
      droite += esc(op.texte);
    } else if (op.type === 'suppr') {
      gauche += marque('del', op.texte);
    } else {
      droite += marque('ins', op.texte);
    }
  }
  return { avant: gauche, apres: droite };
}

// Un changement qui ne porte que sur des retours à la ligne reste visible grâce au signe ¶.
function marque(balise, texte) {
  if (!/\S/.test(texte) && texte.includes('\n')) {
    return `<${balise} class="blanc"><span aria-hidden="true">¶</span>${esc(texte)}</${balise}>`;
  }
  return `<${balise}>${esc(texte)}</${balise}>`;
}

function corpsHtml(texte) {
  return texte
    .split('\n')
    .map((ligneTexte) => {
      const m = ligneTexte.match(RE_ARTICLE);
      return m ? `${esc(m[1])}<strong class="corps-article">${esc(m[2])}</strong>${esc(m[3])}` : esc(ligneTexte);
    })
    .join('\n');
}

function pastille(statut) {
  return `<span class="pastille st-${statut}">${ICONES[statut]}${STATUTS[statut].libelle}</span>`;
}

function badgeUrgent() {
  return '<span class="badge badge--urgent">Urgent</span>';
}

function badgeNouveau() {
  return '<span class="badge badge--nouveau">Nouveau</span>';
}

function vide(titre, texte = '', action = '') {
  return `<div class="vide"><p class="vide-titre">${titre}</p>${texte ? `<p>${texte}</p>` : ''}${action}</div>`;
}

function cleFocus(element) {
  if (!element || element === document.body) return null;
  if (element.id && element.closest('#app') && /^(INPUT|TEXTAREA)$/.test(element.tagName)) return `#${CSS.escape(element.id)}`;
  const cible = element.closest?.('[data-action]');
  if (!cible || !cible.closest('#app')) return null;
  const { action, statut, mode, id } = cible.dataset;
  let selecteur = `#app [data-action="${action}"]`;
  if (statut) selecteur += `[data-statut="${statut}"]`;
  if (mode) selecteur += `[data-mode="${mode}"]`;
  if (id) selecteur += `[data-id="${CSS.escape(id)}"]`;
  return selecteur;
}

function lienFiche(id) {
  return `#/proposition/${encodeURIComponent(id)}`;
}

function slug(texte) {
  return sansAccents(texte).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function tronquer(texte, longueur = 56) {
  return texte.length > longueur ? `${texte.slice(0, longueur - 1).trimEnd()}…` : texte;
}

function horodatage(iso) {
  const t = Date.parse(iso ?? '');
  return Number.isNaN(t) ? 0 : t;
}

function dateHeure(iso) {
  const t = horodatage(iso);
  return t ? FMT_DATE_HEURE.format(t) : '';
}

function dateLongue(iso) {
  const t = horodatage(iso);
  return t ? FMT_DATE.format(t) : '';
}

function esc(valeur) {
  return String(valeur ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function lire(cle) {
  try {
    return localStorage.getItem(cle);
  } catch {
    return null;
  }
}

function ecrire(cle, valeur) {
  try {
    localStorage.setItem(cle, valeur);
    return true;
  } catch {
    return false;
  }
}

function lireVues() {
  try {
    const valeur = JSON.parse(localStorage.getItem(CLES.vues) ?? '[]');
    return new Set(Array.isArray(valeur) ? valeur.filter((id) => typeof id === 'string') : []);
  } catch {
    return null;
  }
}

demarrer();
