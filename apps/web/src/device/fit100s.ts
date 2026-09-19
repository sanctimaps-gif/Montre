import type { LiveSample } from "@montre/core";
import {
  parseBatteryLevel,
  parseHeartRateMeasurement,
  parseRscMeasurement,
} from "@montre/core";

/**
 * Connexion a la montre Decathlon Fit 100 S (et aux autres montres et
 * ceintures compatibles) via Web Bluetooth.
 *
 * Decathlon ne publie ni SDK ni documentation du protocole de synchronisation
 * de ses montres : le transfert d'historique vers Decathlon Coach passe par un
 * service Bluetooth prive. En revanche, comme la quasi-totalite des montres de
 * sport, la Fit 100 S expose pendant l'effort les profils publics du Bluetooth
 * SIG, et ce sont eux que ce module utilise :
 *
 *   - Heart Rate (0x180D)                frequence cardiaque, intervalles RR
 *   - Running Speed and Cadence (0x1814) allure, cadence, distance
 *   - Battery (0x180F)                   niveau de batterie
 *   - Device Information (0x180A)        modele, firmware, numero de serie
 *
 * Le decodage des trames vit dans `@montre/core` (`ble.ts`), ou il est couvert
 * par des tests : c'est la partie ou une erreur d'un octet donnerait une
 * frequence cardiaque fausse sans que rien ne le signale.
 */

export type { LiveSample } from "@montre/core";

/** Identifiants des services et caracteristiques standards utilises. */
export const GATT = {
  heartRate: "heart_rate",
  heartRateMeasurement: "heart_rate_measurement",
  runningSpeedCadence: "running_speed_and_cadence",
  rscMeasurement: "rsc_measurement",
  battery: "battery_service",
  batteryLevel: "battery_level",
  deviceInformation: "device_information",
  modelNumber: "model_number_string",
  firmwareRevision: "firmware_revision_string",
  serialNumber: "serial_number_string",
} as const;

/**
 * Prefixes de nom annonces par les montres Decathlon selon les generations et
 * les marques du groupe (Geonaute, Kalenji, Kiprun, Domyos).
 */
export const DECATHLON_NAME_PREFIXES = [
  "Fit 100",
  "FIT 100",
  "FIT100",
  "Fit100",
  "Decathlon",
  "DECATHLON",
  "DKT",
  "Geonaute",
  "GEONAUTE",
  "Kalenji",
  "Kiprun",
  "KIPRUN",
  "Domyos",
  "ONmove",
  "ON MOVE",
];

export interface DeviceIdentity {
  id: string;
  name: string;
  model?: string;
  firmware?: string;
  serial?: string;
}

/** Profils effectivement trouves sur la montre, apres connexion. */
export interface DeviceProfiles {
  heartRate: boolean;
  cadence: boolean;
  battery: boolean;
  deviceInformation: boolean;
}

export type WatchStatus =
  | "deconnecte"
  | "recherche"
  | "connexion"
  | "connecte"
  | "reconnexion"
  | "erreur";

export interface WatchEvents {
  onStatus?: (status: WatchStatus, detail?: string) => void;
  onSample?: (sample: LiveSample) => void;
  onIdentity?: (identity: DeviceIdentity) => void;
  onProfiles?: (profiles: DeviceProfiles) => void;
}

/** Pourquoi Web Bluetooth est indisponible, et que faire a la place. */
export interface BluetoothEnvironment {
  available: boolean;
  kind: "ok" | "ios" | "firefox" | "insecure" | "indisponible";
  /** Explication courte, affichable telle quelle. */
  message: string;
  /** Marche a suivre concrete quand une solution existe. */
  remedy?: string;
}

/** Vrai si le navigateur expose Web Bluetooth. */
export function isBluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS se presente comme un Mac : le nombre de points tactiles le trahit.
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * Diagnostic de la plateforme.
 *
 * Les trois causes d'indisponibilite sont toujours les memes, et chacune a une
 * solution concrete : mieux vaut la donner que se contenter d'un bouton qui ne
 * repond pas.
 */
