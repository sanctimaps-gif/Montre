import { randomBytes } from "node:crypto";
import type { Activity, Sport, TrackPoint } from "@montre/core";
import { activityToTcx, computeMetrics } from "@montre/core";
import { getProfile } from "./auth.ts";
import { activityExists, insertActivity } from "./activities.ts";
import { config, isStravaConfigured } from "./config.ts";
import { db, newId } from "./db.ts";
import { HttpError } from "./http.ts";

/**
 * Connecteur Strava : OAuth 2, import d'activites avec leurs flux de donnees,
 * et televersement des seances enregistrees par l'application.
 *
 * Les jetons Strava expirent au bout de six heures ; ils sont rafraichis a la
 * volee avant chaque appel a l'API.
 */

const OAUTH_BASE = "https://www.strava.com/oauth";
const API_BASE = "https://www.strava.com/api/v3";

/** Droits demandes : lire toutes les activites et en deposer de nouvelles. */
const SCOPES = "read,activity:read_all,activity:write";

export interface StravaAccount {
  userId: string;
  athleteId: string;
  athleteName?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  lastSyncAt?: number;
}

export function getStravaAccount(userId: string): StravaAccount | null {
  const row = db
    .prepare("SELECT * FROM strava_accounts WHERE user_id = ?")
    .get(userId) as Record<string, string | number | null> | undefined;
  if (!row) return null;
  return {
    userId,
    athleteId: String(row["athlete_id"]),
    athleteName: (row["athlete_name"] as string | null) ?? undefined,
    accessToken: String(row["access_token"]),
    refreshToken: String(row["refresh_token"]),
    expiresAt: Number(row["expires_at"]),
    lastSyncAt: (row["last_sync_at"] as number | null) ?? undefined,
  };
}

export function disconnectStrava(userId: string): void {
  db.prepare("DELETE FROM strava_accounts WHERE user_id = ?").run(userId);
}

/** URL d'autorisation Strava, avec un jeton d'etat a usage unique. */
export function buildAuthorizeUrl(userId: string): string {
  if (!isStravaConfigured()) {
    throw new HttpError(
      503,
      "Strava n'est pas configure sur ce serveur : renseigne STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET.",
    );
  }
  const state = randomBytes(24).toString("base64url");
  db.prepare(
    "INSERT INTO oauth_states (state, user_id, provider, created_at) VALUES (?, ?, 'strava', ?)",
  ).run(state, userId, Date.now());

  const url = new URL(`${OAUTH_BASE}/authorize`);
  url.searchParams.set("client_id", config.strava.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.strava.redirectUri);
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

/** Valide et consomme un jeton d'etat. Dix minutes de validite. */
export function consumeState(state: string): string {
  const row = db
    .prepare("SELECT user_id, created_at FROM oauth_states WHERE state = ? AND provider = 'strava'")
    .get(state) as { user_id: string; created_at: number } | undefined;
  db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
  if (!row || Date.now() - row.created_at > 10 * 60 * 1000) {
    throw new HttpError(400, "Lien d'autorisation expire ou invalide, relance la connexion");
  }
  return row.user_id;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname?: string; lastname?: string };
}

export async function exchangeCode(userId: string, code: string): Promise<StravaAccount> {
  const response = await fetch(`${OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.strava.clientId,
      client_secret: config.strava.clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) {
    throw new HttpError(502, `Strava a refuse l'autorisation (${response.status})`);
  }
  const token = (await response.json()) as TokenResponse;
  const athleteName = token.athlete
    ? [token.athlete.firstname, token.athlete.lastname].filter(Boolean).join(" ")
    : undefined;

  db.prepare(
    `INSERT INTO strava_accounts (user_id, athlete_id, athlete_name, access_token, refresh_token, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       athlete_id = excluded.athlete_id,
       athlete_name = excluded.athlete_name,
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at`,
  ).run(
    userId,
    String(token.athlete?.id ?? ""),
    athleteName ?? null,
    token.access_token,
    token.refresh_token,
    token.expires_at * 1000,
  );

  return getStravaAccount(userId)!;
}

