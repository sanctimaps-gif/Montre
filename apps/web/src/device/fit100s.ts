/**
 * Connexion a la montre Decathlon Fit 100 S (et aux autres montres et
 * ceintures compatibles) via Web Bluetooth.
 *
 * Ce que fait ce module, et pourquoi il est construit ainsi :
 *
 * Decathlon ne publie ni SDK ni documentation du protocole de synchronisation
 * de ses montres : le transfert d'historique entre la montre et l'application
 * Decathlon Coach passe par un service Bluetooth proprietaire non documente.
 * On ne peut donc pas le reimplementer de maniere fiable a l'aveugle.
 *
 * En revanche, comme la quasi-totalite des montres de sport, la Fit 100 S
 * expose pendant l'effort les profils Bluetooth standards du Bluetooth SIG.
 * Ce module s'appuie exclusivement sur ces profils publics :
 *
 *   - Heart Rate (0x180D)              frequence cardiaque en direct
 *   - Running Speed and Cadence (0x1814) allure, cadence, distance
 *   - Battery (0x180F)                 niveau de batterie
 *   - Device Information (0x180A)      modele, firmware, numero de serie
 *
 * Les seances passees se recuperent par import de fichier (.fit, .gpx, .tcx)
 * depuis l'export Decathlon Coach : c'est le chemin documente et stable.
 * Un emplacement est prevu plus bas pour brancher un codec proprietaire si le
 * protocole venait a etre documente.
 */

/** Identifiants des services et caracteristiques standards utilises. */
export const GATT = {
  heartRate: "heart_rate",
  heartRateMeasurement: "heart_rate_measurement",
  bodySensorLocation: "body_sensor_location",
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
  "FIT100",
  "Decathlon",
  "DKT",
  "Geonaute",
  "Kalenji",
  "Kiprun",
  "Domyos",
  "ONmove",
];

export interface DeviceIdentity {
  id: string;
  name: string;
  model?: string;
  firmware?: string;
  serial?: string;
}

/** Mesure instantanee agregee depuis les differents profils. */
export interface LiveSample {
  timestamp: number;
  hr?: number;
  /** Intervalles RR en millisecondes, utiles pour la variabilite cardiaque. */
  rrIntervals?: number[];
  /** Vrai si la montre signale un mauvais contact du capteur. */
  poorSensorContact?: boolean;
  /** Vitesse instantanee en m/s, issue du profil course. */
  speed?: number;
  /** Cadence en pas par minute. */
  cadence?: number;
  /** Longueur de foulee en metres. */
  strideLength?: number;
  /** Distance cumulee mesuree par la montre, en metres. */
  totalDistance?: number;
  battery?: number;
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
}

/** Vrai si le navigateur expose Web Bluetooth. */
export function isBluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

/**
 * Message d'aide quand Web Bluetooth est indisponible. Les causes sont
 * toujours les memes et meritent d'etre expliquees precisement a l'utilisateur.
 */
