import { requireUser } from "../auth.ts";
import { db, newId } from "../db.ts";
import { HttpError, type Router, readJson } from "../http.ts";

/**
 * Montres appairees. L'appairage Bluetooth lui-meme se fait dans le navigateur
 * (Web Bluetooth) ; le serveur ne conserve que l'identite de l'appareil, son
 * etat de batterie et sa derniere connexion, pour les afficher dans les
 * reglages et rattacher les seances a la bonne montre.
 */
export function registerDeviceRoutes(router: Router): void {
  router.get("/api/devices", (ctx) => {
    const userId = requireUser(ctx);
    const rows = db
      .prepare("SELECT * FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC")
      .all(userId) as Array<Record<string, string | number | null>>;

    return rows.map((row) => ({
      id: String(row["id"]),
      name: String(row["name"]),
      model: (row["model"] as string | null) ?? undefined,
      firmware: (row["firmware"] as string | null) ?? undefined,
      serial: (row["serial"] as string | null) ?? undefined,
      lastSeenAt: (row["last_seen_at"] as number | null) ?? undefined,
      lastBattery: (row["last_battery"] as number | null) ?? undefined,
      transport: String(row["transport"] ?? "ble"),
    }));
  });

  /** Enregistre ou met a jour une montre appairee. */
  router.post("/api/devices", async (ctx) => {
    const userId = requireUser(ctx);
    const body = await readJson<{
      id?: string;
      name?: string;
      model?: string;
      firmware?: string;
      serial?: string;
      battery?: number;
      transport?: string;
    }>(ctx.req);

    if (!body.name?.trim()) throw new HttpError(400, "Nom de l'appareil manquant");

    // L'identifiant Bluetooth du navigateur sert de cle quand il est fourni.
    const id = body.id?.trim() || newId("d_");
    const now = Date.now();

    db.prepare(
      `INSERT INTO devices (id, user_id, name, model, firmware, serial, last_seen_at, last_battery, transport)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         model = COALESCE(excluded.model, devices.model),
         firmware = COALESCE(excluded.firmware, devices.firmware),
         serial = COALESCE(excluded.serial, devices.serial),
         last_seen_at = excluded.last_seen_at,
         last_battery = COALESCE(excluded.last_battery, devices.last_battery)`,
    ).run(
      id,
      userId,
      body.name.trim(),
      body.model ?? null,
      body.firmware ?? null,
      body.serial ?? null,
      now,
      body.battery ?? null,
      body.transport ?? "ble",
    );

    return { id, lastSeenAt: now };
  });

  router.delete("/api/devices/:id", (ctx) => {
    const userId = requireUser(ctx);
    const result = db
      .prepare("DELETE FROM devices WHERE id = ? AND user_id = ?")
      .run(ctx.params["id"]!, userId);
    if (result.changes === 0) throw new HttpError(404, "Appareil introuvable");
    return { ok: true };
  });
}
