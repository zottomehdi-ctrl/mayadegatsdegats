# Consignes pour ce dépôt

Liaison Maya : registre des propositions de textes du serveur GTA RP Last Gate. Le site présente le contenu tel quel : on n'invente jamais de contenu juridique.

## Ajouter ou modifier des propositions

- Modifier uniquement `contenu/propositions.json`, sans toucher aux autres fichiers, sauf demande explicite.
- Schéma : `id`, `titre`, `texte`, `article`, `urgent`, `salve`, `resume`, `changements`, `pourquoi`, `effets` (`lspd`, `doj`, `entreprises`), `avant`, `apres`. Le détail des champs obligatoires et des valeurs autorisées est dans le README et dans `assets/registre.js`.
- `id` : slug en minuscules, chiffres et tirets, unique. Ne jamais modifier l'`id` d'une proposition existante ni réutiliser celui d'une proposition retirée : les décisions stockées dans Netlify Blobs y sont rattachées.
- `salve` : entier ≥ 1, facultatif (1 par défaut). La salve en cours est le plus grand numéro du fichier ; une nouvelle salve prend le numéro suivant. Ne jamais changer la salve d'une proposition existante.
- Reprendre le texte fourni à l'identique : retours à la ligne en `\n`, espaces, alinéas.
- Format des articles partout : « Article 12 : » (numéro, espace, deux points, sans tiret), ou « Article <nom de section> : » pour une partie non numérotée. Signaler toute autre forme (« Article 12 - », « Art. 12 ») à l'utilisateur au lieu de la corriger en silence.
- Omettre les champs vides plutôt que les laisser à `""`.
- Lancer `npm run verifier` avant de committer, et corriger ou signaler chaque erreur et chaque remarque.

## Technique

- HTML, CSS et JS natifs, sans framework ni étape de build. Les décisions passent par `netlify/functions/decisions.mjs` et sont stockées dans Netlify Blobs (magasin `decisions`, une clé par `id`).
- Direction artistique : IBM Plex Sans et IBM Plex Mono, jamais d'italique, pas de dégradé, de lueur ni de néon. Les couleurs viennent des palettes définies en tête de `assets/style.css` (sept variables par palette) ; Bleu nuit est la palette par défaut.
