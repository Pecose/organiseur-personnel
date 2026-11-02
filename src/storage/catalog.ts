/** F32 · Catalogue public versionné ; jamais de médias personnels embarqués. */
import type { CatalogEntry, Result } from "../domain/types";

let entries: CatalogEntry[] | null = null;

/** M50 : récupère uniquement le catalogue de l'application sur sa propre origine. */
export async function loadBundledCatalog(): Promise<Result<CatalogEntry[]>> {
  if (typeof fetch === "undefined" || typeof document === "undefined") {
    return {ok: false, error: {
      code: "CATALOG_UNAVAILABLE", message: "Le catalogue requiert un navigateur.",
    }};
  }
  try {
    const url = new URL("./public/catalog/catalog.json", document.baseURI);
    if (url.origin !== location.origin) {
      return {ok: false, error: {code: "CATALOG_ORIGIN", message: "Origine du catalogue non autorisée."}};
    }
    const response = await fetch(url.toString(), {credentials: "same-origin"});
    if (!response.ok) {
      return {ok: false, error: {
        code: "CATALOG_FETCH_FAILED", message: "Catalogue intégré indisponible.",
      }};
    }
    const unknownData: unknown = await response.json();
    if (!Array.isArray(unknownData) || !unknownData.every((item: unknown) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
      const value = item as Record<string, unknown>;
      return typeof value.id === "string" && value.id.length > 0
        && typeof value.revision === "string"
        && (value.kind === "audio" || value.kind === "image")
        && typeof value.url === "string" && typeof value.title === "string"
        && typeof value.checksum === "string"
        && value.redistributionAllowed === true;
    })) {
      return {ok: false, error: {
        code: "INVALID_CATALOG", message: "Catalogue invalide ou média non autorisé.",
      }};
    }
    const normalized = unknownData as CatalogEntry[];
    const ids = new Set(normalized.map(item => item.id));
    if (ids.size !== normalized.length) {
      return {ok: false, error: {code: "INVALID_CATALOG", message: "Identifiants de médias dupliqués."}};
    }
    entries = normalized;
    return {ok: true, value: [...entries]};
  } catch {
    return {ok: false, error: {
      code: "CATALOG_FETCH_FAILED", message: "Impossible de charger le catalogue intégré.",
    }};
  }
}

/** M51 : URL autorisée d'un média intégré après M50. */
export function resolveCatalogAsset(catalogId: string): Result<string> {
  if (entries === null) {
    return {ok: false, error: {code: "CATALOG_NOT_LOADED", message: "Charger le catalogue avant la lecture."}};
  }
  const entry = entries.find(item => item.id === catalogId);
  if (!entry) {
    return {ok: false, error: {code: "CATALOG_ID_UNKNOWN", message: "Média intégré introuvable."}};
  }
  if (typeof document === "undefined") {
    return {ok: false, error: {code: "CATALOG_UNAVAILABLE", message: "Navigateur requis."}};
  }
  try {
    const url = new URL(entry.url, document.baseURI);
    if (url.origin !== location.origin || url.protocol !== "https:" && url.protocol !== "http:") {
      return {ok: false, error: {code: "CATALOG_ORIGIN", message: "URL de média hors du catalogue local."}};
    }
    return {ok: true, value: url.toString()};
  } catch {
    return {ok: false, error: {code: "INVALID_CATALOG_URL", message: "URL de média invalide."}};
  }
}
