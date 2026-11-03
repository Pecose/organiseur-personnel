/** F14 · M01 : bootstrap UI Safari/PWA, sans configuration Firebase inventée.
 * D23 : routeur et écran codés ; aucune recette ni déploiement réalisés.
 */
import { initFirebase } from "./services/firebase";
import { observeAuth } from "./services/auth";
import { observeSyncStatus } from "./services/sync";
import { registerServiceWorker } from "./pwa/service-worker";
import { getAppState, setAppState } from "./app/state";
import { renderRoute, resolveRoute } from "./app/router";
import { renderCommonStatus } from "./ui/components";
import type { PublicFirebaseConfig, Result, Unsubscribe } from "./domain/types";

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
    observeAuth(user => {
      stopSync();
      stopSync = () => undefined;
      setAppState({
        user,
        sync: {
          state: "local", pendingCount: 0,
          message: user ? "Vérification des données synchronisées…" : "Compte non connecté.",
        },
      });
      if (user) {
        stopSync = observeSyncStatus(sync => {
          setAppState({sync});
          renderCommonStatus(sync);
        });
      }
      renderRoute(getAppState().route);
    });
  }

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
