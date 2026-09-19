import type { Lap, Sport, TrackPoint, } from "../types.ts";
import type { ParsedActivity } from "./types.ts";
import { child, children, descendants, numberOf, parseXml, textOf } from "./xml.ts";
import type { XmlNode } from "./xml.ts";

/**
 * Parseur TCX (Training Center XML). Plus riche que le GPX : il porte les
 * tours, la distance mesuree par la montre, les calories et la cadence.
 */
export function parseTcx(source: string): ParsedActivity {
  const doc = parseXml(source);
  const database = child(doc, "TrainingCenterDatabase");
  if (!database) throw new Error("Ce fichier n'est pas un TCX valide");

  const activity = descendants(database, "Activity")[0];
  if (!activity) throw new Error("Ce TCX ne contient aucune activite");

  const points: TrackPoint[] = [];
  const laps: Lap[] = [];
  let totalDistance = 0;
  let totalTime = 0;
  let calories = 0;
  let maxHr: number | undefined;

  for (const lapNode of children(activity, "Lap")) {
    const startTime = Date.parse(lapNode.attributes["StartTime"] ?? "");
    const duration = numberOf(lapNode, "TotalTimeSeconds") ?? 0;
    const distance = numberOf(lapNode, "DistanceMeters") ?? 0;
    const lapCalories = numberOf(lapNode, "Calories") ?? 0;
    const avgHr = heartRate(child(lapNode, "AverageHeartRateBpm"));
    const lapMaxHr = heartRate(child(lapNode, "MaximumHeartRateBpm"));

    totalDistance += distance;
    totalTime += duration;
    calories += lapCalories;
    if (lapMaxHr != null) maxHr = Math.max(maxHr ?? 0, lapMaxHr);

    laps.push({
      index: laps.length + 1,
      startTime: Number.isFinite(startTime) ? startTime : Date.now(),
      duration,
      distance,
      avgHr,
      maxHr: lapMaxHr,
      avgSpeed: duration > 0 ? distance / duration : undefined,
    });

    for (const tp of descendants(lapNode, "Trackpoint")) {
      const time = Date.parse(textOf(tp, "Time") ?? "");
      if (!Number.isFinite(time)) continue;
      const position = child(tp, "Position");
      points.push({
        t: time,
        lat: position ? numberOf(position, "LatitudeDegrees") : undefined,
        lon: position ? numberOf(position, "LongitudeDegrees") : undefined,
        alt: numberOf(tp, "AltitudeMeters"),
        distance: numberOf(tp, "DistanceMeters"),
        hr: heartRate(child(tp, "HeartRateBpm")),
        cadence: numberOf(tp, "Cadence"),
        speed: extensionValue(tp, "Speed"),
        power: extensionValue(tp, "Watts"),
      });
    }
  }

  if (points.length === 0) {
    throw new Error("Ce TCX ne contient aucun point de trace");
  }
  points.sort((a, b) => a.t - b.t);

  const started = Date.parse(textOf(activity, "Id") ?? "");

  return {
    sport: sportFromAttribute(activity.attributes["Sport"]),
    startTime: Number.isFinite(started) ? started : points[0]!.t,
    elapsedTime: (points[points.length - 1]!.t - points[0]!.t) / 1000 || totalTime,
    movingTime: totalTime || undefined,
    distance: totalDistance || undefined,
    calories: calories || undefined,
    maxHr,
    points,
    laps,
    format: "tcx",
  };
}

function heartRate(node: XmlNode | undefined): number | undefined {
  if (!node) return undefined;
  return numberOf(node, "Value");
}

/** Les extensions TPX portent vitesse et puissance selon les montres. */
function extensionValue(tp: XmlNode, name: string): number | undefined {
  const extensions = child(tp, "Extensions");
  if (!extensions) return undefined;
  return numberOf(extensions, name);
}

function sportFromAttribute(sport: string | undefined): Sport {
  switch ((sport ?? "").toLowerCase()) {
    case "running":
      return "course";
    case "biking":
      return "velo";
    case "walking":
      return "marche";
    case "swimming":
      return "natation";
    default:
      return "autre";
  }
}
