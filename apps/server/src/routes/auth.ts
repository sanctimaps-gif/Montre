import {
  authenticate,
  createSession,
  createUser,
  destroySession,
  getProfile,
  getUser,
  requireUser,
} from "../auth.ts";
import { db } from "../db.ts";
import { HttpError, type RequestContext, type Router, readJson } from "../http.ts";

interface Credentials {
  email?: string;
  password?: string;
  displayName?: string;
}

export function registerAuthRoutes(router: Router): void {
  router.post("/api/auth/register", async (ctx) => {
    const body = await readJson<Credentials>(ctx.req);
    if (!body.email || !body.password) {
      throw new HttpError(400, "E-mail et mot de passe requis");
    }
    if (body.password.length < 8) {
      throw new HttpError(400, "Le mot de passe doit faire au moins 8 caracteres");
    }
    const user = createUser(body.email, body.displayName ?? "", body.password);
    return { user, token: createSession(user.id) };
  });

  router.post("/api/auth/login", async (ctx) => {
    const body = await readJson<Credentials>(ctx.req);
    if (!body.email || !body.password) {
      throw new HttpError(400, "E-mail et mot de passe requis");
    }
    const user = authenticate(body.email, body.password);
    return { user, token: createSession(user.id) };
  });

  router.post("/api/auth/logout", (ctx: RequestContext) => {
    const header = ctx.req.headers["authorization"];
    if (header?.startsWith("Bearer ")) destroySession(header.slice(7));
    return { ok: true };
  });

  router.get("/api/auth/me", (ctx) => {
    const userId = requireUser(ctx);
    return { user: getUser(userId), profile: getProfile(userId) };
  });

  router.put("/api/profile", async (ctx) => {
    const userId = requireUser(ctx);
    const body = await readJson<Record<string, unknown>>(ctx.req);

    const level = String(body["level"] ?? "debutant");
    if (!["debutant", "intermediaire", "confirme"].includes(level)) {
      throw new HttpError(400, "Niveau invalide");
    }
    const weeklySessions = Number(body["weeklySessions"] ?? 3);
    if (!Number.isFinite(weeklySessions) || weeklySessions < 1 || weeklySessions > 7) {
      throw new HttpError(400, "Le nombre de seances doit etre compris entre 1 et 7");
    }

    db.prepare(
      `INSERT INTO profiles (user_id, birth_date, weight_kg, max_hr, rest_hr, vma, weekly_sessions, level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         birth_date = excluded.birth_date,
         weight_kg = excluded.weight_kg,
         max_hr = excluded.max_hr,
         rest_hr = excluded.rest_hr,
         vma = excluded.vma,
         weekly_sessions = excluded.weekly_sessions,
         level = excluded.level`,
    ).run(
      userId,
      optionalString(body["birthDate"]),
      optionalNumber(body["weightKg"], 20, 300),
      optionalNumber(body["maxHr"], 120, 230),
      optionalNumber(body["restHr"], 25, 120),
      optionalNumber(body["vma"], 6, 26),
      Math.round(weeklySessions),
      level,
    );

    return getProfile(userId);
  });
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Valeur numerique optionnelle, rejetee si elle sort des bornes physiologiques. */
function optionalNumber(value: unknown, min: number, max: number): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < min || parsed > max) {
    throw new HttpError(400, `Valeur hors limites : attendue entre ${min} et ${max}`);
  }
  return parsed;
}
