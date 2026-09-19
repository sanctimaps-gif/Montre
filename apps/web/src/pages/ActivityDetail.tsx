import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Activity } from "@montre/core";
import { movingAverage } from "@montre/core";
import type { Comment, SessionAnalysis } from "../api.ts";
import { STANDALONE, api } from "../api.ts";
import { LineChart, Legende, PuceLegende } from "../components/Chart.tsx";
import { TrackMap } from "../components/TrackMap.tsx";
import { ZoneBar } from "../components/ZoneBar.tsx";
import {
  SPORT_ICONS,
  SPORT_LABELS,
  dateLong,
  duration,
  km,
  pace,
  paceOrSpeed,
  relative,
} from "../format.ts";

type FullActivity = Activity & { analysis: SessionAnalysis };

export function ActivityDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activity, setActivity] = useState<FullActivity | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!id) return;
    api
      .activity(id)
      .then((result) => {
        setActivity(result);
        setTitle(result.title);
        setDescription(result.description ?? "");
      })
      .catch((caught) => setError((caught as Error).message));
    api.comments(id).then(setComments).catch(() => undefined);
  }, [id]);

  if (error) return <div className="message erreur">{error}</div>;
  if (!activity) return <div className="chargement">Chargement...</div>;

  const m = activity.metrics;
  const points = activity.points;

  // Les courbes brutes a 1 Hz sont illisibles : un lissage sur 15 s suffit.
  const hrSeries = smoothed(points.map((p) => p.hr ?? null));
  const altSeries = smoothed(points.map((p) => p.alt ?? null));
  const paceSeries = smoothed(
    points.map((p) => (p.speed && p.speed > 0.5 ? 1000 / p.speed : null)),
  );

  const save = async () => {
    try {
      await api.updateActivity(activity.id, { title, description });
      setActivity({ ...activity, title, description });
      setEditing(false);
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  const remove = async () => {
    if (!confirm("Supprimer definitivement cette activite ?")) return;
    await api.deleteActivity(activity.id);
    navigate("/activites");
  };

  const sendToStrava = async () => {
    setNotice(null);
    try {
      const result = await api.stravaUpload(activity.id);
      setNotice(`Envoye sur Strava (${result.status}).`);
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  const addComment = async () => {
    if (!draft.trim() || !id) return;
    const comment = await api.addComment(id, draft);
    setComments([...comments, comment]);
    setDraft("");
  };

  return (
    <>
      <div className="entete">
        <div style={{ flex: 1, minWidth: 260 }}>
          {editing ? (
            <>
              <div className="champ">
                <label htmlFor="titre">Titre</label>
                <input id="titre" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="champ">
                <label htmlFor="desc">Description</label>
                <textarea
                  id="desc"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="actions">
                <button className="primaire" onClick={save}>
                  Enregistrer
                </button>
                <button className="discret" onClick={() => setEditing(false)}>
                  Annuler
                </button>
              </div>
            </>
          ) : (
            <>
              <h1>
                {SPORT_ICONS[activity.sport]} {activity.title}
              </h1>
              <p className="sous-titre">
                {dateLong(activity.startTime)} · {SPORT_LABELS[activity.sport]}
              </p>
              {activity.description && <p>{activity.description}</p>}
            </>
          )}
        </div>
        {!editing && (
          <div className="actions">
            <button onClick={() => setEditing(true)}>Modifier</button>
            {!STANDALONE && <button onClick={sendToStrava}>Envoyer sur Strava</button>}
            <button onClick={() => downloadExport(activity.id, "gpx")}>Exporter en GPX</button>
            <button onClick={() => downloadExport(activity.id, "tcx")}>Exporter en TCX</button>
            <button className="danger" onClick={remove}>
              Supprimer
            </button>
          </div>
        )}
      </div>

      {notice && <div className="message succes">{notice}</div>}

      <div className="carte">
        <div className="grille-stats">
          <div className="stat grande">
            <div className="valeur">{(activity.distance / 1000).toFixed(2)}</div>
            <div className="libelle">km</div>
          </div>
          <div className="stat grande">
            <div className="valeur">{duration(activity.movingTime)}</div>
            <div className="libelle">en mouvement</div>
          </div>
          <div className="stat grande">
            <div className="valeur">
              {paceOrSpeed(activity.sport, activity.distance, activity.movingTime)}
            </div>
            <div className="libelle">allure moyenne</div>
          </div>
          {activity.avgHr && (
            <div className="stat grande">
              <div className="valeur cardio">{activity.avgHr}</div>
              <div className="libelle">bpm moyen</div>
            </div>
          )}
        </div>

        <div className="separateur" />

        <div className="grille-stats">
          <Stat label="D+" value={`${activity.elevationGain} m`} />
          <Stat label="D-" value={`${activity.elevationLoss} m`} />
          <Stat label="Temps total" value={duration(activity.elapsedTime)} />
          {activity.maxHr && <Stat label="FC max" value={`${activity.maxHr} bpm`} />}
          {activity.avgCadence && (
            <Stat label="Cadence" value={`${activity.avgCadence} pas/min`} />
          )}
          {m?.trainingLoad != null && <Stat label="Charge" value={String(m.trainingLoad)} />}
          {m?.trimp != null && <Stat label="TRIMP" value={String(m.trimp)} />}
          {m?.gradeAdjustedPace != null && (
            <Stat label="Allure corrigee" value={`${pace(m.gradeAdjustedPace)}/km`} />
          )}
          {m?.decoupling != null && (
            <Stat label="Derive cardiaque" value={`${m.decoupling.toFixed(1)} %`} />
          )}
          {m?.vam != null && m.vam > 0 && <Stat label="Vitesse ascens." value={`${m.vam} m/h`} />}
          {activity.calories && <Stat label="Calories" value={`${activity.calories} kcal`} />}
        </div>
      </div>

      <div className="carte">
        <h2>Analyse du coach</h2>
        <p style={{ fontSize: 17, fontWeight: 600 }}>{activity.analysis.headline}</p>
        <ul style={{ paddingLeft: 18, color: "var(--texte-doux)" }}>
          {activity.analysis.insights.map((insight, i) => (
            <li key={i} style={{ marginBottom: 6 }}>
              {insight}
            </li>
          ))}
        </ul>
        <div className="message info" style={{ marginBottom: 0 }}>
          {activity.analysis.nextStep}
        </div>
      </div>

      <div className="grille">
        <div className="carte">
          <h2>Parcours</h2>
          <TrackMap points={points} />
        </div>

        <div className="carte">
          <h2>Zones cardiaques</h2>
          <ZoneBar times={m?.hrZoneTimes ?? []} />
        </div>
      </div>

      {hrSeries.some((v) => v != null) && (
        <div className="carte">
          <h2>Frequence cardiaque</h2>
          <LineChart
            series={[{ label: "FC", color: "#e5484d", values: hrSeries, fill: true }]}
            formatValue={(v) => `${Math.round(v)}`}
          />
          <Legende>
            <PuceLegende color="#e5484d">battements par minute</PuceLegende>
          </Legende>
        </div>
      )}

      {paceSeries.some((v) => v != null) && (
        <div className="carte">
          <h2>Allure</h2>
          <LineChart
            series={[{ label: "Allure", color: "#fc5200", values: paceSeries }]}
            formatValue={(v) => pace(v)}
          />
        </div>
      )}

      {altSeries.some((v) => v != null) && (
        <div className="carte">
          <h2>Profil altimetrique</h2>
          <LineChart
            series={[{ label: "Altitude", color: "#35c47d", values: altSeries, fill: true }]}
            formatValue={(v) => `${Math.round(v)} m`}
          />
        </div>
      )}

      {activity.laps.length > 0 && (
        <div className="carte">
          <h2>Tours</h2>
          <table>
            <thead>
              <tr>
                <th>Tour</th>
                <th>Distance</th>
                <th>Temps</th>
                <th>Allure</th>
                <th>FC moy.</th>
                <th>D+</th>
              </tr>
            </thead>
            <tbody>
              {activity.laps.map((lap) => (
                <tr key={lap.index}>
                  <td>{lap.index}</td>
                  <td>{km(lap.distance)}</td>
                  <td>{duration(lap.duration)}</td>
                  <td>
                    {lap.distance > 0 ? `${pace((lap.duration / lap.distance) * 1000)}/km` : "--"}
                  </td>
                  <td>{lap.avgHr ?? "--"}</td>
                  <td>{lap.elevationGain != null ? `${lap.elevationGain} m` : "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {m?.bests && Object.keys(m.bests).length > 0 && (
        <div className="carte">
          <h2>Meilleurs efforts de la seance</h2>
          <table>
            <tbody>
              {Object.entries(m.bests).map(([label, seconds]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td style={{ textAlign: "right" }}>{duration(seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="carte">
        <h2>Commentaires</h2>
        {comments.length === 0 && <p className="aide">Aucun commentaire pour l'instant.</p>}
        {comments.map((comment) => (
          <div key={comment.id} style={{ marginBottom: 12 }}>
            <strong>{comment.author}</strong>{" "}
            <span className="aide">{relative(comment.createdAt)}</span>
            <div>{comment.body}</div>
          </div>
        ))}
        <div className="actions" style={{ marginTop: 12 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Belle seance !"
            onKeyDown={(e) => {
              if (e.key === "Enter") void addComment();
            }}
          />
          <button className="primaire" onClick={addComment} disabled={!draft.trim()}>
            Publier
          </button>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="valeur">{value}</div>
      <div className="libelle">{label}</div>
    </div>
  );
}

/** Lisse une serie en conservant les trous (capteur absent sur une portion). */
function smoothed(values: Array<number | null>): Array<number | null> {
  const present = values.filter((v): v is number => v != null);
  if (present.length < 5) return values;
  const filled = values.map((v) => v ?? present[0]!);
  const result = movingAverage(filled, 15);
  return values.map((v, i) => (v == null ? null : result[i]!));
}

/** Telechargement d'un export, via un objet URL temporaire. */
async function downloadExport(id: string, format: "gpx" | "tcx"): Promise<void> {
  const blob = await api.exportActivity(id, format);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${id}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}
