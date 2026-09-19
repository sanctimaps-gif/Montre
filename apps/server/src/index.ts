import { createServer } from "node:http";
import { userFromRequest } from "./auth.ts";
import { config, isStravaConfigured } from "./config.ts";
import {
  HANDLED,
  HttpError,
  Router,
  applyCors,
  json,
  type RequestContext,
} from "./http.ts";
import { registerActivityRoutes } from "./routes/activities.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerCoachRoutes } from "./routes/coach.ts";
import { registerDeviceRoutes } from "./routes/devices.ts";
import { registerSocialRoutes } from "./routes/social.ts";
import { registerStravaRoutes } from "./routes/strava.ts";

const router = new Router();

router.get("/api/health", () => ({
  ok: true,
  strava: isStravaConfigured() ? "configure" : "non configure",
  time: new Date().toISOString(),
}));

registerAuthRoutes(router);
registerActivityRoutes(router);
registerCoachRoutes(router);
registerStravaRoutes(router);
registerSocialRoutes(router);
registerDeviceRoutes(router);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  applyCors(res, req.headers.origin);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const match = router.match(req.method ?? "GET", url.pathname);
  if (!match) {
    json(res, 404, { error: "Route inconnue" });
    return;
  }

  const ctx: RequestContext = { req, res, url, params: match.params };
  ctx.userId = userFromRequest(ctx) ?? undefined;

  try {
    const result = await match.handler(ctx);
    if (result === HANDLED) return;
    // `null` est une reponse legitime (aucun plan, par exemple) : seul un
    // handler qui ne retourne rien recoit l'accuse de reception par defaut.
    json(res, 200, result === undefined ? { ok: true } : result);
  } catch (error) {
    if (error instanceof HttpError) {
      json(res, error.status, { error: error.message });
      return;
    }
    // Erreur inattendue : on la journalise sans exposer la pile au client.
    console.error(`[${req.method} ${url.pathname}]`, error);
    json(res, 500, { error: "Erreur interne du serveur" });
  }
});

server.listen(config.port, () => {
  console.log(`API Montre en ecoute sur http://localhost:${config.port}`);
  console.log(`Front attendu sur ${config.webOrigin}`);
  if (!isStravaConfigured()) {
    console.log(
      "Strava non configure : renseigne STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET dans .env pour activer la synchronisation.",
    );
  }
});
