import { useState } from "react";
import type { FormEvent } from "react";
import { useSession } from "../session.tsx";

export function Login() {
  const { login, register } = useSession();
  const [mode, setMode] = useState<"connexion" | "inscription">("connexion");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "connexion") await login(email, password);
      else await register(email, password, displayName);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="connexion">
      <div className="boite">
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 42 }}>⌚</div>
          <h1 style={{ marginBottom: 6 }}>Montre</h1>
          <p className="sous-titre">
            Ton entrainement, ton coach et tes sorties au meme endroit.
          </p>
        </div>

        <form className="carte" onSubmit={submit}>
          <div className="actions" style={{ marginBottom: 18 }}>
            <button
              type="button"
              className={mode === "connexion" ? "primaire" : "discret"}
              onClick={() => setMode("connexion")}
            >
              Connexion
            </button>
            <button
              type="button"
              className={mode === "inscription" ? "primaire" : "discret"}
              onClick={() => setMode("inscription")}
            >
              Creer un compte
            </button>
          </div>

          {error && <div className="message erreur">{error}</div>}

          {mode === "inscription" && (
            <div className="champ">
              <label htmlFor="nom">Nom affiche</label>
              <input
                id="nom"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Camille"
                autoComplete="nickname"
              />
            </div>
          )}

          <div className="champ">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="champ">
            <label htmlFor="mdp">Mot de passe</label>
            <input
              id="mdp"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "connexion" ? "current-password" : "new-password"}
            />
            {mode === "inscription" && <p className="aide">Huit caracteres au minimum.</p>}
          </div>

          <button type="submit" className="primaire" style={{ width: "100%" }} disabled={busy}>
            {busy ? "..." : mode === "connexion" ? "Se connecter" : "Creer mon compte"}
          </button>
        </form>

        <p className="aide" style={{ textAlign: "center" }}>
          Les donnees restent sur ton serveur : rien n'est envoye ailleurs sans que tu
          connectes explicitement un service tiers.
        </p>
      </div>
    </div>
  );
}