export function bluetoothUnavailableReason(): string {
  if (typeof navigator === "undefined") return "Environnement sans navigateur.";
  if (!window.isSecureContext) {
    return "Web Bluetooth exige une connexion securisee : ouvre l'application en HTTPS ou depuis localhost.";
  }
  const ua = navigator.userAgent;
  if (/Firefox/.test(ua)) {
    return "Firefox ne prend pas en charge Web Bluetooth. Utilise Chrome, Edge ou Opera, sur ordinateur ou sur Android.";
  }
  if (/iPhone|iPad|iPod/.test(ua)) {
    return "iOS ne prend pas en charge Web Bluetooth dans Safari. Sur iPhone, importe tes seances en fichier (.fit, .gpx, .tcx) depuis Decathlon Coach.";
  }
  return "Ce navigateur n'expose pas Web Bluetooth. Utilise Chrome ou Edge, ou passe par l'import de fichier.";
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
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualDisconnect = false;

  constructor(events: WatchEvents = {}) {
    this.events = events;
    this.handleDisconnection = this.handleDisconnection.bind(this);
  }

  getStatus(): WatchStatus {
    return this.status;
  }

  getIdentity(): DeviceIdentity | null {
    if (!this.device) return null;
    return { id: this.device.id, name: this.device.name ?? "Montre" };
  }

  private setStatus(status: WatchStatus, detail?: string): void {
    this.status = status;
    this.events.onStatus?.(status, detail);
  }

  /**
   * Ouvre le selecteur d'appareils du navigateur puis se connecte.
   * Doit etre appelee depuis un geste utilisateur (clic) : le navigateur
   * refuse la demande autrement.
   */
  async connect(): Promise<DeviceIdentity> {
    if (!isBluetoothSupported()) {
      throw new Error(bluetoothUnavailableReason());
    }

    this.manualDisconnect = false;
    this.setStatus("recherche");

    // On propose d'abord les montres Decathlon par leur nom, tout en acceptant
    // n'importe quel appareil exposant le profil cardio (ceinture, autre montre).
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        ...DECATHLON_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
        { services: [GATT.heartRate] },
        { services: [GATT.runningSpeedCadence] },
      ],
      optionalServices: [
        GATT.heartRate,
        GATT.runningSpeedCadence,
        GATT.battery,
        GATT.deviceInformation,
      ],
    });

    this.device = device;
    device.addEventListener("gattserverdisconnected", this.handleDisconnection);

    await this.openGatt();
    const identity = await this.readIdentity();
    this.events.onIdentity?.(identity);
    return identity;
  }

  /** Etablit la liaison GATT et s'abonne aux notifications disponibles. */
  private async openGatt(): Promise<void> {
    if (!this.device?.gatt) throw new Error("Appareil Bluetooth indisponible");
    this.setStatus("connexion");

    this.server = await this.device.gatt.connect();
    this.reconnectAttempts = 0;

    // Chaque profil est optionnel : une montre sans capteur de cadence reste
    // parfaitement utilisable pour le cardio.
    await this.subscribeHeartRate();
    await this.subscribeRunningCadence();
    await this.subscribeBattery();

    this.setStatus("connecte");
  }

  private async subscribeHeartRate(): Promise<void> {
    const characteristic = await this.characteristic(
      GATT.heartRate,
      GATT.heartRateMeasurement,
    );
    if (!characteristic) return;

    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", (event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      this.emit(parseHeartRateMeasurement(value));
    });
  }

  private async subscribeRunningCadence(): Promise<void> {
    const characteristic = await this.characteristic(
      GATT.runningSpeedCadence,
      GATT.rscMeasurement,
    );
    if (!characteristic) return;

    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", (event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      this.emit(parseRscMeasurement(value));
    });
  }

  private async subscribeBattery(): Promise<void> {
    const characteristic = await this.characteristic(GATT.battery, GATT.batteryLevel);
    if (!characteristic) return;

    const value = await characteristic.readValue();
    this.emit({ battery: value.getUint8(0) });

    // Toutes les montres ne notifient pas la batterie : on ignore l'echec.
    try {
      await characteristic.startNotifications();
      characteristic.addEventListener("characteristicvaluechanged", (event) => {
        const updated = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (updated) this.emit({ battery: updated.getUint8(0) });
      });
    } catch {
      // Lecture ponctuelle uniquement.
    }
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
    this.setStatus("deconnecte");
  }
}

/**
 * Decodage de la caracteristique Heart Rate Measurement (0x2A37), telle que
 * definie par le Bluetooth SIG.
 *
 * Octet de drapeaux :
 *   bit 0    format de la FC : 0 = uint8, 1 = uint16
 *   bits 1-2 etat du contact capteur (0b11 = contact detecte)
 *   bit 3    depense energetique presente
 *   bit 4    intervalles RR presents
 */
export function parseHeartRateMeasurement(value: DataView): Partial<LiveSample> {
  const flags = value.getUint8(0);
  const is16Bit = (flags & 0x01) !== 0;
  const contactSupported = (flags & 0x04) !== 0;
  const contactDetected = (flags & 0x02) !== 0;
  const hasEnergy = (flags & 0x08) !== 0;
  const hasRr = (flags & 0x10) !== 0;

  let offset = 1;
  const hr = is16Bit ? value.getUint16(offset, true) : value.getUint8(offset);
  offset += is16Bit ? 2 : 1;

  if (hasEnergy) offset += 2;

  const rrIntervals: number[] = [];
  if (hasRr) {
    while (offset + 1 < value.byteLength) {
      // Les intervalles RR sont exprimes en 1/1024 de seconde.
      rrIntervals.push((value.getUint16(offset, true) / 1024) * 1000);
      offset += 2;
    }
  }

  return {
    hr,
    rrIntervals: rrIntervals.length > 0 ? rrIntervals : undefined,
    poorSensorContact: contactSupported ? !contactDetected : undefined,
  };
}

/**
 * Decodage de la caracteristique RSC Measurement (0x2A53).
 *
 * Octet de drapeaux :
 *   bit 0 longueur de foulee presente
 *   bit 1 distance totale presente
 *   bit 2 course (1) ou marche (0)
 */
export function parseRscMeasurement(value: DataView): Partial<LiveSample> {
  const flags = value.getUint8(0);
  const hasStride = (flags & 0x01) !== 0;
  const hasDistance = (flags & 0x02) !== 0;

  // Vitesse en unites de 1/256 m/s, cadence en pas par minute.
  const speed = value.getUint16(1, true) / 256;
  const cadence = value.getUint8(3);
  let offset = 4;

  let strideLength: number | undefined;
  if (hasStride) {
    strideLength = value.getUint16(offset, true) / 100;
    offset += 2;
  }

  let totalDistance: number | undefined;
  if (hasDistance) {
    // Distance totale en decimetres.
    totalDistance = value.getUint32(offset, true) / 10;
  }

  return { speed, cadence, strideLength, totalDistance };
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
  listActivities(server: BluetoothRemoteGATTServer): Promise<Array<{ id: string; startTime: number }>>;
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
