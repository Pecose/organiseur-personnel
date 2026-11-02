/** F14 · Entrée Vite minimale pour S5.
 * N'installe pas d'écran métier et n'active pas le cache personnel sans accord.
 * M01 attend F15/F19 (routes et interfaces), prévus dans la strate S7.
 */
import { initFirebase } from "./services/firebase";
import type { PublicFirebaseConfig } from "./domain/types";

// Ces valeurs sont une configuration publique du projet Firebase Web,
// PAS des secrets. Si elles manquent, aucune connexion n'est tentée.
const configuration: PublicFirebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? undefined,
};
const status = document.querySelector<HTMLElement>("[data-firebase-status]");
if (configuration.apiKey && configuration.authDomain && configuration.projectId && configuration.appId) {
  const initialized = initFirebase(configuration);
  if (status) {
    status.textContent = initialized.ok
      ? "SDK Firebase configuré. Les formulaires et la synchronisation arrivent dans une prochaine étape."
      : "Connexion Firebase non disponible. Vérifie la configuration publique du projet.";
  }
} else if (status) {
  status.textContent = "Firebase n'est pas encore configuré sur ce site. Aucune connexion n'a été tentée.";
}
