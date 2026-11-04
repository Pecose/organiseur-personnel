/** F33 · S9B : consentement explicite aux notifications Web Push.
 * Ce premier lot ne crée ni abonnement, ni clé VAPID, ni envoi distant.
 * iOS : PWA ajoutée à l'écran d'accueil et geste utilisateur requis.
 * D23 : code non testé, aucun service externe activé.
 */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { fetchCloudRecords, putCloudRecord, removeCloudRecord } from "./cloudRepository";
import { workerRequest } from "./googleCalendarBridge";
import type { NotificationTestResult, PushSubscriptionRecord, Result } from "../domain/types";

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

/** M76 · Inscription volontaire sur cet appareil, avec clé publique VAPID
 * et document O14 sous le seul UID authentifié. Aucun envoi lancé.
 */
export async function subscribeToPush(): Promise<Result<PushSubscriptionRecord>> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)
    || typeof PushManager === "undefined") return {ok:false,error:{
    code:"PUSH_UNSUPPORTED",message:"Abonnement Push indisponible ici.",
  }};
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!key || !/^[A-Za-z0-9_-]{86,90}$/.test(key)) return {ok:false,error:{
    code:"VAPID_NOT_CONFIGURED",
    message:"Le serveur gratuit de notifications n'est pas encore configuré.",
  }};
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return {ok:false,error:{
      code:"AUTH_REQUIRED",message:"Connexion nécessaire avant l'abonnement.",
    }};
    // M75 est appelé depuis le bouton de souscription, jamais automatiquement.
    const permission = await requestPushPermission();
    if (!permission.ok) return permission;
    if (permission.value !== "granted") return {ok:false,error:{
      code:"PUSH_PERMISSION_NOT_GRANTED",message:"Autorisation non accordée.",
    }};
    const scope = new URL("/organiseur-personnel/", location.origin).toString();
    const reg = await navigator.serviceWorker.getRegistration(scope);
    if (!reg) return {ok:false,error:{
      code:"SERVICE_WORKER_NOT_READY",
      message:"La PWA doit être installée et son service worker actif.",
    }};
    const bytes = atob(key.replace(/-/g,"+").replace(/_/g,"/")
      + "=".repeat((4 - key.length % 4) % 4));
    const publicKey = Uint8Array.from(bytes, c => c.charCodeAt(0));
    if (publicKey.length !== 65 || publicKey[0] !== 4) throw Error("Bad public VAPID key");
    const prior = await reg.pushManager.getSubscription();
    const subscription = prior ?? await reg.pushManager.subscribe({
      userVisibleOnly:true, applicationServerKey:publicKey,
    });
    const raw = subscription.toJSON();
    const p256dh = raw.keys?.p256dh;
    const auth = raw.keys?.auth;
    if (!p256dh || !auth || !subscription.endpoint.startsWith("https://")) {
      if (!prior) await subscription.unsubscribe();
      throw Error("Incomplete subscription");
    }
    const stored = await fetchCloudRecords<PushSubscriptionRecord>(
      user.uid, "pushSubscriptions",
    );
    if (!stored.ok) {
      if (!prior) await subscription.unsubscribe();
      return stored;
    }
    const same = stored.value.find(item => item.endpoint === subscription.endpoint);
    if (same) return {ok:true,value:same};
    const record:PushSubscriptionRecord = {
      id:crypto.randomUUID(), endpoint:subscription.endpoint,
      p256dh,auth,updatedAt:new Date().toISOString(),
    };
    const saved = await putCloudRecord(user.uid,"pushSubscriptions",record.id,record);
    if (!saved.ok) {
      if (!prior) await subscription.unsubscribe();
      return saved;
    }
    return {ok:true,value:record};
  } catch {
    return {ok:false,error:{
      code:"PUSH_SUBSCRIPTION_FAILED",
      message:"Abonnement non confirmé sur cet appareil. Aucun envoi n'est garanti.",
    }};
  }
}

/** M78 · Test uniquement sur l'abonnement de ce navigateur et son UID.
 * La réponse du Worker ne garantit pas l'apparition d'une notification.
 */
export async function testPushSubscription(): Promise<Result<NotificationTestResult>> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return {ok:false,error:{code:"PUSH_UNSUPPORTED",message:"Web Push indisponible."}};
  }
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return {ok:false,error:{
      code:"AUTH_REQUIRED",message:"Connexion nécessaire pour tester le Push.",
    }};
    const scope = new URL("/organiseur-personnel/",location.origin).toString();
    const reg = await navigator.serviceWorker.getRegistration(scope);
    const local = await reg?.pushManager.getSubscription();
    if (!local) return {ok:false,error:{
      code:"PUSH_NOT_SUBSCRIBED",message:"Cet appareil n'est pas abonné.",
    }};
    const records = await fetchCloudRecords<PushSubscriptionRecord>(
      user.uid,"pushSubscriptions",
    );
    if (!records.ok) return records;
    const item = records.value.find(value => value.endpoint === local.endpoint);
    if (!item) return {ok:false,error:{
      code:"PUSH_DEVICE_NOT_FOUND",message:"Abonnement de cet appareil non enregistré.",
    }};
    return workerRequest<NotificationTestResult>("/api/push/test","POST",{
      deviceId:item.id,
    });
  } catch {
    return {ok:false,error:{
      code:"PUSH_TEST_UNAVAILABLE",
      message:"Test de notification indisponible ; aucun envoi confirmé.",
    }};
  }
}
