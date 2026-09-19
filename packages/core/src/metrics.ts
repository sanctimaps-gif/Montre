import type {
  Activity,
  ActivityMetrics,
  AthleteProfile,
  HrZones,
  TrackPoint,
} from "./types.ts";

/** Rayon moyen de la Terre, en metres. */
const EARTH_RADIUS = 6_371_000;

/** Distance orthodromique entre deux points GPS, en metres. */
export function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * FC maximale estimee par la formule de Tanaka (2001), plus fiable que 220-age
 * en particulier apres 40 ans.
 */
export function estimateMaxHr(age: number): number {
  return Math.round(208 - 0.7 * age);
}

export function ageFromBirthDate(birthDate: string, now = Date.now()): number {
  const born = new Date(birthDate + "T00:00:00Z").getTime();
  return Math.floor((now - born) / (365.2425 * 24 * 3600 * 1000));
}

/**
 * Zones cardiaques en % de la reserve cardiaque (methode Karvonen) quand la FC
 * de repos est connue, sinon en % de la FC max. Les bornes correspondent aux
 * 5 zones utilisees par la plupart des coachs : recuperation, endurance
 * fondamentale, tempo, seuil, VMA.
 */
export function computeHrZones(profile: AthleteProfile): HrZones {
  const max =
    profile.maxHr ??
    (profile.birthDate
      ? estimateMaxHr(ageFromBirthDate(profile.birthDate))
      : 190);
  const rest = profile.restHr;
  const pct = [0.5, 0.6, 0.7, 0.8, 0.9] as const;
  const bounds = pct.map((p) =>
    rest ? Math.round(rest + p * (max - rest)) : Math.round(p * max),
  ) as unknown as [number, number, number, number, number];
  return { bounds, max };
}

/** Zone (1 a 5) correspondant a une frequence cardiaque donnee. */
export function hrToZone(hr: number, zones: HrZones): 1 | 2 | 3 | 4 | 5 {
  let zone = 1;
  for (let i = 0; i < zones.bounds.length; i++) {
    if (hr >= zones.bounds[i]!) zone = i + 1;
  }
  return zone as 1 | 2 | 3 | 4 | 5;
}

/** Temps passe dans chaque zone cardiaque, en secondes. */
export function hrZoneTimes(points: TrackPoint[], zones: HrZones): number[] {
  const times = [0, 0, 0, 0, 0];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    if (cur.hr == null) continue;
    const dt = (cur.t - prev.t) / 1000;
    // Un ecart superieur a 30 s signale une pause : on ne le comptabilise pas.
    if (dt <= 0 || dt > 30) continue;
    times[hrToZone(cur.hr, zones) - 1]! += dt;
  }
  return times.map((s) => Math.round(s));
}

/**
 * TRIMP d'Edwards : chaque zone est ponderee par son numero, ce qui penalise
 * fortement le temps passe en haute intensite.
 */
export function edwardsTrimp(zoneTimes: number[]): number {
  return zoneTimes.reduce((sum, sec, i) => sum + (sec / 60) * (i + 1), 0);
}

/**
 * Charge d'entrainement d'une seance, sur une echelle ou 100 correspond a une
 * heure d'effort au seuil (zone 4 basse). Le calcul privilegie la puissance
 * quand elle existe, puis la frequence cardiaque, et retombe sur la duree et
 * l'intensite relative de l'allure quand aucun capteur n'est disponible.
 */
export function trainingLoad(
  activity: Pick<Activity, "movingTime" | "distance" | "points">,
  profile: AthleteProfile,
): number {
  const zones = computeHrZones(profile);
  const zoneTimes = hrZoneTimes(activity.points, zones);
  const totalHrTime = zoneTimes.reduce((a, b) => a + b, 0);

  if (totalHrTime > activity.movingTime * 0.5) {
    // Ponderation quadratique par zone : une heure en zone 4 vaut ~100.
    const weights = [0.2, 0.45, 0.7, 1.0, 1.35];
    const load = zoneTimes.reduce(
      (sum, sec, i) => sum + (sec / 3600) * weights[i]! * 100,
      0,
    );
    return Math.round(load);
  }

  // Sans cardio exploitable : intensite deduite du rapport allure / VMA.
  if (profile.vma && activity.distance > 0 && activity.movingTime > 0) {
    const speedKmh = (activity.distance / activity.movingTime) * 3.6;
    const intensity = clamp(speedKmh / profile.vma, 0.3, 1.2);
    return Math.round((activity.movingTime / 3600) * intensity ** 2 * 190);
  }

  return Math.round((activity.movingTime / 3600) * 45);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Allure en secondes par kilometre. */
export function paceFromSpeed(speedMs: number): number {
  if (speedMs <= 0) return 0;
  return 1000 / speedMs;
}

export function formatPace(secPerKm: number): string {
  if (!isFinite(secPerKm) || secPerKm <= 0) return "--:--";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Denivele positif et negatif, apres lissage. Le GPS et l'altimetre de la
 * Fit 100 S bruitent le profil : sans filtre, une sortie plate afficherait
 * plusieurs centaines de metres de D+.
 */
export function elevationChange(points: TrackPoint[]): {
  gain: number;
  loss: number;
} {
  const alts = points
    .map((p) => p.alt)
    .filter((a): a is number => a != null && isFinite(a));
  if (alts.length < 3) return { gain: 0, loss: 0 };

  const smoothed = movingAverage(alts, 15);
  let gain = 0;
  let loss = 0;
  // Seuil de 1 m : en dessous, c'est du bruit de capteur.
  const threshold = 1;
  let reference = smoothed[0]!;
  for (const alt of smoothed) {
    const delta = alt - reference;
    if (delta > threshold) {
      gain += delta;
      reference = alt;
    } else if (delta < -threshold) {
      loss += -delta;
      reference = alt;
    }
  }
  return { gain: Math.round(gain), loss: Math.round(loss) };
}

export function movingAverage(values: number[], window: number): number[] {
  if (window <= 1 || values.length === 0) return values.slice();
  const half = Math.floor(window / 2);
  const out: number[] = new Array(values.length);
  let sum = 0;
  let count = 0;
  // Fenetre glissante centree, avec bords tronques.
  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      for (let j = 0; j <= Math.min(half, values.length - 1); j++) {
        sum += values[j]!;
        count++;
      }
    } else {
      const add = i + half;
      const remove = i - half - 1;
      if (add < values.length) {
        sum += values[add]!;
        count++;
      }
      if (remove >= 0) {
        sum -= values[remove]!;
        count--;
      }
    }
    out[i] = sum / count;
  }
  return out;
}

