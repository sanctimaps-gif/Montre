import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
    sourcemap: true,
  },
});
