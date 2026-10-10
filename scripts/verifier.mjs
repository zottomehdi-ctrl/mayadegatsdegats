// Vérifie contenu/propositions.json avant publication : npm run verifier
// Les règles sont celles du site (assets/registre.js).
import { readFileSync } from 'node:fs';
import { analyserRegistre } from '../assets/registre.js';

const FICHIER = new URL('../contenu/propositions.json', import.meta.url);

let source;
try {
  source = readFileSync(FICHIER, 'utf8');
} catch (err) {
  console.error(`ERREUR     impossible de lire contenu/propositions.json : ${err.message}`);
  process.exit(1);
}

const { propositions, erreurs, remarques } = analyserRegistre(source);

for (const message of erreurs) console.error(`ERREUR     ${message}`);
for (const message of remarques) console.warn(`REMARQUE   ${message}`);

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
console.log(
  `${pluriel(propositions.length, 'proposition')} valide${propositions.length > 1 ? 's' : ''} : `
    + `${pluriel(erreurs.length, 'erreur')}, ${pluriel(remarques.length, 'remarque')}.`,
);
process.exit(erreurs.length ? 1 : 0);
