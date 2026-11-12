/** F35 · Service worker de l'app shell S5 ; jamais de données Firebase. */
import type { PushPayload, Result } from "../domain/types";

const appScope = "/organiseur-personnel/";
const shellRevision = "s10-1";
const cachePrefix = "organiseur-shell-";

/** M79 · Enregistrer uniquement en contexte HTTPS / Pages. */
export async function registerServiceWorker(): Promise<Result<void>> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)
      || typeof location === "undefined"
      || (location.protocol !== "https:" && location.hostname !== "localhost")) {
    return { ok: false, error: {
      code: "SERVICE_WORKER_UNAVAILABLE",
      message: "Le service worker nécessite HTTPS et un navigateur compatible.",
    }};
  }
  try {
    await navigator.serviceWorker.register(
      new URL(appScope + "service-worker.js", location.origin).toString(),
      { scope: appScope, type: "module" },
    );
    return { ok: true, value: undefined };
  } catch {
    return { ok: false, error: {
      code: "SERVICE_WORKER_REGISTER_FAILED",
      message: "Impossible d'installer le cache de l'application.",
    }};
  }
}

/** M80 · Cacher uniquement les fichiers publics du shell, jamais les médias importés. */
export async function cacheAppShell(revision: string): Promise<Result<void>> {
  if (typeof caches === "undefined" || typeof location === "undefined"
      || !/^[a-zA-Z0-9_-]{1,40}$/.test(revision)) {
    return { ok: false, error: {
      code: "CACHE_UNAVAILABLE",
      message: "Cache de l'application indisponible ou version invalide.",
    }};
  }
  try {
    const cache = await caches.open(cachePrefix + revision);
    const homeUrl = new URL(appScope, location.origin).toString();
    await cache.addAll([
      homeUrl,
      new URL(appScope + "manifest.webmanifest", location.origin).toString(),
    ]);
    // Après compilation Vite, précharger aussi les JS/CSS du shell.
    // Sinon le HTML pourrait être disponible hors ligne, mais pas son code.
    const home = await cache.match(homeUrl);
    if (!home) throw new Error("Shell indisponible.");
    const html = await home.text();
    const scriptsAndStyles: string[] = [];
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const resource = new URL(match[1], homeUrl);
      if (resource.origin === location.origin
        && resource.pathname.startsWith(appScope)
        && /\.(?:js|css)$/.test(resource.pathname)) {
        scriptsAndStyles.push(resource.toString());
      }
    }
    if (scriptsAndStyles.length) await cache.addAll([...new Set(scriptsAndStyles)]);
    return { ok: true, value: undefined };
  } catch {
    return { ok: false, error: {
      code: "CACHE_FAILED",
      message: "Le téléchargement hors ligne du shell a échoué.",
    }};
  }
}

/** M81 · Notification locale reçue par le service worker, sans données
 * d'agenda privées. Le serveur ne fournit ni HTML, ni URL ni titre libre.
 */
export async function handlePushMessage(payload: PushPayload): Promise<void> {
  if (!payload || (payload.kind !== "reminder" && payload.kind !== "test")
    || typeof document !== "undefined") return;
  if (payload.kind === "reminder" && (typeof payload.reminderId !== "string"
    || !/^[a-zA-Z0-9@_-]{1,150}$/.test(payload.reminderId))) return;
  const registration = (globalThis as unknown as {
    registration?: {
      showNotification: (title: string, options?: NotificationOptions) => Promise<void>;
    };
  }).registration;
  if (!registration?.showNotification) return;
  await registration.showNotification(
    payload.kind === "test" ? "Notification de test" : "Rappel personnel", {
      body: payload.kind === "test"
        ? "Les notifications de l'organiseur peuvent apparaître sur cet appareil."
        : "Une activité prévue mérite ton attention. Ouvre ton organiseur.",
      tag: payload.kind === "test" ? "organiseur-test" : "organiseur-" + payload.reminderId,
    },
  );
}

