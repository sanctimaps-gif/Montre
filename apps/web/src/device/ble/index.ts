import type { BleTransport } from "./transport.ts";
import { NativeBluetoothTransport } from "./native-transport.ts";
import { WebBluetoothTransport } from "./web-transport.ts";

export type { BleDevice, BleTransport, RequestOptions, TransportKind } from "./transport.ts";
export { TransportError } from "./transport.ts";

/**
 * Choix de la liaison Bluetooth.
 *
 * Le Bluetooth natif prime quand il existe : l'application installee sur le
 * telephone y a droit, ce qui n'est pas le cas d'une page web sur iPhone.
 * Dans un navigateur, on retombe sur Web Bluetooth.
 */
const transports: BleTransport[] = [
  new NativeBluetoothTransport(),
  new WebBluetoothTransport(),
];

export function selectTransport(): BleTransport | null {
  return transports.find((transport) => transport.isAvailable()) ?? null;
}

/** Liaison disponible, ou `null` si aucune ne l'est sur cet appareil. */
export function transportKind(): "web" | "natif" | null {
  return selectTransport()?.kind ?? null;
}

/** Vrai quand le code tourne dans l'application installee, pas dans un navigateur. */
export function isNativeApp(): boolean {
  return transportKind() === "natif";
}
