import type { LiveSample } from "@montre/core";
import {
  GATT_UUID,
  parseBatteryLevel,
  parseHeartRateMeasurement,
  parseRscMeasurement,
} from "@montre/core";
import type { BleDevice, TransportKind } from "./ble/index.ts";
import { TransportError, selectTransport } from "./ble/index.ts";

/**
 * Connexion a la montre Decathlon Fit 100 S (et aux autres montres et
 * ceintures compatibles).
 *
 * Decathlon ne publie ni SDK ni documentation du protocole de synchronisation
 * de ses montres : le transfert d'historique vers Decathlon Hub passe par un
 * service Bluetooth prive. En revanche, comme la quasi-totalite des montres de
 * sport, la Fit 100 S expose pendant l'effort les profils publics du Bluetooth
 * SIG, et ce sont eux que ce module utilise :
 *
 *   - Heart Rate (0x180D)                frequence cardiaque, intervalles RR
 *   - Running Speed and Cadence (0x1814) allure, cadence, distance
 *   - Battery (0x180F)                   niveau de batterie
 *   - Device Information (0x180A)        modele, firmware, numero de serie
 *
 * La liaison elle-meme — navigateur ou Bluetooth natif de l'application
 * installee — est choisie par `selectTransport()`. Ce module n'en sait rien :
 * il decrit ce qu'il veut lire, pas comment la radio est atteinte.
 */

export type { LiveSample } from "@montre/core";

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

/** Comment la montre peut etre atteinte sur cet appareil, et sinon pourquoi. */
export interface BluetoothEnvironment {
  available: boolean;
  kind: "natif" | "web" | "ios" | "firefox" | "insecure" | "indisponible";
  /** Explication courte, affichable telle quelle. */
  message: string;
  /** Marche a suivre concrete quand une solution existe. */
  remedy?: string;
}

/** Liaison Bluetooth utilisable ici, ou `null`. */
export function activeTransport(): TransportKind | null {
  return selectTransport()?.kind ?? null;
}