/**
 * Temps en mouvement : on retire les secondes ou l'athlete est a l'arret
 * (moins de 0,5 m/s, soit une marche tres lente) ainsi que les trous
 * d'enregistrement dus a une pause de la montre.
 */
export function movingTime(points: TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const dt = (cur.t - prev.t) / 1000;
    if (dt <= 0 || dt > 30) continue;
    const speed = cur.speed ?? segmentSpeed(prev, cur, dt);
    if (speed != null && speed < 0.5) continue;
    total += dt;
  }
  return Math.round(total);
}

function segmentSpeed(a: TrackPoint, b: TrackPoint, dt: number): number | null {
  if (a.distance != null && b.distance != null) {
    return (b.distance - a.distance) / dt;
  }
  if (a.lat != null && a.lon != null && b.lat != null && b.lon != null) {
    return haversine(a.lat, a.lon, b.lat, b.lon) / dt;
  }
  return null;
}

/** Distance totale : on utilise le cumul de la montre s'il existe, sinon le GPS. */
export function totalDistance(points: TrackPoint[]): number {
  const withDistance = points.filter((p) => p.distance != null);
  if (withDistance.length >= 2) {
    const first = withDistance[0]!.distance!;
    const last = withDistance[withDistance.length - 1]!.distance!;
    if (last > first) return Math.round(last - first);
  }
  let total = 0;
  let prev: TrackPoint | null = null;
  for (const p of points) {
    if (p.lat == null || p.lon == null) continue;
    if (prev) total += haversine(prev.lat!, prev.lon!, p.lat, p.lon);
    prev = p;
  }
  return Math.round(total);
}

/**
 * Allure corrigee du denivele (GAP). Le facteur de cout applique est une
 * approximation polynomiale des travaux de Minetti sur le cout energetique de
 * la course en pente.
 */
export function gradeAdjustedPace(points: TrackPoint[]): number | undefined {
  let weightedTime = 0;
  let equivalentDistance = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const dt = (cur.t - prev.t) / 1000;
    if (dt <= 0 || dt > 30) continue;
    const dist = segmentDistance(prev, cur);
    if (dist == null || dist <= 0) continue;
    const dAlt = (cur.alt ?? 0) - (prev.alt ?? 0);
    const grade = clamp(dAlt / dist, -0.35, 0.35);
    equivalentDistance += dist * gradeCost(grade);
    weightedTime += dt;
  }
  if (equivalentDistance <= 0) return undefined;
  return (weightedTime / equivalentDistance) * 1000;
}

function segmentDistance(a: TrackPoint, b: TrackPoint): number | null {
  if (a.distance != null && b.distance != null) return b.distance - a.distance;
  if (a.lat != null && a.lon != null && b.lat != null && b.lon != null) {
    return haversine(a.lat, a.lon, b.lat, b.lon);
  }
  return null;
}

/** Cout energetique relatif de la course a une pente donnee (1 = terrain plat). */
export function gradeCost(grade: number): number {
  return (
    1 +
    2.6 * grade +
    16.4 * grade ** 2 -
    12.0 * grade ** 3 -
    45.0 * grade ** 4 +
    30.0 * grade ** 5
  );
}

/**
 * Derive cardiaque : rapport FC/allure de la seconde moitie sur celui de la
 * premiere. Au-dela de 5 %, l'endurance de base manque ou l'allure etait trop
 * rapide pour la sortie.
 */
