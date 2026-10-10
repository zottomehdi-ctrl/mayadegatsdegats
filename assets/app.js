import { diffTextes } from './diff.js';

const STATUTS = {
  attente: { libelle: 'En attente', compteur: 'En attente' },
  validee: { libelle: 'Validée', compteur: 'Validées' },
  refusee: { libelle: 'Refusée', compteur: 'Refusées' },
  rediscuter: { libelle: 'À rediscuter', compteur: 'À rediscuter' },
};
const ORDRE_STATUTS = ['attente', 'validee', 'refusee', 'rediscuter'];
const CODES = ['Code pénal', 'Code de police', 'Code de la route', 'Code du travail', 'Code civil', 'Constitution', 'Autre'];
const GROUPES = ['Décrets', ...CODES];
const BOUTONS = {
  validee: 'Valider',
  refusee: 'Refuser',
  rediscuter: 'À rediscuter en appel',
};
const MESSAGES = {
  validee: 'proposition validée',
  refusee: 'proposition refusée',
  rediscuter: 'proposition renvoyée à rediscuter',
};
const TITRES = {
  recap: 'Récapitulatif',
  rediscuter: 'À rediscuter',
  valides: 'Textes validés',
};
const LIMITE_DISCORD = 2000;
const CLE_MODE = 'registre-doj:mode-rediscuter';
const RE_ARTICLE = /^(\s*)(Article\s+[^\s:]+(?:\s+(?:bis|ter|quater|quinquies|sexies))?\s*:)(.*)$/;

const FMT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const FMT_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

const etat = {
  propositions: [],
  decisions: {},
  doublons: [],
  chargement: true,
  erreurContenu: null,
  erreurDecisions: null,
  filtre: 'tous',
  unParUn: lireMode(),
  indexPoint: 0,
  enCours: null,
  brouillons: {},
  derniereListe: '#/',
  derniereVue: null,
};

async function demarrer() {
  window.addEventListener('hashchange', () => rendre());
  document.addEventListener('click', surClic);
  document.addEventListener('input', surSaisie);
  document.addEventListener('keydown', surTouche);
  rendre();
  await charger();
  rendre();
}

/* Données */

async function charger() {
  const [contenu, decisions] = await Promise.allSettled([
    chargerJson('/contenu/propositions.json'),
    chargerJson('/api/decisions'),
  ]);

  if (contenu.status === 'fulfilled') {
    const liste = Array.isArray(contenu.value) ? contenu.value : contenu.value?.propositions;
    if (Array.isArray(liste)) {
      etat.propositions = liste.map(normaliser);
      const vus = new Set();
      for (const p of etat.propositions) {
        if (vus.has(p.id) && !etat.doublons.includes(p.id)) etat.doublons.push(p.id);
        vus.add(p.id);
      }
    } else {
      etat.erreurContenu = 'Le fichier contenu/propositions.json doit contenir une liste de propositions entre crochets [ ].';
    }
  } else {
    etat.erreurContenu = `Impossible de lire contenu/propositions.json : ${contenu.reason.message}`;
  }

  if (decisions.status === 'fulfilled' && decisions.value && typeof decisions.value === 'object') {
    etat.decisions = decisions.value;
  } else {
    etat.erreurDecisions = "Les décisions n'ont pas pu être chargées et ne peuvent pas être enregistrées. Le site doit être servi par Netlify, ou par « netlify dev » en local.";
  }

  etat.chargement = false;
}

async function chargerJson(url) {
  const reponse = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!reponse.ok) throw new Error(`erreur ${reponse.status}`);
  const brut = await reponse.text();
  try {
    return JSON.parse(brut);
  } catch (err) {
    throw new Error(`le fichier n'est pas un JSON valide (${err.message})`);
  }
}

function normaliser(brut, index) {
  const type = /^d[ée]cret$/i.test(String(brut.type ?? '').trim()) ? 'Décret' : 'Amendement';
  const codeSaisi = String(brut.code ?? '').trim().toLowerCase();
  const code = type === 'Décret' ? null : (CODES.find((c) => c.toLowerCase() === codeSaisi) ?? 'Autre');
  return {
    id: String(brut.id ?? '').trim() || `SANS-ID-${index + 1}`,
    type,
    code,
    groupe: type === 'Décret' ? 'Décrets' : code,
    titre: String(brut.titre ?? '').trim() || 'Sans titre',
    article: normaliserArticle(brut.article),
    texteActuel: lireTexte(brut.texteActuel),
    textePropose: lireTexte(brut.textePropose),
    justification: lireTexte(brut.justification),
    urgente: String(brut.priorite ?? '').trim().toLowerCase() === 'urgente',
    ordre: index,
  };
}

