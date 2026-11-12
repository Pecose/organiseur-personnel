/** F36 · M82/M83 : mises à jour volontaires de la PWA.
 * Seuls le manifeste et le cache PUBLIC sont concernés ; IndexedDB et
 * Firestore de l'utilisatrice ne sont jamais modifiés ici (FL06/D09).
 * D23 : à valider sur Safari iPhone avant tout déploiement.
 */
import {getAppState} from "../app/state";
import type {AppVersion, Result} from "../domain/types";

/** M82 · Lire le manifeste public sans cache pour détecter une révision plus récente. */
export async function checkAppUpdate(): Promise<Result<AppVersion | null>> {
  if (typeof window === "undefined" || typeof location === "undefined"
    || location.protocol !== "https:" && location.hostname !== "localhost") {
    return {ok:false,error:{
      code:"UPDATE_UNAVAILABLE",message:"Vérification de mise à jour disponible seulement en HTTPS.",
    }};
  }
  try {
    const url = new URL("/organiseur-personnel/manifest.webmanifest", location.origin);
    const response = await fetch(url.toString(), {
      cache:"no-store",credentials:"same-origin",redirect:"error",
      headers:{"Accept":"application/manifest+json, application/json"},
    });
    if (!response.ok || response.url && new URL(response.url).origin !== location.origin)
      throw new Error("Manifest unavailable");
    const parsed:unknown = await response.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Invalid manifest");
    const candidate = (parsed as Record<string,unknown>).app_version;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw new Error("Missing version");
    const v = candidate as Record<string,unknown>;
    if (typeof v.version !== "string" || !/^[A-Za-z0-9._-]{1,40}$/.test(v.version)
      || typeof v.cacheRevision !== "string"
      || !/^[A-Za-z0-9_-]{1,40}$/.test(v.cacheRevision)
      || typeof v.catalogRevision !== "string"
      || !/^[A-Za-z0-9._-]{1,40}$/.test(v.catalogRevision)
      || typeof v.releasedAt !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v.releasedAt)
      || !Number.isFinite(Date.parse(v.releasedAt))) throw new Error("Invalid version");
    const remote:AppVersion = {
      version:v.version,cacheRevision:v.cacheRevision,
      catalogRevision:v.catalogRevision,releasedAt:v.releasedAt,
    };
    const local = getAppState().version;
    // Jamais de rétrogradation automatique si un manifeste plus ancien est servi.
    if (Date.parse(remote.releasedAt) <= Date.parse(local.releasedAt)
      || (remote.version === local.version
        && remote.cacheRevision === local.cacheRevision
        && remote.catalogRevision === local.catalogRevision))
      return {ok:true,value:null};
    return {ok:true,value:remote};
  } catch {
    return {ok:false,error:{
      code:"UPDATE_CHECK_FAILED",
      message:"Impossible de vérifier les mises à jour. Réessaie lorsque le réseau est disponible.",
    }};
  }
}

/** M83 · Active UNIQUEMENT un worker en attente, après geste de confirmation UI.
 * Le nouveau worker précache ses ressources publiques avant l'activation.
 * En cas d'absence de worker prêt, aucune suppression ni rechargement n'a lieu.
 */
export async function applyAppUpdate(): Promise<Result<void>> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)
    || typeof location === "undefined") return {ok:false,error:{
    code:"UPDATE_UNAVAILABLE",message:"Les mises à jour PWA ne sont pas disponibles ici.",
  }};
  const available = await checkAppUpdate();
  if (!available.ok) return available;
  if (!available.value) return {ok:false,error:{
    code:"UPDATE_NOT_FOUND",message:"Aucune nouvelle version n'est proposée.",
  }};
  try {
    const scope = new URL("/organiseur-personnel/",location.origin).toString();
    const registration = await navigator.serviceWorker.getRegistration(scope);
    if (!registration) return {ok:false,error:{
      code:"UPDATE_NOT_INSTALLED",message:"L'application doit d'abord être installée.",
    }};
    await registration.update();
    if (registration.installing && !registration.waiting) {
      await new Promise<void>(resolve => {
        const installing = registration.installing!;
        if (installing.state === "installed" || installing.state === "redundant") {
          resolve();return;
        }
        const timeout = setTimeout(resolve,15000);
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" || installing.state === "redundant") {
            clearTimeout(timeout);resolve();
          }
        });
      });
    }
    const waiting = registration.waiting;
    if (!waiting) return {ok:false,error:{
      code:"UPDATE_NOT_READY",
      message:"Nouvelle version détectée mais pas encore prête. Réessaie dans un instant.",
    }};
    return await new Promise<Result<void>>(resolve => {
      let settled = false;
      const finish = (ok:boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener("controllerchange", activated);
        if (ok) {
          resolve({ok:true,value:undefined});
          // Au prochain chargement, le nouveau shell et le manifeste correspondront.
          setTimeout(() => location.reload(),0);
        } else resolve({ok:false,error:{
          code:"UPDATE_ACTIVATION_FAILED",
          message:"Activation non confirmée. Tes données restent intactes, réessaie.",
        }});
      };
      const activated = () => finish(true);
      const timeout = setTimeout(() => finish(false),15000);
      navigator.serviceWorker.addEventListener("controllerchange",activated);
      waiting.postMessage({type:"APPLY_APP_UPDATE"});
    });
  } catch {
    return {ok:false,error:{
      code:"UPDATE_APPLY_FAILED",
      message:"Mise à jour indisponible. Aucune donnée personnelle n'a été supprimée.",
    }};
  }
}
