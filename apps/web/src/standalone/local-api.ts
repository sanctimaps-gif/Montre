import type { Activity, AthleteProfile, TrackPoint, TrainingPlan, User } from "@montre/core";
import {
  acwr,
  activityToGpx,
  activityToTcx,
  analyzeSession,
  computeMetrics,
  defaultTitle,
  elevationChange,
  fitnessSeries,
  generatePlan,
  mean,
  movingTime as computeMovingTime,
  normalizeActivity,
  parseActivityFile,
  readForm,
  recommendToday,
  totalDistance,
  trainingPaces,
  weeklyLoads,
} from "@montre/core";
import type {
  ActivitySummary,
  Comment,
  DeviceRecord,
  ImportResult,
  MontreApi,
  SessionPayload,
  SportStat,
} from "../api-types.ts";
import {
  allActivities,
  deleteActivity as removeActivity,
  getActivity,
  newId,
  putActivity,
  readDoc,
  removeDoc,
  writeDoc,
} from "./storage.ts";
import { demoSessions } from "./demo.ts";

/**
 * Implementation locale de l'API, pour le mode autonome.
 *
 * Toute la logique metier vient de `@montre/core`, exactement comme cote
 * serveur : les metriques, la charge d'entrainement et les recommandations du
 * coach sont donc identiques, seul le stockage change. Ce qui demande un
 * serveur par nature — les comptes et l'acces a l'API Strava, qui exige un
 * secret client — est explicitement indisponible et le dit.
 */

/** Identifiant de l'athlete local, unique puisqu'il n'y a pas de comptes. */
const LOCAL_USER_ID = "local";

class StandaloneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StandaloneError";
  }
}

async function currentUser(): Promise<User> {
  const stored = await readDoc<User>("user");
  if (stored) return stored;
  return writeDoc<User>("user", {
    id: LOCAL_USER_ID,
    email: "",
    displayName: "Athlete",
    createdAt: Date.now(),
  });
}

async function currentProfile(): Promise<AthleteProfile> {
  const stored = await readDoc<AthleteProfile>("profile");
  if (stored) return stored;
  return writeDoc<AthleteProfile>("profile", {
    userId: LOCAL_USER_ID,
    weeklySessions: 3,
    level: "debutant",
  });
}

function toSummary(activity: Activity): ActivitySummary {
  const { points, laps, ...rest } = activity;
  return { ...rest, pointCount: points.length, lapCount: laps.length };
}

