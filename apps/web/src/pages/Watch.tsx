import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { LiveSample } from "@montre/core";
import { computeHrZones, hrToZone } from "@montre/core";
import { api } from "../api.ts";
import type { DeviceRecord } from "../api.ts";
import {
  DECATHLON_NAME_PREFIXES,
  WatchError,
  bluetoothEnvironment,
  watchConnection,
} from "../device/fit100s.ts";
import type { DeviceProfiles, WatchStatus } from "../device/fit100s.ts";
import { useSession } from "../session.tsx";
import { ZONE_COLORS, pace, relative } from "../format.ts";

const STATUS_LABELS: Record<WatchStatus, string> = {
  deconnecte: "Non connectee",
  recherche: "Recherche en cours...",
  connexion: "Connexion...",
  connecte: "Connectee",
  reconnexion: "Reconnexion...",
  erreur: "Connexion perdue",
};

/**
 * Ecran d'appairage de la montre.
 *
 * L'appairage Bluetooth echoue pour un petit nombre de raisons toujours les
 * memes : plateforme sans Web Bluetooth, montre en veille, montre deja prise
 * par l'application Decathlon Coach, ou filtre de recherche trop strict. Cet
 * ecran traite chacune explicitement, et se termine par un test en direct :
 * voir sa frequence cardiaque defiler est la seule preuve qui compte.
 */
