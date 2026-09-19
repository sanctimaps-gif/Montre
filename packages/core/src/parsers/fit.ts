import type { Lap, Sport, TrackPoint } from "../types.ts";
import type { ParsedActivity } from "./types.ts";

/**
 * Decodeur FIT (Flexible and Interoperable Data Transfer), le format natif des
 * montres Garmin, Suunto, Coros et des exports Decathlon Coach / Strava.
 *
 * Le fichier est une suite d'enregistrements precedes de messages de
 * definition qui decrivent la structure des messages de donnees suivants.
 * On ne decode que les messages utiles a une activite : file_id, session, lap,
 * record et sport.
 */

/** Decalage entre l'epoque FIT (1989-12-31 UTC) et l'epoque Unix, en secondes. */
const FIT_EPOCH_OFFSET = 631_065_600;

/** Conversion des semicercles FIT en degres decimaux. */
const SEMICIRCLE_TO_DEGREE = 180 / 2 ** 31;

/** Numeros des messages globaux FIT que l'on decode. */
const Global = {
  FileId: 0,
  Sport: 12,
  Session: 18,
  Lap: 19,
  Record: 20,
} as const;

interface FieldDefinition {
  fieldNumber: number;
  size: number;
  baseType: number;
}

interface MessageDefinition {
  globalMessageNumber: number;
  littleEndian: boolean;
  fields: FieldDefinition[];
  /** Taille totale des champs developpeur, ignores mais a sauter. */
  developerSize: number;
}

type FieldValue = number | string | number[];

/** Taille en octets et caractere signe de chaque type de base FIT. */
const BASE_TYPES: Record<
  number,
  { size: number; read: (view: DataView, offset: number, le: boolean) => number | null }
> = {
  0x00: { size: 1, read: (v, o) => invalidIf(v.getUint8(o), 0xff) },
  0x01: { size: 1, read: (v, o) => invalidIf(v.getInt8(o), 0x7f) },
  0x02: { size: 1, read: (v, o) => invalidIf(v.getUint8(o), 0xff) },
  0x83: { size: 2, read: (v, o, le) => invalidIf(v.getInt16(o, le), 0x7fff) },
  0x84: { size: 2, read: (v, o, le) => invalidIf(v.getUint16(o, le), 0xffff) },
  0x85: { size: 4, read: (v, o, le) => invalidIf(v.getInt32(o, le), 0x7fffffff) },
  0x86: { size: 4, read: (v, o, le) => invalidIf(v.getUint32(o, le), 0xffffffff) },
  0x88: {
    size: 4,
    read: (v, o, le) => {
      const value = v.getFloat32(o, le);
      return Number.isNaN(value) ? null : value;
    },
  },
  0x89: {
    size: 8,
    read: (v, o, le) => {
      const value = v.getFloat64(o, le);
      return Number.isNaN(value) ? null : value;
    },
  },
  0x0a: { size: 1, read: (v, o) => invalidIf(v.getUint8(o), 0) },
  0x8b: { size: 2, read: (v, o, le) => invalidIf(v.getUint16(o, le), 0) },
  0x8c: { size: 4, read: (v, o, le) => invalidIf(v.getUint32(o, le), 0) },
  0x0d: { size: 1, read: (v, o) => invalidIf(v.getUint8(o), 0xff) },
  0x8e: {
    size: 8,
    read: (v, o, le) => {
      const value = v.getBigInt64(o, le);
      return value === 0x7fffffffffffffffn ? null : Number(value);
    },
  },
  0x8f: {
    size: 8,
    read: (v, o, le) => {
      const value = v.getBigUint64(o, le);
      return value === 0xffffffffffffffffn ? null : Number(value);
    },
  },
  0x90: {
    size: 8,
    read: (v, o, le) => {
      const value = v.getBigUint64(o, le);
      return value === 0n ? null : Number(value);
    },
  },
};

/** Le type 7 (chaine) est traite a part car sa taille est variable. */
const STRING_BASE_TYPE = 0x07;

function invalidIf(value: number, invalid: number): number | null {
  return value === invalid ? null : value;
}

function baseTypeSize(baseType: number): number {
  if (baseType === STRING_BASE_TYPE) return 1;
  return BASE_TYPES[baseType]?.size ?? 1;
}

export function isFitFile(bytes: Uint8Array): boolean {
  return (
    bytes.length > 12 &&
    bytes[8] === 0x2e && // '.'
    bytes[9] === 0x46 && // 'F'
    bytes[10] === 0x49 && // 'I'
    bytes[11] === 0x54 // 'T'
  );
}