export function isBluetoothSupported(): boolean {
  return selectTransport() != null;
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
 * Diagnostic de la plateforme. Quand rien n'est disponible, les causes sont
 * toujours les memes et chacune a une solution concrete : mieux vaut la donner
 * que se contenter d'un bouton qui ne repond pas.
 */
export function bluetoothEnvironment(): BluetoothEnvironment {
  const transport = selectTransport();

  if (transport?.kind === "natif") {
    return {
      available: true,
      kind: "natif",
      message: "Bluetooth du telephone, via l'application installee.",
    };
  }

  if (transport?.kind === "web") {
    return { available: true, kind: "web", message: "Bluetooth disponible dans ce navigateur." };
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
        "Sur iPhone et iPad, aucun navigateur du systeme n'expose le Bluetooth aux pages web : Safari, Chrome et Firefox reposent tous sur WebKit.",
      remedy:
        "Installe l'application Montre sur ton telephone : elle accede au Bluetooth comme n'importe quelle application, et se connecte directement a ta montre.",
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
    remedy: "Utilise Chrome, Edge ou Opera, ou installe l'application sur ton telephone.",
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
  private device: BleDevice | null = null;
  private events: WatchEvents;
  private status: WatchStatus = "deconnecte";
  /** Derniere mesure connue, fusionnee entre les differents profils. */
  private latest: LiveSample = { timestamp: 0 };
  private identity: DeviceIdentity | null = null;
  private profiles: DeviceProfiles = emptyProfiles();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualDisconnect = false;

  constructor(events: WatchEvents = {}) {
    this.events = events;
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
   * Ouvre le selecteur d'appareils puis se connecte. Doit etre appelee depuis
   * un geste utilisateur : les navigateurs refusent la demande autrement.
   *
   * `acceptAllDevices` sert de filet : les montres n'annoncent pas toutes leur
   * nom ni leurs services dans la trame de decouverte, si bien qu'un filtre
   * trop strict peut rendre un appareil parfaitement compatible invisible.
   */
  async connect(options: { acceptAllDevices?: boolean } = {}): Promise<DeviceIdentity> {
    const transport = selectTransport();
    if (!transport) {
      const environment = bluetoothEnvironment();
      throw new WatchError(
        "indisponible",
        [environment.message, environment.remedy].filter(Boolean).join(" "),
      );
    }

    this.manualDisconnect = false;
    this.setStatus("recherche");

    try {
      this.device = await transport.requestDevice({
        services: [GATT_UUID.heartRate, GATT_UUID.runningSpeedCadence],
        optionalServices: [
          GATT_UUID.heartRate,
          GATT_UUID.runningSpeedCadence,
          GATT_UUID.battery,
          GATT_UUID.deviceInformation,
        ],
        namePrefixes: DECATHLON_NAME_PREFIXES,
        acceptAll: options.acceptAllDevices ?? false,
      });
    } catch (error) {
      this.setStatus("deconnecte");
      throw toWatchError(error);
    }

    this.device.onDisconnected(() => this.handleDisconnection());

    try {
      await this.openLink();
    } catch (error) {
      this.setStatus("erreur");
      throw new WatchError(
        "connexion",
        `La montre a ete trouvee mais la connexion a echoue (${(error as Error).message}). Verifie qu'aucune autre application, Decathlon Hub en particulier, n'est deja connectee a la montre.`,
      );
    }

    const identity = await this.readIdentity();
    this.identity = identity;
    this.events.onIdentity?.(identity);
    this.events.onProfiles?.(this.profiles);
    return identity;
  }

  /** Etablit la liaison et s'abonne aux notifications disponibles. */
  private async openLink(): Promise<void> {
    if (!this.device) throw new Error("aucun appareil selectionne");
    this.setStatus("connexion");

    await this.device.connect();
    this.reconnectAttempts = 0;

    // Chaque profil est optionnel : une montre sans capteur de cadence reste
    // parfaitement utilisable pour le cardio.
    this.profiles = {
      heartRate: await this.device.subscribe(
        GATT_UUID.heartRate,
        GATT_UUID.heartRateMeasurement,
        (value) => this.emit(parseHeartRateMeasurement(value)),
      ),
      cadence: await this.device.subscribe(
        GATT_UUID.runningSpeedCadence,
        GATT_UUID.rscMeasurement,
        (value) => this.emit(parseRscMeasurement(value)),
      ),
      battery: await this.readBattery(),
      deviceInformation: false,
    };

    this.setStatus("connecte");
  }

  private async readBattery(): Promise<boolean> {
    if (!this.device) return false;

    const value = await this.device.read(GATT_UUID.battery, GATT_UUID.batteryLevel);
    if (!value) return false;
    this.emit(parseBatteryLevel(value));

    // Toutes les montres ne notifient pas la batterie : l'echec est sans effet.
    await this.device.subscribe(GATT_UUID.battery, GATT_UUID.batteryLevel, (updated) =>
      this.emit(parseBatteryLevel(updated)),
    );
    return true;
  }

  /** Lit l'identite de l'appareil, quand le profil Device Information existe. */
  private async readIdentity(): Promise<DeviceIdentity> {
    const identity: DeviceIdentity = {
      id: this.device?.id ?? "inconnu",
      name: this.device?.name ?? "Montre",
    };

    const read = async (uuid: string): Promise<string | undefined> => {
      const value = await this.device?.read(GATT_UUID.deviceInformation, uuid);
      if (!value) return undefined;
      return new TextDecoder().decode(value).replace(/\0+$/, "").trim() || undefined;
    };

    identity.model = await read(GATT_UUID.modelNumber);
    identity.firmware = await read(GATT_UUID.firmwareRevision);
    identity.serial = await read(GATT_UUID.serialNumber);
    this.profiles.deviceInformation = Boolean(
      identity.model || identity.firmware || identity.serial,
    );
    return identity;
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
        await this.openLink();
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  disconnect(): void {
    this.manualDisconnect = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    void this.device?.disconnect();
    this.device = null;
    this.identity = null;
    this.latest = { timestamp: 0 };
    this.profiles = emptyProfiles();
    this.setStatus("deconnecte");
  }
}

function emptyProfiles(): DeviceProfiles {
  return { heartRate: false, cadence: false, battery: false, deviceInformation: false };
}

function toWatchError(error: unknown): WatchError {
  if (error instanceof TransportError) {
    return new WatchError(error.failure, error.message);
  }
  return new WatchError("connexion", (error as Error)?.message ?? "Connexion impossible.");
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
  listActivities(device: BleDevice): Promise<Array<{ id: string; startTime: number }>>;
  /** Telecharge une seance sous forme de fichier FIT, GPX ou TCX. */
  download(device: BleDevice, id: string): Promise<Uint8Array>;
}

const vendorCodecs: VendorSyncCodec[] = [];

export function registerVendorCodec(codec: VendorSyncCodec): void {
  vendorCodecs.push(codec);
}

export function availableVendorCodecs(): readonly VendorSyncCodec[] {
  return vendorCodecs;
}
