import type { Activity, AthleteProfile, TrainingPlan, User } from "@montre/core";
import type {
  ActivitySummary,
  Comment,
  DeviceRecord,
  FeedItem,
  FitnessResponse,
  ImportResult,
  MontreApi,
  SessionAnalysis,
  SessionPayload,
  SportStat,
  StravaStatus,
  TodayResponse,
} from "./api-types.ts";
import { localApi } from "./standalone/local-api.ts";

export type {
  ActivitySummary,
  Comment,
  DeviceRecord,
  FeedItem,
  FitnessResponse,
  ImportResult,
  SessionAnalysis,
  SportStat,
  StravaStatus,
  TodayResponse,
} from "./api-types.ts";

/**
 * Client de l'API.
 *
 * L'application se compile en deux variantes. Avec le serveur, elle parle a
 * l'API HTTP. En mode autonome — la version publiee sur une page statique —
 * tout s'execute dans le navigateur, avec `@montre/core` pour la logique et
 * IndexedDB pour le stockage.
 */
export const STANDALONE = import.meta.env["VITE_STANDALONE"] === "1";

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

/** Implementation adossee au serveur Node. */
const remoteApi: MontreApi = {
  requiresAuth: true,
  standalone: false,

  register: (email, password, displayName) =>
    request<{ user: User; token: string }>("/api/auth/register", {
      body: { email, password, displayName },
    }),

  login: (email, password) =>
    request<{ user: User; token: string }>("/api/auth/login", { body: { email, password } }),

  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  me: () => request<{ user: User; profile: AthleteProfile }>("/api/auth/me"),

  updateProfile: (profile) =>
    request<AthleteProfile>("/api/profile", { method: "PUT", body: profile }),

  activities: (params = {}) => {
    const query = new URLSearchParams();
    if (params.limit) query.set("limit", String(params.limit));
    if (params.offset) query.set("offset", String(params.offset));
    if (params.sport) query.set("sport", params.sport);
    return request<ActivitySummary[]>(`/api/activities?${query}`);
  },

  activity: (id) => request<Activity & { analysis: SessionAnalysis }>(`/api/activities/${id}`),

  importFile: (file) =>
    file.arrayBuffer().then((buffer) =>
      request<ImportResult>("/api/activities/import", {
        method: "POST",
        raw: buffer,
        headers: { "Content-Type": "application/octet-stream", "X-Filename": file.name },
      }),
    ),

  saveSession: (payload: SessionPayload) =>
    request<{ activity: ActivitySummary; analysis: SessionAnalysis }>("/api/activities", {
      body: payload,
    }),

  updateActivity: (id, changes) =>
    request<ActivitySummary>(`/api/activities/${id}`, { method: "PATCH", body: changes }),

  deleteActivity: (id) => request<{ ok: true }>(`/api/activities/${id}`, { method: "DELETE" }),

  exportActivity: async (id, format) => {
    const response = await fetch(`/api/activities/${id}/export?format=${format}`, {
      headers: { Authorization: `Bearer ${getToken() ?? ""}` },
    });
    if (!response.ok) throw new ApiError(response.status, "Export impossible");
    return response.blob();
  },

  stats: () => request<SportStat[]>("/api/stats"),

  fitness: () => request<FitnessResponse>("/api/fitness"),

  today: () => request<TodayResponse>("/api/coach/today"),

  plan: () => request<TrainingPlan | null>("/api/coach/plan"),

  createPlan: (goal, targetDate, targetTime) =>
    request<TrainingPlan>("/api/coach/plan", { body: { goal, targetDate, targetTime } }),

  deletePlan: (id) => request<{ ok: true }>(`/api/coach/plan/${id}`, { method: "DELETE" }),

  feed: () => request<FeedItem[]>("/api/feed"),

  kudos: (activityId) =>
    request<{ kudoed: boolean; count: number }>(`/api/activities/${activityId}/kudos`, {
      method: "POST",
    }),

  comments: (activityId) => request<Comment[]>(`/api/activities/${activityId}/comments`),

  addComment: (activityId, body) =>
    request<Comment>(`/api/activities/${activityId}/comments`, { body: { body } }),

  athletes: () =>
    request<Array<{ id: string; displayName: string; following: boolean }>>("/api/athletes"),

  follow: (id) =>
    request<{ following: boolean }>(`/api/athletes/${id}/follow`, { method: "POST" }),

  devices: () => request<DeviceRecord[]>("/api/devices"),

  saveDevice: (device) =>
    request<{ id: string; lastSeenAt: number }>("/api/devices", { body: device }),

  deleteDevice: (id) => request<{ ok: true }>(`/api/devices/${id}`, { method: "DELETE" }),

  stravaStatus: () => request<StravaStatus>("/api/strava/status"),

  stravaAuthorize: () => request<{ url: string }>("/api/strava/authorize"),

  stravaSync: () =>
    request<{ imported: number; skipped: number }>("/api/strava/sync", { method: "POST" }),

  stravaUpload: (activityId) =>
    request<{ uploadId: string; status: string }>(`/api/strava/upload/${activityId}`, {
      method: "POST",
    }),

  stravaDisconnect: () => request<{ ok: true }>("/api/strava", { method: "DELETE" }),
};

export const api: MontreApi = STANDALONE ? localApi : remoteApi;
