import assert from "node:assert/strict";
import { test } from "node:test";
import { isFitFile, parseFit } from "../src/parsers/fit.ts";
import { parseActivityFile } from "../src/parsers/index.ts";

const FIT_EPOCH_OFFSET = 631_065_600;
const DEGREE_TO_SEMICIRCLE = 2 ** 31 / 180;

/**
 * Encodeur FIT minimal : il ne sert qu'aux tests, pour produire un fichier
 * conforme a la specification et verifier que le decodeur le relit fidelement.
 */
function encodeFit(
  points: Array<{ t: number; lat: number; lon: number; hr: number; distance: number; speed: number; alt: number }>,
): Uint8Array {
  const body: number[] = [];

  const pushU8 = (v: number) => body.push(v & 0xff);
  const pushU16 = (v: number) => {
    body.push(v & 0xff, (v >> 8) & 0xff);
  };
  const pushU32 = (v: number) => {
    body.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  };
  const pushI32 = (v: number) => pushU32(v >>> 0);

  // Definition du message record (global 20) sur le type local 0.
  pushU8(0x40); // en-tete de definition
  pushU8(0); // reserve
  pushU8(0); // petit-boutiste
  pushU16(20); // record
  pushU8(7); // nombre de champs
  const fields: Array<[number, number, number]> = [
    [253, 4, 0x86], // timestamp, uint32
    [0, 4, 0x85], // position_lat, sint32
    [1, 4, 0x85], // position_long, sint32
    [2, 2, 0x84], // altitude, uint16
    [3, 1, 0x02], // heart_rate, uint8
    [5, 4, 0x86], // distance, uint32
    [6, 2, 0x84], // speed, uint16
  ];
  for (const [number, size, baseType] of fields) {
    pushU8(number);
    pushU8(size);
    pushU8(baseType);
  }

  for (const point of points) {
    pushU8(0x00); // message de donnees, type local 0
    pushU32(Math.round(point.t / 1000) - FIT_EPOCH_OFFSET);
    pushI32(Math.round(point.lat * DEGREE_TO_SEMICIRCLE));
    pushI32(Math.round(point.lon * DEGREE_TO_SEMICIRCLE));
    pushU16(Math.round((point.alt + 500) * 5));
    pushU8(point.hr);
    pushU32(Math.round(point.distance * 100));
    pushU16(Math.round(point.speed * 1000));
  }

  const header = [12, 0x10, 0x34, 0x08, 0, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54];
  const dataSize = body.length;
  header[4] = dataSize & 0xff;
  header[5] = (dataSize >> 8) & 0xff;
  header[6] = (dataSize >> 16) & 0xff;
  header[7] = (dataSize >> 24) & 0xff;

  return new Uint8Array([...header, ...body, 0, 0]);
}

const start = Date.UTC(2026, 2, 14, 9, 0, 0);
const samplePoints = Array.from({ length: 10 }, (_, i) => ({
  t: start + i * 1000,
  lat: 48.8566 + i * 0.0001,
  lon: 2.3522 + i * 0.0001,
  alt: 35 + i,
  hr: 140 + i,
  distance: i * 3.2,
  speed: 3.2,
}));

test("reconnait la signature d'un fichier FIT", () => {
  const bytes = encodeFit(samplePoints);
  assert.equal(isFitFile(bytes), true);
  assert.equal(isFitFile(new TextEncoder().encode("<gpx></gpx>")), false);
});

test("decode les messages record d'un fichier FIT", () => {
  const activity = parseFit(encodeFit(samplePoints));

  assert.equal(activity.format, "fit");
  assert.equal(activity.points.length, 10);

  const first = activity.points[0]!;
  assert.equal(first.t, start);
  assert.ok(Math.abs(first.lat! - 48.8566) < 1e-5, `latitude decodee : ${first.lat}`);
  assert.ok(Math.abs(first.lon! - 2.3522) < 1e-5, `longitude decodee : ${first.lon}`);
  assert.equal(first.hr, 140);
  assert.ok(Math.abs(first.alt! - 35) < 0.3, `altitude decodee : ${first.alt}`);
  assert.ok(Math.abs(first.speed! - 3.2) < 0.01);

  const last = activity.points[9]!;
  assert.equal(last.hr, 149);
  assert.ok(Math.abs(last.distance! - 28.8) < 0.05);
});

test("parseActivityFile detecte le FIT sans indication de nom", () => {
  const activity = parseActivityFile(encodeFit(samplePoints));
  assert.equal(activity.format, "fit");
  assert.equal(activity.points.length, 10);
});

test("rejette un fichier binaire qui n'est pas un FIT", () => {
  assert.throws(
    () => parseFit(new Uint8Array(20)),
    /signature manquante/,
  );
});
