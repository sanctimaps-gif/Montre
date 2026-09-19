import type {
  Activity,
  AthleteProfile,
  FitnessState,
  TrainingPlan,
  User,
  Workout,
} from "@montre/core";

/**
 * Types d'echange de l'API, partages par le client HTTP et par
 * l'implementation locale du mode autonome : les deux doivent rendre
 * exactement les memes formes de donnees pour que l'interface ne voie aucune
 * difference.
 */

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

export interface SportStat {
  sport: string;
  count: number;
  distance: number;
  duration: number;
  elevation: number;
}

export interface ImportResult {
  activity: ActivitySummary | null;
  duplicate: boolean;
  existingId?: string;
  analysis?: SessionAnalysis;
  device?: string;
}

export interface SessionPayload {
  sport: string;
  title?: string;
  startTime: number;
  points: unknown[];
  laps: unknown[];
}

/**
 * Surface commune aux deux implementations. Le mode autonome n'a ni comptes ni
 * Strava : ces methodes existent quand meme et expliquent pourquoi elles ne
 * peuvent pas aboutir, plutot que d'echouer sans message.
 */
export interface MontreApi {
  /** Faux en mode autonome : l'interface saute alors l'ecran de connexion. */
  readonly requiresAuth: boolean;
  /** Vrai quand tout tourne dans le navigateur, sans serveur. */
  readonly standalone: boolean;

  register(email: string, password: string, displayName: string): Promise<{ user: User; token: string }>;
  login(email: string, password: string): Promise<{ user: User; token: string }>;
  logout(): Promise<unknown>;
  me(): Promise<{ user: User; profile: AthleteProfile }>;
  updateProfile(profile: Partial<AthleteProfile>): Promise<AthleteProfile>;

  activities(params?: { limit?: number; offset?: number; sport?: string }): Promise<ActivitySummary[]>;
  activity(id: string): Promise<Activity & { analysis: SessionAnalysis }>;
  importFile(file: File): Promise<ImportResult>;
  saveSession(payload: SessionPayload): Promise<{ activity: ActivitySummary; analysis: SessionAnalysis }>;
  updateActivity(id: string, changes: { title?: string; description?: string; sport?: string }): Promise<ActivitySummary>;
  deleteActivity(id: string): Promise<unknown>;
  exportActivity(id: string, format: "gpx" | "tcx"): Promise<Blob>;
  stats(): Promise<SportStat[]>;

  fitness(): Promise<FitnessResponse>;
  today(): Promise<TodayResponse>;
  plan(): Promise<TrainingPlan | null>;
  createPlan(goal: string, targetDate: string, targetTime?: number): Promise<TrainingPlan>;
  deletePlan(id: string): Promise<unknown>;

  feed(): Promise<FeedItem[]>;
  kudos(activityId: string): Promise<{ kudoed: boolean; count: number }>;
  comments(activityId: string): Promise<Comment[]>;
  addComment(activityId: string, body: string): Promise<Comment>;
  athletes(): Promise<Array<{ id: string; displayName: string; following: boolean }>>;
  follow(id: string): Promise<{ following: boolean }>;

  devices(): Promise<DeviceRecord[]>;
  saveDevice(device: {
    id?: string;
    name: string;
    model?: string;
    firmware?: string;
    serial?: string;
    battery?: number;
  }): Promise<{ id: string; lastSeenAt: number }>;
  deleteDevice(id: string): Promise<unknown>;

  stravaStatus(): Promise<StravaStatus>;
  stravaAuthorize(): Promise<{ url: string }>;
  stravaSync(): Promise<{ imported: number; skipped: number }>;
  stravaUpload(activityId: string): Promise<{ uploadId: string; status: string }>;
  stravaDisconnect(): Promise<unknown>;

  /** Charge les seances de demonstration. Disponible en mode autonome seulement. */
  loadDemoData?(): Promise<number>;
  /** Efface toutes les donnees locales. */
  resetLocalData?(): Promise<void>;
}
