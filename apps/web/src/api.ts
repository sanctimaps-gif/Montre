import type {
  Activity,
  AthleteProfile,
  FitnessState,
  TrainingPlan,
  User,
  Workout,
} from "@montre/core";

/**
 * Client HTTP de l'API. Le jeton de session est conserve dans le stockage
 * local et ajoute a chaque appel.
 */

const TOKEN_KEY = "montre.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Stockage indisponible : la session ne survivra pas au rechargement.
  }
}

/** Erreur d'API portant le code HTTP, pour distinguer 401 et 500. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let body: BodyInit | undefined = options.raw;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(path, {
    method: options.method ?? (body ? "POST" : "GET"),
    headers,
    body,
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Erreur ${response.status}`;
    throw new ApiError(response.status, message);
  }

  return payload as T;
}

export interface ActivitySummary extends Omit<Activity, "points" | "laps"> {
  pointCount: number;
  lapCount: number;
}

export interface SessionAnalysis {
  headline: string;
  insights: string[];
  nextStep: string;
}

export interface FeedItem {
  id: string;
  userId: string;
  athlete: string;
  sport: string;
  title: string;
  startTime: number;
  distance: number;
  movingTime: number;
  elevationGain: number;
  avgHr?: number;
  source: string;
  trainingLoad?: number;
  kudosCount: number;
  commentCount: number;
  kudoed: boolean;
  isMine: boolean;
}

export interface Comment {
  id: string;
  body: string;
  createdAt: number;
  author: string;
  authorId: string;
}

export interface FitnessResponse {
  series: FitnessState[];
  today?: FitnessState;
  form: { verdict: string; message: string };
  acwr?: number;
  weekly: Array<{ week: string; load: number }>;
}

export interface TodayResponse {
  workout: Workout;
  reason: string;
  warning?: string;
  paces: Record<string, number> | null;
  hasPlan: boolean;
}

export interface DeviceRecord {
  id: string;
  name: string;
  model?: string;
  firmware?: string;
  serial?: string;
  lastSeenAt?: number;
  lastBattery?: number;
  transport: string;
}

export interface StravaStatus {
  configured: boolean;
  connected: boolean;
  athleteName?: string;
  lastSyncAt?: number;
}

export const api = {
  register: (email: string, password: string, displayName: string) =>
    request<{ user: User; token: string }>("/api/auth/register", {
      body: { email, password, displayName },
    }),

  login: (email: string, password: string) =>
    request<{ user: User; token: string }>("/api/auth/login", {
      body: { email, password },
    }),

  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  me: () => request<{ user: User; profile: AthleteProfile }>("/api/auth/me"),

  updateProfile: (profile: Partial<AthleteProfile>) =>
    request<AthleteProfile>("/api/profile", { method: "PUT", body: profile }),

  activities: (params: { limit?: number; offset?: number; sport?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.limit) query.set("limit", String(params.limit));
    if (params.offset) query.set("offset", String(params.offset));
    if (params.sport) query.set("sport", params.sport);
    return request<ActivitySummary[]>(`/api/activities?${query}`);
  },

  activity: (id: string) =>
    request<Activity & { analysis: SessionAnalysis }>(`/api/activities/${id}`),

  importFile: (file: File) =>
    file.arrayBuffer().then((buffer) =>
      request<{
        activity: ActivitySummary | null;
        duplicate: boolean;
        existingId?: string;
        analysis?: SessionAnalysis;
        device?: string;
      }>("/api/activities/import", {
        method: "POST",
        raw: buffer,
        headers: { "Content-Type": "application/octet-stream", "X-Filename": file.name },
      }),
    ),

  saveSession: (payload: {
    sport: string;
    title?: string;
    startTime: number;
    points: unknown[];
    laps: unknown[];
  }) =>
    request<{ activity: ActivitySummary; analysis: SessionAnalysis }>("/api/activities", {
      body: payload,
    }),

  updateActivity: (id: string, changes: { title?: string; description?: string; sport?: string }) =>
    request<ActivitySummary>(`/api/activities/${id}`, { method: "PATCH", body: changes }),

  deleteActivity: (id: string) =>
    request<{ ok: true }>(`/api/activities/${id}`, { method: "DELETE" }),

  stats: () =>
    request<Array<{ sport: string; count: number; distance: number; duration: number; elevation: number }>>(
      "/api/stats",
    ),

  fitness: () => request<FitnessResponse>("/api/fitness"),

  today: () => request<TodayResponse>("/api/coach/today"),

  plan: () => request<TrainingPlan | null>("/api/coach/plan"),

  createPlan: (goal: string, targetDate: string, targetTime?: number) =>
    request<TrainingPlan>("/api/coach/plan", { body: { goal, targetDate, targetTime } }),

  deletePlan: (id: string) =>
    request<{ ok: true }>(`/api/coach/plan/${id}`, { method: "DELETE" }),

  feed: () => request<FeedItem[]>("/api/feed"),

  kudos: (activityId: string) =>
    request<{ kudoed: boolean; count: number }>(`/api/activities/${activityId}/kudos`, {
      method: "POST",
    }),

  comments: (activityId: string) =>
    request<Comment[]>(`/api/activities/${activityId}/comments`),

  addComment: (activityId: string, body: string) =>
    request<Comment>(`/api/activities/${activityId}/comments`, { body: { body } }),

  athletes: () =>
    request<Array<{ id: string; displayName: string; following: boolean }>>("/api/athletes"),

  follow: (id: string) =>
    request<{ following: boolean }>(`/api/athletes/${id}/follow`, { method: "POST" }),

  devices: () => request<DeviceRecord[]>("/api/devices"),

  saveDevice: (device: {
    id?: string;
    name: string;
    model?: string;
    firmware?: string;
    serial?: string;
    battery?: number;
  }) => request<{ id: string; lastSeenAt: number }>("/api/devices", { body: device }),

  deleteDevice: (id: string) =>
    request<{ ok: true }>(`/api/devices/${id}`, { method: "DELETE" }),

  stravaStatus: () => request<StravaStatus>("/api/strava/status"),

  stravaAuthorize: () => request<{ url: string }>("/api/strava/authorize"),

  stravaSync: () =>
    request<{ imported: number; skipped: number }>("/api/strava/sync", { method: "POST" }),

  stravaUpload: (activityId: string) =>
    request<{ uploadId: string; status: string }>(`/api/strava/upload/${activityId}`, {
      method: "POST",
    }),

  stravaDisconnect: () => request<{ ok: true }>("/api/strava", { method: "DELETE" }),
};
