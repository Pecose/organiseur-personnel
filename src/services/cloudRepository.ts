/** F29 · Dépôt Firestore limité aux collections autorisées du propriétaire. */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  collection, deleteDoc, doc, documentId, getDocs, getFirestore, onSnapshot, query, setDoc, where,
} from "firebase/firestore";
import type { DocumentData } from "firebase/firestore";
import type {
  CloudCollection, CollectionRef, Result, SnapshotMeta, Unsubscribe,
} from "../domain/types";

/** M21 · Seule la session Firebase Auth courante peut adresser son espace. */
export function getUserCollection(uid: string, kind: CloudCollection): CollectionRef {
  const app = getApp("organiseur-personnel");
  const signedIn = getAuth(app).currentUser;
  if (!signedIn || !uid || signedIn.uid !== uid) {
    throw new Error("Accès refusé : aucune session du propriétaire.");
  }
  const allowed: readonly CloudCollection[] = [
    "activities", "activityCompletions", "checklists", "checklistItems",
    "carryOverDecisions", "reminders", "playlists", "tracks",
    "preferences", "pushSubscriptions",
  ];
  if (!allowed.includes(kind)) {
    throw new Error("Collection réservée au serveur.");
  }
  return collection(getFirestore(app), "users", uid, kind);
}

/** M22 · Résolution seulement après confirmation Firebase, pas au dépôt local. */
export async function putCloudRecord<T>(
  uid: string, kind: CloudCollection, id: string, data: T,
): Promise<Result<void>> {
  if (!id || id.includes("/") || data === null || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: { code: "INVALID_RECORD", message: "Document ou identifiant invalide." } };
  }
  try {
    const target = doc(getUserCollection(uid, kind), id);
    await setDoc(target, data as DocumentData);
    return { ok: true, value: undefined };
  } catch (error: unknown) {
    // N'exposer que le code standard du SDK, jamais une réponse brute
    // ni les identifiants, chemins, jetons ou données du document.
    const code = typeof error === "object" && error !== null && "code" in error
      && typeof error.code === "string" ? error.code : "";
    const failure: Readonly<Record<string, {code: string; message: string}>> = {
      "permission-denied": {
        code: "CLOUD_WRITE_PERMISSION_DENIED",
        message: "Firestore refuse cette écriture. Vérifie que les règles de sécurité du projet sont publiées pour ton compte.",
      },
      "unauthenticated": {
        code: "CLOUD_WRITE_UNAUTHENTICATED",
        message: "Session Firebase non reconnue. Déconnecte-toi puis reconnecte-toi à l'organiseur.",
      },
      "unavailable": {
        code: "CLOUD_WRITE_UNAVAILABLE",
        message: "Firestore est indisponible ou l'iPhone est hors connexion. Vérifie le réseau et réessaie.",
      },
      "failed-precondition": {
        code: "CLOUD_WRITE_PRECONDITION",
        message: "Une condition Firebase empêche l'enregistrement. Vérifie l'initialisation de Firestore.",
      },
      "resource-exhausted": {
        code: "CLOUD_WRITE_QUOTA",
        message: "Limite d'utilisation Firebase atteinte. Réessaie après vérification des quotas gratuits.",
      },
    };
    return {ok:false,error:failure[code] ?? {
      code:"CLOUD_WRITE_FAILED",
      message:"Firestore n'a pas confirmé l'écriture. Réessaie en ligne.",
    }};
  }
}

/** M23 · Certaines données doivent rester historisées via tombstone. */
export async function removeCloudRecord(
  uid: string, kind: CloudCollection, id: string,
): Promise<Result<void>> {
  if (!id || id.includes("/")) {
    return { ok: false, error: { code: "INVALID_ID", message: "Identifiant invalide." } };
  }
  if (["activities", "activityCompletions", "carryOverDecisions", "preferences",
    "dispatchReceipts"].includes(kind)) {
    return { ok: false, error: {
      code: "DELETE_REQUIRES_TOMBSTONE",
      message: "Cette donnée conserve son historique et ne peut être supprimée directement.",
    }};
  }
  try {
    await deleteDoc(doc(getUserCollection(uid, kind), id));
    return { ok: true, value: undefined };
  } catch {
    return { ok: false, error: { code: "CLOUD_DELETE_FAILED", message: "Suppression refusée ou indisponible." } };
  }
}

/** M24 · Le consommateur voit également les écritures en attente serveur. */
export function subscribeCloudRecords<T>(
  uid: string, kind: CloudCollection,
  cb: (records: T[], metadata: SnapshotMeta) => void,
): Unsubscribe {
  let lastKnownRecords: T[] = [];
  const source = getUserCollection(uid, kind);
  const reference = kind === "preferences" ? query(source, where(documentId(), "==", "profile")) : source;
  return onSnapshot(reference, { includeMetadataChanges: true },
    snapshot => {
      lastKnownRecords = snapshot.docs.map(item => item.data() as T);
      cb(lastKnownRecords, {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      });
    },
    () => {
      // Préserver la dernière vue, mais ne surtout pas prétendre à un ACK serveur.
      cb(lastKnownRecords, { fromCache: true, hasPendingWrites: true });
    });
}

/** M89 · Lecture ponctuelle, utilisable avec le cache du SDK si disponible. */
export async function fetchCloudRecords<T>(
  uid: string, kind: CloudCollection,
): Promise<Result<T[]>> {
  try {
    const source = getUserCollection(uid, kind);
    const snapshot = await getDocs(kind === "preferences"
      ? query(source, where(documentId(), "==", "profile")) : source);
    return { ok: true, value: snapshot.docs.map(item => item.data() as T) };
  } catch {
    return { ok: false, error: { code: "CLOUD_READ_FAILED", message: "Lecture indisponible ou refusée." } };
  }
}
