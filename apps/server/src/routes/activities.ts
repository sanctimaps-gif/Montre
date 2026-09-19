import type { Activity, TrackPoint } from "@montre/core";
import {
  activityToGpx,
  activityToTcx,
  analyzeSession,
  computeMetrics,
  defaultTitle,
  elevationChange,
  mean,
  movingTime as computeMovingTime,
  normalizeActivity,
  parseActivityFile,
  totalDistance,
} from "@montre/core";
import { getProfile, requireUser } from "../auth.ts";
import {
  deleteActivity,
  downsample,
  getOwnedActivity,
  insertActivity,
  listActivities,
} from "../activities.ts";
import { db, newId } from "../db.ts";
import {
  HANDLED,
  HttpError,
  type Router,
  readBody,
  readJson,
} from "../http.ts";
import { latestPlan } from "./coach.ts";

export function registerActivityRoutes(router: Router): void {
  router.get("/api/activities", (ctx) => {
    const userId = requireUser(ctx);
    return listActivities(userId, {
      limit: Number(ctx.url.searchParams.get("limit") ?? 30),
      offset: Number(ctx.url.searchParams.get("offset") ?? 0),
      sport: ctx.url.searchParams.get("sport") ?? undefined,
    });
  });

  router.get("/api/activities/:id", (ctx) => {
    const userId = requireUser(ctx);
    const activity = getOwnedActivity(ctx.params["id"]!, userId);
    const profile = getProfile(userId);
    const plan = latestPlan(userId);
    const day = new Date(activity.startTime).toISOString().slice(0, 10);
    const planned = plan?.sessions.find((s) => s.date === day);

    return {
      ...activity,
      // La trace complete peut compter des dizaines de milliers de points.
      points: downsample(activity.points),
      analysis: analyzeSession(activity, profile, planned),
    };
  });

  /**
   * Import d'un fichier d'activite. Le corps de la requete est le fichier brut
   * (FIT, GPX ou TCX) ; son nom arrive dans l'en-tete X-Filename, ce qui evite
   * un encodage multipart pour un unique fichier.
   */
  router.post("/api/activities/import", async (ctx) => {
    const userId = requireUser(ctx);
    const profile = getProfile(userId);
    const body = await readBody(ctx.req);
    if (body.length === 0) throw new HttpError(400, "Aucun fichier recu");

    const filename = String(ctx.req.headers["x-filename"] ?? "activite");
    let parsed;
    try {
      parsed = parseActivityFile(new Uint8Array(body), filename);
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }

    // Deux imports du meme fichier produisent la meme empreinte de source.
    const sourceId = `${parsed.format}:${parsed.startTime}:${parsed.points.length}`;
    const duplicate = db
      .prepare(
        "SELECT id FROM activities WHERE user_id = ? AND source = 'import' AND source_id = ?",
      )
      .get(userId, sourceId) as { id: string } | undefined;
    if (duplicate) {
      return { activity: null, duplicate: true, existingId: duplicate.id };
    }

    const activity = normalizeActivity(parsed, {
      userId,
      profile,
      id: newId("a_"),
      source: "import",
      sourceId,
    });
    insertActivity(activity);

    return {
      activity: { ...activity, points: [] },
      duplicate: false,
      analysis: analyzeSession(activity, profile),
      device: parsed.device,
    };
  });

  /**
   * Enregistrement d'une seance capturee en direct par l'application : la trace
   * arrive deja constituee depuis le navigateur (GPS du telephone + capteurs
   * Bluetooth de la montre).
   */
  router.post("/api/activities", async (ctx) => {
    const userId = requireUser(ctx);
    const profile = getProfile(userId);
    const body = await readJson<{
      sport?: Activity["sport"];
      title?: string;
      description?: string;
      startTime?: number;
      points?: TrackPoint[];
      laps?: Activity["laps"];
      source?: Activity["source"];
    }>(ctx.req);

    const points = (body.points ?? []).filter((p) => Number.isFinite(p?.t));
    if (points.length < 2) {
      throw new HttpError(400, "Une seance doit contenir au moins deux points de mesure");
    }
    points.sort((a, b) => a.t - b.t);

    const sport = body.sport ?? "course";
    const startTime = body.startTime ?? points[0]!.t;
    const elevation = elevationChange(points);
    const hrValues = points.map((p) => p.hr).filter((v): v is number => v != null);
    const cadenceValues = points
      .map((p) => p.cadence)
      .filter((v): v is number => v != null && v > 0);

    const base = {
      id: newId("a_"),
      userId,
      sport,
      title: body.title?.trim() || defaultTitle({ startTime, sport }),
      description: body.description?.trim() || undefined,
      startTime,
      elapsedTime: Math.round((points[points.length - 1]!.t - points[0]!.t) / 1000),
      movingTime: computeMovingTime(points),
      distance: totalDistance(points),
      elevationGain: elevation.gain,
      elevationLoss: elevation.loss,
      avgHr: hrValues.length ? Math.round(mean(hrValues)) : undefined,
      maxHr: hrValues.length ? Math.max(...hrValues) : undefined,
      avgCadence: cadenceValues.length ? Math.round(mean(cadenceValues)) : undefined,
      source: body.source ?? ("fit100s" as const),
      points,
      laps: body.laps ?? [],
      createdAt: Date.now(),
    };

    const activity: Activity = { ...base, metrics: computeMetrics(base, profile) };
    insertActivity(activity);

    const plan = latestPlan(userId);
    const day = new Date(startTime).toISOString().slice(0, 10);
    const planned = plan?.sessions.find((s) => s.date === day);

    return {
      activity: { ...activity, points: [] },
      analysis: analyzeSession(activity, profile, planned),
    };
  });

  router.patch("/api/activities/:id", async (ctx) => {
    const userId = requireUser(ctx);
    const activity = getOwnedActivity(ctx.params["id"]!, userId);
    const body = await readJson<{ title?: string; description?: string; sport?: string }>(
      ctx.req,
    );

    const title = body.title?.trim() || activity.title;
    const description = body.description?.trim() ?? activity.description ?? null;
    const sport = body.sport ?? activity.sport;

    db.prepare(
      "UPDATE activities SET title = ?, description = ?, sport = ? WHERE id = ?",
    ).run(title, description, sport, activity.id);

    return { ...activity, title, description: description ?? undefined, sport, points: [] };
  });

  router.delete("/api/activities/:id", (ctx) => {
    const userId = requireUser(ctx);
    deleteActivity(ctx.params["id"]!, userId);
    return { ok: true };
  });

  /** Export d'une activite au format GPX ou TCX. */
  router.get("/api/activities/:id/export", (ctx) => {
    const userId = requireUser(ctx);
    const activity = getOwnedActivity(ctx.params["id"]!, userId);
    const format = ctx.url.searchParams.get("format") === "gpx" ? "gpx" : "tcx";
    const body = format === "gpx" ? activityToGpx(activity) : activityToTcx(activity);

    ctx.res.writeHead(200, {
      "Content-Type": format === "gpx" ? "application/gpx+xml" : "application/xml",
      "Content-Disposition": `attachment; filename="${activity.id}.${format}"`,
      "Content-Length": Buffer.byteLength(body),
    });
    ctx.res.end(body);
    return HANDLED;
  });

  /** Statistiques agregees, pour l'ecran d'accueil. */
  router.get("/api/stats", (ctx) => {
    const userId = requireUser(ctx);
    const since = Date.now() - 365 * 24 * 3600 * 1000;
    const rows = db
      .prepare(
        `SELECT sport, COUNT(*) AS count, SUM(distance) AS distance,
                SUM(moving_time) AS duration, SUM(elevation_gain) AS elevation
         FROM activities WHERE user_id = ? AND start_time >= ?
         GROUP BY sport ORDER BY distance DESC`,
      )
      .all(userId, since) as Array<Record<string, number | string>>;

    return rows.map((row) => ({
      sport: String(row["sport"]),
      count: Number(row["count"]),
      distance: Number(row["distance"] ?? 0),
      duration: Number(row["duration"] ?? 0),
      elevation: Number(row["elevation"] ?? 0),
    }));
  });
}
