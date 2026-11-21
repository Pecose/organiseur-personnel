/** F31 / M46 · Stockage local des médias. Les blobs ne quittent pas l'iPhone.
 * Prépare les stores prévus au registre, sans importer de bibliothèque.
 * Les anciens fichiers dépourvus de marqueur ne sont pas effacés par M49.
 */
import { doc, getDocFromServer, getDocsFromServer } from "firebase/firestore";
import { getAppState } from "../app/state";
import { getUserCollection } from "../services/cloudRepository";
import type { ImageMetadata, LocalMediaBlob, MediaDb, Result } from "../domain/types";

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

/** M47 · Import de média personnel dans IndexedDB, jamais Firestore.
 * Audio : 80 Mio max, image : 20 Mio max. Le SHA-256 sert au contrôle
 * de restauration et ne quitte pas l'appareil avec le fichier.
 */
export async function storeMedia(
  file: File, kind: "audio" | "image",
): Promise<Result<LocalMediaBlob>> {
  const owner = getAppState().user?.uid;
  if (!(file instanceof Blob) || !Number.isSafeInteger(file.size) || file.size < 1
    || (kind !== "audio" && kind !== "image")) {
    return {ok: false, error: {
      code: "INVALID_MEDIA", message: "Fichier média invalide ou vide.",
    }};
  }
  const maxSize = kind === "audio" ? 80 * 1024 * 1024 : 20 * 1024 * 1024;
  if (file.size > maxSize) return {ok: false, error: {
    code: "MEDIA_TOO_LARGE", message: "Le fichier dépasse la taille maximale locale.",
  }};
  const format = file.type.toLowerCase();
  if (kind === "audio" && !["audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a",
    "audio/wav", "audio/x-wav", "audio/ogg", "audio/aac"].includes(format)
    || kind === "image" && !["image/jpeg", "image/png", "image/webp", "image/heic",
      "image/heif", "image/gif"].includes(format)) {
    return {ok: false, error: {
      code: "UNSUPPORTED_MEDIA_TYPE", message: "Format de média non pris en charge.",
    }};
  }
  if (typeof crypto === "undefined" || !crypto.subtle || !crypto.randomUUID) {
    return {ok: false, error: {
      code: "CRYPTO_UNAVAILABLE", message: "Vérification de fichier indisponible.",
    }};
  }
  const opened = await openMediaDb();
  if (!opened.ok) return opened;
  const db = opened.value;
  try {
    const checksumBytes = new Uint8Array(await crypto.subtle.digest(
      "SHA-256", await file.arrayBuffer(),
    ));
    const checksum = Array.from(checksumBytes)
      .map(value => value.toString(16).padStart(2, "0")).join("");
    const media: LocalMediaBlob = {
      id: crypto.randomUUID(), kind, blob: file,
      mimeType: format, byteSize: file.size, checksum,
      importedAt: new Date().toISOString(),
    };
    return await new Promise<Result<LocalMediaBlob>>(resolve => {
      const tx = db.transaction(["mediaBlobs", "localMeta"], "readwrite");
      tx.objectStore("mediaBlobs").add(media);
      if (owner && getAppState().user?.uid === owner) {
        tx.objectStore("localMeta").add(owner, "media-owner:" + media.id);
      }
      tx.oncomplete = () => resolve({ok: true, value: media});
      tx.onerror = () => resolve({ok: false, error: {
        code: "MEDIA_STORAGE_FAILED", message: "Impossible de sauvegarder le fichier localement.",
      }});
      tx.onabort = () => resolve({ok: false, error: {
        code: "MEDIA_STORAGE_FAILED", message: "Enregistrement local interrompu.",
      }});
    });
  } catch {
    return {ok: false, error: {
      code: "MEDIA_IMPORT_FAILED", message: "Lecture ou enregistrement du média impossible.",
    }};
  } finally {
    db.close();
  }
}