export function Watch() {
  const { profile } = useSession();
  const environment = useMemo(() => bluetoothEnvironment(), []);

  const [status, setStatus] = useState<WatchStatus>("deconnecte");
  const [detail, setDetail] = useState<string | null>(null);
  const [sample, setSample] = useState<LiveSample>({ timestamp: 0 });
  const [profiles, setProfiles] = useState<DeviceProfiles | null>(null);
  const [identity, setIdentity] = useState<{ name: string; model?: string; firmware?: string } | null>(null);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const bind = useCallback(
    () =>
      watchConnection({
        onStatus: (next, why) => {
          setStatus(next);
          setDetail(why ?? null);
        },
        onSample: setSample,
        onIdentity: (next) => setIdentity(next),
        onProfiles: setProfiles,
      }),
    [],
  );

  useEffect(() => {
    bind();
    api.devices().then(setDevices).catch(() => undefined);
  }, [bind]);

  const connect = async (acceptAllDevices: boolean) => {
    setError(null);
    setHint(null);
    setBusy(true);

    try {
      const found = await bind().connect({ acceptAllDevices });
      await api
        .saveDevice({
          id: found.id,
          name: found.name,
          model: found.model,
          firmware: found.firmware,
          serial: found.serial,
          battery: sample.battery,
        })
        .catch(() => undefined);
      setDevices(await api.devices().catch(() => []));
    } catch (caught) {
      if (caught instanceof WatchError) {
        // Fermer le selecteur est un choix, pas une panne.
        if (caught.cause !== "annule") setError(caught.message);
        if (caught.cause === "introuvable" && !acceptAllDevices) {
          setHint("elargir");
        }
      } else {
        setError((caught as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setError("Copie impossible : selectionne l'adresse dans la barre du navigateur.");
    }
  };

  const zones = profile ? computeHrZones(profile) : null;
  const hrZone = sample.hr && zones ? hrToZone(sample.hr, zones) : null;
  const connected = status === "connecte";
  const receiving = sample.timestamp > 0 && Date.now() - sample.timestamp < 15_000;

  return (
    <>
      <div className="entete">
        <div>
          <h1>Ma montre</h1>
          <p className="sous-titre">
            Connecter la Decathlon Fit 100 S pour la frequence cardiaque, la cadence et la
            batterie pendant la seance.
          </p>
        </div>
        <span className={`etiquette ${connected ? "vert" : status === "erreur" ? "rouge" : ""}`}>
          <span className="point" />
          {STATUS_LABELS[status]}
        </span>
      </div>

      {error && <div className="message erreur">{error}</div>}
      {detail && <div className="message alerte">{detail}</div>}

      {!environment.available ? (
        <div className="carte accent">
          <h2>Ce navigateur ne peut pas parler a la montre</h2>
          <p>{environment.message}</p>
          {environment.remedy && <p className="sous-titre">{environment.remedy}</p>}

          {environment.kind === "ios" && (
            <>
              <div className="separateur" />
              <h3>Marche a suivre sur iPhone</h3>
              <ol style={{ paddingLeft: 20, lineHeight: 1.8 }}>
                <li>
                  Installe <strong>Bluefy – Web BLE Browser</strong> depuis l'App Store. C'est
                  un navigateur qui implemente Web Bluetooth par-dessus le Bluetooth d'iOS,
                  ce que Safari ne fait pas.
                </li>
                <li>Copie l'adresse de cette page avec le bouton ci-dessous.</li>
                <li>Ouvre Bluefy, colle l'adresse, et reviens sur cet ecran.</li>
                <li>Appuie sur « Rechercher ma montre ». Le reste est identique.</li>
              </ol>
              <div className="actions">
                <button className="primaire" onClick={copyLink}>
                  {copied ? "Adresse copiee" : "Copier l'adresse de la page"}
                </button>
              </div>
              <p className="aide" style={{ marginTop: 12 }}>
                Sur ordinateur ou sur Android, Chrome, Edge et Opera fonctionnent
                directement, sans rien installer.
              </p>
            </>
          )}

          <div className="separateur" />
          <p className="aide">
            Sans Bluetooth, l'application reste pleinement utilisable : exporte tes seances
            depuis Decathlon Coach en <strong>.fit</strong>, <strong>.gpx</strong> ou{" "}
            <strong>.tcx</strong> et depose-les dans{" "}
            <Link to="/activites" style={{ textDecoration: "underline" }}>
              Activites
            </Link>
            . Tu auras les memes analyses, simplement pas le direct.
          </p>
        </div>
      ) : (
        <>
          <div className="carte accent">
            <h2>Avant de lancer la recherche</h2>
            <ol style={{ paddingLeft: 20, lineHeight: 1.9 }}>
              <li>
                <strong>Reveille la montre</strong> et demarre une activite dessus. Beaucoup
                de montres n'emettent leur frequence cardiaque qu'une fois la seance lancee.
              </li>
              <li>
                <strong>Ferme l'application Decathlon Coach</strong> et deconnecte la montre
                dans les reglages Bluetooth du telephone. Une montre ne peut etre connectee
                qu'a une seule application a la fois : si Decathlon Coach la tient, nous ne
                pourrons pas l'avoir.
              </li>
              <li>
                <strong>Garde la montre a moins d'un metre</strong> pendant l'appairage.
              </li>
            </ol>

            <div className="actions" style={{ marginTop: 16 }}>
              <button className="primaire grand" onClick={() => connect(false)} disabled={busy}>
                {busy ? "Recherche..." : "Rechercher ma montre"}
              </button>
              {connected && (
                <button className="discret" onClick={() => bind().disconnect()}>
                  Deconnecter
                </button>
              )}
            </div>

            {hint === "elargir" && (
              <div className="message alerte" style={{ marginTop: 14 }}>
                <p style={{ marginTop: 0 }}>
                  Ta montre n'apparait pas dans la liste filtree. C'est frequent : toutes les
                  montres n'annoncent pas leur nom ni leurs services avant d'etre connectees.
                </p>
                <button onClick={() => connect(true)} disabled={busy}>
                  Afficher tous les appareils Bluetooth
                </button>
              </div>
            )}

            {hint !== "elargir" && (
              <p className="aide" style={{ marginTop: 12 }}>
                Ta montre n'apparait pas ?{" "}
                <button
                  className="discret"
                  style={{ padding: "2px 6px", textDecoration: "underline" }}
                  onClick={() => connect(true)}
                  disabled={busy}
                >
                  Afficher tous les appareils Bluetooth
                </button>
              </p>
            )}
          </div>

          {connected && (
            <div className="carte">
              <h2>Test en direct</h2>
              {identity && (
                <p className="sous-titre">
                  {identity.name}
                  {identity.model ? ` · ${identity.model}` : ""}
                  {identity.firmware ? ` · firmware ${identity.firmware}` : ""}
                </p>
              )}

              <div className="grille-stats" style={{ marginTop: 14 }}>
                <div className="stat">
                  <div
                    className="valeur cardio"
                    style={{ color: hrZone ? ZONE_COLORS[hrZone - 1] : undefined }}
                  >
                    {sample.hr ?? "--"}
                  </div>
                  <div className="libelle">bpm{hrZone ? ` · zone ${hrZone}` : ""}</div>
                </div>
                <div className="stat">
                  <div className="valeur">{sample.cadence ?? "--"}</div>
                  <div className="libelle">pas/min</div>
                </div>
                <div className="stat">
                  <div className="valeur">
                    {sample.speed ? `${pace(1000 / sample.speed)}` : "--"}
                  </div>
                  <div className="libelle">allure /km</div>
                </div>
                <div className="stat">
                  <div className="valeur">
                    {sample.battery != null ? `${sample.battery} %` : "--"}
                  </div>
                  <div className="libelle">batterie</div>
                </div>
              </div>

              {sample.poorSensorContact && (
                <div className="message alerte" style={{ marginTop: 14 }}>
                  La montre signale un mauvais contact du capteur cardiaque : resserre le
                  bracelet d'un cran, au-dessus de l'os du poignet.
                </div>
              )}

              {profiles && (
                <>
                  <div className="separateur" />
                  <h3>Ce que cette montre transmet</h3>
                  <table>
                    <tbody>
                      <ProfileRow label="Frequence cardiaque" ok={profiles.heartRate} />
                      <ProfileRow label="Allure et cadence" ok={profiles.cadence} />
                      <ProfileRow label="Niveau de batterie" ok={profiles.battery} />
                      <ProfileRow label="Modele et firmware" ok={profiles.deviceInformation} />
                    </tbody>
                  </table>

                  {!profiles.heartRate && (
                    <div className="message alerte" style={{ marginTop: 12 }}>
                      Cette montre est connectee mais n'expose pas le profil cardio standard.
                      Demarre une activite sur la montre puis reconnecte-toi : la diffusion
                      ne commence souvent qu'a ce moment-la.
                    </div>
                  )}
                  {profiles.heartRate && !receiving && (
                    <div className="message info" style={{ marginTop: 12 }}>
                      Connectee, mais aucune mesure recue pour l'instant. Demarre une
                      activite sur la montre pour qu'elle se mette a emettre.
                    </div>
                  )}
                </>
              )}

              {receiving && (
                <div className="actions" style={{ marginTop: 16 }}>
                  <Link to="/seance" className="bouton primaire">
                    Demarrer une seance
                  </Link>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div className="carte">
        <h2>Montres appairees</h2>
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
      </div>

      <div className="carte">
        <h2>Si ca ne marche toujours pas</h2>
        <dl style={{ margin: 0 }}>
          <Probleme titre="La montre n'apparait dans aucune liste">
            Elle est probablement deja connectee ailleurs. Sur le telephone, va dans les
            reglages Bluetooth du systeme et oublie la montre, ferme Decathlon Coach, puis
            relance la recherche. Verifie aussi que la montre est bien reveillee.
          </Probleme>
          <Probleme titre="Elle se connecte puis se deconnecte aussitot">
            Deux applications se disputent la montre. Une seule peut la tenir a la fois.
          </Probleme>
          <Probleme titre="Connectee, mais aucune valeur ne s'affiche">
            Demarre une activite sur la montre. La diffusion du cardio ne demarre souvent
            qu'avec la seance, pour economiser la batterie.
          </Probleme>
          <Probleme titre="Je veux quand meme mon historique">
            Le transfert des seances deja enregistrees dans la montre passe par un protocole
            que Decathlon ne documente pas. Exporte-les depuis Decathlon Coach en .fit, .gpx
            ou .tcx : l'application les decode entierement, trace et cardio compris.
          </Probleme>
        </dl>

        <div className="separateur" />
        <p className="aide">
          Appareils reconnus par la recherche filtree : {DECATHLON_NAME_PREFIXES.join(", ")},
          ainsi que toute montre ou ceinture exposant le profil cardio standard. La recherche
          elargie, elle, n'applique aucun filtre.
        </p>
      </div>
    </>
  );
}

function ProfileRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <tr>
      <td style={{ width: 24 }}>{ok ? "✅" : "—"}</td>
      <td>{label}</td>
      <td style={{ textAlign: "right", color: "var(--texte-doux)" }}>
        {ok ? "disponible" : "non expose"}
      </td>
    </tr>
  );
}

function Probleme({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <dt style={{ fontWeight: 600, marginBottom: 2 }}>{titre}</dt>
      <dd style={{ margin: 0, color: "var(--texte-doux)", fontSize: 14 }}>{children}</dd>
    </div>
  );
}
