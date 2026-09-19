import type { Activity, Lap, TrackPoint } from "@montre/core";
import { db } from "./db.ts";
import { HttpError } from "./http.ts";

/**
 * Acces aux activites. Les traces sont serialisees en JSON ; les listes ne les
 * chargent jamais, seul le detail d'une activite les remonte.
 */

type ActivitySummary = Omit<Activity, "points" | "laps"> & {
  pointCount: number;
  lapCount: number;
};

export function insertActivity(activity: Activity): void {
  db.prepare(
    `INSERT INTO activities (
      id, user_id, sport, title, description, start_time, elapsed_time, moving_time,
      distance, elevation_gain, elevation_loss, avg_hr, max_hr, avg_cadence, avg_power,
      calories, source, source_id, points, laps, metrics, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    activity.id,
    activity.userId,
    activity.sport,
    activity.title,
    activity.description ?? null,
    activity.startTime,
    activity.elapsedTime,
    activity.movingTime,
    activity.distance,
    activity.elevationGain,
    activity.elevationLoss,
    activity.avgHr ?? null,
    activity.maxHr ?? null,
    activity.avgCadence ?? null,
    activity.avgPower ?? null,
    activity.calories ?? null,
    activity.source,
    activity.sourceId ?? null,
    JSON.stringify(activity.points),
    JSON.stringify(activity.laps),
    activity.metrics ? JSON.stringify(activity.metrics) : null,
    activity.createdAt,
  );
}

/** Vrai si cette activite a deja ete importee depuis la meme source. */
export function activityExists(
  userId: string,
  source: string,
  sourceId: string,
): boolean {
  const row = db
    .prepare(
      "SELECT id FROM activities WHERE user_id = ? AND source = ? AND source_id = ?",
    )
    .get(userId, source, sourceId);
  return row != null;
}

export function listActivities(
  userId: string,
  options: { limit?: number; offset?: number; sport?: string } = {},
): ActivitySummary[] {
  const limit = Math.min(200, Math.max(1, options.limit ?? 30));
  const offset = Math.max(0, options.offset ?? 0);
  const rows = options.sport
    ? (db
        .prepare(
          `SELECT * FROM activities WHERE user_id = ? AND sport = ?
           ORDER BY start_time DESC LIMIT ? OFFSET ?`,
        )
        .all(userId, options.sport, limit, offset) as Row[])
    : (db
        .prepare(
          `SELECT * FROM activities WHERE user_id = ?
           ORDER BY start_time DESC LIMIT ? OFFSET ?`,
        )
        .all(userId, limit, offset) as Row[]);
  return rows.map(toSummary);
}

export function getActivity(id: string): Activity | null {
  const row = db.prepare("SELECT * FROM activities WHERE id = ?").get(id) as
    | Row
    | undefined;
  return row ? toActivity(row) : null;
}

/** Charge une activite en verifiant qu'elle appartient bien a l'utilisateur. */
export function getOwnedActivity(id: string, userId: string): Activity {
  const activity = getActivity(id);
  if (!activity) throw new HttpError(404, "Activite introuvable");
  if (activity.userId !== userId) {
    throw new HttpError(403, "Cette activite ne t'appartient pas");
  }
  return activity;
}

export function deleteActivity(id: string, userId: string): void {
  const result = db
    .prepare("DELETE FROM activities WHERE id = ? AND user_id = ?")
    .run(id, userId);
  if (result.changes === 0) throw new HttpError(404, "Activite introuvable");
}

/** Charges quotidiennes de l'utilisateur, pour le calcul de forme. */
export function dailyLoads(userId: string): Array<{ date: string; load: number }> {
  const rows = db
    .prepare(
      `SELECT start_time, metrics FROM activities
       WHERE user_id = ? ORDER BY start_time ASC`,
    )
    .all(userId) as Array<{ start_time: number; metrics: string | null }>;

  return rows.map((row) => {
    const metrics = row.metrics ? (JSON.parse(row.metrics) as { trainingLoad?: number }) : null;
    return {
      date: new Date(row.start_time).toISOString().slice(0, 10),
      load: metrics?.trainingLoad ?? 0,
    };
  });
}

type Row = Record<string, string | number | null>;

function toSummary(row: Row): ActivitySummary {
  const points = JSON.parse(String(row["points"] ?? "[]")) as TrackPoint[];
  const laps = JSON.parse(String(row["laps"] ?? "[]")) as Lap[];
  const { points: _p, laps: _l, ...rest } = toActivity(row);
  return { ...rest, pointCount: points.length, lapCount: laps.length };
}

export function toActivity(row: Row): Activity {
  return {
    id: String(row["id"]),
    userId: String(row["user_id"]),
    sport: row["sport"] as Activity["sport"],
    title: String(row["title"]),
    description: (row["description"] as string | null) ?? undefined,
    startTime: Number(row["start_time"]),
    elapsedTime: Number(row["elapsed_time"]),
    movingTime: Number(row["moving_time"]),
    distance: Number(row["distance"]),
    elevationGain: Number(row["elevation_gain"] ?? 0),
    elevationLoss: Number(row["elevation_loss"] ?? 0),
    avgHr: (row["avg_hr"] as number | null) ?? undefined,
    maxHr: (row["max_hr"] as number | null) ?? undefined,
    avgCadence: (row["avg_cadence"] as number | null) ?? undefined,
    avgPower: (row["avg_power"] as number | null) ?? undefined,
    calories: (row["calories"] as number | null) ?? undefined,
    source: row["source"] as Activity["source"],
    sourceId: (row["source_id"] as string | null) ?? undefined,
    points: JSON.parse(String(row["points"] ?? "[]")) as TrackPoint[],
    laps: JSON.parse(String(row["laps"] ?? "[]")) as Lap[],
    metrics: row["metrics"] ? JSON.parse(String(row["metrics"])) : undefined,
    createdAt: Number(row["created_at"]),
  };
}

/**
 * Reduit une trace pour l'affichage : au-dela de quelques milliers de points,
 * les graphiques et la carte n'y gagnent rien et le transfert s'alourdit.
 */
export function downsample(points: TrackPoint[], maxPoints = 2000): TrackPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: TrackPoint[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]!);
  const last = points[points.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
