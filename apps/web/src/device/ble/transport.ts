/**
 * Abstraction de la liaison Bluetooth.
 *
 * L'application doit pouvoir parler a la montre de deux facons :
 *
 *   - dans un navigateur, par Web Bluetooth ;
 *   - dans l'application installee sur le telephone, par le Bluetooth natif
 *     du systeme — la seule voie possible sur iPhone, ou aucun navigateur
 *     n'expose Web Bluetooth.
 *
 * Tout le reste du code — decouverte, abonnement aux profils, reconnexion,
 * decodage — est ecrit une seule fois contre cette interface et ne sait pas
 * laquelle des deux il utilise.
 */

export type TransportKind = "web" | "natif";

/** Appareil decouvert, pret a etre connecte. */
export interface BleDevice {
  readonly id: string;
  readonly name: string;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /** Prevenu quand la liaison tombe, volontairement ou non. */
  onDisconnected(listener: () => void): void;

  /**
   * Lit une caracteristique. Rend `null` quand le service ou la
   * caracteristique n'existe pas sur cet appareil, ce qui est un cas normal :
   * toutes les montres n'exposent pas les memes profils.
   */
  read(service: string, characteristic: string): Promise<DataView | null>;

  /**
   * S'abonne aux notifications d'une caracteristique. Rend `false` quand elle
   * est absente, sans lever d'erreur.
   */
  subscribe(
    service: string,
    characteristic: string,
    onValue: (value: DataView) => void,
  ): Promise<boolean>;
}

export interface RequestOptions {
  /** Services a exiger de l'appareil. Vide pour n'appliquer aucun filtre. */
  services: string[];
  /** Services auxquels on accedera apres connexion. */
  optionalServices: string[];
  /** Noms acceptes, quand la plateforme sait filtrer dessus. */
  namePrefixes: string[];
  /** Vrai pour presenter tous les appareils des environs, sans filtre. */
  acceptAll: boolean;
}

export interface BleTransport {
  readonly kind: TransportKind;
  /** Vrai si cette liaison peut etre utilisee sur l'appareil courant. */
  isAvailable(): boolean;
  /** Ouvre le selecteur d'appareils et rend celui que l'utilisateur choisit. */
  requestDevice(options: RequestOptions): Promise<BleDevice>;
}

/** Raisons d'echec communes aux deux liaisons, pour un message juste. */
export type TransportFailure = "annule" | "introuvable" | "connexion" | "indisponible";

export class TransportError extends Error {
  readonly failure: TransportFailure;

  constructor(failure: TransportFailure, message: string) {
    super(message);
    this.name = "TransportError";
    this.failure = failure;
  }
}
