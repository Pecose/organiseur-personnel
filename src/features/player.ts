/** F25 · Lecteur de médias autorisés uniquement, sans téléversement audio.
 * M58–M63 / M99. Écoute en arrière-plan sur iPhone non garantie avant recette.
 */
import { listTracks } from "./music";
import { readMedia } from "../storage/mediaDb";
import { resolveCatalogAsset } from "../storage/catalog";
import type { PlaybackState, Result } from "../domain/types";

const playback: PlaybackState = {
  queueIds: [], position: 0, paused: true, repeatMode: "normal", shuffle: false,
};
const audio = new Audio();
audio.preload = "metadata";
let objectUrl: string | undefined;
audio.onended = () => {
  if (playback.repeatMode === "normal") void nextTrack();
};

/** M99 · Mettre des identifiants en file, jamais des blobs ou URLs réseau libres. */
export function setPlaybackQueue(trackIds: string[]): Result<void> {
  if (!Array.isArray(trackIds) || trackIds.length > 1000
    || trackIds.some(id => typeof id !== "string" || !id || id.includes("/"))) {
    return {ok: false, error: {
      code: "INVALID_QUEUE", message: "File de lecture invalide.",
    }};
  }
  playback.queueIds = [...trackIds];
  playback.position = playback.trackId
    ? Math.max(0, playback.queueIds.indexOf(playback.trackId)) : 0;
  return {ok: true, value: undefined};
}

/** M58 · Créer une URL temporaire uniquement pour un Blob de cet appareil. */
export async function playTrack(trackId: string): Promise<Result<void>> {
  if (!trackId || trackId.includes("/")) {
    return {ok: false, error: {
      code: "INVALID_TRACK", message: "Identifiant de morceau invalide.",
    }};
  }
  const listing = await listTracks();
  if (!listing.ok) return listing;
  const track = listing.value.find(item => item.id === trackId);
  if (!track) return {ok: false, error: {
    code: "TRACK_NOT_FOUND", message: "Morceau inconnu.",
  }};
  let source: string | undefined;
  let temporary: string | undefined;
  if (track.source === "imported" && track.mediaId) {
    const media = await readMedia(track.mediaId);
    if (!media.ok) return media;
    temporary = URL.createObjectURL(media.value);
    source = temporary;
  } else if (track.source === "bundled" && track.catalogId) {
    const available = resolveCatalogAsset(track.catalogId);
    if (!available.ok) return available;
    source = available.value;
  }
  if (!source) return {ok: false, error: {
    code: "MEDIA_MISSING", message: "Fichier absent sur cet appareil. Réimporte-le pour l'écouter.",
  }};
  audio.pause();
  const previous = objectUrl;
  objectUrl = temporary;
  audio.src = source;
  if (previous) URL.revokeObjectURL(previous);
  audio.loop = playback.repeatMode === "repeat";
  try {
    await audio.play();
    playback.trackId = trackId;
    playback.paused = false;
    const inQueue = playback.queueIds.indexOf(trackId);
    if (inQueue !== -1) playback.position = inQueue;
    return {ok: true, value: undefined};
  } catch {
    audio.pause();
    playback.paused = true;
    return {ok: false, error: {
      code: "AUDIO_NOT_ALLOWED",
      message: "La lecture audio n'a pas démarré. Réessaie en touchant Lire.",
    }};
  }
}

/** M59 · Garder la position courante et le fichier local. */
export function pausePlayback(): void {
  audio.pause();
  playback.paused = true;
}

/** M60 · Déplacement borné en secondes sur la piste chargée. */
export function seekPlayback(seconds: number): Result<void> {
  if (!Number.isFinite(seconds) || seconds < 0
    || !Number.isFinite(audio.duration) || seconds > audio.duration) {
    return {ok: false, error: {
      code: "INVALID_SEEK", message: "Position de lecture invalide.",
    }};
  }
  audio.currentTime = seconds;
  return {ok: true, value: undefined};
}

/** M61 · Avancer dans la file si une piste existe. */
export async function nextTrack(): Promise<Result<void>> {
  if (!playback.queueIds.length) return {ok: false, error: {
    code: "EMPTY_QUEUE", message: "La liste de lecture est vide.",
  }};
  const next = playback.shuffle
    ? Math.floor(Math.random() * playback.queueIds.length)
    : (playback.position + 1) % playback.queueIds.length;
  const result = await playTrack(playback.queueIds[next]);
  if (result.ok) playback.position = next;
  return result;
}

/** M62 · Revenir à la piste précédente de la file. */
export async function previousTrack(): Promise<Result<void>> {
  if (!playback.queueIds.length) return {ok: false, error: {
    code: "EMPTY_QUEUE", message: "La liste de lecture est vide.",
  }};
  const previous = (playback.position - 1 + playback.queueIds.length)
    % playback.queueIds.length;
  const result = await playTrack(playback.queueIds[previous]);
  if (result.ok) playback.position = previous;
  return result;
}

/** M63 · Mode local du lecteur, sans permissions audio supplémentaires. */
export function setPlaybackMode(mode: "normal" | "repeat" | "shuffle"): void {
  playback.repeatMode = mode === "repeat" ? "repeat" : "normal";
  playback.shuffle = mode === "shuffle";
  audio.loop = playback.repeatMode === "repeat";
}
