import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Empaquetage de l'application en application native iOS et Android.
 *
 * C'est ce qui permet a Montre de se connecter elle-meme a la montre sur
 * iPhone : une page web n'a pas acces au Bluetooth sur iOS, une application
 * installee si. Le code embarque est exactement celui du site — meme
 * interface, meme moteur de calcul — construit en mode autonome, puisque
 * l'application fonctionne sans serveur.
 */
const config: CapacitorConfig = {
  appId: "fr.montre.entrainement",
  appName: "Montre",
  webDir: "dist-app",
  // La page est servie depuis le paquet local : pas de reseau au demarrage.
  server: {
    androidScheme: "https",
  },
  ios: {
    contentInset: "always",
    backgroundColor: "#0b1016",
  },
  android: {
    backgroundColor: "#0b1016",
  },
  plugins: {
    BluetoothLe: {
      // Texte affiche par iOS lors de la demande d'autorisation Bluetooth.
      displayStrings: {
        scanning: "Recherche de la montre...",
        cancel: "Annuler",
        availableDevices: "Appareils disponibles",
        noDeviceFound: "Aucun appareil trouve",
      },
    },
  },
};

export default config;
