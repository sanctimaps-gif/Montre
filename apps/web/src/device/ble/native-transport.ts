import { Capacitor } from "@capacitor/core";
import type { BleDevice, BleTransport, RequestOptions } from "./transport.ts";
import { TransportError } from "./transport.ts";

/**
 * Liaison par le Bluetooth natif du systeme, disponible quand l'application
 * tourne installee sur le telephone plutot que dans un navigateur.
 *
 * C'est la seule voie possible sur iPhone : aucun navigateur du systeme
 * n'expose Web Bluetooth, mais une application installee accede au Bluetooth
 * comme n'importe quelle application native. Le greffon est charge a la
 * demande, pour qu'un navigateur ne telecharge jamais ce code.
 */
export class NativeBluetoothTransport implements BleTransport {
  readonly kind = "natif" as const;
  private initialized = false;

  isAvailable(): boolean {
    try {
      return Capacitor.isNativePlatform();
    } catch {
      return false;
    }
  }

  private async client() {
    const { BleClient } = await import("@capacitor-community/bluetooth-le");
    if (!this.initialized) {
      // Sur Android, declarer qu'on ne se sert pas du Bluetooth pour localiser
      // evite d'avoir a demander l'acces a la position.
      await BleClient.initialize({ androidNeverForLocation: true });
      this.initialized = true;
    }
    return BleClient;
  }

  async requestDevice(options: RequestOptions): Promise<BleDevice> {
    const BleClient = await this.client();

    if (!(await BleClient.isEnabled().catch(() => true))) {
      throw new TransportError(
        "indisponible",
        "Le Bluetooth du telephone est eteint. Active-le puis reessaie.",
      );
    }

    try {
      // Sans service exige, le selecteur du systeme montre tous les appareils.
      const device = await BleClient.requestDevice({
        services: options.acceptAll ? [] : options.services,
        optionalServices: options.optionalServices,
      });
      return new NativeBleDevice(device.deviceId, device.name ?? "Montre", () => this.client());
    } catch (error) {
      throw classify(error, options.acceptAll);
    }
  }
}

type Client = Awaited<ReturnType<NativeBluetoothTransport["client"]>>;

class NativeBleDevice implements BleDevice {
  readonly id: string;
  readonly name: string;
  private getClient: () => Promise<Client>;
  private disconnectListeners: Array<() => void> = [];

  constructor(id: string, name: string, getClient: () => Promise<Client>) {
    this.id = id;
    this.name = name;
    this.getClient = getClient;
  }

  async connect(): Promise<void> {
    const client = await this.getClient();
    try {
      await client.connect(this.id, () => {
        for (const listener of this.disconnectListeners) listener();
      });
    } catch (error) {
      throw new TransportError("connexion", (error as Error).message);
    }
  }

  async disconnect(): Promise<void> {
    const client = await this.getClient();
    await client.disconnect(this.id).catch(() => undefined);
  }

  onDisconnected(listener: () => void): void {
    this.disconnectListeners.push(listener);
  }

  async read(service: string, characteristic: string): Promise<DataView | null> {
    const client = await this.getClient();
    try {
      return await client.read(this.id, service, characteristic);
    } catch {
      // Caracteristique absente de cette montre : cas normal.
      return null;
    }
  }

  async subscribe(
    service: string,
    characteristic: string,
    onValue: (value: DataView) => void,
  ): Promise<boolean> {
    const client = await this.getClient();
    try {
      await client.startNotifications(this.id, service, characteristic, onValue);
      return true;
    } catch {
      return false;
    }
  }
}

function classify(error: unknown, acceptedAll: boolean): TransportError {
  const message = (error as Error)?.message ?? "";

  if (/cancel|annul|dismiss/i.test(message)) {
    return new TransportError("annule", "Recherche annulee.");
  }
  if (/permission|denied|unauthorized/i.test(message)) {
    return new TransportError(
      "annule",
      "L'application n'a pas l'autorisation d'utiliser le Bluetooth. Accorde-la dans les reglages du telephone.",
    );
  }
  if (/disabled|turned off|not enabled/i.test(message)) {
    return new TransportError(
      "indisponible",
      "Le Bluetooth du telephone est eteint. Active-le puis reessaie.",
    );
  }

  return new TransportError(
    "introuvable",
    acceptedAll
      ? "Aucun appareil Bluetooth detecte. Reveille la montre, rapproche-la, et verifie qu'elle n'est pas deja connectee a Decathlon Hub."
      : "Montre introuvable parmi les appareils exposant le profil cardio. Essaie la recherche elargie.",
  );
}