export function bluetoothEnvironment(): BluetoothEnvironment {
  if (typeof navigator === "undefined") {
    return { available: false, kind: "indisponible", message: "Environnement sans navigateur." };
  }

  if (isBluetoothSupported()) {
    if (isIos()) {
      // Sur iOS, la seule facon d'avoir Web Bluetooth est un navigateur tiers
      // qui l'implemente par-dessus CoreBluetooth : on y est donc deja.
      return {
        available: true,
        kind: "ok",
        message: "Bluetooth disponible dans ce navigateur.",
      };
    }
    return { available: true, kind: "ok", message: "Bluetooth disponible." };
  }

  if (typeof window !== "undefined" && !window.isSecureContext) {
    return {
      available: false,
      kind: "insecure",
      message:
        "Web Bluetooth exige une connexion securisee : la page doit etre servie en HTTPS.",
      remedy: "Ouvre l'application en https:// ou depuis localhost.",
    };
  }

  if (isIos()) {
    return {
      available: false,
      kind: "ios",
      message:
        "Sur iPhone et iPad, aucun navigateur du systeme n'expose Web Bluetooth : ni Safari, ni Chrome, ni Firefox, qui reposent tous sur WebKit.",
      remedy:
        "Installe Bluefy depuis l'App Store — un navigateur qui implemente Web Bluetooth — puis ouvre cette page dedans. Sinon, utilise Chrome sur Android ou sur ordinateur.",
    };
  }

  if (/Firefox/.test(navigator.userAgent)) {
    return {
      available: false,
      kind: "firefox",
      message: "Firefox ne prend pas en charge Web Bluetooth.",
      remedy: "Ouvre cette page dans Chrome, Edge ou Opera.",
    };
  }

  return {
    available: false,
    kind: "indisponible",
    message: "Ce navigateur n'expose pas Web Bluetooth.",
    remedy: "Utilise Chrome, Edge ou Opera, sur ordinateur ou sur Android.",
  };
}

/** Message court, pour les endroits ou le diagnostic complet ne tient pas. */
export function bluetoothUnavailableReason(): string {
  const environment = bluetoothEnvironment();
  return [environment.message, environment.remedy].filter(Boolean).join(" ");
}

/** Erreur d'appairage portant une cause exploitable par l'interface. */
export class WatchError extends Error {
  readonly cause: "annule" | "introuvable" | "connexion" | "indisponible";

  constructor(cause: WatchError["cause"], message: string) {
    super(message);
    this.name = "WatchError";
    this.cause = cause;
  }
}

/**
 * Connexion a la montre et lecture des mesures en direct.
 *
 * L'instance survit aux coupures : quand la montre sort de portee, la
 * reconnexion est tentee automatiquement avec un delai croissant, car il est
 * courant de perdre le lien quelques secondes au cours d'une sortie.
 */
export class Fit100SConnection {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private events: WatchEvents;
  private status: WatchStatus = "deconnecte";
  /** Derniere mesure connue, fusionnee entre les differents profils. */
  private latest: LiveSample = { timestamp: 0 };
  private identity: DeviceIdentity | null = null;
  private profiles: DeviceProfiles = {
    heartRate: false,
    cadence: false,
    battery: false,
    deviceInformation: false,
  };
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualDisconnect = false;

  constructor(events: WatchEvents = {}) {
    this.events = events;
    this.handleDisconnection = this.handleDisconnection.bind(this);
  }

  /**
   * Rebranche les callbacks sur l'interface courante. La connexion survit au
   * demontage de l'ecran Seance ; a son retour, c'est un nouveau composant qui
   * doit recevoir les mesures.
   */
  setEvents(events: WatchEvents): void {
    this.events = events;
    // Le nouvel abonne doit connaitre l'etat sans attendre la prochaine trame.
    events.onStatus?.(this.status);
    if (this.latest.timestamp > 0) events.onSample?.(this.latest);
    if (this.identity) events.onIdentity?.(this.identity);
    if (this.status === "connecte") events.onProfiles?.(this.profiles);
  }

  getStatus(): WatchStatus {
    return this.status;
  }

  getIdentity(): DeviceIdentity | null {
    return this.identity;
  }

  getProfiles(): DeviceProfiles {
    return this.profiles;
  }

  private setStatus(status: WatchStatus, detail?: string): void {
    this.status = status;
    this.events.onStatus?.(status, detail);
  }

