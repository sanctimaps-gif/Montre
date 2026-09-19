import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { AthleteProfile } from "@montre/core";
import { computeHrZones, estimateMaxHr, trainingPaces } from "@montre/core";
import type { DeviceRecord, StravaStatus } from "../api.ts";
import { STANDALONE, api } from "../api.ts";
import {
  DECATHLON_NAME_PREFIXES,
  bluetoothUnavailableReason,
  isBluetoothSupported,
  watchConnection,
} from "../device/fit100s.ts";
import { useSession } from "../session.tsx";
import { ZONE_COLORS, pace, relative } from "../format.ts";

export function Settings() {
  const { user, profile, refreshProfile, logout } = useSession();
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState<Partial<AthleteProfile>>(profile ?? {});
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [strava, setStrava] = useState<StravaStatus | null>(null);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const [pairing, setPairing] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");

  useEffect(() => {
    if (profile) setForm(profile);
  }, [profile]);

  useEffect(() => {
    api.devices().then(setDevices).catch(() => undefined);
    api.stravaStatus().then(setStrava).catch(() => undefined);
  }, []);

  // Retour de la redirection OAuth Strava.
  useEffect(() => {
    const status = params.get("strava");
    if (!status) return;
    const texts: Record<string, { type: string; text: string }> = {
      connecte: { type: "succes", text: "Compte Strava connecte." },
      refuse: { type: "alerte", text: "Autorisation Strava refusee." },
      erreur: { type: "erreur", text: "La connexion a Strava a echoue, reessaie." },
    };
    setMessage(texts[status] ?? null);
    params.delete("strava");
    setParams(params, { replace: true });
    api.stravaStatus().then(setStrava).catch(() => undefined);
  }, [params, setParams]);

  const saveProfile = async () => {
    setMessage(null);
    try {
      // Sans comptes, le nom affiche se modifie ici plutot qu'a l'inscription.
      if (STANDALONE && displayName.trim() && displayName !== user?.displayName) {
        await api.register("", "", displayName);
      }
      await api.updateProfile(form);
      await refreshProfile();
      setMessage({ type: "succes", text: "Profil enregistre." });
    } catch (error) {
      setMessage({ type: "erreur", text: (error as Error).message });
    }
  };

  const eraseLocalData = async () => {
    if (!api.resetLocalData) return;
    if (!confirm("Effacer toutes les activites et le plan stockes dans ce navigateur ?")) return;
    await api.resetLocalData();
    setMessage({ type: "succes", text: "Donnees locales effacees." });
  };

  /** Appairage : ouvre le selecteur Bluetooth et memorise la montre trouvee. */
  const pairWatch = async () => {
    setMessage(null);
    if (!isBluetoothSupported()) {
      setMessage({ type: "alerte", text: bluetoothUnavailableReason() });
      return;
    }
    setPairing(true);
    // La montre appairee ici reste connectee : elle sera prete pour la seance.
    const connection = watchConnection({});
    try {
      const identity = await connection.connect();
      await api.saveDevice({
        id: identity.id,
        name: identity.name,
        model: identity.model,
        firmware: identity.firmware,
        serial: identity.serial,
      });
      setDevices(await api.devices());
      setMessage({
        type: "succes",
        text: `${identity.name} appairee et connectee. Va dans Seance pour demarrer.`,
      });
    } catch (error) {
      const text = (error as Error).message;
      // Le selecteur ferme sans choisir n'est pas une erreur a signaler.
      if (!/cancelled|annul/i.test(text)) {
        setMessage({ type: "erreur", text });
        connection.disconnect();
      }
    } finally {
      setPairing(false);
    }
  };

  const connectStrava = async () => {
    try {
      const { url } = await api.stravaAuthorize();
      window.location.href = url;
    } catch (error) {
      setMessage({ type: "erreur", text: (error as Error).message });
    }
  };

  const syncStrava = async () => {
    setMessage({ type: "info", text: "Synchronisation en cours..." });
    try {
      const result = await api.stravaSync();
      setMessage({
        type: "succes",
        text: `${result.imported} activite(s) importee(s), ${result.skipped} deja presente(s).`,
      });
      setStrava(await api.stravaStatus());
    } catch (error) {
      setMessage({ type: "erreur", text: (error as Error).message });
    }
  };

  const zones = profile ? computeHrZones(profile) : null;
  const paces = profile?.vma ? trainingPaces(profile.vma) : null;

  return (
    <>
      <div className="entete">
        <div>
          <h1>Reglages</h1>
          <p className="sous-titre">
            {user?.displayName}
            {user?.email ? ` · ${user.email}` : ""}
          </p>
        </div>
        {!STANDALONE && (
          <button className="discret" onClick={() => logout()}>
            Se deconnecter
          </button>
        )}
      </div>

      {STANDALONE && (
        <div className="message info">
          <strong>Version autonome.</strong> Tout s'execute dans ce navigateur : les calculs
          viennent du meme moteur que la version serveur, et tes seances sont stockees
          localement, sur cet appareil uniquement. Il n'y a donc ni compte ni partage, et la
          synchronisation Strava — qui exige un secret cote serveur — demande de lancer
          l'application complete.
        </div>
      )}

      {message && <div className={`message ${message.type}`}>{message.text}</div>}

      <div className="carte">
        <h2>Profil sportif</h2>
        <p className="sous-titre">
          Ces valeurs alimentent les zones cardiaques, les allures cibles et le calcul de
          charge.
        </p>

        <div className="champs">
          {STANDALONE && (
            <div className="champ">
              <label htmlFor="nom-affiche">Nom affiche</label>
              <input
                id="nom-affiche"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Camille"
              />
            </div>
          )}
          <div className="champ">
            <label htmlFor="naissance">Date de naissance</label>
            <input
              id="naissance"
              type="date"
              value={form.birthDate ?? ""}
              onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
            />
          </div>
          <div className="champ">
            <label htmlFor="poids">Poids (kg)</label>
            <input
              id="poids"
              type="number"
              step="0.5"
              value={form.weightKg ?? ""}
              onChange={(e) => setForm({ ...form, weightKg: numberOrUndefined(e.target.value) })}
            />
          </div>
          <div className="champ">
            <label htmlFor="fcmax">FC maximale (bpm)</label>
            <input
              id="fcmax"
              type="number"
              value={form.maxHr ?? ""}
              onChange={(e) => setForm({ ...form, maxHr: numberOrUndefined(e.target.value) })}
            />
            {form.birthDate && !form.maxHr && (
              <p className="aide">
                Estimee a {estimateMaxHr(ageFrom(form.birthDate))} bpm d'apres ton age.
                Mesure-la sur un test de terrain pour plus de precision.
              </p>
            )}
          </div>
          <div className="champ">
            <label htmlFor="fcrepos">FC de repos (bpm)</label>
            <input
              id="fcrepos"
              type="number"
              value={form.restHr ?? ""}
              onChange={(e) => setForm({ ...form, restHr: numberOrUndefined(e.target.value) })}
            />
            <p className="aide">Mesuree au reveil, avant de te lever.</p>
          </div>
          <div className="champ">
            <label htmlFor="vma">VMA (km/h)</label>
            <input
              id="vma"
              type="number"
              step="0.1"
              value={form.vma ?? ""}
              onChange={(e) => setForm({ ...form, vma: numberOrUndefined(e.target.value) })}
            />
            <p className="aide">
              Vitesse maximale aerobie, par exemple celle d'un test demi-Cooper.
            </p>
          </div>
          <div className="champ">
            <label htmlFor="seances">Seances par semaine</label>
            <input
              id="seances"
              type="number"
              min={1}
              max={7}
              value={form.weeklySessions ?? 3}
              onChange={(e) =>
                setForm({ ...form, weeklySessions: Number(e.target.value) || 3 })
              }
            />
          </div>
          <div className="champ">
            <label htmlFor="niveau">Niveau</label>
            <select
              id="niveau"
              value={form.level ?? "debutant"}
              onChange={(e) =>
                setForm({ ...form, level: e.target.value as AthleteProfile["level"] })
              }
            >
              <option value="debutant">Debutant</option>
              <option value="intermediaire">Intermediaire</option>
              <option value="confirme">Confirme</option>
            </select>
          </div>
        </div>

        <button className="primaire" onClick={saveProfile}>
          Enregistrer
        </button>

        {zones && (
          <>
            <div className="separateur" />
            <h3>Tes zones cardiaques</h3>
            <table>
              <tbody>
                {zones.bounds.map((bound, i) => (
                  <tr key={i}>
                    <td style={{ width: 18 }}>
                      <span
                        className="point"
                        style={{ color: ZONE_COLORS[i], display: "inline-block" }}
                      />
                    </td>
                    <td>Zone {i + 1}</td>
                    <td style={{ textAlign: "right" }}>
                      {bound} – {i === 4 ? zones.max : (zones.bounds[i + 1] ?? zones.max) - 1} bpm
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {paces && (
          <>
            <div className="separateur" />
            <h3>Tes allures</h3>
            <table>
              <tbody>
                {Object.entries(paces).map(([label, seconds]) => (
                  <tr key={label}>
                    <td style={{ textTransform: "capitalize" }}>{label}</td>
                    <td style={{ textAlign: "right" }}>{pace(seconds)}/km</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="carte">
        <h2>Ma montre</h2>
        <p className="sous-titre">
          La Fit 100 S se connecte en Bluetooth pour la frequence cardiaque, la cadence et
          la batterie pendant la seance.
        </p>

        {devices.length === 0 ? (
          <p className="aide">Aucune montre appairee pour l'instant.</p>
        ) : (
          devices.map((device) => (
            <div key={device.id} className="ligne-activite">
              <span className="icone">⌚</span>
              <span className="corps">
                <span className="titre">{device.name}</span>
                <span className="meta">
                  {[
                    device.model,
                    device.firmware ? `firmware ${device.firmware}` : null,
                    device.lastBattery != null ? `batterie ${device.lastBattery} %` : null,
                    device.lastSeenAt ? `vue ${relative(device.lastSeenAt)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <button
                className="danger"
                onClick={async () => {
                  await api.deleteDevice(device.id);
                  setDevices(await api.devices());
                }}
              >
                Oublier
              </button>
            </div>
          ))
        )}

        <div className="actions" style={{ marginTop: 14 }}>
          <button className="bleu" onClick={pairWatch} disabled={pairing}>
            {pairing ? "Recherche..." : "Appairer une montre"}
          </button>
        </div>

        <div className="separateur" />

        <h3>Ce que la montre transmet, et comment</h3>
        <p className="aide">
          Decathlon ne publie pas le protocole de synchronisation de ses montres :
          l'historique stocke dans la Fit 100 S transite vers Decathlon Coach par un
          service Bluetooth prive, non documente. Cette application utilise donc les deux
          chemins fiables et ouverts :
        </p>
        <ul className="aide" style={{ paddingLeft: 18 }}>
          <li>
            <strong>En direct</strong> : les profils Bluetooth standards exposes par la
            montre pendant l'effort — frequence cardiaque, allure et cadence, batterie,
            identification de l'appareil. C'est ce qui alimente l'ecran Seance.
          </li>
          <li>
            <strong>Pour l'historique</strong> : l'export de fichier depuis Decathlon
            Coach (<strong>.fit</strong>, <strong>.gpx</strong> ou <strong>.tcx</strong>),
            a deposer dans l'onglet Activites. Les fichiers sont decodes integralement :
            trace, cardio, cadence, tours et altitude.
          </li>
        </ul>
        <p className="aide">
          Appareils reconnus par le selecteur Bluetooth :{" "}
          {DECATHLON_NAME_PREFIXES.join(", ")}, ainsi que toute montre ou ceinture
          exposant le profil cardio standard.
        </p>
        {!isBluetoothSupported() && (
          <div className="message alerte" style={{ marginTop: 12 }}>
            {bluetoothUnavailableReason()}
          </div>
        )}
      </div>

      <div className="carte">
        <h2>Strava</h2>
        {!strava?.configured ? (
          <p className="aide">
            {STANDALONE
              ? "La synchronisation Strava demande un secret client, qui ne peut pas vivre dans une page web : elle n'est disponible qu'avec le serveur de l'application. En attendant, tu peux exporter chaque seance en GPX ou TCX et la televerser sur Strava."
              : "Strava n'est pas configure sur ce serveur. Ajoute STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET dans le fichier .env, puis redemarre l'API."}
          </p>
        ) : strava.connected ? (
          <>
            <p className="sous-titre">
              Connecte{strava.athleteName ? ` en tant que ${strava.athleteName}` : ""}
              {strava.lastSyncAt
                ? ` · derniere synchronisation ${relative(strava.lastSyncAt)}`
                : " · jamais synchronise"}
            </p>
            <div className="actions">
              <button className="primaire" onClick={syncStrava}>
                Synchroniser mes activites
              </button>
              <button
                className="danger"
                onClick={async () => {
                  await api.stravaDisconnect();
                  setStrava(await api.stravaStatus());
                }}
              >
                Deconnecter
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="sous-titre">
              Importe tes activites Strava avec leurs traces, et depose ici tes seances
              enregistrees par l'application.
            </p>
            <button className="primaire" onClick={connectStrava}>
              Connecter mon compte Strava
            </button>
          </>
        )}
      </div>

      {STANDALONE && (
        <div className="carte">
          <h2>Mes donnees</h2>
          <p className="sous-titre">
            Tes seances sont stockees dans ce navigateur, sur cet appareil. Elles ne partent
            sur aucun serveur, mais elles disparaissent si tu effaces les donnees de site.
            Exporte tes seances en GPX ou TCX pour les conserver ailleurs.
          </p>
          <button className="danger" onClick={eraseLocalData}>
            Effacer toutes mes donnees locales
          </button>
        </div>
      )}
    </>
  );
}

function numberOrUndefined(value: string): number | undefined {
  if (value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function ageFrom(birthDate: string): number {
  const born = new Date(birthDate + "T00:00:00Z").getTime();
  return Math.floor((Date.now() - born) / (365.2425 * 24 * 3600 * 1000));
}
