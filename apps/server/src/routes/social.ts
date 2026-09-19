import { getUser, requireUser } from "../auth.ts";
import { getActivity } from "../activities.ts";
import { db, newId } from "../db.ts";
import { HttpError, type Router, readJson } from "../http.ts";

/**
 * Volet social : flux des athletes suivis, encouragements et commentaires.
 * Un athlete voit son propre flux et celui des personnes qu'il suit.
 */
export function registerSocialRoutes(router: Router): void {
  router.get("/api/feed", (ctx) => {
    const userId = requireUser(ctx);
    const limit = Math.min(50, Number(ctx.url.searchParams.get("limit") ?? 20));

    const rows = db
      .prepare(
        `SELECT a.id, a.user_id, a.sport, a.title, a.start_time, a.distance,
                a.moving_time, a.elevation_gain, a.avg_hr, a.metrics, a.source,
                u.display_name,
                (SELECT COUNT(*) FROM kudos k WHERE k.activity_id = a.id) AS kudos_count,
                (SELECT COUNT(*) FROM comments c WHERE c.activity_id = a.id) AS comment_count,
                EXISTS(SELECT 1 FROM kudos k2 WHERE k2.activity_id = a.id AND k2.user_id = ?) AS kudoed
         FROM activities a
         JOIN users u ON u.id = a.user_id
         WHERE a.user_id = ?
            OR a.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)
         ORDER BY a.start_time DESC
         LIMIT ?`,
      )
      .all(userId, userId, userId, limit) as Array<Record<string, string | number | null>>;

    return rows.map((row) => ({
      id: String(row["id"]),
      userId: String(row["user_id"]),
      athlete: String(row["display_name"]),
      sport: String(row["sport"]),
      title: String(row["title"]),
      startTime: Number(row["start_time"]),
      distance: Number(row["distance"]),
      movingTime: Number(row["moving_time"]),
      elevationGain: Number(row["elevation_gain"] ?? 0),
      avgHr: (row["avg_hr"] as number | null) ?? undefined,
      source: String(row["source"]),
      trainingLoad: row["metrics"]
        ? (JSON.parse(String(row["metrics"])) as { trainingLoad?: number }).trainingLoad
        : undefined,
      kudosCount: Number(row["kudos_count"] ?? 0),
      commentCount: Number(row["comment_count"] ?? 0),
      kudoed: Boolean(Number(row["kudoed"] ?? 0)),
      isMine: String(row["user_id"]) === userId,
    }));
  });

  router.post("/api/activities/:id/kudos", (ctx) => {
    const userId = requireUser(ctx);
    const activityId = ctx.params["id"]!;
    if (!getActivity(activityId)) throw new HttpError(404, "Activite introuvable");

    // Un second appel retire l'encouragement, comme un bouton a bascule.
    const existing = db
      .prepare("SELECT 1 FROM kudos WHERE activity_id = ? AND user_id = ?")
      .get(activityId, userId);
    if (existing) {
      db.prepare("DELETE FROM kudos WHERE activity_id = ? AND user_id = ?").run(
        activityId,
        userId,
      );
    } else {
      db.prepare(
        "INSERT INTO kudos (activity_id, user_id, created_at) VALUES (?, ?, ?)",
      ).run(activityId, userId, Date.now());
    }

    const count = db
      .prepare("SELECT COUNT(*) AS n FROM kudos WHERE activity_id = ?")
      .get(activityId) as { n: number };
    return { kudoed: !existing, count: count.n };
  });

  router.get("/api/activities/:id/comments", (ctx) => {
    requireUser(ctx);
    const rows = db
      .prepare(
        `SELECT c.id, c.body, c.created_at, u.display_name, u.id AS user_id
         FROM comments c JOIN users u ON u.id = c.user_id
         WHERE c.activity_id = ? ORDER BY c.created_at ASC`,
      )
      .all(ctx.params["id"]!) as Array<Record<string, string | number>>;

    return rows.map((row) => ({
      id: String(row["id"]),
      body: String(row["body"]),
      createdAt: Number(row["created_at"]),
      author: String(row["display_name"]),
      authorId: String(row["user_id"]),
    }));
  });

  router.post("/api/activities/:id/comments", async (ctx) => {
    const userId = requireUser(ctx);
    const activityId = ctx.params["id"]!;
    if (!getActivity(activityId)) throw new HttpError(404, "Activite introuvable");

    const body = await readJson<{ body?: string }>(ctx.req);
    const text = body.body?.trim();
    if (!text) throw new HttpError(400, "Commentaire vide");
    if (text.length > 1000) throw new HttpError(400, "Commentaire trop long (1000 caracteres)");

    const id = newId("c_");
    db.prepare(
      "INSERT INTO comments (id, activity_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, activityId, userId, text, Date.now());

    return {
      id,
      body: text,
      createdAt: Date.now(),
      author: getUser(userId).displayName,
      authorId: userId,
    };
  });

  router.get("/api/athletes", (ctx) => {
    const userId = requireUser(ctx);
    const rows = db
      .prepare(
        `SELECT u.id, u.display_name,
                EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.followee_id = u.id) AS following
         FROM users u WHERE u.id != ? ORDER BY u.display_name`,
      )
      .all(userId, userId) as Array<Record<string, string | number>>;

    return rows.map((row) => ({
      id: String(row["id"]),
      displayName: String(row["display_name"]),
      following: Boolean(Number(row["following"])),
    }));
  });

  router.post("/api/athletes/:id/follow", (ctx) => {
    const userId = requireUser(ctx);
    const target = ctx.params["id"]!;
    if (target === userId) throw new HttpError(400, "Tu ne peux pas te suivre toi-meme");
    getUser(target);

    const existing = db
      .prepare("SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?")
      .get(userId, target);
    if (existing) {
      db.prepare("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?").run(
        userId,
        target,
      );
      return { following: false };
    }
    db.prepare(
      "INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)",
    ).run(userId, target, Date.now());
    return { following: true };
  });
}