// Un texte peut être une chaîne ou une liste de lignes (plus lisible dans le JSON).
function lireTexte(valeur) {
  if (Array.isArray(valeur)) return valeur.map((ligne) => String(ligne ?? '')).join('\n');
  if (typeof valeur === 'string') return valeur.replace(/\r\n?/g, '\n');
  return '';
}

// « 12 », « Article 12 », « Art. 12 - » deviennent tous « Article 12 : ».
function normaliserArticle(valeur) {
  if (valeur === undefined || valeur === null) return '';
  const numero = String(valeur)
    .trim()
    .replace(/^art(?:icle|\.)?\s*/i, '')
    .replace(/\s*[:.\-–—]+\s*$/, '')
    .trim();
  return numero ? `Article ${numero} :` : '';
}

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
      return horodatage(da.renvoyeLe ?? da.date) - horodatage(db.renvoyeLe ?? db.date) || a.ordre - b.ordre;
    });
}

function grouper(liste) {
  const groupes = new Map(GROUPES.map((nom) => [nom, []]));
  for (const p of liste) groupes.get(p.groupe).push(p);
  return [...groupes].filter(([, items]) => items.length > 0);
}

/* Rendu */

function lireRoute() {
  const morceaux = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (morceaux[0] === 'rediscuter') return { vue: 'rediscuter' };
  if (morceaux[0] === 'valides') return { vue: 'valides' };
  if (morceaux[0] === 'proposition' && morceaux[1]) {
    let id = morceaux[1];
    try { id = decodeURIComponent(id); } catch { /* identifiant laissé tel quel */ }
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
  if (etat.erreurContenu) {
    contenu = vueErreur();
    titre = 'Erreur';
  } else if (route.vue === 'rediscuter') {
    contenu = vueRediscuter();
  } else if (route.vue === 'valides') {
    contenu = vueValides();
  } else if (route.vue === 'detail') {
    const p = trouver(route.id);
    contenu = vueDetail(route.id);
    titre = p ? `${p.id} · ${p.titre}` : 'Proposition introuvable';
  } else {
    contenu = vueRecap();
  }

  const focus = cleFocus(document.activeElement);
  const app = document.getElementById('app');
  app.innerHTML = `<div class="${nouvelleVue ? 'apparition' : ''}">${bandeaux()}${contenu}</div>`;
  document.title = `${titre} · Registre des propositions`;

  if (focus) document.querySelector(focus)?.focus({ preventScroll: true });
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
  document.getElementById('compte-rediscuter').textContent = compte ? String(compte) : '';
}

function bandeaux() {
  const messages = [];
  if (etat.erreurDecisions) messages.push(etat.erreurDecisions);
  if (etat.doublons.length) {
    messages.push(`Identifiants en double dans contenu/propositions.json : ${etat.doublons.join(', ')}. Chaque proposition doit avoir un identifiant unique.`);
  }
  return messages.map((m) => `<p class="bandeau" role="alert">${esc(m)}</p>`).join('');
}

function vueErreur() {
  return `
    <header class="page-tete"><h1>Registre indisponible</h1></header>
    ${vide(esc(etat.erreurContenu), 'Corrigez le fichier puis rechargez la page.')}`;
}

/* Récapitulatif */

function vueRecap() {
  const total = etat.propositions.length;
  const comptes = Object.fromEntries(ORDRE_STATUTS.map((s) => [s, 0]));
  for (const p of etat.propositions) comptes[statutDe(p.id)]++;

  const filtre = etat.filtre;
  const visibles = filtre === 'tous' ? etat.propositions : etat.propositions.filter((p) => statutDe(p.id) === filtre);

  const compteur = (cle, libelle, nombre) => `
    <button type="button" class="compteur ${cle === 'tous' ? 'compteur--tous' : `st-${cle}`}" data-action="filtre" data-statut="${cle}" aria-pressed="${filtre === cle}">
      <span class="compteur-libelle">${cle === 'tous' ? '' : '<span class="puce" aria-hidden="true"></span>'}${libelle}</span>
      <span class="compteur-nombre">${nombre}</span>
    </button>`;

  let liste;
  if (total === 0) {
    liste = vide('Aucune proposition pour le moment.', 'Les propositions se trouvent dans contenu/propositions.json.');
  } else if (visibles.length === 0) {
    liste = vide(`Aucune proposition avec le statut « ${STATUTS[filtre].libelle} ».`);
  } else {
    liste = grouper(visibles).map(([nom, items]) => `
      <section class="groupe" aria-labelledby="groupe-${slug(nom)}">
        <h2 class="groupe-titre" id="groupe-${slug(nom)}">${esc(nom)} <span class="groupe-compte">${items.length}</span></h2>
        <ul class="liste">
          ${items.map((p) => `
          <li>
            <a class="ligne" href="${lienFiche(p.id)}">
              <span class="ligne-id">${esc(p.id)}</span>
              <span class="ligne-titre">${esc(p.titre)}</span>
              ${priorite(p)}
              ${pastille(statutDe(p.id))}
            </a>
          </li>`).join('')}
        </ul>
      </section>`).join('');
  }

  return `
    <header class="page-tete">
      <h1>Récapitulatif</h1>
      <p class="chapo">Toutes les propositions soumises, groupées par code. Cliquez sur un compteur pour filtrer la liste par statut.</p>
    </header>
    <div class="compteurs" role="group" aria-label="Filtrer par statut">
      ${compteur('tous', 'Toutes', total)}
      ${ORDRE_STATUTS.map((s) => compteur(s, STATUTS[s].compteur, comptes[s])).join('')}
    </div>
    ${liste}`;
}

/* Fiche d'une proposition */

function vueDetail(id) {
  const p = trouver(id);
  if (!p) return `${lienRetour()}${vide(`Aucune proposition ne porte l'identifiant ${esc(id)}.`)}`;
  return `
    <article>
      ${lienRetour()}
      <header>
        <div class="meta">
          <span class="id">${esc(p.id)}</span>
          <span>${esc(libelleType(p))}</span>
          ${priorite(p)}
          ${pastille(statutDe(p.id))}
        </div>
        <h1 class="fiche-titre">${esc(p.titre)}</h1>
      </header>
      ${blocTexte(p, 2)}
      ${blocJustification(p, 2)}
      ${blocDecision(p)}
      ${blocHistorique(p)}
    </article>`;
}

function lienRetour() {
  const libelles = { '#/rediscuter': 'À rediscuter', '#/valides': 'Textes validés' };
  const libelle = libelles[etat.derniereListe] ?? 'Récapitulatif';
  return `<a class="retour" href="${esc(etat.derniereListe)}"><span aria-hidden="true">←</span> ${libelle}</a>`;
}

function blocTexte(p, niveau) {
  const h = `h${niveau}`;
  const hc = `h${niveau + 1}`;
  const article = p.article ? `<span class="article">${esc(p.article)}</span>` : '';

  if (p.texteActuel) {
    const { avant, apres } = diffHtml(p.texteActuel, p.textePropose);
    const titre = p.textePropose ? 'Modification' : 'Abrogation';
    const droite = p.textePropose
      ? `<div class="corps">${apres}</div>`
      : `<p class="abroge">${p.article ? "L'article est abrogé." : 'Le texte est abrogé.'}</p>`;
    return `
      <section class="bloc">
        <div class="texte-tete">
          <div class="texte-tete-gauche"><${h} class="bloc-titre">${titre}</${h}>${article}</div>
          <p class="legende" aria-hidden="true"><del>Supprimé</del><ins>Ajouté</ins></p>
        </div>
        <div class="comparaison">
          <div class="colonne">
            <${hc} class="colonne-titre">Texte actuel</${hc}>
            <div class="corps">${avant}</div>
          </div>
          <div class="colonne">
            <${hc} class="colonne-titre">Texte proposé</${hc}>
            ${droite}
          </div>
        </div>
      </section>`;
  }

  const titre = p.type === 'Décret' ? 'Texte du décret' : (p.article ? 'Nouvel article' : 'Texte proposé');
  return `
    <section class="bloc">
      <div class="texte-tete">
        <div class="texte-tete-gauche"><${h} class="bloc-titre">${titre}</${h}>${article}</div>
      </div>
      <div class="feuille"><div class="corps">${corpsHtml(p.textePropose)}</div></div>
    </section>`;
}

function blocJustification(p, niveau) {
  if (!p.justification) return '';
  return `
    <section class="bloc">
      <h${niveau} class="bloc-titre">Justification</h${niveau}>
      <p class="prose">${esc(p.justification)}</p>
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
      <h2 class="bloc-titre" id="titre-decision">Décision</h2>
      <p class="decision-etat">${situation}</p>
      ${commentaire}
      ${champCommentaire(p.id)}
      <div class="boutons">
        ${['validee', 'refusee', 'rediscuter'].map((s) => boutonDecision(p.id, s, statut === s)).join('')}
      </div>
      <p class="aide">Refuser vaut refus catégorique. « À rediscuter en appel » place la proposition dans la section dédiée. La décision reste modifiable.</p>
    </section>`;
}

function champCommentaire(id) {
  const champ = `commentaire-${slug(id)}`;
  return `
    <label class="champ-label" for="${champ}">Commentaire (facultatif)</label>
    <textarea class="champ" id="${champ}" data-brouillon="${esc(id)}" rows="3" maxlength="2000">${esc(etat.brouillons[id] ?? '')}</textarea>`;
}

function boutonDecision(id, statut, actif) {
  const bloque = Boolean(etat.erreurDecisions || etat.enCours);
  return `<button type="button" class="btn-decision st-${statut}" data-action="decider" data-id="${esc(id)}" data-statut="${statut}" aria-pressed="${actif}"${bloque ? ' disabled' : ''}>${BOUTONS[statut]}</button>`;
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

  if (total === 0) {
    return tete + vide('Aucun point à rediscuter. Tout a été tranché.', '<a class="btn" href="#/">Voir le récapitulatif</a>');
  }

  etat.indexPoint = Math.min(Math.max(etat.indexPoint, 0), total - 1);
  const pager = etat.unParUn ? `
      <div class="pager">
        <button type="button" class="btn" data-action="precedent"${etat.indexPoint === 0 ? ' disabled' : ''}><span aria-hidden="true">←</span> Précédent</button>
        <span class="pager-pos">${etat.indexPoint + 1} sur ${total}</span>
        <button type="button" class="btn btn--plein" data-action="suivant"${etat.indexPoint >= total - 1 ? ' disabled' : ''}>Suivant <span aria-hidden="true">→</span></button>
      </div>` : '';

  const barre = `
    <div class="barre-mode${etat.unParUn ? ' barre-mode--collante' : ''}">
      <div class="segment" role="group" aria-label="Affichage">
        <button type="button" data-action="mode" data-mode="liste" aria-pressed="${!etat.unParUn}">Tous les points</button>
        <button type="button" data-action="mode" data-mode="unparun" aria-pressed="${etat.unParUn}">Un point à la fois</button>
      </div>
      ${pager}
    </div>`;

  const affiches = etat.unParUn
    ? [[points[etat.indexPoint], etat.indexPoint]]
    : points.map((p, i) => [p, i]);

  return tete + barre + affiches.map(([p, i]) => cartePoint(p, i)).join('');
}

function cartePoint(p, index) {
  const decision = decisionDe(p.id);
  const commentaire = decision?.commentaire
    ? `<div class="commentaire-fondatrice">
        <p class="commentaire-fondatrice-titre">Commentaire de la fondatrice</p>
        <p class="commentaire-fondatrice-texte">${esc(decision.commentaire)}</p>
      </div>`
    : `<div class="commentaire-fondatrice commentaire-fondatrice--vide">
        <p class="commentaire-fondatrice-titre">Commentaire de la fondatrice</p>
        <p class="commentaire-fondatrice-texte">Aucun commentaire n'accompagne ce renvoi.</p>
      </div>`;

  return `
    <article class="point" data-point="${esc(p.id)}" aria-labelledby="point-${slug(p.id)}">
      <header class="point-tete">
        <span class="point-num" aria-hidden="true">${index + 1}</span>
        <div>
          <div class="meta">
            <a class="id" href="${lienFiche(p.id)}">${esc(p.id)}</a>
            <span>${esc(libelleType(p))}</span>
            ${priorite(p)}
          </div>
          <h2 class="point-titre" id="point-${slug(p.id)}"><a href="${lienFiche(p.id)}">${esc(p.titre)}</a></h2>
          <p class="point-date">Renvoyée le ${dateHeure(decision.renvoyeLe ?? decision.date)}</p>
        </div>
      </header>
      ${commentaire}
      ${blocTexte(p, 3)}
      ${blocJustification(p, 3)}
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
    .sort((a, b) => horodatage(decisionDe(a.id).date) - horodatage(decisionDe(b.id).date) || a.ordre - b.ordre);

  const tete = `
    <header class="page-tete">
      <h1>Textes validés</h1>
      <p class="chapo">Les propositions validées, classées par code puis par date de validation.</p>
    </header>`;

  if (!valides.length) return tete + vide('Aucun texte validé pour le moment.');

  return tete + grouper(valides).map(([nom, items]) => `
    <section class="groupe" aria-labelledby="valides-${slug(nom)}">
      <h2 class="groupe-titre" id="valides-${slug(nom)}">${esc(nom)} <span class="groupe-compte">${items.length}</span></h2>
      ${items.map(carteValide).join('')}
    </section>`).join('');
}

function carteValide(p) {
  const decision = decisionDe(p.id);
  const longueur = [...texteDiscord(p)].length;
  const article = p.article ? `<strong class="corps-article">${esc(p.article)}</strong>\n` : '';
  const texte = p.textePropose
    ? corpsHtml(p.textePropose)
    : `<span class="abroge">${p.article ? "L'article est abrogé." : 'Le texte est abrogé.'}</span>`;
  const alerte = longueur > LIMITE_DISCORD
    ? `<p class="alerte-discord">Ce texte fait ${longueur.toLocaleString('fr-FR')} caractères une fois mis en forme. Discord limite un message à 2 000 caractères (4 000 avec Nitro) : il faudra le publier en plusieurs messages.</p>`
    : '';

  return `
    <article class="valide">
      <div class="valide-tete">
        <div>
          <div class="meta">
            <a class="id" href="${lienFiche(p.id)}">${esc(p.id)}</a>
            <span>${esc(libelleType(p))}</span>
            <span>Validée le ${dateLongue(decision.date)}</span>
          </div>
          <h3 class="valide-titre">${esc(p.titre)}</h3>
        </div>
        <button type="button" class="btn" data-action="copier" data-id="${esc(p.id)}">Copier le texte</button>
      </div>
      <div class="corps">${article}${texte}</div>
      ${alerte}
    </article>`;
}

// Rendu Discord : titre en gras, en-têtes d'articles en gras, mise en forme du texte conservée.
function texteDiscord(p) {
  const decision = decisionDe(p.id);
  const lignes = [
    `**${echapperDiscord(p.titre)}**`,
    `${libelleType(p)} · ${echapperDiscord(p.id)}`,
    '',
  ];
  if (p.article) lignes.push(`**${p.article}**`);
  lignes.push(p.textePropose
    ? formaterDiscord(p.textePropose)
    : (p.article ? "L'article est abrogé." : 'Le texte est abrogé.'));
  if (decision?.date) lignes.push('', `-# Texte validé le ${dateLongue(decision.date)}`);
  return lignes.join('\n');
}

// Neutralise la syntaxe Markdown de Discord pour que le texte s'affiche tel quel.
function echapperDiscord(texte) {
  return texte
    .split('\n')
    .map((ligne) => ligne
      .replace(/[\\*_~`|]/g, '\\$&')
      .replace(/@(everyone|here)/g, '@​$1')
      .replace(/^(\s*)(#{1,3}\s|-#\s|>|[-+]\s|\d+[.)]\s)/, '$1\\$2'))
    .join('\n');
}

function formaterDiscord(texte) {
  return echapperDiscord(texte)
    .split('\n')
    .map((ligne) => {
      const m = ligne.match(RE_ARTICLE);
      return m ? `${m[1]}**${m[2]}**${m[3]}` : ligne;
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
    annoncer("La copie a échoué. Sélectionnez le texte manuellement.", true);
    return;
  }
  bouton.textContent = 'Texte copié';
  clearTimeout(bouton.minuteur);
  bouton.minuteur = setTimeout(() => { bouton.textContent = 'Copier le texte'; }, 2000);
  annoncer('Texte copié, prêt à coller sur Discord.');
}

/* Décisions */

async function decider(id, statut) {
  if (etat.enCours || etat.erreurDecisions) return;
  const vue = lireRoute().vue;
  const commentaire = (etat.brouillons[id] ?? '').trim();
  etat.enCours = id;
  document.querySelectorAll('[data-action="decider"]').forEach((b) => { b.disabled = true; });

  try {
    const reponse = await fetch('/api/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, statut, commentaire }),
    });
    const corps = await reponse.json().catch(() => null);
    if (!reponse.ok || !corps) throw new Error(corps?.erreur ?? `erreur ${reponse.status}`);
    if (vue === 'rediscuter' && statut !== 'rediscuter') await faireSortir(id);
    etat.decisions[id] = corps;
    delete etat.brouillons[id];
    annoncer(`${id} : ${MESSAGES[statut]}.`);
  } catch (err) {
    annoncer(`La décision n'a pas été enregistrée : ${err.message}`, true);
  } finally {
    etat.enCours = null;
    rendre({ garderPosition: true });
  }
}

function faireSortir(id) {
  const carte = document.querySelector(`[data-point="${CSS.escape(id)}"]`);
  if (!carte || matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
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

/* Événements */

function surClic(e) {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const { action } = el.dataset;
  if (action === 'filtre') {
    etat.filtre = el.dataset.statut;
    rendre({ garderPosition: true });
  } else if (action === 'decider') {
    decider(el.dataset.id, el.dataset.statut);
  } else if (action === 'mode') {
    etat.unParUn = el.dataset.mode === 'unparun';
    ecrireMode(etat.unParUn);
    rendre({ garderPosition: true });
  } else if (action === 'precedent') {
    changerPoint(-1);
  } else if (action === 'suivant') {
    changerPoint(1);
  } else if (action === 'copier') {
    copier(el.dataset.id, el);
  }
}

function surSaisie(e) {
  const champ = e.target.closest?.('[data-brouillon]');
  if (champ) etat.brouillons[champ.dataset.brouillon] = champ.value;
}

function surTouche(e) {
  if (lireRoute().vue !== 'rediscuter' || !etat.unParUn) return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.target.closest?.('textarea, input, select, [contenteditable="true"]')) return;
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    changerPoint(1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    changerPoint(-1);
  }
}

let minuteurToast;
function annoncer(message, erreur = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.toggle('toast--erreur', erreur);
  toast.classList.add('toast--visible');
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => toast.classList.remove('toast--visible'), erreur ? 5000 : 2600);
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
    .map((ligne) => {
      const m = ligne.match(RE_ARTICLE);
      return m ? `${esc(m[1])}<strong class="corps-article">${esc(m[2])}</strong>${esc(m[3])}` : esc(ligne);
    })
    .join('\n');
}

function libelleType(p) {
  if (p.type === 'Décret') return 'Décret';
  if (p.code === 'Constitution') return 'Amendement à la Constitution';
  if (p.code === 'Autre') return 'Amendement';
  return `Amendement au ${p.code}`;
}

function pastille(statut) {
  return `<span class="pastille st-${statut}">${STATUTS[statut].libelle}</span>`;
}

function priorite(p) {
  return p.urgente ? '<span class="prio prio--urgente">Urgente</span>' : '<span class="prio">Normale</span>';
}

function vide(message, suite = '') {
  return `<div class="vide"><p>${message}</p>${suite ? `<p>${suite}</p>` : ''}</div>`;
}

function cleFocus(el) {
  const cible = el?.closest?.('[data-action]');
  if (!cible) return null;
  const { action, statut, mode, id } = cible.dataset;
  let selecteur = `[data-action="${action}"]`;
  if (statut) selecteur += `[data-statut="${statut}"]`;
  if (mode) selecteur += `[data-mode="${mode}"]`;
  if (id) selecteur += `[data-id="${CSS.escape(id)}"]`;
  return selecteur;
}

function lienFiche(id) {
  return `#/proposition/${encodeURIComponent(id)}`;
}

function slug(texte) {
  return String(texte)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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

function lireMode() {
  try {
    return localStorage.getItem(CLE_MODE) === 'unparun';
  } catch {
    return false;
  }
}

function ecrireMode(unParUn) {
  try {
    localStorage.setItem(CLE_MODE, unParUn ? 'unparun' : 'liste');
  } catch {
    /* préférence non mémorisée */
  }
}

demarrer();