interface DecodedMessage {
  globalMessageNumber: number;
  fields: Map<number, FieldValue>;
}

/** Decode la suite de messages d'un fichier FIT. */
export function decodeFitMessages(bytes: Uint8Array): DecodedMessage[] {
  if (!isFitFile(bytes)) {
    throw new Error("Ce fichier n'est pas un FIT valide (signature manquante)");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = bytes[0]!;
  const dataSize = view.getUint32(4, true);
  const end = Math.min(bytes.length, headerSize + dataSize);

  const definitions = new Map<number, MessageDefinition>();
  const messages: DecodedMessage[] = [];
  let offset = headerSize;

  while (offset < end) {
    const header = bytes[offset++]!;
    const compressed = (header & 0x80) !== 0;
    const localType = compressed ? (header >> 5) & 0x03 : header & 0x0f;

    if (!compressed && (header & 0x40) !== 0) {
      // Message de definition.
      offset++; // octet reserve
      const littleEndian = bytes[offset++] === 0;
      const globalMessageNumber = view.getUint16(offset, littleEndian);
      offset += 2;
      const fieldCount = bytes[offset++]!;
      const fields: FieldDefinition[] = [];
      for (let i = 0; i < fieldCount; i++) {
        fields.push({
          fieldNumber: bytes[offset]!,
          size: bytes[offset + 1]!,
          baseType: bytes[offset + 2]!,
        });
        offset += 3;
      }
      let developerSize = 0;
      if ((header & 0x20) !== 0) {
        const devFieldCount = bytes[offset++]!;
        for (let i = 0; i < devFieldCount; i++) {
          developerSize += bytes[offset + 1]!;
          offset += 3;
        }
      }
      definitions.set(localType, {
        globalMessageNumber,
        littleEndian,
        fields,
        developerSize,
      });
      continue;
    }

    const definition = definitions.get(localType);
    if (!definition) {
      // Sans definition prealable, impossible de connaitre la taille du message.
      break;
    }

    const fields = new Map<number, FieldValue>();
    for (const field of definition.fields) {
      const value = readField(view, offset, field, definition.littleEndian);
      if (value != null) fields.set(field.fieldNumber, value);
      offset += field.size;
    }
    offset += definition.developerSize;
    messages.push({ globalMessageNumber: definition.globalMessageNumber, fields });
  }

  return messages;
}

function readField(
  view: DataView,
  offset: number,
  field: FieldDefinition,
  littleEndian: boolean,
): FieldValue | null {
  if (field.baseType === STRING_BASE_TYPE) {
    const chars: number[] = [];
    for (let i = 0; i < field.size; i++) {
      const c = view.getUint8(offset + i);
      if (c === 0) break;
      chars.push(c);
    }
    const text = new TextDecoder().decode(new Uint8Array(chars));
    return text.length > 0 ? text : null;
  }

  const reader = BASE_TYPES[field.baseType];
  if (!reader) return null;

  const unitSize = baseTypeSize(field.baseType);
  const count = Math.max(1, Math.floor(field.size / unitSize));
  if (count === 1) {
    if (offset + unitSize > view.byteLength) return null;
    return reader.read(view, offset, littleEndian);
  }

  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + (i + 1) * unitSize > view.byteLength) break;
    const value = reader.read(view, offset + i * unitSize, littleEndian);
    if (value != null) values.push(value);
  }
  return values.length > 0 ? values : null;
}

function num(fields: Map<number, FieldValue>, key: number): number | undefined {
  const value = fields.get(key);
  return typeof value === "number" ? value : undefined;
}

function fitTimeToMs(fitSeconds: number | undefined): number | undefined {
  if (fitSeconds == null) return undefined;
  return (fitSeconds + FIT_EPOCH_OFFSET) * 1000;
}

/** Correspondance entre l'enum sport du FIT et les sports de l'application. */
export function fitSportToSport(sport?: number, subSport?: number): Sport {
  if (sport === 1) return subSport === 3 ? "trail" : "course";
  if (sport === 2) return "velo";
  if (sport === 5) return "natation";
  if (sport === 11 || sport === 17) return "marche";
  if (sport === 4 || sport === 10) return "cardio";
  return "autre";
}

