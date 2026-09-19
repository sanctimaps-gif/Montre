import type { Lap, Sport, TrackPoint } from "../types.ts";

/**
 * Resultat brut d'un parseur, avant normalisation. Les champs optionnels sont
 * ceux que le fichier peut ne pas contenir : ils seront recalcules depuis la
 * trace au moment de l'import.
 */
export interface ParsedActivity {
  sport: Sport;
  startTime: number;
  title?: string;
  elapsedTime?: number;
  movingTime?: number;
  distance?: number;
  calories?: number;
  avgHr?: number;
  maxHr?: number;
  avgCadence?: number;
  avgPower?: number;
  elevationGain?: number;
  elevationLoss?: number;
  points: TrackPoint[];
  laps: Lap[];
  /** Appareil ayant produit le fichier, quand il est identifiable. */
  device?: string;
  format: "fit" | "gpx" | "tcx";
}
