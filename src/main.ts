/** F14 · M01 : bootstrap UI Safari/PWA, sans configuration Firebase inventée.
 * D23 : routeur et écran codés ; aucune recette ni déploiement réalisés.
 */
import { initFirebase } from "./services/firebase";
import { observeAuth } from "./services/auth";
import { observeSyncStatus } from "./services/sync";
import { subscribeCloudRecords } from "./services/cloudRepository";
import { registerServiceWorker } from "./pwa/service-worker";
import { getAppState, setAppState, watchAppState } from "./app/state";
import { getActiveTheme, listImages } from "./features/decor";
import { readMedia } from "./storage/mediaDb";
import { resolveCatalogAsset } from "./storage/catalog";
import { requestGoogleCalendarSync } from "./features/googleCalendar";
import { renderRoute, resolveRoute } from "./app/router";
import { renderCommonStatus } from "./ui/components";
import type { ProfilePreferences, PublicFirebaseConfig, Result, Unsubscribe } from "./domain/types";

/** M01 · Monter Jour même sans Firebase, sans afficher de données factices. */
export async function bootstrapApp(): Promise<Result<void>> {
  const config: PublicFirebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? undefined,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? undefined,
  };

  const route = resolveRoute(window.location.hash);
  const defaultPreferences = getAppState().preferences;
  let backgroundUrl: string | undefined;
  let backgroundUid: string | undefined;
  let backgroundId: string | undefined;
  let backgroundRequest = 0;
  watchAppState(({preferences, user}) => {
    const theme = getActiveTheme(new Date().toISOString(), preferences);
    for (const [name, color] of Object.entries(theme.colors)) {
      document.documentElement.style.setProperty("--theme-" + name, color);
    }
    const uid = user?.uid;
    const imageId = theme.backgroundImageId;
    if (backgroundUid === uid && backgroundId === imageId) return;
    backgroundUid = uid;
    backgroundId = imageId;
    const request = ++backgroundRequest;
    if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
    backgroundUrl = undefined;
    document.body.style.removeProperty("--personal-background");
    if (!uid || !imageId) return;
    void (async () => {
      const images = await listImages();
      if (!images.ok || request !== backgroundRequest) return;
      const image = images.value.find(entry => entry.id === imageId);
      let url: string;
      if (image?.source === "imported" && image.mediaId) {
        const media = await readMedia(image.mediaId);
        if (!media.ok || request !== backgroundRequest) {
          if (request === backgroundRequest) backgroundId = undefined;
          return;
        }
        backgroundUrl = URL.createObjectURL(media.value);
        url = backgroundUrl;
      } else if (image?.source === "bundled" && image.catalogId) {
        const asset = resolveCatalogAsset(image.catalogId);
        if (!asset.ok || new URL(asset.value).origin !== location.origin) return;
        url = asset.value;
      } else {
        backgroundId = undefined;
        return;
      }
      document.body.style.setProperty("--personal-background", "url(" + JSON.stringify(url) + ")");
    })().catch(() => {
      if (request === backgroundRequest) backgroundId = undefined;
    });
  });
  setAppState({route});
  renderRoute(route);

  // Navigation par fragment compatible GitHub Pages, y compris après retour arrière.
  window.addEventListener("popstate", () => {
    const nextRoute = resolveRoute(window.location.hash);
    setAppState({route: nextRoute});
    renderRoute(nextRoute);
  });

  if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
    setAppState({sync: {
      state: "local", pendingCount: 0,
      message: "Mode de présentation : Firebase n'est pas configuré.",
    }});
    renderCommonStatus(getAppState().sync);
  } else {
    const initialized = initFirebase(config);
    if (!initialized.ok) {
      setAppState({sync: {
        state: "error", pendingCount: 0,
        message: "Configuration Firebase invalide : aucune session ouverte.",
      }});
      renderCommonStatus(getAppState().sync);
      return initialized;
    }
    let stopSync: Unsubscribe = () => undefined;
    let stopPreferences: Unsubscribe = () => undefined;
    observeAuth(user => {
      stopSync();
      stopPreferences();
      stopSync = () => undefined;
      stopPreferences = () => undefined;
      setAppState({
        user,
        preferences: defaultPreferences,
        sync: {
          state: "local", pendingCount: 0,
          message: user ? "Vérification des données synchronisées…" : "Compte non connecté.",
        },
      });
      if (user) {
        void requestGoogleCalendarSync("startup").then(result => {
          if (result.ok && result.value.pulled > 0 && getAppState().user?.uid === user.uid
            && ["day", "calendar", "habits"].includes(getAppState().route.name)) {
            renderRoute(getAppState().route);
          }
        });
        stopPreferences = subscribeCloudRecords<ProfilePreferences>(
          user.uid, "preferences", ([preferences], metadata) => {
            if (getAppState().user?.uid !== user.uid) return;
            if (!preferences && metadata.fromCache) return;
            setAppState({preferences: preferences ?? defaultPreferences});
          },
        );
        stopSync = observeSyncStatus(sync => {
          setAppState({sync});
          renderCommonStatus(sync);
        });
        // FL15 : une seule réconciliation bornée au retour de session.
        // Aucun minuteur de fond et aucune écriture en absence de session.
        void import("./features/activities").then(async actions => {
          const result = await actions.reconcileDueAutoCompletions(new Date().toISOString());
          if (result.ok && result.value > 0 && getAppState().route.name === "day") {
            renderRoute(getAppState().route);
          }
        }).catch(() => { /* La connexion ne permet pas de confirmer la réconciliation. */ });
      }
      renderRoute(getAppState().route);
    });
  }

  // Sur iPhone, l'onglet peut redevenir visible longtemps après le dernier rendu.
  // On réévalue seulement à ce moment, sans prétendre disposer d'une alarme native.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !getAppState().user) return;
    void import("./features/activities").then(async actions => {
      const result = await actions.reconcileDueAutoCompletions(new Date().toISOString());
      if (result.ok && result.value > 0 && getAppState().route.name === "day") {
        renderRoute(getAppState().route);
      }
    }).catch(() => { /* Pas d'ACK serveur annoncé en cas d'échec. */ });
  });

  // Le SDK et le cache PWA sont deux couches distinctes : les fichiers personnels
  // ne sont jamais placés dans le cache public du service worker.
  if (import.meta.env.PROD) {
    void registerServiceWorker().then(result => {
      if (!result.ok) {
        const status = getAppState().sync;
        if (status.state === "local" && !getAppState().user) {
          setAppState({sync: {
            ...status, message: "Cache PWA à vérifier lors de la recette iPhone.",
          }});
          renderCommonStatus(getAppState().sync);
        }
      }
    });
  }
  return {ok: true, value: undefined};
}

void bootstrapApp();
