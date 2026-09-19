import { useEffect, useState } from "react";
import type { PlannedSession, TrainingPlan } from "@montre/core";
import type { TodayResponse } from "../api.ts";
import { api } from "../api.ts";
import { WorkoutCard } from "../components/WorkoutSteps.tsx";
import { useSession } from "../session.tsx";
import { KIND_COLORS, KIND_LABELS, dateShort, durationWords, pace } from "../format.ts";

const GOALS: Array<{ value: string; label: string }> = [
  { value: "5km", label: "5 km" },
  { value: "10km", label: "10 km" },
  { value: "semi", label: "Semi-marathon" },
  { value: "marathon", label: "Marathon" },
  { value: "trail", label: "Trail" },
  { value: "forme", label: "Rester en forme" },
];

export function Coach() {
  const { profile } = useSession();
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [goal, setGoal] = useState("10km");
  const [targetDate, setTargetDate] = useState(defaultTargetDate());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.plan().then(setPlan).catch(() => undefined);
    api.today().then(setToday).catch(() => undefined);
  }, []);

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      setPlan(await api.createPlan(goal, targetDate));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!plan || !confirm("Supprimer ce plan d'entrainement ?")) return;
    await api.deletePlan(plan.id);
    setPlan(null);
  };

  const today0 = new Date().toISOString().slice(0, 10);
  const weeks = plan?.sessions ? groupByWeek(plan.sessions) : [];

  return (
    <>
      <div className="entete">
        <div>
          <h1>Coach</h1>
          <p className="sous-titre">
            Un plan periodise, ajuste chaque jour selon ta fatigue reelle.
          </p>
        </div>
      </div>

      {error && <div className="message erreur">{error}</div>}

      {today && (
        <>
          <h2>Aujourd'hui</h2>
          <p className="sous-titre">{today.reason}</p>
          {today.warning && <div className="message alerte">{today.warning}</div>}
          <WorkoutCard workout={today.workout} />
        </>
      )}

      {today?.paces ? (
        <div className="carte">
          <h2>Tes allures d'entrainement</h2>
          <p className="aide">
            Calculees depuis ta VMA de {profile?.vma} km/h. Elles servent de cible aux
            seances du plan.
          </p>
          <table>
            <tbody>
              {Object.entries(today.paces).map(([label, seconds]) => (
                <tr key={label}>
                  <td style={{ textTransform: "capitalize" }}>{label}</td>
                  <td style={{ textAlign: "right" }}>{pace(seconds)}/km</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="message alerte">
          Renseigne ta VMA dans les reglages pour obtenir des allures cibles chiffrees.
          Sans elle, les seances s'appuient uniquement sur les zones cardiaques.
        </div>
      )}

      <div className="carte">
        <div className="entete" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{plan ? "Ton plan" : "Creer un plan"}</h2>
          {plan && (
            <button className="danger" onClick={remove}>
              Supprimer le plan
            </button>
          )}
        </div>

        {plan ? (
          <p className="sous-titre">
            Objectif {GOALS.find((g) => g.value === plan.goal)?.label ?? plan.goal} le{" "}
            {dateShort(plan.targetDate)} · {plan.sessions.length} seances ·{" "}
            {profile?.weeklySessions} par semaine
          </p>
        ) : (
          <>
            <p className="sous-titre">
              Le plan se construit a partir de ton profil : niveau, nombre de seances
              hebdomadaires et VMA.
            </p>
            <div className="champs">
              <div className="champ">
                <label htmlFor="objectif">Objectif</label>
                <select id="objectif" value={goal} onChange={(e) => setGoal(e.target.value)}>
                  {GOALS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="champ">
                <label htmlFor="date">Date de l'objectif</label>
                <input
                  id="date"
                  type="date"
                  value={targetDate}
                  min={today0}
                  onChange={(e) => setTargetDate(e.target.value)}
                />
              </div>
            </div>
            <button className="primaire" onClick={create} disabled={busy}>
              {busy ? "Generation..." : "Generer mon plan"}
            </button>
          </>
        )}
      </div>

      {weeks.map(({ week, sessions }) => (
        <div key={week} className="semaine">
          <div className="numero">
            Semaine {week}
            <div className="aide">
              {Math.round(
                sessions.reduce((sum, s) => sum + s.estimatedDuration, 0) / 60,
              )}{" "}
              min
            </div>
          </div>
          <div className="jours">
            {sessions.map((session) => (
              <div
                key={session.date + session.id}
                className={`jour ${session.date === today0 ? "aujourdhui" : ""}`}
              >
                <div className="date">{dateShort(session.date)}</div>
                <div className="nom">{session.title}</div>
                <div
                  className="aide"
                  style={{ color: KIND_COLORS[session.kind], fontWeight: 600 }}
                >
                  {KIND_LABELS[session.kind] ?? session.kind}
                  {session.estimatedDuration > 0
                    ? ` · ${durationWords(session.estimatedDuration)}`
                    : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function groupByWeek(
  sessions: PlannedSession[],
): Array<{ week: number; sessions: PlannedSession[] }> {
  const byWeek = new Map<number, PlannedSession[]>();
  for (const session of sessions) {
    const list = byWeek.get(session.week) ?? [];
    list.push(session);
    byWeek.set(session.week, list);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a - b)
    .map(([week, weekSessions]) => ({ week, sessions: weekSessions }));
}

/** Objectif propose par defaut : dans douze semaines, duree d'une preparation type. */
function defaultTargetDate(): string {
  return new Date(Date.now() + 12 * 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
}
