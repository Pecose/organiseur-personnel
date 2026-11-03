/**
 * F26 · M67 (saisons), M64/M65/M95 (images personnelles locales).
 * Les opérations sensibles non testées restent réservées à la recette D23.
 */
import { openMediaDb, storeMedia } from "../storage/mediaDb";
import { loadBundledCatalog } from "../storage/catalog";
import type { ImageMetadata, Result, Season } from "../domain/types";

/**
 * M67 — Saison météorologique de l'hémisphère Nord :
 * printemps mars–mai, été juin–août, automne septembre–novembre,
 * hiver décembre–février. Une date civile YYYY-MM-DD est locale ;
 * un instant ISO est converti dans timeZone.
 */
export function resolveSeason(date: string, timeZone: string): Season {
  // Valide aussi le fuseau quand on reçoit une simple date civile.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "numeric",
    calendar: "gregory",
    numberingSystem: "latn",
  });

  let month: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parsed = new Date(date + "T00:00:00.000Z");
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new RangeError("Date civile invalide.");
    }
    month = parsed.getUTCMonth() + 1;
  } else {
    // Interdire un texte local ambigu, qui dépendrait du fuseau du navigateur.
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(date)) {
      throw new RangeError("Instant ISO avec décalage explicite attendu.");
    }
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) throw new RangeError("Instant invalide.");
    month = Number(formatter.formatToParts(parsed).find((part) => part.type === "month")?.value);
  }
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

/** M64 · Importer une image personnelle en local, avec réduction facultative.
 * Aucune image n'est envoyée vers Firestore ni publiée dans le dépôt.
 */
export async function importImage(file: File): Promise<Result<ImageMetadata>> {
  if (!(file instanceof Blob) || !file.size || !file.name) return {ok: false, error: {
    code: "INVALID_IMAGE", message: "Fichier image manquant.",
  }};
  let image = file;
  try {
    // Préserver les animations GIF. Redimensionnement seulement si le navigateur
    // dispose d'un décodeur et d'un canevas ; en cas d'échec, garder l'original.
    if (file.type !== "image/gif" && typeof createImageBitmap === "function"
      && typeof document !== "undefined") {
      const bitmap = await createImageBitmap(file);
      try {
        const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
        if (scale < 1 || file.size > 6 * 1024 * 1024) {
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const outputType = file.type === "image/png" || file.type === "image/webp"
              ? "image/webp" : "image/jpeg";
            const result = await new Promise<Blob | null>(resolve =>
              canvas.toBlob(resolve, outputType, 0.84));
            if (result && result.size > 0 && result.size < file.size) {
              image = new File([result], file.name, {type: result.type});
            }
          }
        }
      } finally {
        bitmap.close();
      }
    }
  } catch {
    // Une HEIC ou autre image non décodable reste importable sans conversion,
    // sous réserve des limites MIME et de taille de M47.
  }
  const stored = await storeMedia(image, "image");
  if (!stored.ok) return stored;
  const entry: ImageMetadata = {
    id: crypto.randomUUID(),
    name: file.name,
    source: "imported",
    mediaId: stored.value.id,
    tags: [],
    updatedAt: new Date().toISOString(),
  };
  const open = await openMediaDb();
  if (!open.ok) return open;
  try {
    return await new Promise<Result<ImageMetadata>>(resolve => {
      const tx = open.value.transaction("imageMetadata", "readwrite");
      tx.objectStore("imageMetadata").put(entry);
      tx.oncomplete = () => resolve({ok: true, value: entry});
      tx.onerror = () => resolve({ok: false, error: {
        code: "IMAGE_METADATA_FAILED", message: "Informations d'image non enregistrées.",
      }});
      tx.onabort = () => resolve({ok: false, error: {
        code: "IMAGE_METADATA_FAILED", message: "Enregistrement de l'image interrompu.",
      }});
    });
  } catch {
    return {ok: false, error: {
      code: "IMAGE_METADATA_FAILED", message: "Stockage des informations de l'image indisponible.",
    }};
  } finally {
    open.value.close();
  }
}

