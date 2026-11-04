/** F33 · S9B : consentement explicite aux notifications Web Push.
 * Ce premier lot ne crée ni abonnement, ni clé VAPID, ni envoi distant.
 * iOS : PWA ajoutée à l'écran d'accueil et geste utilisateur requis.
 * D23 : code non testé, aucun service externe activé.
 */
import type { Result } from "../domain/types";

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
