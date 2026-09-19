# Architecture

## Vue d'ensemble

Trois paquets dans un espace de travail npm :

```
packages/core   ──►  apps/server   (API)
      │
      └──────────►  apps/web      (interface)
```

`@montre/core` ne dépend de rien et ne connaît ni HTTP ni navigateur. Il contient les
parseurs de fichiers, les calculs physiologiques et le moteur de coaching. Serveur et front
l'importent tous les deux, ce qui garantit qu'une charge d'entraînement affichée dans
l'interface est calculée exactement comme celle stockée en base.

## `packages/core`

| Fichier | Rôle |
| --- | --- |
| `types.ts` | Le vocabulaire du domaine. Toutes les unités sont SI, documentées sur chaque champ. |
| `metrics.ts` | Zones cardiaques (Karvonen), TRIMP d'Edwards, charge, dénivelé filtré, temps en mouvement, allure corrigée du dénivelé, dérive cardiaque, meilleurs efforts, estimation de VMA. |
| `training-load.ts` | Séries CTL / ATL / TSB, lecture de l'état de forme, ratio charge aiguë sur chronique, agrégation hebdomadaire. |
| `workouts.ts` | Catalogue de séances : endurance, récupération, sortie longue, fractionné court et long, seuil, côtes, renforcement. Chaque séance est paramétrée par la VMA. |
| `coach.ts` | Génération de plan périodisé, recommandation quotidienne adaptative, analyse post-séance. |
| `ble.ts` | Décodage des trames Bluetooth standards (cardio, allure/cadence, batterie). Fonctions pures, donc testables sans montre ni navigateur. |
| `serialize.ts` | Écriture TCX et GPX, pour l'export et le dépôt sur Strava. |
| `parsers/` | Décodage FIT binaire, GPX, TCX, plus la normalisation en activité complète. |

Quelques décisions qui méritent d'être expliquées :

**Le dénivelé est filtré.** Sans lissage ni seuil, le bruit d'altimètre fait afficher
plusieurs centaines de mètres de D+ sur une sortie parfaitement plate. Une moyenne glissante
sur 15 points et un seuil de 1 m ramènent le résultat à ce que l'athlète a réellement monté
— un test vérifie les deux cas.

**La charge a plusieurs sources.** Quand le cardio couvre plus de la moitié de la séance,
elle vient du temps par zone, pondéré pour qu'une heure au seuil vaille environ 100. Sinon,
elle est déduite du rapport allure/VMA. En dernier recours, seule la durée compte. L'échelle
reste comparable d'une méthode à l'autre.

**Le conseil post-séance regarde l'intensité, pas seulement le volume.** Trente minutes au
seuil accumulent peu de charge totale mais fatiguent réellement : au-delà de 25 % du temps
en zone 4-5, le coach recommande une journée facile même si la charge est basse.

## `apps/server`

Node `http` et `node:sqlite`, aucune dépendance de production. Le projet est assez petit
pour ne pas justifier un framework : un micro-routeur (`http.ts`) couvre les besoins en une
centaine de lignes.

- **Authentification** : mot de passe en scrypt avec sel aléatoire, comparaison à temps
  constant, jetons de session en base avec expiration à 30 jours.
- **Stockage** : les traces sont sérialisées en JSON dans une colonne, jamais interrogées
  point par point. Les listes d'activités ne les chargent pas ; le détail les sous-échantillonne
  à 2 000 points, largement assez pour les graphiques et la carte.
- **Déduplication** : un index unique `(user_id, source, source_id)` empêche d'importer deux
  fois la même activité, qu'elle vienne de Strava ou d'un fichier.
- **OAuth Strava** : jetons d'état à usage unique en base (dix minutes de validité) plutôt
  qu'un secret partagé ; jetons d'accès rafraîchis automatiquement avec une minute de marge.

## `apps/web`

React et Vite, trois dépendances de production (`react`, `react-dom`, `react-router-dom`).

