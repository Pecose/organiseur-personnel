/** F30 · Cache Firestore conscient du consentement, statut de synchronisation fiable. */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore, memoryLocalCache, persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { subscribeCloudRecords } from "./cloudRepository";
import type { Connectivity, Result, SnapshotMeta, SyncStatus, Unsubscribe } from "../domain/types";

let persistenceConfigured = false;

/**
 * M25 · Consentement explicite requis pour le cache persistant sur appareil de confiance.
 * En cas de refus, le SDK garde seulement un cache mémoire pour la session active.
 * Appel uniquement après initialisation M16 et à partir d'une interaction utilisateur.
 */
export async function configurePersistence(): Promise<Result<void>> {
  if (persistenceConfigured) return { ok: true, value: undefined };
  try {
    const app = getApp("organiseur-personnel");
    if (typeof window === "undefined" || typeof window.confirm !== "function") {
      return { ok: false, error: {
        code: "PERSISTENCE_BROWSER_ONLY", message: "La persistance nécessite un navigateur.",
      }};
    }
    const trusted = window.confirm(
      "Cet iPhone est-il un appareil personnel de confiance ?\n" +
      "Si oui, les activités pourront être conservées hors ligne, même après fermeture. " +
      "Sur un appareil partagé, choisis Annuler pour éviter ce stockage durable.",
    );
    initializeFirestore(app, {
      localCache: trusted
        ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        : memoryLocalCache(),
    });
    persistenceConfigured = true;
    return { ok: true, value: undefined };
  } catch {
    return { ok: false, error: {
      code: "PERSISTENCE_INIT_FAILED",
      message: "Impossible de configurer le cache Firestore. Ne suppose pas que le mode hors ligne fonctionne.",
    }};
  }
}

/** M26 · Seul un snapshot serveur sans écriture en attente signifie « synced ». */
export function deriveSyncStatus(meta: SnapshotMeta, connectivity: Connectivity): SyncStatus {
  if (meta.hasPendingWrites) return { state: "pending", pendingCount: 1 };
  if (!connectivity.online || meta.fromCache) return { state: "local", pendingCount: 0 };
  return { state: "synced", pendingCount: 0 };
}

/** M27 · Combine les métadonnées du SDK et l'état réseau apparent. */
export function observeSyncStatus(cb: (s: SyncStatus) => void): Unsubscribe {
  const user = getAuth(getApp("organiseur-personnel")).currentUser;
  if (!user) {
    cb({ state: "local", pendingCount: 0, message: "Non connecté." });
    return () => undefined;
  }
  let latest: SnapshotMeta = { fromCache: true, hasPendingWrites: false };
  const send = () => cb(deriveSyncStatus(latest, {
    online: typeof navigator !== "undefined" && navigator.onLine !== false,
  }));
  const unsubscribe = subscribeCloudRecords<unknown>(user.uid, "activities", (_records, meta) => {
    latest = meta;
    send();
  });
  if (typeof window !== "undefined") {
    window.addEventListener("online", send);
    window.addEventListener("offline", send);
  }
  send();
  return () => {
    unsubscribe();
    if (typeof window !== "undefined") {
      window.removeEventListener("online", send);
      window.removeEventListener("offline", send);
    }
  };
}
