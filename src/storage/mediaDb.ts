/** F31 / M46 · Stockage local des médias. Les blobs ne quittent pas l'iPhone.
 * Prépare les stores prévus au registre, sans importer de bibliothèque.
 * M47–M49 (CRUD médias) seront implémentés dans la strate S6.
 */
import type { MediaDb, Result } from "../domain/types";

export function openMediaDb(): Promise<Result<MediaDb>> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve({ok: false, error: {
        code: "INDEXEDDB_UNAVAILABLE",
        message: "Le stockage local n'est pas disponible dans ce navigateur.",
      }});
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open("organiseur-personnel-media", 1);
    } catch {
      resolve({ok: false, error: {
        code: "INDEXEDDB_OPEN_FAILED",
        message: "Impossible d'ouvrir la base locale de médias.",
      }});
      return;
    }

    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("mediaBlobs")) {
        db.createObjectStore("mediaBlobs", {keyPath: "id"});
      }
      if (!db.objectStoreNames.contains("imageMetadata")) {
        db.createObjectStore("imageMetadata", {keyPath: "id"});
      }
      if (!db.objectStoreNames.contains("playbackState")) {
        db.createObjectStore("playbackState");
      }
      if (!db.objectStoreNames.contains("localMeta")) {
        db.createObjectStore("localMeta");
      }
    };
    request.onblocked = () => {
      blocked = true;
      resolve({ok: false, error: {
        code: "INDEXEDDB_BLOCKED",
        message: "Une autre version de l'application empêche la migration des médias.",
      }});
    };
    request.onerror = () => {
      resolve({ok: false, error: {
        code: "INDEXEDDB_OPEN_FAILED",
        message: "Le stockage local des médias ne peut pas être ouvert.",
      }});
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      // Ne jamais effacer un store lors de la réouverture de l'application.
      resolve({ok: true, value: request.result});
    };
  });
}
