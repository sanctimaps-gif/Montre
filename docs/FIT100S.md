# Connexion à la Decathlon Fit 100 S

Ce document décrit précisément ce que l'application lit sur la montre, comment, et où sont
les limites.

## Ce qui est possible, et ce qui ne l'est pas

La Fit 100 S est une montre GPS de sport qui se synchronise avec l'application Decathlon
Coach par Bluetooth Low Energy. Deux canaux coexistent dans ce type de montre :

1. **Les profils standards du Bluetooth SIG**, publics et documentés, diffusés pendant
   l'effort pour que n'importe quel appareil (compteur vélo, application de course, montre
   tierce) puisse lire les mesures en direct.
2. **Un service propriétaire**, avec des UUID spécifiques au fabricant, utilisé pour
   transférer l'historique des séances stockées dans la montre.

Le second n'est **pas documenté par Decathlon** : pas de SDK public, pas de spécification.
Cette application s'appuie donc entièrement sur le premier, et récupère l'historique par
import de fichier — le chemin que Decathlon Coach expose lui-même via son export.

C'est une limite du fabricant, pas une limite de l'application : tout ce qui est
techniquement accessible sans rétro-ingénierie est exploité.

## Profils lus en direct

Connexion et découverte : `apps/web/src/device/fit100s.ts`. Le décodage des trames vit dans
`packages/core/src/ble.ts`, où il est couvert par des tests — c'est la partie où une erreur
d'un octet donnerait une fréquence cardiaque fausse sans que rien ne le signale.

### Heart Rate — service `0x180D`

Caractéristique `heart_rate_measurement` (`0x2A37`), en notification.

Format de la trame, tel que spécifié par le Bluetooth SIG :

```
octet 0 : drapeaux
          bit 0    format de la FC   0 = uint8, 1 = uint16
          bits 1-2 contact du capteur (0b11 = contact détecté)
          bit 3    dépense énergétique présente
          bit 4    intervalles RR présents
octet 1+ : fréquence cardiaque (1 ou 2 octets, petit-boutiste)
[2 octets] dépense énergétique, si bit 3
[2 octets par valeur] intervalles RR, en 1/1024 s, si bit 4
```

Les intervalles RR sont conservés : ils permettent de calculer la variabilité cardiaque.
Le bit de contact alimente l'avertissement « resserre le bracelet » sur l'écran Séance.

### Running Speed and Cadence — service `0x1814`

Caractéristique `rsc_measurement` (`0x2A53`), en notification.

```
octet 0   : drapeaux
            bit 0 longueur de foulée présente
            bit 1 distance totale présente
            bit 2 course (1) ou marche (0)
octets 1-2 : vitesse instantanée, en 1/256 m/s
octet 3    : cadence, en pas par minute
[2 octets] longueur de foulée, en 1/100 m, si bit 0
[4 octets] distance totale, en 1/10 m, si bit 1
```

La vitesse de la montre est préférée à celle déduite du GPS : l'accéléromètre est plus
stable que le GPS sur les variations courtes d'allure.

### Battery — service `0x180F`

Caractéristique `battery_level` (`0x2A19`) : un octet, de 0 à 100. Lue à la connexion, puis
en notification quand la montre le permet. Le niveau est stocké côté serveur pour être
affiché dans les Réglages entre deux sorties.

### Device Information — service `0x180A`

Chaînes lues une fois à la connexion : modèle (`0x2A24`), firmware (`0x2A26`), numéro de
série (`0x2A25`). Elles identifient l'appareil dans les Réglages.

## Découverte et appairage

Le sélecteur Bluetooth du navigateur propose :

- les appareils dont le nom commence par `Fit 100`, `FIT100`, `Decathlon`, `DKT`,
  `Geonaute`, `Kalenji`, `Kiprun`, `Domyos`, `ONmove` — les marques du groupe selon les
  générations ;
- tout appareil exposant le service Heart Rate ou Running Speed and Cadence, ce qui couvre
  les ceintures cardio et les autres montres.

L'appairage doit partir d'un clic : les navigateurs refusent `requestDevice()` en dehors
d'un geste utilisateur.

## Reconnexion

Perdre le lien quelques secondes en pleine sortie est banal. À l'événement
`gattserverdisconnected`, la reconnexion est retentée avec une attente doublant à chaque
essai (1 s, 2 s, 4 s… plafonnée à 30 s), jusqu'à dix tentatives. L'enregistrement continue
pendant ce temps : le chrono et le GPS ne dépendent pas de la montre, seules les valeurs
cardiaques manquent sur la portion concernée.

## Compatibilité des navigateurs

| Plateforme | Web Bluetooth |
| --- | --- |
| Chrome, Edge, Opera (Windows, macOS, Linux, Android) | oui |
| Firefox | non |
| Safari, Chrome, Firefox sur iOS | non |
| Bluefy sur iOS | oui |

Le contexte doit être sécurisé : HTTPS, ou `localhost` en développement.

### Le cas iOS

Sur iPhone et iPad, tous les navigateurs sont obligés d'utiliser WebKit, et WebKit
n'implémente pas Web Bluetooth. Changer Safari pour Chrome ou Firefox ne change donc rien :
ce sont les mêmes entrailles. **Aucun code côté application ne peut contourner cela** — une
page web n'accède pas à la radio Bluetooth sans passer par du natif.

L'écran `/montre` détecte iOS et propose quatre chemins, classés par simplicité plutôt que
par élégance technique :

