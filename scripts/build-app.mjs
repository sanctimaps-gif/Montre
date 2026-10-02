#!/usr/bin/env node
/**
 * Prepare l'application native, pour iOS ou pour Android.
 *
 *   node scripts/build-app.mjs ios
 *   node scripts/build-app.mjs android
 *
 * Le script fait tout ce qui peut l'etre en ligne de commande : construction
 * du front en mode autonome — l'application embarquee n'a pas de serveur —,
 * creation du projet natif s'il n'existe pas, declaration des autorisations
 * Bluetooth, puis synchronisation. Il ne reste qu'a ouvrir le projet dans
 * Xcode ou Android Studio et a appuyer sur « Run ».
 *
 * Les autorisations sont posees ici plutot que laissees a l'utilisateur : une
 * application iOS qui demande le Bluetooth sans texte d'explication est
 * fermee par le systeme au moment ou elle en a besoin, sans message utile.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = resolve(root, "apps/web");

const platform = process.argv[2];
if (platform !== "ios" && platform !== "android") {
  console.error("Usage : node scripts/build-app.mjs <ios|android>");
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: "inherit",
    env: { ...process.env, ...options.env },
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`\nEchec de : ${command} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

console.log("1/4  Compilation du coeur metier et des icones");
run("npm", ["run", "build", "-w", "@montre/core"]);
run("node", ["scripts/make-icons.mjs"]);

console.log("\n2/4  Construction de l'application en mode autonome");
// Chemins relatifs : la page est servie depuis le paquet, pas depuis un
// domaine. Mode autonome : l'application embarquee n'a pas de serveur.
run("npm", ["run", "build", "-w", "@montre/web"], {
  env: { VITE_STANDALONE: "1", VITE_BASE: "./", VITE_OUT_DIR: "dist-app" },
});

const platformDir = resolve(webDir, platform);
if (!existsSync(platformDir)) {
  console.log(`\n3/4  Creation du projet ${platform}`);
  run("npx", ["cap", "add", platform], { cwd: webDir });
} else {
  console.log(`\n3/4  Projet ${platform} deja present`);
}

console.log("\n    Declaration des autorisations Bluetooth");
if (platform === "ios") declareIosPermissions(platformDir);
else declareAndroidPermissions(platformDir);

console.log("\n4/4  Synchronisation du projet natif");
run("npx", ["cap", "sync", platform], { cwd: webDir });

console.log(
  platform === "ios"
    ? "\nProjet pret. Ouvre-le dans Xcode :\n" +
        "  npx cap open ios   (depuis apps/web, sur un Mac)\n" +
        "Puis choisis ton iPhone comme cible et appuie sur Run.\n"
    : "\nProjet pret. Ouvre-le dans Android Studio :\n" +
        "  npx cap open android   (depuis apps/web)\n" +
        "Puis branche ton telephone et appuie sur Run.\n",
);

/**
 * iOS exige un texte d'explication pour chaque acces sensible. Sans
 * NSBluetoothAlwaysUsageDescription, le systeme ferme l'application a la
 * premiere demande de Bluetooth.
 */
function declareIosPermissions(dir) {
  const plist = resolve(dir, "App/App/Info.plist");
  if (!existsSync(plist)) {
    console.warn(`    Info.plist introuvable (${plist}) : autorisations a poser a la main.`);
    return;
  }

  let content = readFileSync(plist, "utf8");
  const entries = {
    NSBluetoothAlwaysUsageDescription:
      "Montre utilise le Bluetooth pour se connecter a ta montre de sport et lire ta frequence cardiaque, ta cadence et son niveau de batterie pendant tes seances.",
    NSBluetoothPeripheralUsageDescription:
      "Montre utilise le Bluetooth pour se connecter a ta montre de sport pendant tes seances.",
    NSLocationWhenInUseUsageDescription:
      "Montre utilise ta position pour enregistrer le trace, la distance et le denivele de tes seances.",
  };

  let added = 0;
  for (const [key, description] of Object.entries(entries)) {
    if (content.includes(`<key>${key}</key>`)) continue;
    // Insertion juste avant la fermeture du dictionnaire principal.
    content = content.replace(
      /\n<\/dict>\n<\/plist>/,
      `\n\t<key>${key}</key>\n\t<string>${description}</string>\n</dict>\n</plist>`,
    );
    added++;
  }

  if (added > 0) writeFileSync(plist, content);
  console.log(`    ${added} autorisation(s) ajoutee(s) a Info.plist`);
}

/**
 * Android demande des permissions declarees dans le manifeste. Depuis
 * Android 12, BLUETOOTH_SCAN et BLUETOOTH_CONNECT remplacent les anciennes,
 * et « neverForLocation » evite d'avoir a demander la position pour scanner.
 */
function declareAndroidPermissions(dir) {
  const manifest = resolve(dir, "app/src/main/AndroidManifest.xml");
  if (!existsSync(manifest)) {
    console.warn(`    Manifeste introuvable (${manifest}) : autorisations a poser a la main.`);
    return;
  }

  let content = readFileSync(manifest, "utf8");
  const permissions = [
    '<uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />',
    '<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />',
    '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
    '<uses-feature android:name="android.hardware.bluetooth_le" android:required="true" />',
  ];

  const missing = permissions.filter((line) => !content.includes(attributeName(line)));
  if (missing.length > 0) {
    content = content.replace("</manifest>", `    ${missing.join("\n    ")}\n</manifest>`);
    writeFileSync(manifest, content);
  }
  console.log(`    ${missing.length} autorisation(s) ajoutee(s) au manifeste`);
}

/** Extrait le nom d'une permission, pour savoir si elle est deja declaree. */
function attributeName(line) {
  return /android:name="([^"]+)"/.exec(line)?.[1] ?? line;
}