/** Reduit une trace pour l'affichage, comme le fait le serveur. */
function downsample(points: TrackPoint[], maxPoints = 2000): TrackPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: TrackPoint[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]!);
  const last = points[points.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

async function dailyLoads(): Promise<Array<{ date: string; load: number }>> {
  const activities = await allActivities<Activity>();
  return activities
    .map((a) => ({
      date: new Date(a.startTime).toISOString().slice(0, 10),
      load: a.metrics?.trainingLoad ?? 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function ownedActivity(id: string): Promise<Activity> {
  const activity = await getActivity<Activity>(id);
  if (!activity) throw new StandaloneError("Activite introuvable");
  return activity;
}

/** Enregistre une activite construite a partir d'une trace. */
async function storeFromPoints(
  points: TrackPoint[],
  options: { sport: Activity["sport"]; title?: string; startTime: number; laps?: Activity["laps"]; source: Activity["source"] },
): Promise<Activity> {
  const profile = await currentProfile();
  const elevation = elevationChange(points);
  const hrValues = points.map((p) => p.hr).filter((v): v is number => v != null);
  const cadenceValues = points
    .map((p) => p.cadence)
    .filter((v): v is number => v != null && v > 0);

  const base = {
    id: newId("a_"),
    userId: LOCAL_USER_ID,
    sport: options.sport,
    title: options.title?.trim() || defaultTitle({ startTime: options.startTime, sport: options.sport }),
    startTime: options.startTime,
    elapsedTime: Math.round((points[points.length - 1]!.t - points[0]!.t) / 1000),
    movingTime: computeMovingTime(points),
    distance: totalDistance(points),
    elevationGain: elevation.gain,
    elevationLoss: elevation.loss,
    avgHr: hrValues.length ? Math.round(mean(hrValues)) : undefined,
    maxHr: hrValues.length ? Math.max(...hrValues) : undefined,
    avgCadence: cadenceValues.length ? Math.round(mean(cadenceValues)) : undefined,
    source: options.source,
    points,
    laps: options.laps ?? [],
    createdAt: Date.now(),
  };

  const activity: Activity = { ...base, metrics: computeMetrics(base, profile) };
  return putActivity(activity);
}

export const localApi: MontreApi = {
  requiresAuth: false,
  standalone: true,

  async register(_email, _password, displayName) {
    const user = await writeDoc<User>("user", {
      ...(await currentUser()),
      displayName: displayName.trim() || "Athlete",
    });
    return { user, token: "local" };
  },

  async login() {
    throw new StandaloneError(
      "Cette version fonctionne sans compte : tes donnees restent dans ce navigateur.",
    );
  },

  async logout() {
    return { ok: true };
  },

  async me() {
    return { user: await currentUser(), profile: await currentProfile() };
  },

  async updateProfile(profile) {
    const current = await currentProfile();
    const merged: AthleteProfile = {
      ...current,
      ...profile,
      userId: LOCAL_USER_ID,
      weeklySessions: Math.min(7, Math.max(1, Number(profile.weeklySessions ?? current.weeklySessions))),
      level: profile.level ?? current.level,
    };
    return writeDoc("profile", merged);
  },

  async activities(params = {}) {
    const all = await allActivities<Activity>();
    const filtered = params.sport ? all.filter((a) => a.sport === params.sport) : all;
    const offset = params.offset ?? 0;
    return filtered.slice(offset, offset + (params.limit ?? 30)).map(toSummary);
  },

  async activity(id) {
    const activity = await ownedActivity(id);
    const profile = await currentProfile();
    const plan = await readDoc<TrainingPlan>("plan");
    const day = new Date(activity.startTime).toISOString().slice(0, 10);
    const planned = plan?.sessions.find((s) => s.date === day);

    return {
      ...activity,
      points: downsample(activity.points),
      analysis: analyzeSession(activity, profile, planned),
    };
  },

  async importFile(file): Promise<ImportResult> {
    const profile = await currentProfile();
    const buffer = await file.arrayBuffer();

    let parsed;
    try {
      parsed = parseActivityFile(new Uint8Array(buffer), file.name);
    } catch (error) {
      throw new StandaloneError((error as Error).message);
    }

    // Meme empreinte que cote serveur, pour detecter un fichier deja importe.
    const sourceId = `${parsed.format}:${parsed.startTime}:${parsed.points.length}`;
    const existing = (await allActivities<Activity>()).find((a) => a.sourceId === sourceId);
    if (existing) return { activity: null, duplicate: true, existingId: existing.id };

    const activity = normalizeActivity(parsed, {
      userId: LOCAL_USER_ID,
      profile,
      id: newId("a_"),
      source: "import",
      sourceId,
    });
    await putActivity(activity);

    return {
      activity: toSummary(activity),
      duplicate: false,
      analysis: analyzeSession(activity, profile),
      device: parsed.device,
    };
  },

  async saveSession(payload: SessionPayload) {
    const points = (payload.points as TrackPoint[]).filter((p) => Number.isFinite(p?.t));
    if (points.length < 2) {
      throw new StandaloneError("Une seance doit contenir au moins deux points de mesure");
    }
    points.sort((a, b) => a.t - b.t);

    const activity = await storeFromPoints(points, {
      sport: (payload.sport as Activity["sport"]) ?? "course",
      title: payload.title,
      startTime: payload.startTime ?? points[0]!.t,
      laps: payload.laps as Activity["laps"],
      source: "fit100s",
    });

    const profile = await currentProfile();
    return { activity: toSummary(activity), analysis: analyzeSession(activity, profile) };
  },

  async updateActivity(id, changes) {
    const activity = await ownedActivity(id);
    const updated: Activity = {
      ...activity,
      title: changes.title?.trim() || activity.title,
      description: changes.description?.trim() || undefined,
      sport: (changes.sport as Activity["sport"]) ?? activity.sport,
    };
    await putActivity(updated);
    return toSummary(updated);
  },

  async deleteActivity(id) {
    await removeActivity(id);
    return { ok: true };
  },

  async exportActivity(id, format) {
    const activity = await ownedActivity(id);
    const body = format === "gpx" ? activityToGpx(activity) : activityToTcx(activity);
    return new Blob([body], { type: format === "gpx" ? "application/gpx+xml" : "application/xml" });
  },

  async stats(): Promise<SportStat[]> {
    const since = Date.now() - 365 * 24 * 3600 * 1000;
    const activities = (await allActivities<Activity>()).filter((a) => a.startTime >= since);
    const bySport = new Map<string, SportStat>();

    for (const activity of activities) {
      const entry = bySport.get(activity.sport) ?? {
        sport: activity.sport,
        count: 0,
        distance: 0,
        duration: 0,
        elevation: 0,
      };
      entry.count++;
      entry.distance += activity.distance;
      entry.duration += activity.movingTime;
      entry.elevation += activity.elevationGain;
      bySport.set(activity.sport, entry);
    }

    return [...bySport.values()].sort((a, b) => b.distance - a.distance);
  },

  async fitness() {
    const loads = await dailyLoads();
    const series = fitnessSeries(loads);
    const today = series[series.length - 1];
    return {
      series: series.slice(-180),
      today,
      form: readForm(today),
      acwr: acwr(today),
      weekly: weeklyLoads(loads).slice(-26),
    };
  },

  async today() {
    const profile = await currentProfile();
    const loads = await dailyLoads();
    const series = fitnessSeries(loads);
    const plan = await readDoc<TrainingPlan>("plan");
    const recent = (await allActivities<Activity>()).slice(0, 20);

    const recommendation = recommendToday({
      profile,
      fitness: series[series.length - 1],
      plan: plan ?? undefined,
      recentActivities: recent.map((a) => ({ startTime: a.startTime, metrics: a.metrics })),
    });

    return {
      ...recommendation,
      paces: profile.vma ? trainingPaces(profile.vma) : null,
      hasPlan: plan != null,
    };
  },

  async plan() {
    return readDoc<TrainingPlan>("plan");
  },

  async createPlan(goal, targetDate, targetTime) {
    const profile = await currentProfile();
    let plan: TrainingPlan;
    try {
      plan = generatePlan({
        goal: goal as TrainingPlan["goal"],
        targetDate,
        targetTime,
        profile,
      });
    } catch (error) {
      throw new StandaloneError((error as Error).message);
    }
    return writeDoc("plan", plan);
  },

  async deletePlan() {
    await removeDoc("plan");
    return { ok: true };
  },

  async feed() {
    const user = await currentUser();
    const activities = await allActivities<Activity>();
    const kudos = (await readDoc<string[]>("kudos")) ?? [];
    const comments = (await readDoc<Record<string, Comment[]>>("comments")) ?? {};

    return activities.slice(0, 20).map((activity) => ({
      id: activity.id,
      userId: LOCAL_USER_ID,
      athlete: user.displayName,
      sport: activity.sport,
      title: activity.title,
      startTime: activity.startTime,
      distance: activity.distance,
      movingTime: activity.movingTime,
      elevationGain: activity.elevationGain,
      avgHr: activity.avgHr,
      source: activity.source,
      trainingLoad: activity.metrics?.trainingLoad,
      kudosCount: kudos.includes(activity.id) ? 1 : 0,
      commentCount: comments[activity.id]?.length ?? 0,
      kudoed: kudos.includes(activity.id),
      isMine: true,
    }));
  },

  async kudos(activityId) {
    const kudos = (await readDoc<string[]>("kudos")) ?? [];
    const kudoed = !kudos.includes(activityId);
    const updated = kudoed ? [...kudos, activityId] : kudos.filter((id) => id !== activityId);
    await writeDoc("kudos", updated);
    return { kudoed, count: kudoed ? 1 : 0 };
  },

  async comments(activityId) {
    const comments = (await readDoc<Record<string, Comment[]>>("comments")) ?? {};
    return comments[activityId] ?? [];
  },

  async addComment(activityId, body) {
    const text = body.trim();
    if (!text) throw new StandaloneError("Commentaire vide");

    const user = await currentUser();
    const comments = (await readDoc<Record<string, Comment[]>>("comments")) ?? {};
    const comment: Comment = {
      id: newId("c_"),
      body: text,
      createdAt: Date.now(),
      author: user.displayName,
      authorId: LOCAL_USER_ID,
    };
    comments[activityId] = [...(comments[activityId] ?? []), comment];
    await writeDoc("comments", comments);
    return comment;
  },

  async athletes() {
    // Sans serveur, il n'y a qu'un athlete : celui de ce navigateur.
    return [];
  },

  async follow() {
    throw new StandaloneError(
      "Suivre d'autres athletes demande un serveur partage : lance l'application avec son API.",
    );
  },

  async devices() {
    return (await readDoc<DeviceRecord[]>("devices")) ?? [];
  },

  async saveDevice(device) {
    const devices = (await readDoc<DeviceRecord[]>("devices")) ?? [];
    const id = device.id?.trim() || newId("d_");
    const lastSeenAt = Date.now();
    const existing = devices.find((d) => d.id === id);

    const record: DeviceRecord = {
      id,
      name: device.name,
      model: device.model ?? existing?.model,
      firmware: device.firmware ?? existing?.firmware,
      serial: device.serial ?? existing?.serial,
      lastBattery: device.battery ?? existing?.lastBattery,
      lastSeenAt,
      transport: "ble",
    };

    await writeDoc(
      "devices",
      existing ? devices.map((d) => (d.id === id ? record : d)) : [...devices, record],
    );
    return { id, lastSeenAt };
  },

  async deleteDevice(id) {
    const devices = (await readDoc<DeviceRecord[]>("devices")) ?? [];
    await writeDoc(
      "devices",
      devices.filter((d) => d.id !== id),
    );
    return { ok: true };
  },

  async stravaStatus() {
    // La synchronisation Strava exige un secret client, qui n'a pas sa place
    // dans une page web : elle reste l'affaire du serveur.
    return { configured: false, connected: false };
  },

  async stravaAuthorize() {
    throw new StandaloneError(
      "La connexion Strava passe par le serveur de l'application : lance-le avec tes identifiants Strava.",
    );
  },

  async stravaSync() {
    throw new StandaloneError("La synchronisation Strava demande le serveur de l'application.");
  },

  async stravaUpload() {
    throw new StandaloneError(
      "Le depot sur Strava demande le serveur. Exporte la seance en GPX ou TCX et televerse-la sur Strava.",
    );
  },

  async stravaDisconnect() {
    return { ok: true };
  },

  async loadDemoData() {
    const sessions = demoSessions();
    for (const session of sessions) {
      await storeFromPoints(session.points, {
        sport: session.sport,
        title: session.title,
        startTime: session.startTime,
        source: "manuelle",
      });
    }
    return sessions.length;
  },

  async resetLocalData() {
    for (const activity of await allActivities<Activity>()) {
      await removeActivity(activity.id);
    }
    for (const key of ["plan", "kudos", "comments", "devices"]) {
      await removeDoc(key);
    }
  },
};
