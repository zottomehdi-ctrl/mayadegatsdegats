# Liaison Maya

Registre des propositions de textes du serveur GTA RP Last Gate (État de San Andreas). Le site présente chaque proposition et recueille les décisions de la fondatrice : valider, refuser ou rediscuter en appel.

- `contenu/propositions.json` : toutes les propositions. C'est le seul fichier à modifier.
- `netlify/functions/decisions.mjs` : enregistre les décisions dans Netlify Blobs, une clé par `id` de proposition.
- `assets/registre.js` : lecture et vérification du fichier, partagées par le site et par `npm run verifier`.
- `index.html`, `assets/` : le site.

## Déployer sur Netlify

1. Pousser le dépôt sur GitHub.
2. Sur Netlify : **Add new project > Import an existing project**, choisir le dépôt.
3. Garder les réglages proposés (ils viennent de `netlify.toml` : aucune commande de build, dossier publié `.`), puis **Deploy**.

Netlify Blobs fonctionne sans configuration. Chaque push redéploie le site, et les décisions déjà prises sont conservées.

## Tester en local

Prérequis : Node.js 22.12 ou plus récent, et Netlify CLI (`npm install -g netlify-cli`).

```bash
npm install
netlify dev
```

Ouvrir http://localhost:8888. En local, les décisions sont stockées dans `.netlify/` et restent séparées de celles du site en ligne.

## Ajouter ou modifier des propositions

Remplacer `contenu/propositions.json`, lancer `npm run verifier`, puis commit et push : Netlify redéploie automatiquement.

```json
{
  "id": "vol-a-main-armee",
  "titre": "Titre court",
  "texte": "Code pénal",
  "article": "Article 12 :",
  "urgent": false,
  "resume": "Le changement, en une phrase.",
  "changements": ["Premier point concret.", "Deuxième point concret."],
  "pourquoi": "La justification, en quelques lignes.",
  "effets": { "lspd": "…", "doj": "…", "entreprises": "…" },
  "avant": "Texte actuel.\nDeuxième ligne.",
  "apres": "Texte proposé.\nDeuxième ligne."
}
```

| Champ | Obligatoire | Contenu |
| --- | --- | --- |
| `id` | oui | Clé interne en slug (minuscules, chiffres, tirets), unique, jamais affichée. Ne jamais la modifier ni la réutiliser : les décisions y sont rattachées. |
| `titre` | oui | Titre court. |
| `texte` | oui | `Code pénal`, `Code de procédure pénale`, `Code de police`, `Code de la route`, `Code du travail`, `Code civil`, `Code électoral`, `Constitution`, `Décret` ou `Autre`. |
| `article` | oui, sauf pour un décret | Sous la forme « Article 12 : ». |
| `urgent` | non | `true` ou `false` (faux par défaut). |
| `resume` | oui | En une phrase. |
| `changements` | oui | 1 à 4 points concrets. |
| `pourquoi` | oui | Quelques lignes. |
| `effets` | non | Sous-champs facultatifs `lspd`, `doj`, `entreprises` ; seuls les sous-champs remplis s'affichent. |
| `avant` | non | Texte actuel. Absent : ajout pur. |
| `apres` | oui, sauf abrogation | Texte proposé. Absent alors que `avant` est rempli : abrogation. |

- Retours à la ligne en `\n` ; espaces et alinéas conservés à l'identique.
- Champs vides omis plutôt que laissés à `""`.
- Si le fichier est mal formé ou qu'un champ obligatoire manque, le site l'indique en haut de la page (numéro et titre de la proposition, champ en cause) et affiche les autres propositions normalement.
- Les propositions d'exemple ont un `id` qui commence par `exemple-`. Pour les retirer, il suffit de les supprimer du fichier.

## Palettes

Le bouton « Palette » de l'en-tête propose 8 palettes claires, 4 sombres et un mode automatique (Bleu nuit ou Nuit marine selon le réglage de l'appareil). Le choix est mémorisé dans le navigateur de chaque personne. Les couleurs sont définies en tête de `assets/style.css`, sous forme de variables CSS.

## Accès

Le site n'a ni connexion ni code. Toute personne qui connaît l'adresse peut consulter le registre et enregistrer une décision, donc ne la partagez qu'avec la fondatrice. Le site n'est pas indexé par les moteurs de recherche (`noindex` et `robots.txt`).
