import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { computeHrZones, hrToZone } from "@montre/core";
import { api } from "../api.ts";
import type { SessionAnalysis } from "../api.ts";
import {
  bluetoothUnavailableReason,
  isBluetoothSupported,
  watchConnection,
} from "../device/fit100s.ts";
import type { DeviceIdentity, LiveSample, WatchStatus } from "../device/fit100s.ts";
import { currentPace, sessionRecorder } from "../device/recorder.ts";
import type { RecorderState } from "../device/recorder.ts";
import { useSession } from "../session.tsx";
import { SPORT_LABELS, ZONE_COLORS, duration, km, pace } from "../format.ts";

const STATUS_LABELS: Record<WatchStatus, string> = {
  deconnecte: "Montre non connectee",
  recherche: "Recherche de la montre...",
  connexion: "Connexion en cours...",
  connecte: "Montre connectee",
  reconnexion: "Reconnexion...",
  erreur: "Connexion perdue",
};

export function Record() {
  const navigate = useNavigate();
  const { profile } = useSession();

  // L'enregistreur et la connexion Bluetooth sont partages par l'application :
  // quitter cet ecran en pleine sortie ne doit rien interrompre.
  const recorder = sessionRecorder;
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const [state, setState] = useState<RecorderState>(recorder.getState());
  const [sample, setSample] = useState<LiveSample>({ timestamp: 0 });
  const [watchStatus, setWatchStatus] = useState<WatchStatus>("deconnecte");
  const [watchDetail, setWatchDetail] = useState<string | null>(null);
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [sport, setSport] = useState("course");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [analysis, setAnalysis] = useState<SessionAnalysis | null>(null);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const unsubscribe = recorder.subscribe(setState);
    // Une seance interrompue (ecran verrouille, onglet ferme) est reprise en pause.
    if (recorder.restore()) setRestored(true);
    return () => {
      unsubscribe();
    };
  }, [recorder]);

  const zones = useMemo(
    () => (profile ? computeHrZones(profile) : null),
    [profile],
  );

  /** Branche l'ecran sur la connexion partagee, sans la recreer. */
  const bindWatch = useCallback(
    () =>
      watchConnection({
        onStatus: (status, detail) => {
          setWatchStatus(status);
          setWatchDetail(detail ?? null);
        },
        onSample: (next) => {
          setSample(next);
          recorder.updateSample(next);
        },
        onIdentity: (next) => setIdentity(next),
      }),
    [recorder],
  );

  // Au retour sur cet ecran, on recupere l'etat de la montre deja connectee.
  useEffect(() => {
    bindWatch();
  }, [bindWatch]);

  const connect = useCallback(async () => {
    setError(null);
    if (!isBluetoothSupported()) {
      setError(bluetoothUnavailableReason());
      return;
    }

    const connection = bindWatch();

    try {
      const found = await connection.connect();
      // La montre est memorisee cote serveur pour la retrouver dans les reglages.
      await api
        .saveDevice({
          id: found.id,
          name: found.name,
          model: found.model,
          firmware: found.firmware,
          serial: found.serial,
        })
        .catch(() => undefined);
    } catch (caught) {
      const message = (caught as Error).message;
      // Annulation du selecteur par l'utilisateur : ce n'est pas une erreur.
      setError(/cancelled|annul/i.test(message) ? null : message);
      setWatchStatus("deconnecte");
    }
  }, [bindWatch]);

  /** Empeche l'ecran de s'eteindre pendant la seance, quand le navigateur le permet. */
  const acquireWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      }
    } catch {
      // Refuse par le navigateur : sans consequence sur l'enregistrement.
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    void wakeLockRef.current?.release();
    wakeLockRef.current = null;
  }, []);

  useEffect(() => () => releaseWakeLock(), [releaseWakeLock]);

  const start = async () => {
    setError(null);
    setAnalysis(null);
    setRestored(false);
    await recorder.start(sport);
    await acquireWakeLock();
  };

  const stopAndSave = async () => {
    const finished = recorder.stop();
    releaseWakeLock();

    if (finished.points.length < 2) {
      setError("Seance trop courte pour etre enregistree.");
      recorder.reset();
      return;
    }

    setSaving(true);
    try {
      const result = await api.saveSession({
        sport: finished.sport,
        startTime: finished.startedAt,
        points: finished.points,
        laps: finished.laps,
      });
      setAnalysis(result.analysis);
      recorder.reset();
      navigate(`/activites/${result.activity.id}`);
    } catch (caught) {
      // La trace reste dans le stockage local : l'enregistrement pourra etre retente.
      setError(
        `${(caught as Error).message} — ta seance est conservee localement, reessaie l'enregistrement.`,
      );
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    if (!confirm("Supprimer definitivement cette seance en cours ?")) return;
    recorder.reset();
    releaseWakeLock();
    setRestored(false);
  };

  const running = state.status === "enregistrement";
  const paused = state.status === "pause";
  const instantPace = currentPace(state.points);
  const hrZone = sample.hr && zones ? hrToZone(sample.hr, zones) : null;

  return (
    <>
      <div className="entete">
        <div>
          <h1>Seance en direct</h1>
          <p className="sous-titre">
            Chrono et GPS du telephone, cardio et cadence de la montre.
          </p>
        </div>
      </div>

      {error && <div className="message erreur">{error}</div>}
      {restored && (
        <div className="message info">
          Une seance interrompue a ete retrouvee ({duration(state.elapsed)} enregistrees).
          Reprends-la ou enregistre-la telle quelle.
        </div>
      )}
      {analysis && <div className="message succes">{analysis.headline}</div>}

      <div className="carte">
        <div className="entete" style={{ marginBottom: 0 }}>
          <div>
            <span
              className={`etiquette ${
                watchStatus === "connecte"
                  ? "vert"
                  : watchStatus === "erreur"
                    ? "rouge"
                    : watchStatus === "deconnecte"
                      ? ""
                      : "orange"
              }`}
            >
              <span className="point" />
              {STATUS_LABELS[watchStatus]}
            </span>
            {identity && (
              <p className="aide" style={{ marginTop: 8 }}>
                {identity.name}
                {identity.model ? ` · ${identity.model}` : ""}
                {identity.firmware ? ` · firmware ${identity.firmware}` : ""}
                {sample.battery != null ? ` · batterie ${sample.battery} %` : ""}
              </p>
            )}
            {watchDetail && <p className="aide">{watchDetail}</p>}
            {sample.poorSensorContact && (
              <p className="aide" style={{ color: "var(--jaune)" }}>
                Contact du capteur cardiaque insuffisant : resserre le bracelet.
              </p>
            )}
          </div>
          <div className="actions">
            {watchStatus === "connecte" ? (
              <button
                className="discret"
                onClick={() => {
                  bindWatch().disconnect();
                  setIdentity(null);
                }}
              >
                Deconnecter
              </button>
            ) : (
              <>
                <button className="bleu" onClick={connect}>
                  Connecter la montre
                </button>
                {/* L'appairage guide et le diagnostic vivent sur leur propre ecran. */}
                <Link to="/montre" className="bouton discret">
                  Aide a la connexion
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="carte direct">
        <div className="chrono">{duration(state.elapsed)}</div>

        <div className="grille-directe">
          <div className="stat">
            <div className="valeur">{(state.distance / 1000).toFixed(2)}</div>
            <div className="libelle">km</div>
          </div>
          <div className="stat">
            <div className="valeur">{pace(instantPace)}</div>
            <div className="libelle">allure /km</div>
          </div>
          <div className="stat">
            <div
              className="valeur cardio"
              style={{ color: hrZone ? ZONE_COLORS[hrZone - 1] : undefined }}
            >
              {sample.hr ?? "--"}
            </div>
            <div className="libelle">bpm{hrZone ? ` · zone ${hrZone}` : ""}</div>
          </div>
        </div>

        {!running && !paused && (
          <div className="champ" style={{ maxWidth: 260, margin: "0 auto 18px" }}>
            <label htmlFor="sport">Type de seance</label>
            <select id="sport" value={sport} onChange={(e) => setSport(e.target.value)}>
              {Object.entries(SPORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="actions" style={{ justifyContent: "center" }}>
          {!running ? (
            <button className="primaire grand" onClick={start} disabled={saving}>
              {paused ? "Reprendre" : "Demarrer"}
            </button>
          ) : (
            <>
              <button className="grand" onClick={() => recorder.pause()}>
                Pause
              </button>
              <button className="grand" onClick={() => recorder.closeLap()}>
                Tour
              </button>
            </>
          )}

          {(running || paused) && (
            <button className="grand bleu" onClick={stopAndSave} disabled={saving}>
              {saving ? "Enregistrement..." : "Terminer"}
            </button>
          )}
          {paused && (
            <button className="danger" onClick={discard}>
              Abandonner
            </button>
          )}
        </div>

        {sample.cadence != null && (
          <p className="aide" style={{ marginTop: 14 }}>
            Cadence {sample.cadence} pas/min
            {sample.strideLength ? ` · foulee ${sample.strideLength.toFixed(2)} m` : ""}
          </p>
        )}
      </div>

      {state.laps.length > 0 && (
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
              </tr>
            </thead>
            <tbody>
              {state.laps.map((lap) => (
                <tr key={lap.index}>
                  <td>{lap.index}</td>
                  <td>{km(lap.distance)}</td>
                  <td>{duration(lap.duration)}</td>
                  <td>
                    {lap.distance > 0
                      ? `${pace((lap.duration / lap.distance) * 1000)}/km`
                      : "--"}
                  </td>
                  <td>{lap.avgHr ?? "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isBluetoothSupported() && (
        <div className="message info">
          <strong>Bluetooth indisponible ici.</strong> {bluetoothUnavailableReason()} Le
          chrono, le GPS et l'import de fichiers restent utilisables.{" "}
          <Link to="/montre" style={{ textDecoration: "underline" }}>
            Voir la marche a suivre
          </Link>
          .
        </div>
      )}
    </>
  );
}
