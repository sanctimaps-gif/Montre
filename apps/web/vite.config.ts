import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // La version autonome est servie depuis un sous-chemin (GitHub Pages) :
  // les URL des ressources doivent en tenir compte.
  base: process.env["VITE_BASE"] ?? "/",
  server: {
    port: 5173,
    // L'API tourne sur un autre port : le proxy evite toute question de CORS
    // en developpement et garde les memes URL relatives qu'en production.
    proxy: {
      "/api": {
        target: process.env["API_URL"] ?? "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    // La version publiee est versionnee dans le depot : pas de carte de
    // sources d'un megaoctet a y faire entrer.
    sourcemap: process.env["VITE_STANDALONE"] !== "1",
  },
});
