// Comparaison mot à mot de deux textes, en conservant à l'identique
// les espaces, les retours à la ligne et les alinéas.
// Renvoie une liste d'opérations : { type: 'egal' | 'suppr' | 'ajout', texte }.

const RE_JETON = /\n|[^\S\n]+|[\p{L}\p{M}\p{N}]+|[^\s\p{L}\p{M}\p{N}]/gu;
const LIMITE_CELLULES = 9_000_000;

export function diffTextes(avant, apres) {
  const a = decouper(avant);
  const b = decouper(apres);
  return enOperations(aligner(absorber(enBlocs(comparer(a, b)))));
}

function decouper(texte) {
  return String(texte ?? '').replace(/\r\n?/g, '\n').match(RE_JETON) ?? [];
}

// Plus longue sous-séquence commune, après retrait du début et de la fin identiques.
function comparer(a, b) {
  let debut = 0;
  while (debut < a.length && debut < b.length && a[debut] === b[debut]) debut++;
  let finA = a.length;
  let finB = b.length;
  while (finA > debut && finB > debut && a[finA - 1] === b[finB - 1]) {
    finA--;
    finB--;
  }

  const ops = [];
  if (debut > 0) ops.push({ type: 'egal', texte: a.slice(0, debut).join('') });
  ops.push(...comparerMilieu(a.slice(debut, finA), b.slice(debut, finB)));
  if (finA < a.length) ops.push({ type: 'egal', texte: a.slice(finA).join('') });
  return ops;
}

function comparerMilieu(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return [{ type: 'ajout', texte: b.join('') }];
  if (m === 0) return [{ type: 'suppr', texte: a.join('') }];
  if ((n + 1) * (m + 1) > LIMITE_CELLULES) {
    return [
      { type: 'suppr', texte: a.join('') },
      { type: 'ajout', texte: b.join('') },
    ];
  }

  const largeur = m + 1;
  const table = new Uint16Array((n + 1) * largeur);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * largeur + j] = a[i] === b[j]
        ? table[(i + 1) * largeur + j + 1] + 1
        : Math.max(table[(i + 1) * largeur + j], table[i * largeur + j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'egal', texte: a[i] });
      i++;
      j++;
    } else if (table[(i + 1) * largeur + j] >= table[i * largeur + j + 1]) {
      ops.push({ type: 'suppr', texte: a[i] });
      i++;
    } else {
      ops.push({ type: 'ajout', texte: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'suppr', texte: a[i++] });
  while (j < m) ops.push({ type: 'ajout', texte: b[j++] });
  return ops;
}

// Regroupe les opérations en blocs : { egal } ou { suppr, ajout }.
function enBlocs(ops) {
  const blocs = [];
  for (const op of ops) {
    const dernier = blocs[blocs.length - 1];
    if (op.type === 'egal') {
      if (dernier && dernier.egal !== undefined) dernier.egal += op.texte;
      else blocs.push({ egal: op.texte });
    } else {
      if (!dernier || dernier.egal !== undefined) blocs.push({ suppr: '', ajout: '' });
      blocs[blocs.length - 1][op.type] += op.texte;
    }
  }
  return blocs;
}

// Un court passage identique coincé entre deux changements (espace, « de », virgule…)
// est intégré au changement, pour éviter un rendu haché.
function absorber(blocs) {
  let modifie = true;
  while (modifie) {
    modifie = false;
    for (let k = 1; k < blocs.length - 1; k++) {
      const avant = blocs[k - 1];
      const bloc = blocs[k];
      const apres = blocs[k + 1];
      if (bloc.egal === undefined || avant.egal !== undefined || apres.egal !== undefined) continue;
      if (!estFaible(bloc.egal, avant, apres)) continue;
      blocs.splice(k - 1, 3, {
        suppr: avant.suppr + bloc.egal + apres.suppr,
        ajout: avant.ajout + bloc.egal + apres.ajout,
      });
      modifie = true;
      break;
    }
  }
  return blocs;
}

function estFaible(texte, avant, apres) {
  if (texte.includes('\n')) return false;
  const court = texte.trim();
  if (court.length <= 3) return true;
  const taille = (bloc) => Math.max(bloc.suppr.length, bloc.ajout.length);
  return court.split(/\s+/).length <= 2 && court.length * 3 < Math.min(taille(avant), taille(apres));
}

// Fait glisser un ajout ou une suppression isolé vers les limites naturelles
// (fin de ligne, fin de phrase, espace) quand le texte le permet.
function aligner(blocs) {
  for (let k = 1; k < blocs.length - 1; k++) {
    const avant = blocs[k - 1];
    const bloc = blocs[k];
    const apres = blocs[k + 1];
    if (bloc.egal !== undefined || avant.egal === undefined || apres.egal === undefined) continue;
    if (bloc.suppr && bloc.ajout) continue;

    const cle = bloc.suppr ? 'suppr' : 'ajout';
    let gauche = avant.egal;
    let edition = bloc[cle];
    let droite = apres.egal;

    const commun = suffixeCommun(gauche, edition);
    if (commun > 0) {
      const fin = edition.slice(edition.length - commun);
      gauche = gauche.slice(0, gauche.length - commun);
      edition = fin + edition.slice(0, edition.length - commun);
      droite = fin + droite;
    }

    let meilleur = { gauche, edition, droite, note: note(gauche, edition) + note(edition, droite) };
    while (edition && droite && edition[0] === droite[0]) {
      gauche += edition[0];
      edition = edition.slice(1) + droite[0];
      droite = droite.slice(1);
      const n = note(gauche, edition) + note(edition, droite);
      if (n >= meilleur.note) meilleur = { gauche, edition, droite, note: n };
    }

    avant.egal = meilleur.gauche;
    bloc[cle] = meilleur.edition;
    apres.egal = meilleur.droite;
  }

  const nettoyes = [];
  for (const bloc of blocs) {
    if (bloc.egal === '') continue;
    const dernier = nettoyes[nettoyes.length - 1];
    if (bloc.egal === undefined && dernier && dernier.egal === undefined) {
      dernier.suppr += bloc.suppr;
      dernier.ajout += bloc.ajout;
    } else if (bloc.egal !== undefined && dernier && dernier.egal !== undefined) {
      dernier.egal += bloc.egal;
    } else {
      nettoyes.push({ ...bloc });
    }
  }
  return nettoyes;
}

function suffixeCommun(a, b) {
  const max = Math.min(a.length, b.length);
  let n = 0;
  while (n < max && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function note(gauche, droite) {
  if (!gauche || !droite) return 6;
  const c1 = gauche[gauche.length - 1];
  const c2 = droite[0];
  if (c1 === '\n' || c2 === '\n') return 5;
  if (/[.;:!?]/.test(c1) && /\s/.test(c2)) return 4;
  if (/\s/.test(c1) || /\s/.test(c2)) return 3;
  if (/[^\p{L}\p{N}]/u.test(c1) || /[^\p{L}\p{N}]/u.test(c2)) return 2;
  return 0;
}

function enOperations(blocs) {
  const ops = [];
  for (const bloc of blocs) {
    if (bloc.egal !== undefined) {
      ops.push({ type: 'egal', texte: bloc.egal });
      continue;
    }
    if (bloc.suppr) ops.push({ type: 'suppr', texte: bloc.suppr });
    if (bloc.ajout) ops.push({ type: 'ajout', texte: bloc.ajout });
  }
  return ops;
}
