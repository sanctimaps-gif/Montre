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

Implémentation : `apps/web/src/device/fit100s.ts`.

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
| Safari, tout navigateur sur iOS | non |

Le contexte doit être sécurisé : HTTPS, ou `localhost` en développement.

Quand Web Bluetooth est indisponible, `bluetoothUnavailableReason()` renvoie la raison exacte
(navigateur, plateforme ou absence de HTTPS) et l'interface la présente avec la solution de
repli, plutôt que de laisser un bouton qui ne fonctionne pas.

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
