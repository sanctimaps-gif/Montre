import { requireUser } from "../auth.ts";
import { getOwnedActivity } from "../activities.ts";
import { config, isStravaConfigured } from "../config.ts";
import { HANDLED, HttpError, type Router, readJson } from "../http.ts";
import {
  buildAuthorizeUrl,
  consumeState,
  disconnectStrava,
  exchangeCode,
  getStravaAccount,
  syncFromStrava,
  uploadToStrava,
} from "../strava.ts";

export function registerStravaRoutes(router: Router): void {
  router.get("/api/strava/status", (ctx) => {
    const userId = requireUser(ctx);
    const account = getStravaAccount(userId);
    return {
      configured: isStravaConfigured(),
      connected: account != null,
      athleteName: account?.athleteName,
      lastSyncAt: account?.lastSyncAt,
    };
  });

  /** Renvoie l'URL d'autorisation ; le front y redirige l'utilisateur. */
  router.get("/api/strava/authorize", (ctx) => {
    const userId = requireUser(ctx);
    return { url: buildAuthorizeUrl(userId) };
  });

  /**
   * Retour de Strava apres autorisation. Cette route est ouverte : elle n'a pas
   * de session, l'utilisateur est retrouve via le jeton d'etat a usage unique.
   */
  router.get("/api/strava/callback", async (ctx) => {
    const error = ctx.url.searchParams.get("error");
    const code = ctx.url.searchParams.get("code");
    const state = ctx.url.searchParams.get("state");

    const redirect = (status: string) => {
      ctx.res.writeHead(302, {
        Location: `${config.webOrigin}/reglages?strava=${status}`,
      });
      ctx.res.end();
      return HANDLED;
    };

    if (error || !code || !state) return redirect("refuse");

    try {
      const userId = consumeState(state);
      await exchangeCode(userId, code);
      return redirect("connecte");
    } catch {
      return redirect("erreur");
    }
  });

  router.post("/api/strava/sync", async (ctx) => {
    const userId = requireUser(ctx);
    const body = await readJson<{ maxActivities?: number }>(ctx.req);
    return syncFromStrava(userId, { maxActivities: body.maxActivities });
  });

  router.post("/api/strava/upload/:id", async (ctx) => {
    const userId = requireUser(ctx);
    const activity = getOwnedActivity(ctx.params["id"]!, userId);
    if (activity.source === "strava") {
      throw new HttpError(400, "Cette activite vient deja de Strava");
    }
    return uploadToStrava(userId, activity);
  });

  router.delete("/api/strava", (ctx) => {
    const userId = requireUser(ctx);
    disconnectStrava(userId);
    return { ok: true };
  });
}