// Cette portion est active uniquement dans le service worker compilé.
// Ce même module est aussi importé dans la page pour M79.
if (typeof document === "undefined" && "registration" in globalThis && "clients" in globalThis) {
  const worker = globalThis as unknown as {
    location: Location;
    registration: { scope: string };
    clients: { claim(): Promise<void> };
    skipWaiting(): Promise<void>;
    addEventListener(name: string, listener: (event: unknown) => void): void;
  };

  worker.addEventListener("install", (event: unknown) => {
    const e = event as { waitUntil(promise: Promise<unknown>): void };
    e.waitUntil(cacheAppShell(shellRevision).then(async result => {
      if (!result.ok) throw new Error("Mise en cache initiale non réalisée.");
      // Une mise à jour attend le consentement depuis F36/M83.
      // La première installation sans worker actif peut s'activer normalement.
    }));
  });

  // FL06 / M83 : seul le bouton explicite de mise à jour active un worker en attente.
  worker.addEventListener("message", (event: unknown) => {
    const e = event as {data?: {type?: unknown};waitUntil?(promise: Promise<unknown>): void};
    if (e.data?.type === "APPLY_APP_UPDATE") {
      const activation = worker.skipWaiting();
      e.waitUntil?.(activation);
    }
  });

  worker.addEventListener("activate", (event: unknown) => {
    const e = event as { waitUntil(promise: Promise<unknown>): void };
    e.waitUntil((async () => {
      const names = await caches.keys();
      await Promise.all(names.filter(name => name.startsWith(cachePrefix)
        && name !== cachePrefix + shellRevision).map(name => caches.delete(name)));
      // Ne toucher ni à IndexedDB ni au cache Firestore.
      await worker.clients.claim();
    })());
  });

  worker.addEventListener("push", (event: unknown) => {
    const e = event as {
      data?: {json(): unknown};
      waitUntil(promise: Promise<unknown>): void;
    };
    let payload: PushPayload | null = null;
    try {
      const incoming: unknown = e.data?.json();
      if (typeof incoming === "object" && incoming !== null
        && !Array.isArray(incoming)) {
        const value = incoming as Record<string, unknown>;
        if (value.kind === "test") payload = {kind: "test"};
        else if (value.kind === "reminder"
          && typeof value.reminderId === "string") {
          payload = {kind: "reminder", reminderId: value.reminderId};
        }
      }
    } catch {
      // Toute charge illisible est ignorée, jamais affichée comme texte libre.
    }
    if (payload) e.waitUntil(handlePushMessage(payload));
  });

  worker.addEventListener("notificationclick", (event: unknown) => {
    const e = event as {
      notification: {close(): void};
      waitUntil(promise: Promise<unknown>): void;
    };
    e.notification.close();
    const workerClients = globalThis as unknown as {
      clients: {openWindow?: (url: string) => Promise<unknown>};
      location: Location;
    };
    // La destination est fixée en dur : aucune redirection provenant du Push.
    if (workerClients.clients.openWindow) {
      e.waitUntil(workerClients.clients.openWindow(
        new URL(appScope + "#day", workerClients.location.origin).toString(),
      ));
    }
  });

  worker.addEventListener("fetch", (event: unknown) => {
    const e = event as { request: Request; respondWith(promise: Promise<Response>): void };
    const request = e.request;
    const url = new URL(request.url);
    // M80 : seules les ressources publiques explicitement prévues par
    // la PWA sont cachées. Un retour OAuth avec ?code ou ?state ne l'est jamais.
    const relative = url.pathname.startsWith(appScope)
      ? url.pathname.slice(appScope.length) : null;
    const publicAsset = relative !== null && (
      relative === "" || relative === "index.html"
      || relative === "manifest.webmanifest"
      || relative === "service-worker.js"
      || /^assets\/[a-zA-Z0-9._/-]+$/.test(relative)
      || /^catalog\/[a-zA-Z0-9._/-]+$/.test(relative)
    );
    if (request.method !== "GET" || url.origin !== location.origin
      || url.search !== "" || !publicAsset) return;
    e.respondWith((async (): Promise<Response> => {
      try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(cachePrefix + shellRevision);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const home = await caches.match(new URL(appScope, location.origin).toString());
          if (home) return home;
        }
        return new Response("Application indisponible hors connexion.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })());
  });
}
