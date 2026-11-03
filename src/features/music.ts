/** F24 · Musique personnelle et playlists.
 * Les MP3 restent dans IndexedDB O10, Firestore ne reçoit que O08/O09.
 * Aucun son n'est joué ou publié par ce module. D23 : non testé.
 */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { fetchCloudRecords, putCloudRecord } from "../services/cloudRepository";
import { storeMedia } from "../storage/mediaDb";
import { loadBundledCatalog } from "../storage/catalog";
import type { Playlist, Result, TrackMetadata } from "../domain/types";

/** M54 · Persister uniquement les métadonnées, jamais le Blob du morceau. */
export async function saveTrackMetadata(track: TrackMetadata): Promise<Result<void>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return {ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connexion requise pour sauvegarder la musique.",
    }};
    if (!track || !track.id || track.id.includes("/")
      || typeof track.title !== "string" || !track.title.trim() || track.title.length > 300
      || (track.source !== "imported" && track.source !== "bundled")
      || typeof track.favorite !== "boolean"
      || !Number.isFinite(Date.parse(track.updatedAt))
      || (track.duration !== undefined && (!Number.isFinite(track.duration) || track.duration < 0))) {
      return {ok: false, error: {
        code: "INVALID_TRACK", message: "Métadonnées musicales incorrectes.",
      }};
    }
    // Liste blanche de champs légers : un objet mal formé ne peut pas envoyer un Blob.
    const clean: TrackMetadata = {
      id: track.id, title: track.title.trim(), source: track.source,
      favorite: track.favorite, updatedAt: track.updatedAt,
      ...(track.artist !== undefined ? {artist: track.artist} : {}),
      ...(track.album !== undefined ? {album: track.album} : {}),
      ...(track.catalogId !== undefined ? {catalogId: track.catalogId} : {}),
      ...(track.mediaId !== undefined ? {mediaId: track.mediaId} : {}),
      ...(track.artworkId !== undefined ? {artworkId: track.artworkId} : {}),
      ...(track.duration !== undefined ? {duration: track.duration} : {}),
    };
    return await putCloudRecord(user.uid, "tracks", clean.id, clean);
  } catch {
    return {ok: false, error: {
      code: "SAVE_TRACK_FAILED", message: "Sauvegarde des métadonnées indisponible.",
    }};
  }
}

/** M52 · Importe un fichier personnel et crée une référence audio légère. */
export async function importAudio(
  file: File, metadata: Partial<TrackMetadata>,
): Promise<Result<TrackMetadata>> {
  if (!file || !metadata || typeof metadata !== "object") return {ok: false, error: {
    code: "INVALID_AUDIO", message: "Fichier ou informations musicales invalides.",
  }};
  const local = await storeMedia(file, "audio");
  if (!local.ok) return local;
  const title = typeof metadata.title === "string" && metadata.title.trim()
    ? metadata.title.trim() : file.name.replace(/\.[^/.]+$/, "").trim();
  if (!title || title.length > 300) return {ok: false, error: {
    code: "INVALID_TRACK", message: "Le titre musical est invalide.",
  }};
  const track: TrackMetadata = {
    id: crypto.randomUUID(), title, source: "imported", mediaId: local.value.id,
    favorite: metadata.favorite === true, updatedAt: new Date().toISOString(),
    ...(typeof metadata.artist === "string" ? {artist: metadata.artist} : {}),
    ...(typeof metadata.album === "string" ? {album: metadata.album} : {}),
    ...(typeof metadata.artworkId === "string" ? {artworkId: metadata.artworkId} : {}),
  };
  const saved = await saveTrackMetadata(track);
  if (!saved.ok) return saved;
  return {ok: true, value: track};
}

/** M53 · Combiner le catalogue public et les références personnelles cloud. */
export async function listTracks(query?: string): Promise<Result<TrackMetadata[]>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return {ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connexion requise pour consulter les morceaux.",
    }};
    const cloud = await fetchCloudRecords<TrackMetadata>(user.uid, "tracks");
    if (!cloud.ok) return cloud;
    const bundled = await loadBundledCatalog();
    if (!bundled.ok) return bundled;
    const all = new Map<string, TrackMetadata>();
    for (const entry of bundled.value.filter(item => item.kind === "audio")) {
      all.set(entry.id, {
        id: entry.id, catalogId: entry.id, source: "bundled",
        title: entry.title, favorite: false, updatedAt: "1970-01-01T00:00:00.000Z",
      });
    }
    for (const track of cloud.value) all.set(track.id, track);
    const q = typeof query === "string" ? query.trim().toLocaleLowerCase("fr") : "";
    const filtered = [...all.values()].filter(track =>
      !q || [track.title, track.artist ?? "", track.album ?? ""]
        .some(value => value.toLocaleLowerCase("fr").includes(q)));
    filtered.sort((a, b) => a.title.localeCompare(b.title, "fr")
      || a.id.localeCompare(b.id));
    return {ok: true, value: filtered};
  } catch {
    return {ok: false, error: {
      code: "TRACKS_UNAVAILABLE", message: "Catalogue musical indisponible.",
    }};
  }
}

/** M55 · Playlist composée d'identifiants, non de fichiers audio. */
export async function savePlaylist(playlist: Playlist): Promise<Result<void>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return {ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connexion requise pour les playlists.",
    }};
    if (!playlist || !playlist.id || playlist.id.includes("/")
      || !playlist.name?.trim() || playlist.name.length > 250
      || !Array.isArray(playlist.trackIds)
      || playlist.trackIds.some(id => typeof id !== "string" || !id || id.includes("/"))
      || new Set(playlist.trackIds).size !== playlist.trackIds.length) {
      return {ok: false, error: {
        code: "INVALID_PLAYLIST", message: "Nom ou références musicales invalides.",
      }};
    }
    const clean: Playlist = {
      id: playlist.id, name: playlist.name.trim(),
      trackIds: [...playlist.trackIds], updatedAt: new Date().toISOString(),
    };
    return await putCloudRecord(user.uid, "playlists", clean.id, clean);
  } catch {
    return {ok: false, error: {
      code: "SAVE_PLAYLIST_FAILED", message: "Enregistrement de playlist indisponible.",
    }};
  }
}

/** M56 · Listes de lecture du compte, sans accès aux fichiers privés. */
export async function listPlaylists(): Promise<Result<Playlist[]>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return {ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connexion requise pour les playlists.",
    }};
    const data = await fetchCloudRecords<Playlist>(user.uid, "playlists");
    if (!data.ok) return data;
    return {ok: true, value: data.value.sort((a, b) =>
      a.name.localeCompare(b.name, "fr") || a.id.localeCompare(b.id))};
  } catch {
    return {ok: false, error: {
      code: "PLAYLISTS_UNAVAILABLE", message: "Lecture des playlists indisponible.",
    }};
  }
}

/** M57 · Favori synchronisé comme métadonnée, pas comme fichier audio. */
export async function setTrackFavorite(
  trackId: string, favorite: boolean,
): Promise<Result<void>> {
  if (!trackId || trackId.includes("/") || typeof favorite !== "boolean") {
    return {ok: false, error: {
      code: "INVALID_TRACK", message: "Morceau ou choix de favori invalide.",
    }};
  }
  const loaded = await listTracks();
  if (!loaded.ok) return loaded;
  const original = loaded.value.find(track => track.id === trackId);
  if (!original) return {ok: false, error: {
    code: "TRACK_NOT_FOUND", message: "Morceau absent du catalogue.",
  }};
  return await saveTrackMetadata({
    ...original, favorite, updatedAt: new Date().toISOString(),
  });
}