1. **Decathlon Hub, puis Strava.** La chaîne officielle, et la seule automatique sur iPhone.
   [Decathlon Hub](https://support.decathlon.fr/decathlon-hub) est l'application de Decathlon
   pour les montres FIT 100 : elle parle à la montre en Bluetooth nativement, et sait pousser
   les séances vers Strava. L'application lit Strava. Une fois les trois maillons en place,
   les séances arrivent sans intervention. Seule contrainte : l'étape Strava demande le
   serveur, son API exigeant un secret client.
2. **L'export de fichier depuis Decathlon Hub.** Le même trajet, en manuel, sans serveur.
   On obtient exactement les mêmes analyses — seul l'affichage pendant l'effort manque.
3. **Un ordinateur ou un Android avec Chrome.** Rien à installer, le direct fonctionne.
4. **Bluefy – Web BLE Browser**, un navigateur de l'App Store qui implémente Web Bluetooth
   par-dessus CoreBluetooth. C'est la seule façon d'avoir le cardio à l'écran pendant
   l'effort sur iPhone, mais elle arrive en dernier : elle demande d'installer une
   application pour un gain que les options 1 et 2 couvrent presque entièrement.

Et sans montre du tout, l'écran Séance enregistre le chrono, le GPS, l'allure, le dénivelé et
les tours automatiques avec le seul téléphone.

### Pourquoi pas un hub Bluetooth maison

On pourrait écrire un compagnon Node qui parle à la montre en Bluetooth natif, à la manière
de Decathlon Hub. Ce serait du code non vérifiable ici — dépendances natives par plateforme,
protocole propriétaire non documenté — pour reproduire ce que l'application officielle fait
déjà, gratuitement et de façon supportée, avec en prime la synchronisation Strava. Le travail
utile était donc de brancher proprement l'extrémité de cette chaîne, pas d'en refaire le
début.

`bluetoothEnvironment()` renvoie la cause exacte de l'indisponibilité — plateforme,
navigateur ou absence de HTTPS — plutôt que de laisser un bouton qui ne répond pas.

### Un piège qui bloquait l'import sur iPhone

Le champ de fichier portait `accept=".fit,.gpx,.tcx"`. iOS fait correspondre les extensions
à ses propres types de fichiers, et comme il ne connaît ni `.fit` ni `.tcx`, il **grisait ces
fichiers dans le sélecteur** : le chemin de repli était inutilisable là où il était le plus
nécessaire. L'attribut a été retiré. Le format est de toute façon reconnu au contenu — les
octets de signature pour le FIT, la racine du document pour le GPX et le TCX — et un fichier
invalide est refusé avec un message explicite.

## Réussir l'appairage

Trois causes expliquent la quasi-totalité des échecs, et l'écran `/montre` les traite une par une.

**La montre n'émet pas.** Beaucoup de montres ne diffusent leur fréquence cardiaque qu'une
fois une activité démarrée, pour économiser la batterie. Lancer une séance sur la montre
avant de chercher résout le cas le plus fréquent de « connectée mais aucune valeur ».

**Une autre application tient la montre.** Le Bluetooth Low Energy n'autorise qu'une seule
connexion centrale à la fois : si l'application Decathlon Coach est connectée, la nôtre ne
peut pas l'être. Il faut la fermer, et parfois oublier la montre dans les réglages Bluetooth
du système.

**Le filtre de recherche est trop strict.** `requestDevice()` n'affiche que les appareils
correspondant aux filtres, et toutes les montres n'annoncent ni leur nom ni leurs services
dans leur trame de découverte. Une montre parfaitement compatible peut donc rester
invisible. D'où le bouton « Afficher tous les appareils Bluetooth », qui relance la recherche
avec `acceptAllDevices: true` — sans filtre, la montre apparaît, et les services sont
découverts après connexion.

Après connexion, l'écran affiche **quels profils la montre expose réellement** (cardio,
cadence, batterie, identification) et les valeurs en direct. C'est le seul diagnostic qui
vaille : si la fréquence cardiaque défile, ça marche.

## Import de fichier

Le décodeur FIT (`packages/core/src/parsers/fit.ts`) lit le format binaire complet :
en-tête, messages de définition, messages de données, en-têtes compressés, types de base,
champs développeur ignorés proprement. Les messages exploités sont `file_id` (0), `sport`
(12), `session` (18), `lap` (19) et `record` (20).

Conversions appliquées, conformes au profil FIT :

| Champ | Unité du fichier | Conversion |
| --- | --- | --- |
| `timestamp` | secondes depuis 1989-12-31 UTC | + 631 065 600 s |
| `position_lat` / `position_long` | semicercles | × 180 / 2³¹ |
| `altitude` | 1/5 m, décalage 500 | ÷ 5 − 500 |
| `distance` | centimètres | ÷ 100 |
| `speed` | mm/s | ÷ 1000 |

Les valeurs « invalides » du format (0xFF, 0xFFFF, 0x7FFFFFFF selon le type) sont traitées
comme absentes et non comme des mesures.

Les formats GPX et TCX sont également acceptés, avec leurs extensions cardio
(`TrackPointExtension` pour le GPX, `TPX` pour le TCX).

## Brancher un protocole propriétaire

Si le protocole de synchronisation venait à être documenté, l'interface `VendorSyncCodec`
est le point d'entrée prévu :

```ts
export interface VendorSyncCodec {
  serviceUuid: string;
  label: string;
  listActivities(server: BluetoothRemoteGATTServer): Promise<Array<{ id: string; startTime: number }>>;
  download(server: BluetoothRemoteGATTServer, id: string): Promise<Uint8Array>;
}
```

`download` doit rendre un fichier FIT, GPX ou TCX : le reste de la chaîne — décodage,
métriques, coaching, stockage — fonctionne déjà sur ces formats.
