/** F33 · S9B : consentement explicite aux notifications Web Push.
 * Ce premier lot ne crée ni abonnement, ni clé VAPID, ni envoi distant.
 * iOS : PWA ajoutée à l'écran d'accueil et geste utilisateur requis.
 * D23 : code non testé, aucun service externe activé.
 */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { fetchCloudRecords, removeCloudRecord } from "./cloudRepository";
import type { PushSubscriptionRecord, Result } from "../domain/types";

/** M75 · À appeler uniquement depuis un bouton touché par l'utilisatrice.
 * PermissionState natif : granted, denied ou prompt.
 */
export async function requestPushPermission(): Promise<Result<PermissionState>> {
  if (typeof window === "undefined" || typeof navigator === "undefined"
    || typeof Notification === "undefined"
    || !("serviceWorker" in navigator)
    || !("PushManager" in window)
    || typeof Notification.requestPermission !== "function") {
    return {ok: false, error: {
      code: "PUSH_UNSUPPORTED",
      message: "Ce navigateur ne prend pas en charge les notifications Web Push.",
    }};
  }
  const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const homeScreen = window.matchMedia?.("(display-mode: standalone)").matches === true
    || (navigator as Navigator & {standalone?: boolean}).standalone === true;
  if (isAppleMobile && !homeScreen) {
    return {ok: false, error: {
      code: "PWA_INSTALL_REQUIRED",
      message: "Sur iPhone, ajoute d'abord l'application à l'écran d'accueil.",
    }};
  }
  if (Notification.permission === "denied") {
    return {ok: false, error: {
      code: "PUSH_DENIED",
      message: "Les notifications sont bloquées dans les réglages de cet appareil.",
    }};
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") return {ok: true, value: "granted"};
    if (permission === "denied") return {ok: true, value: "denied"};
    return {ok: true, value: "prompt"};
  } catch {
    return {ok: false, error: {
      code: "PUSH_PERMISSION_FAILED",
      message: "Impossible de demander l'autorisation des notifications.",
    }};
  }
}

/** M77 · Révocation volontaire de l'abonnement Push de CET appareil.
 * Supprimer uniquement les documents qui correspondent à son endpoint.
 * Ne jamais retirer les abonnements appartenant à d'autres appareils.
 * Cette fonction ne crée aucun abonnement et n'envoie aucune notification.
 */
export async function unsubscribeFromPush(): Promise<Result<void>> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)
    || typeof location === "undefined") {
    return {ok: false, error: {
      code: "PUSH_UNAVAILABLE", message: "Gestion Push indisponible sur cet appareil.",
    }};
  }
  try {
    const app = getApp("organiseur-personnel");
    const user = getAuth(app).currentUser;
    if (!user) return {ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connecte-toi avant de retirer un abonnement.",
    }};
    const scope = new URL("/organiseur-personnel/", location.origin).toString();
    const registration = await navigator.serviceWorker.getRegistration(scope);
    if (!registration) return {ok: true, value: undefined};
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return {ok: true, value: undefined};
    const existing = await fetchCloudRecords<PushSubscriptionRecord>(
      user.uid, "pushSubscriptions",
    );
    if (!existing.ok) return existing;
    const owned = existing.value.filter(entry => entry.endpoint === subscription.endpoint);
    for (const entry of owned) {
      if (!entry.id || entry.id.includes("/")) return {ok: false, error: {
        code: "INVALID_SUBSCRIPTION", message: "Abonnement enregistré invalide.",
      }};
      const removed = await removeCloudRecord(user.uid, "pushSubscriptions", entry.id);
      if (!removed.ok) return removed;
    }
    const unsubscribed = await subscription.unsubscribe();
    if (!unsubscribed) return {ok: false, error: {
      code: "PUSH_UNSUBSCRIBE_FAILED",
      message: "Le navigateur n'a pas confirmé la révocation de cet abonnement.",
    }};
    return {ok: true, value: undefined};
  } catch {
    return {ok: false, error: {
      code: "PUSH_UNSUBSCRIBE_FAILED",
      message: "Révocation non confirmée. Réessaie en ligne depuis cet appareil.",
    }};
  }
}
