/** F29 · Dépôt Firestore limité aux collections autorisées du propriétaire. */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  collection, deleteDoc, doc, getDocs, getFirestore, onSnapshot, setDoc,
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
  } catch {
    return { ok: false, error: { code: "CLOUD_WRITE_FAILED", message: "Écriture refusée ou indisponible." } };
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
  return onSnapshot(getUserCollection(uid, kind), { includeMetadataChanges: true },
    snapshot => cb(snapshot.docs.map(item => item.data() as T), {
      fromCache: snapshot.metadata.fromCache,
      hasPendingWrites: snapshot.metadata.hasPendingWrites,
    }),
    () => cb([], { fromCache: true, hasPendingWrites: true }));
}

/** M89 · Lecture ponctuelle, utilisable avec le cache du SDK si disponible. */
export async function fetchCloudRecords<T>(
  uid: string, kind: CloudCollection,
): Promise<Result<T[]>> {
  try {
    const snapshot = await getDocs(getUserCollection(uid, kind));
    return { ok: true, value: snapshot.docs.map(item => item.data() as T) };
  } catch {
    return { ok: false, error: { code: "CLOUD_READ_FAILED", message: "Lecture indisponible ou refusée." } };
  }
}
