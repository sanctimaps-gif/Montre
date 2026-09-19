import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Configuration lue dans l'environnement, avec un .env optionnel a la racine
 * du depot pour le developpement local. Aucun secret n'est ecrit en dur.
 */
function loadDotEnv(): void {
  for (const candidate of [".env", "../../.env"]) {
    try {
      const content = readFileSync(resolve(process.cwd(), candidate), "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const separator = trimmed.indexOf("=");
        if (separator === -1) continue;
        const key = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
        if (!(key in process.env)) process.env[key] = value;
      }
      return;
    } catch {
      // Fichier absent : on continue avec l'environnement tel quel.
    }
  }
}

loadDotEnv();

export const config = {
  port: Number(process.env["PORT"] ?? 8787),
  /** Origine du front, utilisee pour le CORS et les redirections OAuth. */
  webOrigin: process.env["WEB_ORIGIN"] ?? "http://localhost:5173",
  databasePath: process.env["DATABASE_PATH"] ?? "data/montre.sqlite",
  strava: {
    clientId: process.env["STRAVA_CLIENT_ID"] ?? "",
    clientSecret: process.env["STRAVA_CLIENT_SECRET"] ?? "",
    /** Doit correspondre exactement a l'URL declaree dans l'API Strava. */
    redirectUri:
      process.env["STRAVA_REDIRECT_URI"] ?? "http://localhost:8787/api/strava/callback",
  },
} as const;

export function isStravaConfigured(): boolean {
  return Boolean(config.strava.clientId && config.strava.clientSecret);
}
