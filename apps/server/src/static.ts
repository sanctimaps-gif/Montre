import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { ServerResponse } from "node:http";

/**
 * Service des fichiers de l'application web par l'API elle-meme.
 *
 * Avoir un seul processus et une seule adresse change beaucoup de choses a
 * l'usage : plus de question de CORS, plus de second terminal a lancer, et
 * l'adresse de retour de l'autorisation Strava est la meme que celle de
 * l'application. C'est ce qui rend la synchronisation Strava — donc la chaine
 * montre vers Decathlon Hub vers Strava vers ici — accessible sans bricolage.
 */

/** Emplacement de la construction du front, a cote du serveur dans le depot. */
const DEFAULT_ROOT = resolve(
  new URL("../../web/dist", import.meta.url).pathname,
);

const webRoot = process.env["WEB_DIST"]
  ? resolve(process.env["WEB_DIST"])
  : DEFAULT_ROOT;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export function webRootPath(): string {
  return webRoot;
}

/** Vrai si l'application web a ete construite et peut donc etre servie. */
export function hasWebBuild(): boolean {
  try {
    return statSync(join(webRoot, "index.html")).isFile();
  } catch {
    return false;
  }
}

/**
 * Sert un fichier de la construction, ou la page principale en dernier
 * recours : le routage de l'application vit dans le navigateur, et une URL
 * profonde rechargee doit renvoyer la page plutot qu'une erreur.
 */
export function serveStatic(pathname: string, res: ServerResponse): boolean {
  if (!hasWebBuild()) return false;

  const file = resolveWithinRoot(pathname);
  if (file) {
    send(file, res);
    return true;
  }

  // Repli sur la page principale pour toute URL qui n'est pas un fichier.
  const index = join(webRoot, "index.html");
  send(index, res, { noStore: true });
  return true;
}

/**
 * Resout un chemin de requete en fichier existant, en refusant tout ce qui
 * sortirait du dossier servi : une requete contenant « .. » ne doit jamais
 * pouvoir atteindre le reste du disque.
 */
function resolveWithinRoot(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (decoded.includes("\0")) return null;

  const candidate = resolve(join(webRoot, normalize(decoded)));
  if (candidate !== webRoot && !candidate.startsWith(webRoot + sep)) return null;

  try {
    return statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function send(file: string, res: ServerResponse, options: { noStore?: boolean } = {}): void {
  const type = MIME_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";

  // Les ressources portent une empreinte dans leur nom : leur contenu ne
  // change jamais pour un nom donne, elles peuvent donc etre gardees un an.
  // La page principale, elle, ne doit jamais etre servie depuis un cache.
  const cache =
    options.noStore || file.endsWith("index.html")
      ? "no-store"
      : "public, max-age=31536000, immutable";

  res.writeHead(200, { "Content-Type": type, "Cache-Control": cache });
  createReadStream(file).pipe(res);
}