/** M48 · Lire un Blob local ; aucun téléchargement et aucune API réseau. */
export async function readMedia(mediaId: string): Promise<Result<Blob>> {
  if (!mediaId || mediaId.includes("/")) return {ok: false, error: {
    code: "INVALID_MEDIA_ID", message: "Identifiant de média invalide.",
  }};
  const opened = await openMediaDb();
  if (!opened.ok) return opened;
  const db = opened.value;
  try {
    return await new Promise<Result<Blob>>(resolve => {
      const tx = db.transaction("mediaBlobs", "readonly");
      const req = tx.objectStore("mediaBlobs").get(mediaId);
      req.onsuccess = () => {
        const record = req.result as LocalMediaBlob | undefined;
        if (!record || !(record.blob instanceof Blob)) {
          resolve({ok: false, error: {
            code: "MEDIA_NOT_FOUND", message: "Média introuvable, réimport nécessaire.",
          }});
        } else resolve({ok: true, value: record.blob});
      };
      req.onerror = () => resolve({ok: false, error: {
        code: "MEDIA_READ_FAILED", message: "Lecture du fichier local impossible.",
      }});
      tx.onabort = () => resolve({ok: false, error: {
        code: "MEDIA_READ_FAILED", message: "Lecture du fichier local interrompue.",
      }});
    });
  } catch {
    return {ok: false, error: {
      code: "MEDIA_READ_FAILED", message: "Stockage local indisponible.",
    }};
  } finally {
    db.close();
  }
}

/** M49/D27 · Effacer sur cet appareil après lecture serveur et contrôle local. */
export async function removeMedia(mediaId: string): Promise<Result<void>> {
  const uid = getAppState().user?.uid;
  const protectedMedia: Result<void> = {ok: false, error: {
    code: "MEDIA_DELETE_UNVERIFIED",
    message: "Le fichier est conservé. Sa propriété ou l’absence de références n’a pas pu être confirmée.",
  }};
  if (!uid || !mediaId || mediaId.includes("/")) return protectedMedia;
  try {
    const [tracks, activities, preferences] = await Promise.all([
      getDocsFromServer(getUserCollection(uid, "tracks")),
      getDocsFromServer(getUserCollection(uid, "activities")),
      getDocFromServer(doc(getUserCollection(uid, "preferences"), "profile")),
    ]);
    if ([tracks, activities, preferences].some(snapshot =>
      snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites)
      || getAppState().user?.uid !== uid) return protectedMedia;
    if (tracks.docs.some(track => track.data().mediaId === mediaId || track.data().artworkId === mediaId)) {
      return protectedMedia;
    }
    const references = new Set([
      preferences.data()?.backgroundImageId,
      ...activities.docs.map(activity => activity.data().imageId),
      ...tracks.docs.map(track => track.data().artworkId),
    ]);
    if (references.has(mediaId)) return protectedMedia;

    const opened = await openMediaDb();
    if (!opened.ok) return opened;
    const db = opened.value;
    try {
      return await new Promise<Result<void>>(resolve => {
        const tx = db.transaction(["mediaBlobs", "localMeta", "imageMetadata"], "readwrite");
        const metadata = tx.objectStore("localMeta");
        const media = tx.objectStore("mediaBlobs");
        const gallery = tx.objectStore("imageMetadata");
        const ownerKey = "media-owner:" + mediaId;
        const owner = metadata.get(ownerKey);
        const blob = media.get(mediaId);
        const images = gallery.getAll();
        let allowed = false;
        images.onsuccess = () => {
          const record = blob.result as LocalMediaBlob | undefined;
          const linked = (images.result as ImageMetadata[]).filter(image => image.mediaId === mediaId);
          if (!record || owner.result !== uid || getAppState().user?.uid !== uid
            || linked.length > 1 || linked.some(image =>
              image.source !== "imported" || references.has(image.id))
            || (record.kind === "audio" && linked.length > 0)) return;
          if (linked.length === 1) gallery.delete(linked[0].id);
          media.delete(mediaId);
          metadata.delete(ownerKey);
          allowed = true;
        };
        tx.oncomplete = () => resolve(allowed ? {ok: true, value: undefined} : protectedMedia);
        tx.onabort = () => resolve(protectedMedia);
      });
    } finally {
      db.close();
    }
  } catch {
    return protectedMedia;
  }
}