  /**
   * Ouvre le selecteur d'appareils du navigateur puis se connecte.
   * Doit etre appelee depuis un geste utilisateur (clic) : le navigateur
   * refuse la demande autrement.
   *
   * `acceptAllDevices` sert de filet : les montres n'annoncent pas toutes leur
   * nom ni leurs services dans la trame de decouverte, si bien qu'un filtre
   * trop strict peut rendre un appareil parfaitement compatible invisible.
   */
  async connect(options: { acceptAllDevices?: boolean } = {}): Promise<DeviceIdentity> {
    const environment = bluetoothEnvironment();
    if (!environment.available) {
      throw new WatchError(
        "indisponible",
        [environment.message, environment.remedy].filter(Boolean).join(" "),
      );
    }

    this.manualDisconnect = false;
    this.setStatus("recherche");

    const optionalServices = [
      GATT.heartRate,
      GATT.runningSpeedCadence,
      GATT.battery,
      GATT.deviceInformation,
    ];

    let device: BluetoothDevice;
    try {
      device = await navigator.bluetooth.requestDevice(
        options.acceptAllDevices
          ? { acceptAllDevices: true, optionalServices }
          : {
              filters: [
                ...DECATHLON_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
                { services: [GATT.heartRate] },
                { services: [GATT.runningSpeedCadence] },
              ],
              optionalServices,
            },
      );
    } catch (error) {
      this.setStatus("deconnecte");
      throw classifyRequestError(error, options.acceptAllDevices ?? false);
    }

    this.device = device;
    device.addEventListener("gattserverdisconnected", this.handleDisconnection);

    try {
      await this.openGatt();
    } catch (error) {
      this.setStatus("erreur");
      throw new WatchError(
        "connexion",
        `La montre a ete trouvee mais la connexion a echoue (${(error as Error).message}). Verifie qu'aucune autre application, Decathlon Coach en particulier, n'est deja connectee a la montre.`,
      );
    }

    const identity = await this.readIdentity();
    this.identity = identity;
    this.events.onIdentity?.(identity);
    this.events.onProfiles?.(this.profiles);
    return identity;
  }

  /** Etablit la liaison GATT et s'abonne aux notifications disponibles. */
  private async openGatt(): Promise<void> {
    if (!this.device?.gatt) throw new Error("appareil Bluetooth indisponible");
    this.setStatus("connexion");

    this.server = await this.device.gatt.connect();
    this.reconnectAttempts = 0;

    // Chaque profil est optionnel : une montre sans capteur de cadence reste
    // parfaitement utilisable pour le cardio.
    this.profiles = {
      heartRate: await this.subscribeHeartRate(),
      cadence: await this.subscribeRunningCadence(),
      battery: await this.subscribeBattery(),
      deviceInformation: false,
    };

    this.setStatus("connecte");
  }

  private async subscribeHeartRate(): Promise<boolean> {
    const characteristic = await this.characteristic(
      GATT.heartRate,
      GATT.heartRateMeasurement,
    );
    if (!characteristic) return false;

    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", (event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (value) this.emit(parseHeartRateMeasurement(value));
    });
    return true;
  }

  private async subscribeRunningCadence(): Promise<boolean> {
    const characteristic = await this.characteristic(
      GATT.runningSpeedCadence,
      GATT.rscMeasurement,
    );
    if (!characteristic) return false;

    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", (event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (value) this.emit(parseRscMeasurement(value));
    });
    return true;
  }

  private async subscribeBattery(): Promise<boolean> {
    const characteristic = await this.characteristic(GATT.battery, GATT.batteryLevel);
    if (!characteristic) return false;

    const value = await characteristic.readValue();
    this.emit(parseBatteryLevel(value));

    // Toutes les montres ne notifient pas la batterie : on ignore l'echec.
    try {
      await characteristic.startNotifications();
      characteristic.addEventListener("characteristicvaluechanged", (event) => {
        const updated = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (updated) this.emit(parseBatteryLevel(updated));
      });
    } catch {
      // Lecture ponctuelle uniquement.
    }
    return true;
  }

  /** Lit l'identite de l'appareil, quand le profil Device Information existe. */
  private async readIdentity(): Promise<DeviceIdentity> {
    const identity: DeviceIdentity = {
      id: this.device?.id ?? "inconnu",
      name: this.device?.name ?? "Montre",
    };

    const read = async (uuid: string): Promise<string | undefined> => {
      const characteristic = await this.characteristic(GATT.deviceInformation, uuid);
      if (!characteristic) return undefined;
      try {
        const value = await characteristic.readValue();
        return new TextDecoder().decode(value).replace(/\0+$/, "").trim() || undefined;
      } catch {
        return undefined;
      }
    };

    identity.model = await read(GATT.modelNumber);
    identity.firmware = await read(GATT.firmwareRevision);
    identity.serial = await read(GATT.serialNumber);
    this.profiles.deviceInformation = Boolean(
      identity.model || identity.firmware || identity.serial,
    );
    return identity;
  }

  private async characteristic(
    service: string,
    characteristic: string,
  ): Promise<BluetoothRemoteGATTCharacteristic | null> {
    if (!this.server) return null;
    try {
      const gattService = await this.server.getPrimaryService(service);
      return await gattService.getCharacteristic(characteristic);
    } catch {
      // Service ou caracteristique absent de cette montre : cas normal.
      return null;
    }
  }

  /** Fusionne une mesure partielle avec l'etat courant et la diffuse. */
  private emit(partial: Partial<LiveSample>): void {
    this.latest = { ...this.latest, ...partial, timestamp: Date.now() };
    this.events.onSample?.(this.latest);
  }

  private handleDisconnection(): void {
    if (this.manualDisconnect) {
      this.setStatus("deconnecte");
      return;
    }
    this.setStatus("reconnexion", "Montre hors de portee, tentative de reconnexion...");
    this.scheduleReconnect();
  }

  /**
   * Reconnexion avec attente croissante (1 s, 2 s, 4 s... plafonnee a 30 s),
   * pendant dix tentatives : de quoi couvrir un passage sous un tunnel comme
   * une montre posee trop loin du telephone.
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.reconnectAttempts >= 10) {
      this.setStatus("erreur", "Reconnexion impossible apres dix tentatives.");
      return;
    }

    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.openGatt();
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  disconnect(): void {
    this.manualDisconnect = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.device?.removeEventListener("gattserverdisconnected", this.handleDisconnection);
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.device = null;
    this.server = null;
    this.identity = null;
    this.latest = { timestamp: 0 };
    this.profiles = {
      heartRate: false,
      cadence: false,
      battery: false,
      deviceInformation: false,
    };
    this.setStatus("deconnecte");
  }
}

/**
 * Traduit l'erreur du selecteur en cause exploitable. Le navigateur leve la
 * meme `NotFoundError` que l'utilisateur ait ferme la fenetre ou qu'aucun
 * appareil ne soit apparu : le texte du message permet de trancher.
 */