/** Retourne un jeton d'acces valide, en le rafraichissant si besoin. */
async function validAccessToken(account: StravaAccount): Promise<string> {
  // Marge d'une minute pour eviter d'utiliser un jeton qui expire pendant l'appel.
  if (account.expiresAt > Date.now() + 60_000) return account.accessToken;

  const response = await fetch(`${OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.strava.clientId,
      client_secret: config.strava.clientSecret,
      refresh_token: account.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    throw new HttpError(
      401,
      "La connexion Strava a expire, reconnecte ton compte dans les reglages",
    );
  }
  const token = (await response.json()) as TokenResponse;
  db.prepare(
    "UPDATE strava_accounts SET access_token = ?, refresh_token = ?, expires_at = ? WHERE user_id = ?",
  ).run(token.access_token, token.refresh_token, token.expires_at * 1000, account.userId);
  return token.access_token;
}

async function stravaFetch(
  account: StravaAccount,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const accessToken = await validAccessToken(account);
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (response.status === 429) {
    throw new HttpError(
      429,
      "Quota d'appels Strava atteint (100 requetes / 15 min). Reessaie dans quelques minutes.",
    );
  }
  return response;
}

interface StravaActivitySummary {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  start_date: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  total_elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  average_watts?: number;
  calories?: number;
}

/**
 * Importe les activites Strava posterieures a la derniere synchronisation.
 * Chaque activite est completee par ses flux (trace, cardio, cadence) afin de
 * disposer des memes metriques que pour une seance enregistree par la montre.
 */
export async function syncFromStrava(
  userId: string,
  options: { maxActivities?: number } = {},
): Promise<{ imported: number; skipped: number }> {
  const account = getStravaAccount(userId);
  if (!account) throw new HttpError(400, "Aucun compte Strava connecte");

  const profile = getProfile(userId);
  const perPage = Math.min(100, options.maxActivities ?? 30);
  const after = account.lastSyncAt ? Math.floor(account.lastSyncAt / 1000) : undefined;

  const query = new URLSearchParams({ per_page: String(perPage) });
  if (after) query.set("after", String(after));

  const response = await stravaFetch(account, `/athlete/activities?${query}`);
  if (!response.ok) {
    throw new HttpError(502, `Strava a refuse la lecture des activites (${response.status})`);
  }
  const summaries = (await response.json()) as StravaActivitySummary[];

  let imported = 0;
  let skipped = 0;

  for (const summary of summaries) {
    if (activityExists(userId, "strava", String(summary.id))) {
      skipped++;
      continue;
    }
    const startTime = Date.parse(summary.start_date);
    const points = await fetchStreams(account, summary.id, startTime);

    const base = {
      id: newId("a_"),
      userId,
      sport: stravaTypeToSport(summary.sport_type ?? summary.type),
      title: summary.name,
      startTime,
      elapsedTime: summary.elapsed_time,
      movingTime: summary.moving_time,
      distance: Math.round(summary.distance),
      elevationGain: Math.round(summary.total_elevation_gain ?? 0),
      elevationLoss: 0,
      avgHr: summary.average_heartrate ? Math.round(summary.average_heartrate) : undefined,
      maxHr: summary.max_heartrate ? Math.round(summary.max_heartrate) : undefined,
      avgCadence: summary.average_cadence ? Math.round(summary.average_cadence) : undefined,
      avgPower: summary.average_watts ? Math.round(summary.average_watts) : undefined,
      calories: summary.calories,
      source: "strava" as const,
      sourceId: String(summary.id),
      points,
      laps: [],
      createdAt: Date.now(),
    };

    const activity: Activity = { ...base, metrics: computeMetrics(base, profile) };
    insertActivity(activity);
    imported++;
  }

  db.prepare("UPDATE strava_accounts SET last_sync_at = ? WHERE user_id = ?").run(
    Date.now(),
    userId,
  );

  return { imported, skipped };
}

type StreamSet = Record<string, { data: unknown[] } | undefined>;

/** Reconstruit une trace point par point depuis les flux Strava. */
async function fetchStreams(
  account: StravaAccount,
  activityId: number,
  startTime: number,
): Promise<TrackPoint[]> {
  const keys = "time,latlng,altitude,heartrate,cadence,distance,velocity_smooth,watts,temp";
  const response = await stravaFetch(
    account,
    `/activities/${activityId}/streams?keys=${keys}&key_by_type=true`,
  );
  // Une activite sans trace (seance en salle) ne renvoie pas de flux : ce n'est pas une erreur.
  if (!response.ok) return [];

  const streams = (await response.json()) as StreamSet;
  const time = (streams["time"]?.data ?? []) as number[];
  if (time.length === 0) return [];

  const latlng = (streams["latlng"]?.data ?? []) as Array<[number, number]>;
  const altitude = (streams["altitude"]?.data ?? []) as number[];
  const heartrate = (streams["heartrate"]?.data ?? []) as number[];
  const cadence = (streams["cadence"]?.data ?? []) as number[];
  const distance = (streams["distance"]?.data ?? []) as number[];
  const velocity = (streams["velocity_smooth"]?.data ?? []) as number[];
  const watts = (streams["watts"]?.data ?? []) as number[];
  const temp = (streams["temp"]?.data ?? []) as number[];

  // Les flux Strava sont horodates en secondes depuis le depart de l'activite.
  return time.map((offset, i) => ({
    t: startTime + offset * 1000,
    lat: latlng[i]?.[0],
    lon: latlng[i]?.[1],
    alt: altitude[i],
    hr: heartrate[i],
    cadence: cadence[i],
    distance: distance[i],
    speed: velocity[i],
    power: watts[i],
    temperature: temp[i],
  }));
}

/** Depose une activite enregistree par l'application sur Strava. */
export async function uploadToStrava(
  userId: string,
  activity: Activity,
): Promise<{ uploadId: string; status: string }> {
  const account = getStravaAccount(userId);
  if (!account) throw new HttpError(400, "Aucun compte Strava connecte");

  const tcx = activityToTcx(activity);
  const form = new FormData();
  form.append("file", new Blob([tcx], { type: "application/xml" }), `${activity.id}.tcx`);
  form.append("data_type", "tcx");
  form.append("name", activity.title);
  if (activity.description) form.append("description", activity.description);
  form.append("external_id", activity.id);

  const response = await stravaFetch(account, "/uploads", { method: "POST", body: form });
  const payload = (await response.json()) as {
    id_str?: string;
    status?: string;
    error?: string;
  };
  if (!response.ok || payload.error) {
    throw new HttpError(502, payload.error ?? `Strava a refuse le depot (${response.status})`);
  }
  return { uploadId: payload.id_str ?? "", status: payload.status ?? "en cours de traitement" };
}

/** Correspondance entre les types d'activite Strava et les sports internes. */
export function stravaTypeToSport(type: string): Sport {
  switch (type) {
    case "Run":
    case "VirtualRun":
      return "course";
    case "TrailRun":
      return "trail";
    case "Walk":
    case "Hike":
      return "marche";
    case "Ride":
    case "VirtualRide":
    case "MountainBikeRide":
    case "GravelRide":
      return "velo";
    case "Swim":
      return "natation";
    case "Workout":
    case "Elliptical":
      return "cardio";
    case "WeightTraining":
      return "renforcement";
    default:
      return "autre";
  }
}
