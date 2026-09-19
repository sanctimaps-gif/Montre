import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { App } from "./App.tsx";
import { STANDALONE } from "./api.ts";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Element racine introuvable");

/**
 * Sur un hebergement statique, aucun serveur ne peut renvoyer l'application
 * pour une URL profonde : le routage par fragment garantit qu'un lien partage
 * ou un rechargement de page fonctionne toujours.
 */
const Router = STANDALONE ? HashRouter : BrowserRouter;

createRoot(container).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
);

/**
 * Le service worker n'a de sens que pour la version autonome, installable et
 * utilisable hors ligne. En developpement, il masquerait les modifications
 * derriere son cache.
 */
if (STANDALONE && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // Le chemin est relatif : l'application peut vivre dans un sous-dossier.
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Hors contexte securise ou refuse par l'utilisateur : sans consequence.
    });
  });
}
