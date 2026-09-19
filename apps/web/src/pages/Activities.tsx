import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ActivitySummary } from "../api.ts";
import { api } from "../api.ts";
import { DemoData } from "../components/DemoData.tsx";
import {
  SPORT_ICONS,
  SPORT_LABELS,
  dateLong,
  duration,
  km,
  paceOrSpeed,
} from "../format.ts";

const PAGE_SIZE = 20;

export function Activities() {
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [sport, setSport] = useState("");
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (offset: number, replace: boolean) => {
      setLoading(true);
      try {
        const page = await api.activities({
          limit: PAGE_SIZE,
          offset,
          sport: sport || undefined,
        });
        setActivities((current) => (replace ? page : [...current, ...page]));
        setDone(page.length < PAGE_SIZE);
      } catch (error) {
        setMessage({ type: "erreur", text: (error as Error).message });
      } finally {
        setLoading(false);
      }
    },
    [sport],
  );

  useEffect(() => {
    void load(0, true);
  }, [load]);

  /** Import d'un ou plusieurs fichiers d'activite. */
  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setMessage(null);

    let imported = 0;
    let duplicates = 0;
    const failures: string[] = [];

    for (const file of Array.from(files)) {
      try {
        const result = await api.importFile(file);
        if (result.duplicate) duplicates++;
        else imported++;
      } catch (error) {
        failures.push(`${file.name} : ${(error as Error).message}`);
      }
    }

    const parts: string[] = [];
    if (imported > 0) parts.push(`${imported} activite(s) importee(s)`);
    if (duplicates > 0) parts.push(`${duplicates} deja presente(s)`);
    if (failures.length > 0) parts.push(failures.join(" / "));

    setMessage({
      type: failures.length > 0 ? "alerte" : "succes",
      text: parts.join(" · ") || "Rien a importer",
    });
    await load(0, true);
  };

  return (
    <>
      <div className="entete">
        <div>
          <h1>Activites</h1>
          <p className="sous-titre">
            Seances enregistrees, importees depuis Decathlon Coach ou synchronisees avec
            Strava.
          </p>
        </div>
        <div className="actions">
          <select
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            style={{ width: "auto" }}
          >
            <option value="">Tous les sports</option>
            {Object.entries(SPORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button className="primaire" onClick={() => fileInput.current?.click()}>
            Importer un fichier
          </button>
        </div>
      </div>

      {message && <div className={`message ${message.type}`}>{message.text}</div>}

      {/*
        Volontairement sans attribut `accept` : iOS fait correspondre les
        extensions a ses propres types de fichiers, et comme il ne connait ni
        .fit ni .tcx, il grise ces fichiers dans le selecteur — rendant l'import
        impossible depuis un iPhone. Le format est de toute facon reconnu au
        contenu, pas au nom, et un fichier invalide est refuse avec un message.
      */}
      <input
        ref={fileInput}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          void importFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div
        className={`deposer ${dragging ? "survol" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void importFiles(e.dataTransfer.files);
        }}
      >
        Depose ou choisis tes fichiers <strong>.fit</strong>, <strong>.gpx</strong> ou{" "}
        <strong>.tcx</strong> exportes de Decathlon Coach, de ta montre ou de Strava.
        <div className="aide" style={{ marginTop: 8 }}>
          Sur telephone, les fichiers exportes depuis Decathlon Coach se retrouvent dans
          l'application Fichiers.{" "}
          <Link to="/montre" style={{ textDecoration: "underline" }}>
            Voir la marche a suivre
          </Link>
          .
        </div>
      </div>

      <div className="carte" style={{ marginTop: 16 }}>
        {activities.length === 0 && !loading ? (
          <div className="vide">
            Aucune activite pour le moment.
            <DemoData onLoaded={() => load(0, true)} />
          </div>
        ) : (
          activities.map((activity) => (
            <Link key={activity.id} to={`/activites/${activity.id}`} className="ligne-activite">
              <span className="icone">{SPORT_ICONS[activity.sport] ?? "⚡"}</span>
              <span className="corps">
                <span className="titre">{activity.title}</span>
                <span className="meta">
                  {dateLong(activity.startTime)} · {km(activity.distance)} ·{" "}
                  {duration(activity.movingTime)} ·{" "}
                  {paceOrSpeed(activity.sport, activity.distance, activity.movingTime)}
                  {activity.avgHr ? ` · ${activity.avgHr} bpm` : ""}
                </span>
              </span>
              <span className="etiquette">{sourceLabel(activity.source)}</span>
            </Link>
          ))
        )}
      </div>

      {!done && activities.length > 0 && (
        <div style={{ textAlign: "center" }}>
          <button onClick={() => load(activities.length, false)} disabled={loading}>
            {loading ? "Chargement..." : "Charger plus"}
          </button>
        </div>
      )}
    </>
  );
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    fit100s: "Montre",
    import: "Import",
    strava: "Strava",
    decathlon: "Decathlon",
    manuelle: "Manuelle",
  };
  return labels[source] ?? source;
}
