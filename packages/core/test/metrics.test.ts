import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bestEfforts,
  computeHrZones,
  edwardsTrimp,
  elevationChange,
  estimateMaxHr,
  formatPace,
  gradeCost,
  haversine,
  hrToZone,
  hrZoneTimes,
  movingTime,
  totalDistance,
  trainingLoad,
  trainingPaces,
} from "../src/metrics.ts";
import type { AthleteProfile, TrackPoint } from "../src/types.ts";

const profile: AthleteProfile = {
  userId: "u1",
  maxHr: 190,
  restHr: 50,
  vma: 16,
  weeklySessions: 4,
  level: "intermediaire",
};

/** Trace synthetique : vitesse et FC constantes, terrain plat. */
function steadyRun(
  seconds: number,
  speed: number,
  hr: number,
  startAlt = 0,
  slope = 0,
): TrackPoint[] {
  const start = Date.UTC(2026, 2, 14, 9, 0, 0);
  return Array.from({ length: seconds }, (_, i) => ({
    t: start + i * 1000,
    distance: i * speed,
    speed,
    hr,
    alt: startAlt + i * slope,
  }));
}

test("la distance de Haversine est correcte sur un degre de latitude", () => {
  const distance = haversine(48, 2, 49, 2);
  // Un degre de latitude vaut environ 111,2 km.
  assert.ok(Math.abs(distance - 111_195) < 500, `distance calculee : ${distance}`);
});

test("estimation de la FC max par la formule de Tanaka", () => {
  assert.equal(estimateMaxHr(40), 180);
  assert.equal(estimateMaxHr(20), 194);
});

test("les zones cardiaques utilisent la reserve quand la FC de repos est connue", () => {
  const zones = computeHrZones(profile);
  // Zone 2 a 60 % de reserve : 50 + 0,6 * 140 = 134.
  assert.equal(zones.bounds[1], 134);
  assert.equal(zones.max, 190);
  assert.equal(hrToZone(120, zones), 1);
  assert.equal(hrToZone(140, zones), 2);
  assert.equal(hrToZone(175, zones), 4);
  assert.equal(hrToZone(188, zones), 5);
});

test("le temps par zone couvre toute la duree de la trace", () => {
  const points = steadyRun(600, 3.2, 150);
  const times = hrZoneTimes(points, computeHrZones(profile));
  assert.equal(times.reduce((a, b) => a + b, 0), 599);
  // 150 bpm tombe en zone 3 (borne a 148 avec cette reserve).
  assert.equal(times[2], 599);
});

test("le TRIMP d'Edwards pondere les zones hautes plus fortement", () => {
  assert.equal(edwardsTrimp([3600, 0, 0, 0, 0]), 60);
  assert.equal(edwardsTrimp([0, 0, 0, 0, 3600]), 300);
});

test("une heure au seuil vaut environ 100 de charge", () => {
  // 175 bpm : zone 4 avec ce profil.
  const points = steadyRun(3600, 4.4, 175);
  const load = trainingLoad(
    { movingTime: 3599, distance: 15_800, points },
    profile,
  );
  assert.ok(load >= 95 && load <= 105, `charge calculee : ${load}`);
});

test("une sortie facile pese nettement moins qu'une seance au seuil", () => {
  const easy = trainingLoad(
    { movingTime: 3599, distance: 11_500, points: steadyRun(3600, 3.2, 135) },
    profile,
  );
  const hard = trainingLoad(
    { movingTime: 3599, distance: 15_800, points: steadyRun(3600, 4.4, 175) },
    profile,
  );
  assert.ok(easy < hard / 2, `facile ${easy} vs seuil ${hard}`);
});

test("le temps en mouvement exclut les arrets", () => {
  const points = steadyRun(300, 3.2, 140);
  // Cinq minutes a l'arret au milieu de la sortie.
  for (let i = 100; i < 200; i++) {
    points[i]!.speed = 0;
    points[i]!.distance = points[99]!.distance;
  }
  assert.equal(movingTime(points), 199);
});

test("la distance totale privilegie le cumul de la montre", () => {
  const points = steadyRun(100, 3.2, 140);
  assert.equal(totalDistance(points), Math.round(99 * 3.2));
});

test("le denivele filtre le bruit d'altimetre", () => {
  const flat = steadyRun(600, 3.2, 140);
  // Bruit de plus ou moins 0,5 m, typique d'un GPS sur terrain plat.
  flat.forEach((p, i) => {
    p.alt = (i % 2 === 0 ? 0.5 : -0.5) + 30;
  });
  const noise = elevationChange(flat);
  assert.ok(noise.gain < 5, `D+ sur terrain plat : ${noise.gain}`);

  const climb = steadyRun(600, 3.2, 150, 100, 0.1);
  const real = elevationChange(climb);
  // 600 s a 0,1 m/s d'ascension : environ 60 m de D+.
  assert.ok(Math.abs(real.gain - 60) < 8, `D+ en montee : ${real.gain}`);
});

test("le cout energetique augmente en montee et diminue en legere descente", () => {
  assert.equal(gradeCost(0), 1);
  assert.ok(gradeCost(0.1) > 1.2);
  assert.ok(gradeCost(-0.05) < 1);
});

test("les meilleurs temps sont extraits de la trace", () => {
  // 20 minutes a 4 m/s : 4,8 km, soit un 1 km en 250 s.
  const points = steadyRun(1200, 4, 160);
  const bests = bestEfforts(points);
  assert.ok(bests["1km"] != null);
  assert.ok(Math.abs(bests["1km"]! - 250) <= 2, `1 km : ${bests["1km"]}`);
  assert.equal(bests["5km"], undefined);
});

test("les allures d'entrainement se deduisent de la VMA", () => {
  const paces = trainingPaces(16);
  // 100 % de VMA a 16 km/h : 225 s/km.
  assert.equal(Math.round(paces["vma"]!), 225);
  assert.ok(paces["endurance"]! > paces["seuil"]!);
  assert.equal(formatPace(225), "3:45");
  assert.equal(formatPace(0), "--:--");
});
