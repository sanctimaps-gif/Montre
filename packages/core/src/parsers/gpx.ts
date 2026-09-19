import type { Sport, TrackPoint } from "../types.ts";
import type { ParsedActivity } from "./types.ts";
import { child, descendants, numberOf, parseXml, textOf } from "./xml.ts";

/**
 * Parseur GPX. Le GPX ne transporte officiellement que position, altitude et
 * horodatage ; la frequence cardiaque et la cadence passent par l'extension
 * TrackPointExtension, utilisee par Strava comme par Decathlon Coach.
 */
export function parseGpx(source: string): ParsedActivity {
  const doc = parseXml(source);
  const gpx = child(doc, "gpx");
  if (!gpx) throw new Error("Ce fichier n'est pas un GPX valide");

  const track = descendants(gpx, "trk")[0];
  const title = track ? textOf(track, "name") : undefined;
  const points: TrackPoint[] = [];

  for (const trkpt of descendants(gpx, "trkpt")) {
    const lat = Number(trkpt.attributes["lat"]);
    const lon = Number(trkpt.attributes["lon"]);
    const time = textOf(trkpt, "time");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const t = time ? Date.parse(time) : NaN;
    points.push({
      t: Number.isFinite(t) ? t : points.length * 1000,
      lat,
      lon,
      alt: numberOf(trkpt, "ele"),
      hr: numberOf(trkpt, "hr"),
      cadence: numberOf(trkpt, "cad"),
      power: numberOf(trkpt, "power"),
      temperature: numberOf(trkpt, "atemp"),
    });
  }

  if (points.length === 0) {
    throw new Error("Ce GPX ne contient aucun point de trace");
  }

  points.sort((a, b) => a.t - b.t);

  return {
    sport: sportFromType(track ? textOf(track, "type") : undefined),
    startTime: points[0]!.t,
    title,
    elapsedTime: (points[points.length - 1]!.t - points[0]!.t) / 1000,
    points,
    laps: [],
    format: "gpx",
  };
}

/** Le champ <type> du GPX est libre : on reconnait les valeurs courantes. */
function sportFromType(type: string | undefined): Sport {
  const value = (type ?? "").toLowerCase();
  if (/trail/.test(value)) return "trail";
  if (/run|course|jog/.test(value) || value === "9") return "course";
  if (/bike|cycl|velo|ride/.test(value) || value === "1") return "velo";
  if (/walk|hike|marche|rando/.test(value)) return "marche";
  if (/swim|natation/.test(value)) return "natation";
  return "course";
}
