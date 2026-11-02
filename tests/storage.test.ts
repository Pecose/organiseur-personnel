/** F41 / T03 · S5 : tests des adaptateurs sans dépendance externe.
 * Ces scénarios simulent fetch et l'absence d'IndexedDB.
 * Ils ne remplacent PAS un test Safari iPhone ou une migration IDB réelle.
 */
import { openMediaDb } from "../src/storage/mediaDb";
import { loadBundledCatalog, resolveCatalogAsset } from "../src/storage/catalog";

void (async () => {
  const oldDoc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldLoc = Object.getOwnPropertyDescriptor(globalThis, "location");
  const oldFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const oldIdb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  try {
    Object.defineProperty(globalThis, "indexedDB", {configurable: true, value: undefined});
    const offlineDb = await openMediaDb();
    if (offlineDb.ok || offlineDb.error.code !== "INDEXEDDB_UNAVAILABLE") {
      throw new Error("M46 : absence d'IndexedDB non diagnostiquée.");
    }

    Object.defineProperty(globalThis, "document", {
      configurable: true, value: {baseURI: "https://example.test/organiseur-personnel/index.html"},
    });
    Object.defineProperty(globalThis, "location", {
      configurable: true, value: {origin: "https://example.test"},
    });
    let fetchedUrl = "";
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async (input: string) => {
        fetchedUrl = input;
        return new Response("[]", {status: 200});
      },
    });
    const empty = await loadBundledCatalog();
    if (!empty.ok || empty.value.length !== 0
        || fetchedUrl !== "https://example.test/organiseur-personnel/public/catalog/catalog.json") {
      throw new Error("M50 : lecture de catalogue vide ou URL Pages invalide.");
    }
    const unknown = resolveCatalogAsset("unknown");
    if (unknown.ok || unknown.error.code !== "CATALOG_ID_UNKNOWN") {
      throw new Error("M51 : un média absent ne doit pas recevoir d'URL.");
    }

    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async () => new Response(JSON.stringify([{
        id: "music-1", revision: "1", kind: "audio", url: "./public/catalog/audio/base.mp3",
        title: "Média de test", checksum: "placeholder", redistributionAllowed: true,
      }]), {status: 200}),
    });
    const valid = await loadBundledCatalog();
    const asset = resolveCatalogAsset("music-1");
    if (!valid.ok || valid.value.length !== 1 || !asset.ok
        || asset.value !== "https://example.test/organiseur-personnel/public/catalog/audio/base.mp3") {
      throw new Error("M50/M51 : résolution d'un média local autorisé incorrecte.");
    }

    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async () => new Response(JSON.stringify([{
        id: "blocked", revision: "1", kind: "audio", url: "https://another.test/track.mp3",
        title: "Média externe", checksum: "x", redistributionAllowed: true,
      }]), {status: 200}),
    });
    const loaded = await loadBundledCatalog();
    const denied = resolveCatalogAsset("blocked");
    if (!loaded.ok || denied.ok || denied.error.code !== "CATALOG_ORIGIN") {
      throw new Error("M51 : URL externe autorisée par erreur.");
    }

    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async () => new Response(JSON.stringify([{
        id: "illegal", revision: "1", kind: "image", url: "./other.png",
        title: "Sans droits", checksum: "x", redistributionAllowed: false,
      }]), {status: 200}),
    });
    const deniedRights = await loadBundledCatalog();
    if (deniedRights.ok || deniedRights.error.code !== "INVALID_CATALOG") {
      throw new Error("M50 : fichier non autorisé accepté.");
    }
    console.log("S5 F41 : catalogue, origine, droits et absence d'IndexedDB vérifiés (simulation).");
  } finally {
    for (const [key, descriptor] of [
      ["document", oldDoc], ["location", oldLoc], ["fetch", oldFetch], ["indexedDB", oldIdb],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
})();
