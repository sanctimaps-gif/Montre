import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { LiveSample } from "@montre/core";
import { computeHrZones, hrToZone } from "@montre/core";
import { STANDALONE, api } from "../api.ts";
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
 * par Decathlon Hub, ou filtre de recherche trop strict. Cet
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
        <>
          <div className="carte accent">
            <h2>Ce navigateur ne peut pas parler au Bluetooth</h2>
            <p>{environment.message}</p>
            {environment.kind === "ios" && (
              <p className="sous-titre">
                Aucun reglage ni astuce ne change cela : c'est une limite du systeme, pas de
                l'application. Voici les quatre chemins qui fonctionnent, du plus simple au
                plus technique.
              </p>
            )}
          </div>

          <HubOption numero={1} />

          <Option
            numero={2}
            titre="Exporter une seance depuis Decathlon Hub"
            resume="Sans rien installer d'autre, et sans serveur"
          >
            <p>
              Meme principe, en manuel : une fois la seance remontee dans Decathlon Hub,
              sors-en un fichier et depose-le ici. Il contient tout — trace GPS, cardio,
              cadence et tours.
            </p>
            <ol style={{ paddingLeft: 20, lineHeight: 1.9 }}>
              <li>Ouvre la seance dans Decathlon Hub.</li>
              <li>
                Cherche <strong>Partager</strong> ou <strong>Exporter</strong>, souvent dans
                le menu « … » en haut de la seance.
              </li>
              <li>
                Choisis <strong>GPX</strong>, <strong>TCX</strong> ou <strong>FIT</strong>,
                puis <strong>Enregistrer dans Fichiers</strong>.
              </li>
              <li>
                Reviens ici, dans{" "}
                <Link to="/activites" style={{ textDecoration: "underline" }}>
                  Activites
                </Link>
                , et choisis le fichier depuis l'application Fichiers.
              </li>
            </ol>
            <p className="aide">
              Tu obtiens exactement les memes analyses que par le direct — zones, charge,
              derive cardiaque, records, coaching.
            </p>
            <div className="actions">
              <Link to="/activites" className="bouton primaire">
                Aller importer une seance
              </Link>
            </div>
          </Option>

          <Option
            numero={3}
            titre="Sur un ordinateur ou un telephone Android"
            resume="Le direct, sans rien installer"
          >
            <p>
              Ouvre cette meme adresse dans <strong>Chrome</strong>, Edge ou Opera. La
              connexion Bluetooth y fonctionne nativement : tu vois ta frequence cardiaque
              defiler et tu peux enregistrer tes seances en direct.
            </p>
            <div className="actions">
              <button onClick={copyLink}>
                {copied ? "Adresse copiee" : "Copier l'adresse de la page"}
              </button>
            </div>
          </Option>

          {environment.kind === "ios" && (
            <Option
              numero={4}
              titre="Bluefy, pour le direct sur iPhone"
              resume="Un navigateur tiers a installer"
            >
              <p>
                <strong>Bluefy – Web BLE Browser</strong>, sur l'App Store, implemente Web
                Bluetooth par-dessus le Bluetooth d'iOS — ce que Safari ne fait pas. Copie
                l'adresse de cette page, ouvre-la dans Bluefy, et la recherche de montre
                fonctionne comme sur un ordinateur.
              </p>
              <div className="actions">
                <button onClick={copyLink}>
                  {copied ? "Adresse copiee" : "Copier l'adresse de la page"}
                </button>
              </div>
              <p className="aide">
                C'est la seule facon d'avoir le cardio a l'ecran pendant l'effort sur un
                iPhone. Pour tout le reste, les options 1 et 2 suffisent.
              </p>
            </Option>
          )}

          <div className="carte">
            <h3>Et sans la montre du tout ?</h3>
            <p className="aide">
              L'ecran{" "}
              <Link to="/seance" style={{ textDecoration: "underline" }}>
                Seance
              </Link>{" "}
              enregistre le chrono, le GPS, la distance, l'allure, le denivele et les tours
              automatiques avec le seul telephone. Seule la frequence cardiaque manque,
              puisqu'elle vient du capteur de la montre.
            </p>
          </div>
        </>
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
                <strong>Ferme Decathlon Hub (ou Decathlon Coach)</strong> et deconnecte la montre
                dans les reglages Bluetooth du telephone. Une montre ne peut etre connectee
                qu'a une seule application a la fois : si Decathlon Hub la tient, nous ne
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

      {/* La chaine automatique reste utile meme quand le direct fonctionne :
          elle remonte l'historique deja stocke dans la montre. */}
      {environment.available && <HubOption />}

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
            reglages Bluetooth du systeme et oublie la montre, ferme Decathlon Hub, puis
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
            que Decathlon ne documente pas. Exporte-les depuis Decathlon Hub en .fit, .gpx
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