export function decoupling(points: TrackPoint[]): number | undefined {
  const usable = points.filter((p) => p.hr != null && (p.speed ?? 0) > 1);
  if (usable.length < 60) return undefined;
  const mid = Math.floor(usable.length / 2);
  const ratio = (slice: TrackPoint[]) => {
    const hr = mean(slice.map((p) => p.hr!));
    const speed = mean(slice.map((p) => p.speed!));
    return speed > 0 ? hr / speed : NaN;
  };
  const first = ratio(usable.slice(0, mid));
  const second = ratio(usable.slice(mid));
  if (!isFinite(first) || !isFinite(second) || first === 0) return undefined;
  return (second / first - 1) * 100;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Meilleurs temps sur les distances de reference, en balayant la trace avec une
 * fenetre glissante. Sert a alimenter les records personnels du profil.
 */
export function bestEfforts(points: TrackPoint[]): Record<string, number> {
  const distances: Record<string, number> = {
    "400m": 400,
    "1km": 1000,
    "5km": 5000,
    "10km": 10000,
    "semi": 21097,
    "marathon": 42195,
  };
  const cumulative = cumulativeDistance(points);
  const total = cumulative[cumulative.length - 1] ?? 0;
  const bests: Record<string, number> = {};

  for (const [label, target] of Object.entries(distances)) {
    if (total < target) continue;
    let best = Infinity;
    let start = 0;
    for (let end = 0; end < points.length; end++) {
      while (cumulative[end]! - cumulative[start]! >= target) {
        const time = (points[end]!.t - points[start]!.t) / 1000;
        if (time > 0 && time < best) best = time;
        start++;
      }
    }
    if (isFinite(best)) bests[label] = Math.round(best);
  }
  return bests;
}

function cumulativeDistance(points: TrackPoint[]): number[] {
  const out: number[] = [];
  let total = 0;
  let prev: TrackPoint | null = null;
  for (const p of points) {
    if (prev) {
      const d = segmentDistance(prev, p);
      if (d != null && d > 0) total += d;
    }
    out.push(total);
    prev = p;
  }
  return out;
}

/**
 * VMA estimee depuis une seance. Une course de 5 a 6 minutes a fond se court
 * approximativement a 100 % de VMA ; au-dela, on applique la table de Mercier
 * pour ramener la performance a la VMA equivalente.
 */
export function estimateVma(bests: Record<string, number>): number | undefined {
  const candidates: Array<[number, number]> = [];
  const push = (meters: number, sec: number | undefined, factor: number) => {
    if (sec && sec > 0) candidates.push([(meters / sec) * 3.6 / factor, sec]);
  };
  // Fraction de VMA soutenable selon la duree de l'effort.
  push(1000, bests["1km"], 1.05);
  push(5000, bests["5km"], 0.92);
  push(10000, bests["10km"], 0.87);
  push(21097, bests["semi"], 0.83);
  if (candidates.length === 0) return undefined;
  // On retient l'estimation issue de l'effort le plus long, plus representatif.
  candidates.sort((a, b) => b[1] - a[1]);
  return Math.round(candidates[0]![0] * 10) / 10;
}

/**
 * Allures d'entrainement derivees de la VMA, en secondes par kilometre.
 * Les pourcentages correspondent aux references classiques de la methode VMA.
 */
export function trainingPaces(vma: number): Record<string, number> {
  const paceAt = (pct: number) => 3600 / (vma * pct);
  return {
    recuperation: paceAt(0.6),
    endurance: paceAt(0.68),
    marathon: paceAt(0.78),
    semi: paceAt(0.83),
    seuil: paceAt(0.87),
    "10km": paceAt(0.9),
    "5km": paceAt(0.94),
    vma: paceAt(1.0),
    vitesse: paceAt(1.05),
  };
}

/** Calcule toutes les metriques derivees d'une activite. */
export function computeMetrics(
  activity: Pick<Activity, "points" | "movingTime" | "distance" | "sport">,
  profile: AthleteProfile,
): ActivityMetrics {
  const zones = computeHrZones(profile);
  const zoneTimes = hrZoneTimes(activity.points, zones);
  const bests =
    activity.sport === "course" || activity.sport === "trail"
      ? bestEfforts(activity.points)
      : {};
  const elevation = elevationChange(activity.points);
  const hours = activity.movingTime / 3600;

  return {
    trainingLoad: trainingLoad(activity, profile),
    trimp: Math.round(edwardsTrimp(zoneTimes)),
    hrZoneTimes: zoneTimes,
    avgPace:
      activity.distance > 0 && activity.movingTime > 0
        ? Math.round((activity.movingTime / activity.distance) * 1000)
        : undefined,
    gradeAdjustedPace: round(gradeAdjustedPace(activity.points)),
    decoupling: round(decoupling(activity.points)),
    vam: hours > 0 ? Math.round(elevation.gain / hours) : undefined,
    bests,
  };
}

function round(v: number | undefined): number | undefined {
  return v == null ? undefined : Math.round(v * 10) / 10;
}
