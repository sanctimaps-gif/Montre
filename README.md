# Montre

Application d'entraînement qui réunit ce que font Strava et Decathlon Coach, connectée à la
montre **Decathlon Fit 100 S** :

- le **suivi et le social** de Strava — activités détaillées, trace GPS, records, flux,
  encouragements, commentaires, synchronisation dans les deux sens avec Strava ;
- le **coaching** de Decathlon Coach — plan d'entraînement périodisé, séance du jour adaptée à
  la fatigue réelle, analyse de chaque sortie, allures et zones personnalisées.

Tout tourne sur ton serveur : aucune donnée ne part ailleurs tant que tu ne connectes pas
explicitement un service tiers.

## Essayer en ligne

**→ [sanctimaps-gif.github.io/Montre](https://sanctimaps-gif.github.io/Montre/)**

Cette adresse sert la **version autonome** : l'application entière tourne dans le
navigateur, sans serveur. La logique est exactement la même — c'est le paquet
`@montre/core` qui calcule les métriques, la charge et les séances, comme côté serveur —
seul le stockage change : tes activités restent dans ce navigateur, sur cet appareil, via
IndexedDB.

Ce qui fonctionne : import de fichiers `.fit`/`.gpx`/`.tcx`, connexion Bluetooth à la
montre, enregistrement de séance, analyses, plans, export GPX/TCX. Un bouton charge cinq
semaines de séances de démonstration, clairement étiquetées comme telles, pour voir
immédiatement les courbes et l'analyse.

Ce qui demande le serveur : les comptes, le partage entre athlètes, et la synchronisation
Strava — qui exige un secret client, lequel n'a pas sa place dans une page web.

Reconstruire cette version : `npm run build:site` (sortie dans `index.html` et `assets/`
à la racine, d'où GitHub Pages la sert).

## Démarrage

```bash
cp .env.example .env     # facultatif tant que tu n'utilises pas Strava
npm install
npm run dev
```

- Front : http://localhost:5173
- API : http://localhost:8787

Node 22.5 ou plus récent est requis (l'API utilise `node:sqlite`, intégré à Node).

```bash
npm test        # 34 tests du cœur métier
npm run build   # compile le cœur, vérifie l'API, bundle le front
npm run typecheck
```

## La montre Fit 100 S

C'est la partie à comprendre avant d'utiliser l'application, parce qu'elle détermine ce qui
est possible.

**Decathlon ne publie ni SDK ni documentation du protocole de ses montres.** Le transfert
d'historique entre une Fit 100 S et l'application Decathlon Coach passe par un service
Bluetooth privé, non documenté. Le réimplémenter à l'aveugle donnerait quelque chose de
fragile, qui casserait à la première mise à jour du firmware.

L'application utilise donc les deux chemins ouverts et stables :

### 1. En direct — Bluetooth (`apps/web/src/device/fit100s.ts`)

Pendant l'effort, la montre diffuse les profils Bluetooth standards du Bluetooth SIG. Le
module s'y abonne via Web Bluetooth :

| Profil | Ce qu'on en tire |
| --- | --- |
| Heart Rate (`0x180D`) | fréquence cardiaque, intervalles RR, contact du capteur |
| Running Speed and Cadence (`0x1814`) | allure, cadence, longueur de foulée, distance |
| Battery (`0x180F`) | niveau de batterie |
| Device Information (`0x180A`) | modèle, firmware, numéro de série |

L'écran **Séance** combine ces mesures avec le GPS du téléphone et tient le chrono, les tours
automatiques au kilomètre et la reprise après coupure. La reconnexion est automatique quand
la montre sort de portée.

L'écran **Montre** guide l'appairage : vérifications préalables, recherche filtrée puis
recherche élargie si la montre n'apparaît pas, et test en direct qui affiche les valeurs
reçues et les profils réellement exposés par l'appareil.

Web Bluetooth fonctionne sur Chrome, Edge et Opera (ordinateur et Android), en HTTPS ou sur
`localhost`. Firefox ne le prend pas en charge.

**Sur iPhone et iPad**, aucun navigateur du système ne l'expose — Safari, Chrome et Firefox
reposent tous sur WebKit, qui ne l'implémente pas. Il faut passer par un navigateur tiers qui
implémente Web Bluetooth par-dessus CoreBluetooth, comme **Bluefy** : l'application détecte
iOS et donne la marche à suivre, avec un bouton pour copier l'adresse de la page. Sans
Bluetooth, l'import de fichier reste disponible et l'application le dit clairement plutôt que
d'échouer en silence.

### 2. Historique — import de fichier

Decathlon Coach exporte les séances en `.fit`, `.gpx` ou `.tcx`. Ces fichiers se déposent
dans l'onglet **Activités** et sont décodés intégralement — y compris le FIT binaire, dont le
décodeur est écrit dans `packages/core/src/parsers/fit.ts`.

### Et si le protocole propriétaire était documenté un jour ?

L'interface `VendorSyncCodec` (fin de `fit100s.ts`) attend exactement ça : lister les séances
de la montre et les télécharger. Il suffirait de l'implémenter et de l'enregistrer — tout le
reste de la chaîne (import, métriques, coaching) fonctionne déjà sur des fichiers normalisés.

## Ce que fait le coach

Le moteur (`packages/core/src/coach.ts`) ne se contente pas d'afficher un plan figé.

- **Charge d'entraînement** : chaque séance reçoit une charge, calculée depuis le temps passé
  par zone cardiaque quand le cardio est disponible, sinon depuis le rapport allure/VMA.
- **Forme, fatigue, fraîcheur** : moyennes exponentielles sur 42 et 7 jours (CTL/ATL/TSB),
  plus le rapport charge aiguë / charge chronique qui signale la zone à risque de blessure.
- **Plan périodisé** : base, développement, spécifique, affûtage, avec semaine de récupération
  toutes les quatre semaines, construit depuis ton niveau, ton nombre de séances
  hebdomadaires et ta date d'objectif.
- **Adaptation quotidienne** : une séance de qualité prévue au lendemain d'un gros effort est
  reportée ; une fatigue accumulée élevée déclenche de la récupération ; une grande fraîcheur
  autorise à durcir une sortie facile.
- **Analyse post-séance** : répartition par zone, dérive cardiaque, allure corrigée du
  dénivelé, meilleurs efforts, et un conseil pour le lendemain qui tient compte de
  l'intensité et pas seulement du volume.

## Strava

Renseigne `STRAVA_CLIENT_ID` et `STRAVA_CLIENT_SECRET` dans `.env`
([créer une application](https://www.strava.com/settings/api)), puis connecte ton compte
depuis les **Réglages**. L'application peut alors :

- importer tes activités Strava avec leurs flux complets (trace, cardio, cadence, puissance) ;
- déposer sur Strava une séance enregistrée ici, au format TCX.

Sans ces variables, tout le reste de l'application fonctionne normalement.

## Structure

```
packages/core/     Domaine partagé, sans dépendance externe
  parsers/         Décodeurs FIT (binaire), GPX et TCX
  metrics.ts       Zones, TRIMP, charge, dénivelé, dérive cardiaque, records
  training-load.ts CTL / ATL / TSB, ratio charge aiguë sur chronique
  workouts.ts      Catalogue de séances paramétrées par la VMA
  coach.ts         Plans périodisés, séance du jour, analyse post-séance

apps/server/       API Node : node:http + node:sqlite, zéro dépendance runtime
  routes/          auth, activités, coach, Strava, social, appareils

apps/web/          PWA React + Vite
  device/          Web Bluetooth (fit100s.ts) et enregistreur de séance
  pages/           Accueil, Séance, Activités, Coach, Flux, Réglages
```

Choix assumés : les graphiques et la trace GPS sont dessinés en SVG maison, sans bibliothèque
de charts ni fond de carte tiers. Le bundle reste sous 75 Ko gzip, la trace GPS ne part chez
aucun fournisseur de tuiles, et tout fonctionne hors ligne.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — organisation du code et choix techniques
- [`docs/FIT100S.md`](docs/FIT100S.md) — protocole Bluetooth, trames décodées, limites
- [`docs/API.md`](docs/API.md) — routes HTTP
