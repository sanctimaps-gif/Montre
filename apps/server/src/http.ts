import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config.ts";

/**
 * Micro-routeur sur le serveur HTTP de Node. L'API reste assez simple pour ne
 * pas justifier un framework : quelques dizaines de routes REST, du JSON, et
 * des corps binaires pour l'import de fichiers d'activite.
 */

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  /** Utilisateur authentifie, renseigne par le middleware d'authentification. */
  userId?: string;
}

export type Handler = (ctx: RequestContext) => Promise<unknown> | unknown;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

/** Erreur portant un code HTTP, levee par les handlers. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler): this {
    this.routes.push({
      method,
      segments: path.split("/").filter(Boolean),
      handler,
    });
    return this;
  }

  get(path: string, handler: Handler): this {
    return this.add("GET", path, handler);
  }
  post(path: string, handler: Handler): this {
    return this.add("POST", path, handler);
  }
  put(path: string, handler: Handler): this {
    return this.add("PUT", path, handler);
  }
  patch(path: string, handler: Handler): this {
    return this.add("PATCH", path, handler);
  }
  delete(path: string, handler: Handler): this {
    return this.add("DELETE", path, handler);
  }

  /** Cherche la route correspondante et extrait les parametres de chemin. */
  match(
    method: string,
    pathname: string,
  ): { handler: Handler; params: Record<string, string> } | null {
    const segments = pathname.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== segments.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i++) {
        const expected = route.segments[i]!;
        const actual = segments[i]!;
        if (expected.startsWith(":")) {
          params[expected.slice(1)] = decodeURIComponent(actual);
        } else if (expected !== actual) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }
}

/** Reponse deja ecrite par le handler (fichier, redirection...). */
export const HANDLED = Symbol("handled");

export function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Taille maximale d'un corps de requete : un FIT de 4 h tient largement dedans. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

export async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new HttpError(413, "Fichier trop volumineux (25 Mo maximum)");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const body = await readBody(req);
  if (body.length === 0) return {} as T;
  try {
    return JSON.parse(body.toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "Corps de requete JSON invalide");
  }
}

export function applyCors(res: ServerResponse, origin: string | undefined): void {
  // Le front est servi depuis une origine distincte en developpement.
  const allowed = origin === config.webOrigin ? origin : config.webOrigin;
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Filename");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Vary", "Origin");
}
