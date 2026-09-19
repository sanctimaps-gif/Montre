import { useState } from "react";
import { STANDALONE, api } from "../api.ts";

/**
 * Chargement des seances de demonstration, propose uniquement en mode autonome
 * et uniquement quand il n'y a aucune activite : l'application s'ouvre vide, et
 * ce bouton permet de voir immediatement ce qu'elle affiche avec de l'historique.
 */
export function DemoData({ onLoaded }: { onLoaded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!STANDALONE || !api.loadDemoData) return null;

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.loadDemoData!();
      onLoaded();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ textAlign: "center", marginTop: 8 }}>
      {error && <div className="message erreur">{error}</div>}
      <button className="primaire" onClick={load} disabled={busy}>
        {busy ? "Generation..." : "Charger cinq semaines de demonstration"}
      </button>
      <p className="aide" style={{ marginTop: 8 }}>
        Seances generees, clairement marquees comme telles. Tu peux les supprimer a tout
        moment depuis les reglages.
      </p>
    </div>
  );
}