- `device/fit100s.ts` — Web Bluetooth : diagnostic de plateforme, découverte (filtrée puis
  élargie), abonnement aux profils standards, reconnexion automatique. Le décodage des trames
  est dans `core/ble.ts` pour être testable. Détaillé dans [`FIT100S.md`](FIT100S.md).
- `pages/Watch.tsx` — appairage guidé : vérifications préalables, recherche, test en direct
  et dépannage. La connexion Bluetooth est une instance partagée de l'application, pas une
  instance par écran : la montre reste connectée quand on change de page.
- `device/recorder.ts` — fusion à 1 Hz du GPS, des mesures Bluetooth et de l'horloge.
  Les positions imprécises (plus de 35 m) et les sauts GPS (plus de 12 m/s) sont écartés,
  sans quoi la distance dérive en ville. L'état est écrit dans le stockage local à chaque
  seconde : une séance survit au verrouillage de l'écran ou au rechargement de l'onglet.
- `components/Chart.tsx` et `TrackMap.tsx` — graphiques et trace GPS en SVG. Pas de
  bibliothèque de charts, pas de fond de carte : le bundle reste léger, et les positions de
  l'athlète ne sont envoyées à aucun fournisseur de tuiles. La trace est projetée avec une
  correction en cosinus de la latitude, sans quoi les parcours paraissent étirés.

## Mode autonome

L'application se compile en deux variantes depuis les mêmes sources. Avec le serveur, elle
parle à l'API HTTP. En mode autonome (`VITE_STANDALONE=1`), tout s'exécute dans le
navigateur.

C'est `packages/core` qui rend la chose possible : sans dépendance et sans rien connaître de
HTTP ni du système de fichiers, il tourne aussi bien dans Node que dans un navigateur. Les
métriques, la charge d'entraînement et les recommandations du coach sont donc littéralement
le même code dans les deux variantes.

- `src/api-types.ts` définit l'interface `MontreApi` que les deux implémentations respectent.
- `src/standalone/local-api.ts` l'implémente sur IndexedDB (`storage.ts`). Le stockage local
  classique aurait suffi pour un profil, pas pour des traces : une heure enregistrée à 1 Hz
  pèse déjà plusieurs centaines de kilo-octets, et le quota de 5 Mo serait vite atteint.
- Ce qui exige structurellement un serveur — comptes, partage, secret client Strava — n'est
  pas simulé : ces méthodes expliquent pourquoi elles ne peuvent pas aboutir.
- Le routage passe par le fragment d'URL, et les chemins des ressources sont relatifs :
  la même construction fonctionne à la racine d'un domaine comme dans un sous-dossier, et
  un lien profond reste rechargeable sans réécriture d'URL côté serveur.

## Tests

34 tests dans `packages/core/test`, exécutés par `node --test` sans dépendance :

- le décodeur FIT est vérifié contre un **encodeur FIT écrit dans le test**, qui produit un
  fichier conforme à la spécification ; cela valide l'en-tête, les messages de définition,
  les types de base et toutes les conversions d'unités ;
- les métriques sont vérifiées sur des traces synthétiques dont le résultat attendu est
  connu analytiquement (un degré de latitude vaut 111,2 km ; une heure au seuil vaut 100 de
  charge ; 600 s à 0,1 m/s d'ascension valent 60 m de D+) ;
- le coach est vérifié sur ses règles de sécurité : pas deux séances dures consécutives,
  récupération imposée en surcharge, périodisation dans le bon ordre.

## Ce qui n'est pas fait

Honnêtement, pour que la liste soit claire :

- pas de segments ni de classements — c'est une grosse fonctionnalité de Strava, absente ici ;
- pas de notifications push ni de mode hors ligne complet (le service worker reste à écrire) ;
- la synchronisation Strava est manuelle, déclenchée depuis les Réglages : pas de webhook ;
- le décodeur FIT ignore les champs développeur et les messages autres que ceux d'une
  activité, ce qui est suffisant pour une montre de course mais pas pour un fichier de
  multisport complexe.
