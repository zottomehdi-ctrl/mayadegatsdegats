# Consignes pour ce dépôt

Registre des propositions du DOJ (serveur GTA RP Last Gate). Le site présente le contenu tel quel : on n'invente jamais de contenu juridique.

## Ajouter des propositions

- Modifier uniquement `contenu/propositions.json` : ajouter les nouvelles entrées à la fin de la liste, sans toucher aux autres fichiers ni aux entrées existantes, sauf demande explicite.
- Reprendre le texte fourni à l'identique : retours à la ligne, espaces, alinéas. Une chaîne par ligne dans les tableaux `texteActuel`, `textePropose` et `justification`.
- `article` contient le numéro seul (`"12"`). Dans les textes, les en-têtes d'articles s'écrivent « Article 12 : ». Signaler toute autre forme (« Article 12 - », « Art. 12 ») à l'utilisateur au lieu de la corriger en silence.
- Identifiants uniques. Ne jamais réutiliser l'identifiant d'une proposition retirée.
- Lancer `npm run verifier` avant de committer, et corriger ou signaler chaque erreur et chaque avertissement.

## Technique

- HTML, CSS et JS natifs, sans framework ni étape de build. Les décisions passent par `netlify/functions/decisions.mjs` et sont stockées dans Netlify Blobs (magasin `decisions`, une clé par identifiant).
- Direction artistique : IBM Plex Sans et IBM Plex Mono, jamais d'italique, un seul accent bleu nuit, pas de dégradés.
