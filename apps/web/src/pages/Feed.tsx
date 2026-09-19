import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { FeedItem } from "../api.ts";
import { api } from "../api.ts";
import { SPORT_ICONS, duration, km, paceOrSpeed, relative } from "../format.ts";

export function Feed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [athletes, setAthletes] = useState<
    Array<{ id: string; displayName: string; following: boolean }>
  >([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.feed().then(setItems).catch((caught) => setError((caught as Error).message));
    api.athletes().then(setAthletes).catch(() => undefined);
  }, []);

  const toggleKudos = async (item: FeedItem) => {
    try {
      const result = await api.kudos(item.id);
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, kudoed: result.kudoed, kudosCount: result.count }
            : entry,
        ),
      );
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  const toggleFollow = async (id: string) => {
    const result = await api.follow(id);
    setAthletes((current) =>
      current.map((a) => (a.id === id ? { ...a, following: result.following } : a)),
    );
    setItems(await api.feed());
  };

  return (
    <>
      <div className="entete">
        <div>
          <h1>Flux</h1>
          <p className="sous-titre">Tes sorties et celles des athletes que tu suis.</p>
        </div>
      </div>

      {error && <div className="message erreur">{error}</div>}

      {athletes.length > 0 && (
        <div className="carte">
          <h2>Athletes</h2>
          {athletes.map((athlete) => (
            <div key={athlete.id} className="ligne-activite">
              <span className="icone">🙂</span>
              <span className="corps">
                <span className="titre">{athlete.displayName}</span>
              </span>
              <button
                className={athlete.following ? "discret" : "primaire"}
                onClick={() => toggleFollow(athlete.id)}
              >
                {athlete.following ? "Ne plus suivre" : "Suivre"}
              </button>
            </div>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <div className="vide">
          Le flux est vide. Enregistre une seance ou suis un autre athlete.
        </div>
      ) : (
        items.map((item) => (
          <div key={item.id} className="carte">
            <div className="ligne-activite" style={{ borderBottom: "none", padding: 0 }}>
              <span className="icone">{SPORT_ICONS[item.sport] ?? "⚡"}</span>
              <span className="corps">
                <span className="titre">
                  {item.athlete}
                  {item.isMine && <span className="etiquette" style={{ marginLeft: 8 }}>toi</span>}
                </span>
                <span className="meta">{relative(item.startTime)}</span>
              </span>
            </div>

            <Link to={`/activites/${item.id}`}>
              <h2 style={{ marginTop: 14 }}>{item.title}</h2>
            </Link>

            <div className="grille-stats">
              <div className="stat">
                <div className="valeur">{(item.distance / 1000).toFixed(2)}</div>
                <div className="libelle">km</div>
              </div>
              <div className="stat">
                <div className="valeur">{duration(item.movingTime)}</div>
                <div className="libelle">duree</div>
              </div>
              <div className="stat">
                <div className="valeur">
                  {paceOrSpeed(item.sport, item.distance, item.movingTime)}
                </div>
                <div className="libelle">allure</div>
              </div>
              {item.elevationGain > 0 && (
                <div className="stat">
                  <div className="valeur">{item.elevationGain}</div>
                  <div className="libelle">m D+</div>
                </div>
              )}
              {item.avgHr && (
                <div className="stat">
                  <div className="valeur cardio">{item.avgHr}</div>
                  <div className="libelle">bpm</div>
                </div>
              )}
            </div>

            <div className="actions" style={{ marginTop: 14 }}>
              <button
                className={item.kudoed ? "primaire" : ""}
                onClick={() => toggleKudos(item)}
              >
                👏 {item.kudosCount}
              </button>
              <Link to={`/activites/${item.id}`} className="bouton">
                💬 {item.commentCount}
              </Link>
              {item.trainingLoad != null && (
                <span className="etiquette">charge {item.trainingLoad}</span>
              )}
            </div>
          </div>
        ))
      )}
    </>
  );
}