/** Decode un fichier FIT en activite normalisee. */
export function parseFit(bytes: Uint8Array): ParsedActivity {
  const messages = decodeFitMessages(bytes);

  const points: TrackPoint[] = [];
  const laps: Lap[] = [];
  let sport: Sport = "autre";
  let startTime: number | undefined;
  let elapsedTime: number | undefined;
  let movingTime: number | undefined;
  let distance: number | undefined;
  let calories: number | undefined;
  let avgHr: number | undefined;
  let maxHr: number | undefined;
  let avgCadence: number | undefined;
  let avgPower: number | undefined;
  let elevationGain: number | undefined;
  let elevationLoss: number | undefined;
  let device: string | undefined;

  for (const message of messages) {
    const f = message.fields;
    switch (message.globalMessageNumber) {
      case Global.FileId: {
        const manufacturer = num(f, 1);
        const product = num(f, 2);
        if (manufacturer != null) {
          device = `${manufacturerName(manufacturer)}${product != null ? ` (produit ${product})` : ""}`;
        }
        startTime ??= fitTimeToMs(num(f, 4));
        break;
      }
      case Global.Sport: {
        sport = fitSportToSport(num(f, 0), num(f, 1));
        break;
      }
      case Global.Record: {
        const timestamp = fitTimeToMs(num(f, 253));
        if (timestamp == null) break;
        const lat = num(f, 0);
        const lon = num(f, 1);
        // enhanced_altitude (78) et enhanced_speed (73) priment quand ils existent.
        const altitudeRaw = num(f, 78) ?? num(f, 2);
        const speedRaw = num(f, 73) ?? num(f, 6);
        points.push({
          t: timestamp,
          lat: lat != null ? lat * SEMICIRCLE_TO_DEGREE : undefined,
          lon: lon != null ? lon * SEMICIRCLE_TO_DEGREE : undefined,
          alt: altitudeRaw != null ? altitudeRaw / 5 - 500 : undefined,
          distance: num(f, 5) != null ? num(f, 5)! / 100 : undefined,
          speed: speedRaw != null ? speedRaw / 1000 : undefined,
          hr: num(f, 3),
          cadence: num(f, 4),
          power: num(f, 7),
          temperature: num(f, 13),
        });
        break;
      }
      case Global.Lap: {
        const start = fitTimeToMs(num(f, 2)) ?? fitTimeToMs(num(f, 253));
        if (start == null) break;
        const avgSpeed = num(f, 13);
        laps.push({
          index: laps.length + 1,
          startTime: start,
          duration: (num(f, 7) ?? num(f, 8) ?? 0) / 1000,
          distance: (num(f, 9) ?? 0) / 100,
          avgHr: num(f, 15),
          maxHr: num(f, 16),
          avgSpeed: avgSpeed != null ? avgSpeed / 1000 : undefined,
          elevationGain: num(f, 21),
        });
        break;
      }
      case Global.Session: {
        startTime = fitTimeToMs(num(f, 2)) ?? startTime;
        elapsedTime = (num(f, 7) ?? 0) / 1000 || undefined;
        movingTime = (num(f, 8) ?? 0) / 1000 || undefined;
        distance = (num(f, 9) ?? 0) / 100 || undefined;
        calories = num(f, 11);
        avgHr = num(f, 16);
        maxHr = num(f, 17);
        avgCadence = num(f, 18);
        avgPower = num(f, 20);
        elevationGain = num(f, 22);
        elevationLoss = num(f, 23);
        if (sport === "autre") sport = fitSportToSport(num(f, 5), num(f, 6));
        break;
      }
    }
  }

  points.sort((a, b) => a.t - b.t);
  startTime ??= points[0]?.t;

  return {
    sport,
    startTime: startTime ?? Date.now(),
    elapsedTime,
    movingTime,
    distance,
    calories,
    avgHr,
    maxHr,
    avgCadence,
    avgPower,
    elevationGain,
    elevationLoss,
    points,
    laps,
    device,
    format: "fit",
  };
}

/**
 * Quelques fabricants courants. Decathlon/Geonaute expose l'identifiant 89
 * dans le profil FIT officiel.
 */
function manufacturerName(id: number): string {
  const names: Record<number, string> = {
    1: "Garmin",
    13: "Suunto",
    23: "Polar",
    32: "Wahoo",
    69: "Hammerhead",
    89: "Decathlon",
    260: "Zwift",
    265: "Strava",
    294: "Coros",
  };
  return names[id] ?? `Fabricant ${id}`;
}
