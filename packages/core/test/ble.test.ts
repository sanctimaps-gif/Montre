import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseBatteryLevel,
  parseHeartRateMeasurement,
  parseRscMeasurement,
} from "../src/ble.ts";

/** Construit une trame a partir d'une liste d'octets. */
function frame(...bytes: number[]): DataView {
  return new DataView(new Uint8Array(bytes).buffer);
}

const u16 = (value: number): [number, number] => [value & 0xff, (value >> 8) & 0xff];
const u32 = (value: number): [number, number, number, number] => [
  value & 0xff,
  (value >> 8) & 0xff,
  (value >> 16) & 0xff,
  (value >> 24) & 0xff,
];

test("frequence cardiaque sur un octet, sans option", () => {
  const sample = parseHeartRateMeasurement(frame(0x00, 142));
  assert.equal(sample.hr, 142);
  assert.equal(sample.rrIntervals, undefined);
  // Sans prise en charge declaree, l'etat du contact est inconnu, pas "mauvais".
  assert.equal(sample.poorSensorContact, undefined);
});

test("frequence cardiaque sur deux octets", () => {
  // Le bit 0 a 1 signale un entier 16 bits : indispensable au-dela de 255 bpm,
  // mais certaines montres l'utilisent aussi pour des valeurs normales.
  const sample = parseHeartRateMeasurement(frame(0x01, ...u16(142)));
  assert.equal(sample.hr, 142);
});

test("contact du capteur signale comme mauvais", () => {
  // bit 2 = detection prise en charge, bit 1 = contact detecte.
  assert.equal(parseHeartRateMeasurement(frame(0x04, 140)).poorSensorContact, true);
  assert.equal(parseHeartRateMeasurement(frame(0x06, 140)).poorSensorContact, false);
});

test("intervalles RR decodes apres la depense energetique", () => {
  // bit 3 : energie presente, bit 4 : intervalles RR presents.
  const sample = parseHeartRateMeasurement(
    frame(0x18, 150, ...u16(320), ...u16(1024), ...u16(512)),
  );
  assert.equal(sample.hr, 150);
  assert.equal(sample.energyKj, 320);
  // 1024/1024 s = 1000 ms, 512/1024 s = 500 ms.
  assert.deepEqual(sample.rrIntervals, [1000, 500]);
});

test("les intervalles RR ne sont pas decales quand l'energie est absente", () => {
  const sample = parseHeartRateMeasurement(frame(0x10, 150, ...u16(1024)));
  assert.deepEqual(sample.rrIntervals, [1000]);
});

test("une trame cardiaque tronquee ne produit pas de valeur fantaisiste", () => {
  assert.deepEqual(parseHeartRateMeasurement(frame(0x00)), {});
  // Drapeau RR mais aucun intervalle complet derriere : la FC reste lisible.
  const sample = parseHeartRateMeasurement(frame(0x10, 148, 0x42));
  assert.equal(sample.hr, 148);
  assert.equal(sample.rrIntervals, undefined);
});

test("mesure de course : vitesse et cadence", () => {
  // 3,5 m/s vaut 896 unites de 1/256 m/s.
  const sample = parseRscMeasurement(frame(0x04, ...u16(896), 88));
  assert.ok(Math.abs(sample.speed! - 3.5) < 1e-6);
  assert.equal(sample.cadence, 88);
  assert.equal(sample.running, true);
  assert.equal(sample.strideLength, undefined);
  assert.equal(sample.totalDistance, undefined);
});

test("mesure de course avec foulee et distance", () => {
  // bit 0 : foulee, bit 1 : distance, bit 2 : course.
  const sample = parseRscMeasurement(
    frame(0x07, ...u16(896), 88, ...u16(118), ...u32(52_340)),
  );
  assert.ok(Math.abs(sample.strideLength! - 1.18) < 1e-6);
  // 52 340 decimetres valent 5 234 m.
  assert.equal(sample.totalDistance, 5234);
});

test("la distance n'est pas lue a la place de la foulee quand celle-ci manque", () => {
  // Sans le bit 0, les quatre octets qui suivent la cadence sont la distance.
  const sample = parseRscMeasurement(frame(0x06, ...u16(768), 82, ...u32(1000)));
  assert.equal(sample.strideLength, undefined);
  assert.equal(sample.totalDistance, 100);
});

test("marche et course se distinguent par le drapeau", () => {
  assert.equal(parseRscMeasurement(frame(0x00, ...u16(400), 60)).running, false);
});

test("une trame de course tronquee est ignoree", () => {
  assert.deepEqual(parseRscMeasurement(frame(0x07, 0x00)), {});
});

test("niveau de batterie", () => {
  assert.equal(parseBatteryLevel(frame(68)).battery, 68);
  assert.equal(parseBatteryLevel(frame(0)).battery, 0);
  // Une valeur hors echelle signale une trame mal interpretee : on l'ecarte.
  assert.equal(parseBatteryLevel(frame(200)).battery, undefined);
  assert.deepEqual(parseBatteryLevel(frame()), {});
});
