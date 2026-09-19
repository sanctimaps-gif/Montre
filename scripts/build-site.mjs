#!/usr/bin/env node
/**
 * Construit la version autonome de l'application et la place a la racine du
 * depot, d'ou GitHub Pages la sert.
 *
 * Deux details rendent le resultat robuste quel que soit l'hebergement :
 * les URL des ressources sont relatives (`./assets/...`), donc la page
 * fonctionne aussi bien a la racine d'un domaine que dans un sous-dossier ;
 * et le routage se fait par fragment, ce qui evite les 404 sur les liens
 * profonds puisqu'aucun serveur ne peut reecrire les URL.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "apps/web/dist");
const siteAssets = resolve(root, "assets");

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`Echec de : ${command} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

console.log("1/3  Compilation du coeur metier et des icones");
run("npm", ["run", "build", "-w", "@montre/core"]);
run("node", ["scripts/make-icons.mjs"]);

console.log("2/3  Construction de l'application en mode autonome");
run("npm", ["run", "build", "-w", "@montre/web"], {
  VITE_STANDALONE: "1",
  VITE_BASE: "./",
});

console.log("3/3  Publication a la racine du depot");
// Le dossier des ressources est reconstruit a neuf : les fichiers portent une
// empreinte dans leur nom, sans quoi les anciennes versions s'accumuleraient.
rmSync(siteAssets, { recursive: true, force: true });
mkdirSync(siteAssets, { recursive: true });

// Tout ce que produit la construction est publie : la page, les ressources,
// mais aussi le manifeste, le service worker et les icones venus de public/.
for (const entry of readdirSync(distDir, { withFileTypes: true })) {
  cpSync(resolve(distDir, entry.name), resolve(root, entry.name), {
    recursive: entry.isDirectory(),
  });
  console.log(`     ${entry.name}`);
}

// Sans ce fichier, GitHub Pages ferait passer la sortie par Jekyll, qui
// ignore les fichiers commencant par un tiret bas et n'a rien a faire ici.
writeFileSync(resolve(root, ".nojekyll"), "");

console.log("\nSite pret : index.html et assets/ a la racine du depot.");
