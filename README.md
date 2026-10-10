# Registre des propositions · DOJ San Andreas

Site interne du Département de la Justice (serveur Last Gate). Il présente les propositions de textes (décrets, amendements) et recueille les décisions de la fondatrice.

- `contenu/propositions.json` : toutes les propositions. C'est le seul fichier à modifier.
- `netlify/functions/decisions.mjs` : enregistre les décisions dans Netlify Blobs, une clé par identifiant de proposition.
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

## Ajouter des propositions

Ajouter un objet à la liste de `contenu/propositions.json` :

```json
{
  "id": "P-014",
  "type": "Amendement",
  "code": "Code pénal",
  "titre": "Titre court",
  "article": "12",
  "texteActuel": [
    "Première ligne du texte actuel.",
    "",
    "    Alinéa en retrait."
  ],
  "textePropose": [
    "Première ligne du texte proposé.",
    "",
    "    Alinéa en retrait."
  ],
  "justification": [
    "Pourquoi ce changement, en quelques lignes."
  ],
  "priorite": "normale"
}
```

| Champ | Valeurs |
| --- | --- |
| `id` | Unique, par exemple `P-014`. Ne jamais réutiliser l'identifiant d'une proposition retirée : sa décision y resterait attachée. |
| `type` | `Décret` ou `Amendement` |
| `code` | Pour un amendement : `Code pénal`, `Code de police`, `Code de la route`, `Code du travail`, `Code civil`, `Constitution`, `Autre` |
| `article` | Le numéro seul (`12`, `12 bis`). Il s'affiche sous la forme « Article 12 : ». |
| `texteActuel` | Uniquement pour une modification ou une abrogation |
| `textePropose` | Le texte proposé. S'il est absent alors que `texteActuel` est rempli, la proposition est présentée comme une abrogation. |
| `justification` | Quelques lignes |
| `priorite` | `normale` ou `urgente` |

- Les textes s'écrivent ligne par ligne, avec une chaîne par ligne. `""` donne une ligne vide. Les espaces en début de ligne sont conservés.
- Dans un texte, les en-têtes d'articles s'écrivent « Article 12 : » (numéro, espace, deux points, sans tiret).
- Avant de publier, lancer `npm run verifier` : la commande signale les erreurs de format, les identifiants en double et les en-têtes d'articles mal formés.

Pour retirer les exemples, supprimer `EX-01` à `EX-03` du fichier. Leurs décisions de démonstration ne s'afficheront plus.

## Palettes

Le bandeau propose cinq palettes : Nuit (par défaut), Ardoise, Forêt, Bordeaux (sombres) et Pierre (claire). Le choix est mémorisé dans le navigateur de chaque personne et n'affecte pas les autres. Les couleurs sont définies en tête de `assets/style.css`.

## Accès

Le site n'a ni connexion ni code. Toute personne qui connaît l'adresse peut consulter le registre et enregistrer une décision, donc ne la partagez qu'avec la fondatrice. Le site n'est pas indexé par les moteurs de recherche (`noindex` et `robots.txt`).
