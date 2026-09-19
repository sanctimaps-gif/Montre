import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ActivitySummary, FitnessResponse, TodayResponse } from "../api.ts";
import { api } from "../api.ts";
import { BarChart, LineChart, Legende, PuceLegende } from "../components/Chart.tsx";
import { WorkoutCard } from "../components/WorkoutSteps.tsx";
import { useSession } from "../session.tsx";
import {
  SPORT_ICONS,
  dateLong,
  duration,
  durationWords,
  km,
  paceOrSpeed,
} from "../format.ts";

const VERDICT_STYLE: Record<string, string> = {
  frais: "vert",
  optimal: "vert",
  productif: "orange",
  surcharge: "rouge",
  repos: "bleu",
};

export function Dashboard() {
  const { user, profile } = useSession();
  const [fitness, setFitness] = useState<FitnessResponse | null>(null);
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [recent, setRecent] = useState<ActivitySummary[]>([]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof api.stats>>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.fitness(), api.today(), api.activities({ limit: 5 }), api.stats()])
      .then(([f, t, a, s]) => {
        setFitness(f);
        setToday(t);
        setRecent(a);
        setStats(s);
      })
      .catch((caught) => setError((caught as Error).message));
  }, []);

  if (error) return <div className="message erreur">{error}</div>;
  if (!fitness || !today) return <div className="chargement">Chargement...</div>;

  const totals = stats.reduce(
    (sum, s) => ({
      distance: sum.distance + s.distance,
      duration: sum.duration + s.duration,
      count: sum.count + s.count,
      elevation: sum.elevation + s.elevation,
    }),
    { distance: 0, duration: 0, count: 0, elevation: 0 },
  );

  const hasProfile = profile?.vma != null || profile?.maxHr != null;

  return (
    <>
      <div className="entete">
        <div>
          <h1>Salut {user?.displayName}</h1>
          <p className="sous-titre">{dateLong(Date.now()).split(",")[0]}</p>
        </div>
        <div className="actions">
          <Link to="/seance" className="bouton primaire">
            Demarrer une seance
          </Link>
        </div>
      </div>

      {!hasProfile && (
        <div className="message alerte">
          Renseigne ta VMA et ta frequence cardiaque maximale dans les{" "}
          <Link to="/reglages" style={{ textDecoration: "underline" }}>
            reglages
          </Link>{" "}
          : le coach en a besoin pour calculer tes allures et tes zones.
        </div>
      )}

      <div className="grille">
        <div className="carte">
          <h2>Seance du jour</h2>
          <p className="sous-titre" style={{ marginBottom: 14 }}>
            {today.reason}
          </p>
          {today.warning && <div className="message alerte">{today.warning}</div>}
          <WorkoutCard workout={today.workout}>
            <div className="actions" style={{ marginTop: 14 }}>
              <Link to="/seance" className="bouton primaire">
                Lancer cette seance
              </Link>
              <Link to="/coach" className="bouton">
                Voir le plan
              </Link>
            </div>
          </WorkoutCard>
        </div>

        <div>
          <div className="carte">
            <h2>Etat de forme</h2>
            <span className={`etiquette ${VERDICT_STYLE[fitness.form.verdict] ?? ""}`}>
              <span className="point" />
              {fitness.form.verdict}
            </span>
            <p className="sous-titre" style={{ marginTop: 10 }}>
              {fitness.form.message}
            </p>

            <div className="grille-stats" style={{ marginTop: 16 }}>
              <div className="stat">
                <div className="valeur">{fitness.today?.ctl ?? 0}</div>
                <div className="libelle">Forme</div>
              </div>
              <div className="stat">
                <div className="valeur">{fitness.today?.atl ?? 0}</div>
                <div className="libelle">Fatigue</div>
              </div>
              <div className="stat">
                <div
                  className="valeur"
                  style={{ color: (fitness.today?.tsb ?? 0) >= 0 ? "var(--vert)" : "var(--accent)" }}
                >
                  {fitness.today?.tsb ?? 0}
                </div>
                <div className="libelle">Fraicheur</div>
              </div>
            </div>

            {fitness.acwr != null && (
              <p className="aide" style={{ marginTop: 12 }}>
                Rapport charge aigue / chronique : <strong>{fitness.acwr}</strong>
                {fitness.acwr > 1.3
                  ? " — au-dessus de 1,3, le risque de blessure augmente."
                  : fitness.acwr < 0.8
                    ? " — en dessous de 0,8, tu perds du fond."
                    : " — dans la fenetre optimale."}
              </p>
            )}
          </div>

          <div className="carte">
            <h2>12 derniers mois</h2>
            <div className="grille-stats">
              <div className="stat">
                <div className="valeur">{(totals.distance / 1000).toFixed(0)}</div>
                <div className="libelle">km</div>
              </div>
              <div className="stat">
                <div className="valeur">{Math.round(totals.duration / 3600)}</div>
                <div className="libelle">heures</div>
              </div>
              <div className="stat">
                <div className="valeur">{totals.count}</div>
                <div className="libelle">seances</div>
              </div>
              <div className="stat">
                <div className="valeur">{totals.elevation}</div>
                <div className="libelle">m D+</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="carte">
        <h2>Courbe de forme</h2>
        <LineChart
          height={200}
          baseline={0}
          series={[
            {
              label: "Forme",
              color: "#4bb4e6",
              values: fitness.series.map((s) => s.ctl),
              fill: true,
            },
            { label: "Fatigue", color: "#e5484d", values: fitness.series.map((s) => s.atl) },
            {
              label: "Fraicheur",
              color: "#35c47d",
              values: fitness.series.map((s) => s.tsb),
              dashed: true,
            },
          ]}
          labels={fitness.series.map((s) => s.date)}
        />
        <Legende>
          <PuceLegende color="#4bb4e6">Forme (charge chronique)</PuceLegende>
          <PuceLegende color="#e5484d">Fatigue (charge aigue)</PuceLegende>
          <PuceLegende color="#35c47d">Fraicheur</PuceLegende>
        </Legende>
      </div>

      <div className="carte">
        <h2>Charge par semaine</h2>
        <BarChart values={fitness.weekly.map((w) => ({ label: w.week, value: w.load }))} />
      </div>

      <div className="carte">
        <div className="entete" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Dernieres sorties</h2>
          <Link to="/activites" className="aide">
            Tout voir
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="vide">
            Aucune activite pour l'instant. Importe un fichier depuis Decathlon Coach ou
            enregistre une seance en direct.
          </div>
        ) : (
          recent.map((activity) => (
            <Link key={activity.id} to={`/activites/${activity.id}`} className="ligne-activite">
              <span className="icone">{SPORT_ICONS[activity.sport] ?? "⚡"}</span>
              <span className="corps">
                <span className="titre">{activity.title}</span>
                <span className="meta">
                  {km(activity.distance)} · {duration(activity.movingTime)} ·{" "}
                  {paceOrSpeed(activity.sport, activity.distance, activity.movingTime)}
                </span>
              </span>
              <span className="meta">{durationWords(activity.movingTime)}</span>
            </Link>
          ))
        )}
      </div>
    </>
  );
}