/** M65 · Galerie locale et images librement distribuables du catalogue. */
export async function listImages(): Promise<Result<ImageMetadata[]>> {
  const opened = await openMediaDb();
  if (!opened.ok) return opened;
  try {
    const local = await new Promise<Result<ImageMetadata[]>>(resolve => {
      const tx = opened.value.transaction("imageMetadata", "readonly");
      const req = tx.objectStore("imageMetadata").getAll();
      req.onsuccess = () => resolve({ok: true, value: req.result as ImageMetadata[]});
      req.onerror = () => resolve({ok: false, error: {
        code: "IMAGES_UNAVAILABLE", message: "Galerie locale indisponible.",
      }});
      tx.onabort = () => resolve({ok: false, error: {
        code: "IMAGES_UNAVAILABLE", message: "Consultation des images interrompue.",
      }});
    });
    if (!local.ok) return local;
    const merged = new Map<string, ImageMetadata>();
    const bundled = await loadBundledCatalog();
    if (bundled.ok) for (const entry of bundled.value) {
      if (entry.kind !== "image") continue;
      merged.set(entry.id, {
        id: entry.id, name: entry.title, source: "bundled",
        catalogId: entry.id, tags: [], updatedAt: "1970-01-01T00:00:00.000Z",
      });
    }
    for (const item of local.value) merged.set(item.id, item);
    return {ok: true, value: [...merged.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "fr") || a.id.localeCompare(b.id))};
  } catch {
    return {ok: false, error: {
      code: "IMAGES_UNAVAILABLE", message: "Consultation de la galerie indisponible.",
    }};
  } finally {
    opened.value.close();
  }
}

/** M95 · Renommer/classer une image personnelle sans réécrire le binaire. */
export async function updateImageMetadata(image: ImageMetadata): Promise<Result<void>> {
  if (!image || !image.id || image.id.includes("/") || image.source !== "imported"
    || !image.name?.trim() || image.name.length > 250
    || !Array.isArray(image.tags) || image.tags.length > 30
    || image.tags.some(tag => typeof tag !== "string" || !tag.trim() || tag.length > 40)) {
    return {ok: false, error: {
      code: "INVALID_IMAGE", message: "Informations d'image invalides.",
    }};
  }
  const opened = await openMediaDb();
  if (!opened.ok) return opened;
  try {
    const old = await new Promise<Result<ImageMetadata>>(resolve => {
      const tx = opened.value.transaction("imageMetadata", "readonly");
      const req = tx.objectStore("imageMetadata").get(image.id);
      req.onsuccess = () => req.result
        ? resolve({ok: true, value: req.result as ImageMetadata})
        : resolve({ok: false, error: {
          code: "IMAGE_NOT_FOUND", message: "Image personnelle introuvable.",
        }});
      req.onerror = () => resolve({ok: false, error: {
        code: "IMAGE_READ_FAILED", message: "Métadonnées locales indisponibles.",
      }});
    });
    if (!old.ok) return old;
    if (old.value.source !== "imported" || !old.value.mediaId) return {
      ok: false, error: {
        code: "IMAGE_READ_ONLY", message: "Une image du catalogue ne peut pas être modifiée.",
      },
    };
    const revised: ImageMetadata = {
      ...old.value, name: image.name.trim(),
      tags: image.tags.map(tag => tag.trim()),
      updatedAt: new Date().toISOString(),
    };
    return await new Promise<Result<void>>(resolve => {
      const tx = opened.value.transaction("imageMetadata", "readwrite");
      tx.objectStore("imageMetadata").put(revised);
      tx.oncomplete = () => resolve({ok: true, value: undefined});
      tx.onerror = () => resolve({ok: false, error: {
        code: "IMAGE_WRITE_FAILED", message: "Modification d'image indisponible.",
      }});
      tx.onabort = () => resolve({ok: false, error: {
        code: "IMAGE_WRITE_FAILED", message: "Modification d'image interrompue.",
      }});
    });
  } catch {
    return {ok: false, error: {
      code: "IMAGE_WRITE_FAILED", message: "Modification des informations impossible.",
    }};
  } finally {
    opened.value.close();
  }
}
