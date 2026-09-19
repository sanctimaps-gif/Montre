import type { PlanGoal, TrainingPlan } from "@montre/core";
import {
  acwr,
  fitnessSeries,
  generatePlan,
  readForm,
  recommendToday,
  trainingPaces,
  weeklyLoads,
} from "@montre/core";
import { getProfile, requireUser } from "../auth.ts";
import { dailyLoads } from "../activities.ts";
import { db, newId } from "../db.ts";
import { HttpError, type Router, readJson } from "../http.ts";

const GOALS: PlanGoal[] = ["5km", "10km", "semi", "marathon", "forme", "trail"];

/** Dernier plan cree par l'utilisateur, ou null s'il n'en a aucun. */
export function latestPlan(userId: string): TrainingPlan | null {
  const row = db
    .prepare("SELECT * FROM plans WHERE user_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(userId) as Record<string, string | number | null> | undefined;
  if (!row) return null;
  return {
    id: String(row["id"]),
    userId,
    goal: row["goal"] as PlanGoal,
    targetDate: String(row["target_date"]),
    targetTime: (row["target_time"] as number | null) ?? undefined,
    createdAt: Number(row["created_at"]),
    sessions: JSON.parse(String(row["sessions"])),
  };
}

export function registerCoachRoutes(router: Router): void {
  /** Courbe de forme : charge chronique, fatigue et fraicheur jour par jour. */
  router.get("/api/fitness", (ctx) => {
    const userId = requireUser(ctx);
    const loads = dailyLoads(userId);
    const series = fitnessSeries(loads);
    const today = series[series.length - 1];

    return {
      series: series.slice(-180),
      today,
      form: readForm(today),
      acwr: acwr(today),
      weekly: weeklyLoads(loads).slice(-26),
    };
  });

  /** Seance du jour, ajustee a l'etat de forme reel. */
  router.get("/api/coach/today", (ctx) => {
    const userId = requireUser(ctx);
    const profile = getProfile(userId);
    const loads = dailyLoads(userId);
    const series = fitnessSeries(loads);
    const plan = latestPlan(userId);

    const recent = db
      .prepare(
        `SELECT start_time, metrics FROM activities
         WHERE user_id = ? ORDER BY start_time DESC LIMIT 20`,
      )
      .all(userId) as Array<{ start_time: number; metrics: string | null }>;

    const recommendation = recommendToday({
      profile,
      fitness: series[series.length - 1],
      plan: plan ?? undefined,
      recentActivities: recent.map((row) => ({
        startTime: row.start_time,
        metrics: row.metrics ? JSON.parse(row.metrics) : undefined,
      })),
    });

    return {
      ...recommendation,
      paces: profile.vma ? trainingPaces(profile.vma) : null,
      hasPlan: plan != null,
    };
  });

  router.get("/api/coach/plan", (ctx) => {
    const userId = requireUser(ctx);
    return latestPlan(userId);
  });

  router.post("/api/coach/plan", async (ctx) => {
    const userId = requireUser(ctx);
    const profile = getProfile(userId);
    const body = await readJson<{
      goal?: string;
      targetDate?: string;
      targetTime?: number;
      availableDays?: number[];
    }>(ctx.req);

    const goal = body.goal as PlanGoal;
    if (!GOALS.includes(goal)) {
      throw new HttpError(400, `Objectif inconnu. Valeurs possibles : ${GOALS.join(", ")}`);
    }
    if (!body.targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)) {
      throw new HttpError(400, "Date d'objectif attendue au format AAAA-MM-JJ");
    }

    let plan: TrainingPlan;
    try {
      plan = generatePlan({
        goal,
        targetDate: body.targetDate,
        targetTime: body.targetTime,
        availableDays: body.availableDays,
        profile,
      });
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }

    plan.id = newId("p_");
    db.prepare(
      `INSERT INTO plans (id, user_id, goal, target_date, target_time, created_at, sessions)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      plan.id,
      userId,
      plan.goal,
      plan.targetDate,
      plan.targetTime ?? null,
      plan.createdAt,
      JSON.stringify(plan.sessions),
    );

    return plan;
  });

  router.delete("/api/coach/plan/:id", (ctx) => {
    const userId = requireUser(ctx);
    const result = db
      .prepare("DELETE FROM plans WHERE id = ? AND user_id = ?")
      .run(ctx.params["id"]!, userId);
    if (result.changes === 0) throw new HttpError(404, "Plan introuvable");
    return { ok: true };
  });
}