/** Une solution proposee, numerotee par ordre de simplicite. */
function Option({
  numero,
  titre,
  resume,
  accent,
  children,
}: {
  numero?: number;
  titre: string;
  resume: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`carte ${accent ? "accent" : ""}`}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        {numero != null && (
          <span
            style={{
              flexShrink: 0,
              width: 32,
              height: 32,
              borderRadius: 10,
              display: "grid",
              placeItems: "center",
              background: "var(--surface-haute)",
              border: "1px solid var(--bordure)",
              fontWeight: 700,
            }}
          >
            {numero}
          </span>
        )}
        <div style={{ minWidth: 0 }}>
          <h2 style={{ marginBottom: 2 }}>{titre}</h2>
          <p className="sous-titre" style={{ marginBottom: 12 }}>
            {resume}
          </p>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * La chaine officielle, et la seule qui soit automatique sur iPhone :
 * la montre remonte dans Decathlon Hub — l'application de Decathlon pour la
 * Fit 100, qui fait le Bluetooth nativement, ce qu'aucune page web ne peut
 * faire sur iOS — Decathlon Hub pousse vers Strava, et cette application lit
 * Strava.
 */
function HubOption({ numero }: { numero?: number }) {
  return (
    <Option
      numero={numero}
      accent
      titre="Decathlon Hub, puis Strava"
      resume="La chaine officielle, automatique une fois en place"
    >
      <p>
        <strong>Decathlon Hub</strong> est l'application de Decathlon pour la Fit 100. Elle
        parle a ta montre en Bluetooth nativement — ce qu'une page web ne peut pas faire sur
        iPhone — et sait pousser tes seances vers Strava. Cette application, elle, sait lire
        Strava. Une fois les trois maillons en place, tes seances arrivent ici toutes seules.
      </p>
      <ol style={{ paddingLeft: 20, lineHeight: 1.9 }}>
        <li>
          Installe <strong>Decathlon Hub</strong> et appaire ta Fit 100, si ce n'est pas deja
          fait.
        </li>
        <li>
          Dans Decathlon Hub, ou sur le site HUB by Decathlon, connecte ton compte{" "}
          <strong>Strava</strong>. La synchronisation devient automatique, en arriere-plan.
        </li>
        <li>
          Ici, connecte ton compte Strava dans{" "}
          <Link to="/reglages" style={{ textDecoration: "underline" }}>
            Reglages
          </Link>
          , puis lance la synchronisation.
        </li>
      </ol>

      {STANDALONE ? (
        <div className="message alerte" style={{ marginBottom: 0 }}>
          <p style={{ marginTop: 0 }}>
            <strong>Cette etape demande le serveur de l'application.</strong> L'API Strava
            exige un secret client, qui ne peut pas vivre dans une page web sans etre expose
            a tous ceux qui l'ouvrent.
          </p>
          <p style={{ marginBottom: 0 }}>
            Sur un ordinateur, depuis le depot :{" "}
            <code>npm install</code>, puis <code>npm start</code>, et ouvre{" "}
            <code>http://localhost:8787</code>. Tu y retrouves la meme application, avec la
            synchronisation Strava en plus. Les details sont dans le fichier README.
          </p>
        </div>
      ) : (
        <div className="actions">
          <Link to="/reglages" className="bouton primaire">
            Connecter mon compte Strava
          </Link>
        </div>
      )}
    </Option>
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
