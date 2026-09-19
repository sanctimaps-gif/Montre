# API HTTP

Base : `http://localhost:8787`. Toutes les réponses sont en JSON.

L'authentification se fait par un jeton de session envoyé en en-tête :

```
Authorization: Bearer <jeton>
```

Les erreurs ont la forme `{ "error": "message lisible" }` avec le code HTTP correspondant.

## Comptes

| Méthode | Route | Description |
| --- | --- | --- |
| `POST` | `/api/auth/register` | `{ email, password, displayName }` → `{ user, token }`. Mot de passe de 8 caractères minimum. |
| `POST` | `/api/auth/login` | `{ email, password }` → `{ user, token }` |
| `POST` | `/api/auth/logout` | Invalide le jeton courant |
| `GET` | `/api/auth/me` | `{ user, profile }` |
| `PUT` | `/api/profile` | Met à jour le profil sportif. Les valeurs hors bornes physiologiques sont rejetées. |

Profil : `birthDate`, `weightKg`, `maxHr`, `restHr`, `vma`, `weeklySessions`, `level`
(`debutant`, `intermediaire`, `confirme`).

## Activités

| Méthode | Route | Description |
| --- | --- | --- |
| `GET` | `/api/activities?limit&offset&sport` | Liste, sans les traces |
| `GET` | `/api/activities/:id` | Détail, trace sous-échantillonnée à 2 000 points, plus l'analyse du coach |
| `POST` | `/api/activities/import` | Corps = fichier brut, en-tête `X-Filename`. Accepte `.fit`, `.gpx`, `.tcx`. Détecte les doublons. |
| `POST` | `/api/activities` | Enregistre une séance capturée en direct : `{ sport, startTime, points, laps }` |
| `PATCH` | `/api/activities/:id` | `{ title, description, sport }` |
| `DELETE` | `/api/activities/:id` | Supprime |
| `GET` | `/api/activities/:id/export?format=gpx\|tcx` | Télécharge le fichier |
| `GET` | `/api/stats` | Totaux par sport sur 12 mois |

## Coaching

| Méthode | Route | Description |
| --- | --- | --- |
| `GET` | `/api/fitness` | Série CTL/ATL/TSB, état du jour, verdict de forme, ratio charge aiguë/chronique, charges hebdomadaires |
| `GET` | `/api/coach/today` | Séance recommandée, motif, avertissement éventuel, allures d'entraînement |
| `GET` | `/api/coach/plan` | Dernier plan, ou `null` |
| `POST` | `/api/coach/plan` | `{ goal, targetDate, targetTime?, availableDays? }`. Objectifs : `5km`, `10km`, `semi`, `marathon`, `trail`, `forme` |
| `DELETE` | `/api/coach/plan/:id` | Supprime le plan |

## Strava

| Méthode | Route | Description |
| --- | --- | --- |
| `GET` | `/api/strava/status` | Configuration serveur, état de connexion, dernière synchronisation |
| `GET` | `/api/strava/authorize` | `{ url }` vers laquelle rediriger l'utilisateur |
| `GET` | `/api/strava/callback` | Retour OAuth, redirige vers `/reglages?strava=...`. Route publique. |
| `POST` | `/api/strava/sync` | Importe les activités depuis la dernière synchronisation → `{ imported, skipped }` |
| `POST` | `/api/strava/upload/:id` | Dépose l'activité sur Strava au format TCX |
| `DELETE` | `/api/strava` | Déconnecte le compte |

## Social

| Méthode | Route | Description |
| --- | --- | --- |
| `GET` | `/api/feed?limit` | Activités de l'athlète et de ceux qu'il suit |
| `POST` | `/api/activities/:id/kudos` | Bascule l'encouragement → `{ kudoed, count }` |
| `GET` | `/api/activities/:id/comments` | Liste les commentaires |
| `POST` | `/api/activities/:id/comments` | `{ body }`, 1 000 caractères maximum |
| `GET` | `/api/athletes` | Athlètes du serveur, avec l'état de suivi |
| `POST` | `/api/athletes/:id/follow` | Bascule le suivi |

## Appareils

| Méthode | Route | Description |
| --- | --- | --- |
| `GET` | `/api/devices` | Montres appairées |
| `POST` | `/api/devices` | Enregistre ou met à jour une montre : `{ id, name, model, firmware, serial, battery }` |
| `DELETE` | `/api/devices/:id` | Oublie l'appareil |

## Divers

| Méthode | Route | Description |
| --- | --- | --- |
| `GET` | `/api/health` | État du serveur et de la configuration Strava. Route publique. |
