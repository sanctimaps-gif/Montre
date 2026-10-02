import type { BleDevice, BleTransport, RequestOptions } from "./transport.ts";
import { TransportError } from "./transport.ts";

/**
 * Liaison par Web Bluetooth, utilisee dans un navigateur de bureau ou Android.
 *
 * Elle n'existe pas sur iOS : aucun navigateur du systeme ne l'expose, tous
 * reposant sur WebKit. C'est precisement ce que la liaison native resout.
 */
export class WebBluetoothTransport implements BleTransport {
  readonly kind = "web" as const;

  isAvailable(): boolean {
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  }

  async requestDevice(options: RequestOptions): Promise<BleDevice> {
    if (!this.isAvailable()) {
      throw new TransportError("indisponible", "Web Bluetooth n'est pas disponible ici.");
    }

    // Sans filtre, le navigateur exige explicitement acceptAllDevices.
    const filters = [
      ...options.namePrefixes.map((namePrefix) => ({ namePrefix })),
      ...options.services.map((service) => ({ services: [service] })),
    ];

    let device: BluetoothDevice;
    try {
      device = await navigator.bluetooth.requestDevice(
        options.acceptAll || filters.length === 0
          ? { acceptAllDevices: true, optionalServices: options.optionalServices }
          : { filters, optionalServices: options.optionalServices },
      );
    } catch (error) {
      throw classify(error, options.acceptAll);
    }

    return new WebBleDevice(device);
  }
}

class WebBleDevice implements BleDevice {
  readonly id: string;
  readonly name: string;
  private device: BluetoothDevice;
  private server: BluetoothRemoteGATTServer | null = null;

  constructor(device: BluetoothDevice) {
    this.device = device;
    this.id = device.id;
    this.name = device.name ?? "Montre";
  }

  async connect(): Promise<void> {
    if (!this.device.gatt) {
      throw new TransportError("connexion", "Cet appareil n'expose pas de services GATT.");
    }
    this.server = await this.device.gatt.connect();
  }

  async disconnect(): Promise<void> {
    if (this.device.gatt?.connected) this.device.gatt.disconnect();
    this.server = null;
  }

  onDisconnected(listener: () => void): void {
    this.device.addEventListener("gattserverdisconnected", listener);
  }

  async read(service: string, characteristic: string): Promise<DataView | null> {
    const found = await this.characteristic(service, characteristic);
    if (!found) return null;
    try {
      return await found.readValue();
    } catch {
      return null;
    }
  }

  async subscribe(
    service: string,
    characteristic: string,
    onValue: (value: DataView) => void,
  ): Promise<boolean> {
    const found = await this.characteristic(service, characteristic);
    if (!found) return false;

    try {
      await found.startNotifications();
    } catch {
      return false;
    }

    found.addEventListener("characteristicvaluechanged", (event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (value) onValue(value);
    });
    return true;
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
}

/**
 * Le navigateur leve la meme erreur que l'utilisateur ait ferme le selecteur
 * ou qu'aucun appareil n'y soit apparu : le message permet de trancher.
 */
function classify(error: unknown, acceptedAll: boolean): TransportError {
  const message = (error as Error)?.message ?? "";

  if (/cancel|annul/i.test(message)) {
    return new TransportError("annule", "Recherche annulee.");
  }
  if (/User denied|permission/i.test(message)) {
    return new TransportError(
      "annule",
      "Acces au Bluetooth refuse. Autorise-le dans les reglages du navigateur.",
    );
  }
  if (/globally disabled|turned off|adapter/i.test(message)) {
    return new TransportError(
      "indisponible",
      "Le Bluetooth de l'appareil est eteint. Active-le puis reessaie.",
    );
  }

  return new TransportError(
    "introuvable",
    acceptedAll
      ? "Aucun appareil Bluetooth detecte. Reveille la montre, rapproche-la, et verifie qu'elle n'est pas deja connectee a une autre application."
      : "Montre introuvable avec les filtres habituels. Essaie la recherche elargie, qui affiche tous les appareils des environs.",
  );
}
