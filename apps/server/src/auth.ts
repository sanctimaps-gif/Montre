import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { AthleteProfile, User } from "@montre/core";
import { db, newId } from "./db.ts";
import { HttpError, type RequestContext } from "./http.ts";

/** Duree de validite d'une session, en millisecondes. */
const SESSION_TTL = 30 * 24 * 3600 * 1000;

/**
 * Mots de passe stockes en scrypt avec sel aleatoire. Format : scrypt$sel$hash,
 * les deux parties en hexadecimal.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const derived = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  // Comparaison a temps constant pour ne pas fuir d'information par la duree.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function createUser(
  email: string,
  displayName: string,
  password: string,
): User {
  const normalized = email.trim().toLowerCase();
  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(normalized);
  if (existing) throw new HttpError(409, "Un compte existe deja avec cet e-mail");

  const user: User = {
    id: newId("u_"),
    email: normalized,
    displayName: displayName.trim() || normalized.split("@")[0]!,
    createdAt: Date.now(),
  };

  db.prepare(
    "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(user.id, user.email, user.displayName, hashPassword(password), user.createdAt);

  // Profil par defaut, que l'utilisateur affinera dans les reglages.
  db.prepare(
    "INSERT INTO profiles (user_id, weekly_sessions, level) VALUES (?, 3, 'debutant')",
  ).run(user.id);

  return user;
}

export function authenticate(email: string, password: string): User {
  const row = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as Record<string, string | number> | undefined;
  if (!row || !verifyPassword(password, String(row["password_hash"]))) {
    throw new HttpError(401, "E-mail ou mot de passe incorrect");
  }
  return {
    id: String(row["id"]),
    email: String(row["email"]),
    displayName: String(row["display_name"]),
    createdAt: Number(row["created_at"]),
  };
}

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(token, userId, now, now + SESSION_TTL);
  return token;
}

export function destroySession(token: string): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

/** Retourne l'utilisateur de la session portee par la requete, ou null. */
export function userFromRequest(ctx: RequestContext): string | null {
  const header = ctx.req.headers["authorization"];
  const token = header?.startsWith("Bearer ") ? header.slice(7) : tokenFromCookie(ctx);
  if (!token) return null;

  const row = db
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token = ?")
    .get(token) as { user_id: string; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(token);
    return null;
  }
  return row.user_id;
}

function tokenFromCookie(ctx: RequestContext): string | null {
  const cookie = ctx.req.headers["cookie"];
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "montre_session") return rest.join("=");
  }
  return null;
}

/** Exige une session valide, sinon leve une 401. */
export function requireUser(ctx: RequestContext): string {
  if (ctx.userId) return ctx.userId;
  throw new HttpError(401, "Authentification requise");
}

export function getUser(userId: string): User {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as
    | Record<string, string | number>
    | undefined;
  if (!row) throw new HttpError(404, "Utilisateur introuvable");
  return {
    id: String(row["id"]),
    email: String(row["email"]),
    displayName: String(row["display_name"]),
    createdAt: Number(row["created_at"]),
  };
}

export function getProfile(userId: string): AthleteProfile {
  const row = db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(userId) as
    | Record<string, string | number | null>
    | undefined;
  if (!row) {
    return { userId, weeklySessions: 3, level: "debutant" };
  }
  return {
    userId,
    birthDate: (row["birth_date"] as string | null) ?? undefined,
    weightKg: (row["weight_kg"] as number | null) ?? undefined,
    maxHr: (row["max_hr"] as number | null) ?? undefined,
    restHr: (row["rest_hr"] as number | null) ?? undefined,
    vma: (row["vma"] as number | null) ?? undefined,
    weeklySessions: Number(row["weekly_sessions"] ?? 3),
    level: (row["level"] as AthleteProfile["level"]) ?? "debutant",
  };
}
