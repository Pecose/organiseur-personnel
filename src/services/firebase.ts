/** F27 · Firebase SDK Web modulaire. Ne contient aucune clé privée. */
import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import type { FirebaseClients, PublicFirebaseConfig, Result } from "../domain/types";

/** M16 : initialisation unique, configuration publique fournie par l'appelant. */
export function initFirebase(config: PublicFirebaseConfig): Result<FirebaseClients> {
  if (!config || typeof config.apiKey !== "string" || !config.apiKey.trim()
    || typeof config.authDomain !== "string" || !config.authDomain.trim()
    || typeof config.projectId !== "string" || !config.projectId.trim()
    || typeof config.appId !== "string" || !config.appId.trim()) {
    return { ok: false, error: {
      code: "FIREBASE_CONFIG_REQUIRED",
      message: "Configuration publique Firebase incomplète. Aucune connexion tentée.",
    }};
  }

  try {
    const app = getApps().find(existing => existing.name === "organiseur-personnel")
      ?? initializeApp(config, "organiseur-personnel");
    if (app.options.projectId !== config.projectId
      || app.options.appId !== config.appId) {
      return { ok: false, error: {
        code: "FIREBASE_CONFIG_MISMATCH",
        message: "Une autre configuration Firebase est déjà active.",
      }};
    }
    return { ok: true, value: { app, auth: getAuth(app) } };
  } catch {
    return { ok: false, error: {
      code: "FIREBASE_INIT_FAILED",
      message: "Initialisation du SDK Firebase impossible.",
    }};
  }
}