function classifyRequestError(error: unknown, acceptedAll: boolean): WatchError {
  const message = (error as Error)?.message ?? "";

  if (/cancel|annul/i.test(message)) {
    return new WatchError("annule", "Recherche annulee.");
  }
  if (/User denied|permission/i.test(message)) {
    return new WatchError(
      "annule",
      "Acces au Bluetooth refuse. Autorise-le dans les reglages du navigateur.",
    );
  }
  if (/globally disabled|turned off|adapter/i.test(message)) {
    return new WatchError(
      "indisponible",
      "Le Bluetooth de l'appareil est eteint. Active-le puis reessaie.",
    );
  }

  return new WatchError(
    "introuvable",
    acceptedAll
      ? "Aucun appareil Bluetooth detecte. Reveille la montre, rapproche-la, et verifie qu'elle n'est pas deja connectee a l'application Decathlon Coach."
      : "Montre introuvable avec les filtres habituels. Essaie la recherche elargie, qui affiche tous les appareils Bluetooth des environs.",
  );
}

/**
 * Connexion partagee par l'application. Comme l'enregistreur de seance, elle
 * ne doit pas etre recreee a chaque affichage de l'ecran Seance : la montre
 * resterait connectee a un objet devenu invisible.
 */
let sharedConnection: Fit100SConnection | null = null;

export function watchConnection(events: WatchEvents = {}): Fit100SConnection {
  if (!sharedConnection) sharedConnection = new Fit100SConnection(events);
  else sharedConnection.setEvents(events);
  return sharedConnection;
}

/**
 * Point d'extension pour un protocole de synchronisation proprietaire.
 *
 * Le transfert d'historique de la Fit 100 S passe par un service Bluetooth
 * non documente par Decathlon. Si ce protocole est un jour publie ou analyse,
 * il suffit d'implementer cette interface et de l'enregistrer : le reste de
 * l'application (import, metriques, coaching) fonctionne deja sur les fichiers
 * d'activite normalises.
 */
export interface VendorSyncCodec {
  /** UUID du service proprietaire a declarer dans optionalServices. */
  serviceUuid: string;
  /** Nom lisible du protocole, affiche dans les reglages. */
  label: string;
  /** Liste les seances stockees dans la montre. */
  listActivities(
    server: BluetoothRemoteGATTServer,
  ): Promise<Array<{ id: string; startTime: number }>>;
  /** Telecharge une seance sous forme de fichier FIT, GPX ou TCX. */
  download(server: BluetoothRemoteGATTServer, id: string): Promise<Uint8Array>;
}

const vendorCodecs: VendorSyncCodec[] = [];

export function registerVendorCodec(codec: VendorSyncCodec): void {
  vendorCodecs.push(codec);
}

export function availableVendorCodecs(): readonly VendorSyncCodec[] {
  return vendorCodecs;
}
