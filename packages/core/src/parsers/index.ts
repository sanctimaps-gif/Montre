import type { Activity, AthleteProfile } from "../types.ts";
import {
  computeMetrics,
  elevationChange,
  mean,
  movingTime as computeMovingTime,
  totalDistance,
} from "../metrics.ts";
import { isFitFile, parseFit } from "./fit.ts";
import { parseGpx } from "./gpx.ts";
import { parseTcx } from "./tcx.ts";
import type { ParsedActivity } from "./types.ts";

export { parseFit, isFitFile, decodeFitMessages } from "./fit.ts";
export { parseGpx } from "./gpx.ts";
export { parseTcx } from "./tcx.ts";
export type { ParsedActivity } from "./types.ts";

/**
 * Detecte le format d'un fichier d'activite et le decode. Accepte le FIT
 * (binaire), le GPX et le TCX (XML) : c'est la totalite de ce que Decathlon
 * Coach et Strava savent exporter.
 */
export function parseActivityFile(bytes: Uint8Array, filename?: string): ParsedActivity {
  if (isFitFile(bytes)) return parseFit(bytes);

  const text = new TextDecoder().decode(bytes);
  const head = text.slice(0, 2000);

  if (/<TrainingCenterDatabase/i.test(head)) return parseTcx(text);
  if (/<gpx/i.test(head)) return parseGpx(text);

  // Dernier recours : on se fie a l'extension du fichier.
  const extension = filename?.toLowerCase().split(".").pop();
  if (extension === "gpx") return parseGpx(text);
  if (extension === "tcx") return parseTcx(text);

  throw new Error(
    "Format non reconnu. Formats acceptes : .fit, .gpx et .tcx (exports Decathlon Coach, Strava ou montre).",
  );
}

export interface NormalizeOptions {
  userId: string;
  profile: AthleteProfile;
  id: string;
  source: Activity["source"];
  sourceId?: string;
  title?: string;
}

/**
 * Transforme un fichier decode en activite complete : les valeurs absentes du
 * fichier (distance, temps en mouvement, denivele, moyennes) sont recalculees
 * depuis la trace, puis les metriques d'entrainement sont derivees.
 */
export function normalizeActivity(
  parsed: ParsedActivity,
  options: NormalizeOptions,
): Activity {
  const points = parsed.points;
  const distance = parsed.distance ?? totalDistance(points);
  const movingTime = parsed.movingTime ?? computeMovingTime(points);
  const elapsedTime =
    parsed.elapsedTime ??
    (points.length >= 2
      ? (points[points.length - 1]!.t - points[0]!.t) / 1000
      : movingTime);

  const elevation = elevationChange(points);
  const hrValues = points.map((p) => p.hr).filter((v): v is number => v != null);
  const cadenceValues = points
    .map((p) => p.cadence)
    .filter((v): v is number => v != null && v > 0);
  const powerValues = points
    .map((p) => p.power)
    .filter((v): v is number => v != null && v > 0);

  const base = {
    id: options.id,
    userId: options.userId,
    sport: parsed.sport,
    title: options.title ?? parsed.title ?? defaultTitle(parsed),
    startTime: parsed.startTime,
    elapsedTime: Math.round(elapsedTime),
    movingTime: Math.round(movingTime),
    distance: Math.round(distance),
    elevationGain: parsed.elevationGain ?? elevation.gain,
    elevationLoss: parsed.elevationLoss ?? elevation.loss,
    avgHr: parsed.avgHr ?? (hrValues.length ? Math.round(mean(hrValues)) : undefined),
    maxHr: parsed.maxHr ?? (hrValues.length ? Math.max(...hrValues) : undefined),
    avgCadence:
      parsed.avgCadence ??
      (cadenceValues.length ? Math.round(mean(cadenceValues)) : undefined),
    avgPower:
      parsed.avgPower ?? (powerValues.length ? Math.round(mean(powerValues)) : undefined),
    calories: parsed.calories,
    source: options.source,
    sourceId: options.sourceId,
    points,
    laps: parsed.laps,
    createdAt: Date.now(),
  };

  return { ...base, metrics: computeMetrics(base, options.profile) };
}

/** Titre par defaut : moment de la journee et sport, comme sur Strava. */
export function defaultTitle(parsed: Pick<ParsedActivity, "startTime" | "sport">): string {
  const hour = new Date(parsed.startTime).getHours();
  const moment =
    hour < 6
      ? "de nuit"
      : hour < 12
        ? "du matin"
        : hour < 18
          ? "de l'apres-midi"
          : "du soir";
  const labels: Record<string, string> = {
    course: "Course a pied",
    trail: "Trail",
    marche: "Marche",
    velo: "Sortie velo",
    natation: "Natation",
    cardio: "Seance cardio",
    renforcement: "Renforcement",
    autre: "Activite",
  };
  return `${labels[parsed.sport] ?? "Activite"} ${moment}`;
}
