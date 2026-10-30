# Budget mensuel

PWA de suivi de budget mensuel, pensée pour l'iPhone. HTML, CSS et JS sans étape de build.
Les données restent dans le `localStorage` de l'appareil : rien n'est envoyé à un serveur.

## Déployer sur GitHub Pages

Le site publié est **public**, même si le dépôt est privé selon votre offre. `seed.json` contient
vos données de départ : `.gitignore` l'exclut, ne le retirez pas.

Depuis ce dossier :

```sh
git init -b main
git add .
git status        # seed.json et tests/seed.test.js ne doivent pas apparaître
git commit -m "Première version"
git remote add origin https://github.com/VOTRE-COMPTE/budget-mensuel.git
git push -u origin main
```

Puis sur GitHub : **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/ (root)`**.
Le site est en ligne après une minute environ sur `https://VOTRE-COMPTE.github.io/budget-mensuel/`.

Une nouvelle version poussée s'affiche au lancement qui suit sa première récupération : il faut
parfois ouvrir l'application deux fois.

## Installer sur l'iPhone

1. Ouvrez l'adresse du site dans **Safari**.
2. Touchez **Partager**, puis **Sur l'écran d'accueil**, puis **Ajouter**.
3. Lancez l'application **depuis la nouvelle icône**.
4. Pour charger vos données de départ, placez `seed.json` dans l'app Fichiers (iCloud Drive ou OneDrive),
   puis touchez **Importer un fichier** sur l'écran d'accueil de l'application.

Sur iPhone, Safari et l'application installée ne partagent pas leurs données : importez bien
depuis l'icône. Exportez régulièrement une sauvegarde (Réglages → Exporter en JSON), car supprimer
l'application efface ses données.

## Lancer en local

```sh
python -m http.server 8000
```

Ouvrez `http://localhost:8000/`. Au premier lancement, `seed.json` est chargé automatiquement s'il est présent.

## Tests

```sh
npm test
```

Node 20 ou plus, sans dépendance. Les tests couvrent les calculs, la création de mois, l'ajout rapide et l'import/export.

## Fichiers

| Fichier | Rôle |
|---|---|
| `store.js` | Données, calculs, import/export (sans DOM) |
| `app.js` | Écrans, panneaux, actions |
| `charts.js` | Graphiques en SVG et HTML |
| `styles.css` | Mise en page et les trois styles |
| `sw.js` | Fonctionnement hors ligne |
| `seed.json` | Données de départ, hors de git |
