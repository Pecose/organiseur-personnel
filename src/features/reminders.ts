/** F23 · Rappels O06 par occurrence, sans envoi de notification.
 * S6 / D23 : code non testé, aucune tâche planifiée ni Worker démarré.
 */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { fetchCloudRecords, getUserCollection, putCloudRecord } from "../services/cloudRepository";
import { classifyActivity } from "./activities";
import { expandActivityOccurrences } from "./habits";
import type { Activity, Reminder, Result } from "../domain/types";

/** M41 · Rappels dus pour l'interface locale, jamais un envoi Push. */
export async function getDueReminders(now: string): Promise<Result<Reminder[]>> {
  try {
    const time = Date.parse(now);
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!Number.isFinite(time)) return {ok: false, error: {
      code: "INVALID_INSTANT", message: "Instant de consultation invalide.",
    }};
    if (!user) return {ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connexion requise pour les rappels.",
    }};
    const data = await fetchCloudRecords<Reminder>(user.uid, "reminders");
    if (!data.ok) return data;
    const due = data.value.filter(item =>
      item.enabled === true
      && item.dispatchStatus !== "sent"
      && item.dispatchStatus !== "cancelled"
      && Number.isFinite(Date.parse(item.scheduledFor))
      && Number.isSafeInteger(item.leadMinutes) && item.leadMinutes >= 0
      && Date.parse(item.scheduledFor) - item.leadMinutes * 60_000 <= time
    ).sort((a, b) =>
      (Date.parse(a.scheduledFor) - a.leadMinutes * 60_000)
      - (Date.parse(b.scheduledFor) - b.leadMinutes * 60_000)
      || a.id.localeCompare(b.id));
    return {ok: true, value: due};
  } catch {
    return {ok: false, error: {
      code: "REMINDER_READ_FAILED", message: "Consultation des rappels indisponible.",
    }};
  }
}

/** M43 · Enregistrer le rappel rattaché à une activité et une occurrence réelles. */
export async function saveReminder(input: Reminder): Promise<Result<Reminder>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return {ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connexion requise pour modifier les rappels.",
    }};
    if (!input || !input.id || input.id.includes("/") || !input.activityId
      || input.activityId.includes("/") || !input.occurrenceKey
      || input.occurrenceKey.includes("/")
      || typeof input.enabled !== "boolean" || typeof input.dispatchStatus !== "string"
      || !Number.isSafeInteger(input.leadMinutes) || input.leadMinutes < 0
      || input.leadMinutes > 10080 || !Number.isFinite(Date.parse(input.scheduledFor))) {
      return {ok: false, error: {
        code: "INVALID_REMINDER", message: "Identifiants, durée ou horaire du rappel invalides.",
      }};
    }
    try {
      new Intl.DateTimeFormat("fr-FR", {timeZone: input.timeZone});
    } catch {
      return {ok: false, error: {
        code: "INVALID_TIME_ZONE", message: "Fuseau horaire inconnu.",
      }};
    }
    const parent = await getDoc(doc(getUserCollection(user.uid, "activities"), input.activityId));
    if (!parent.exists() || (parent.data() as Activity).deletedAt) {
      return {ok: false, error: {
        code: "ACTIVITY_NOT_FOUND", message: "Activité absente ou archivée.",
      }};
    }
    const activity = parent.data() as Activity;
    const keyPart = input.occurrenceKey.slice((input.activityId + "@").length);
    if (!input.occurrenceKey.startsWith(input.activityId + "@")
      || !/^\d{4}-\d{2}-\d{2}$/.test(keyPart)
      || Number.isNaN(Date.parse(keyPart + "T00:00:00Z"))) {
      return {ok: false, error: {
        code: "INVALID_OCCURRENCE", message: "Occurrence de rappel invalide.",
      }};
    }
    const center = Date.parse(keyPart + "T00:00:00Z");
    const occurrences = expandActivityOccurrences(activity, {
      from: new Date(center - 2 * 86_400_000).toISOString(),
      to: new Date(center + 3 * 86_400_000).toISOString(),
    });
    if (!occurrences.some(item => item.occurrenceKey === input.occurrenceKey)) {
      return {ok: false, error: {
        code: "OCCURRENCE_NOT_FOUND", message: "Cette occurrence n'existe pas dans le calendrier.",
      }};
    }
    const data: Reminder = {
      id: input.id, activityId: input.activityId,
      occurrenceKey: input.occurrenceKey, scheduledFor: input.scheduledFor,
      leadMinutes: input.leadMinutes, timeZone: input.timeZone,
      enabled: input.enabled, dispatchStatus: input.dispatchStatus,
    };
    const stored = await putCloudRecord(user.uid, "reminders", data.id, data);
    return stored.ok ? {ok: true, value: data} : stored;
  } catch {
    return {ok: false, error: {
      code: "REMINDER_SAVE_FAILED", message: "Enregistrement du rappel indisponible.",
    }};
  }
}

/** M44 · Désactiver un rappel sans effacer ses informations. */
export async function disableReminder(reminderId: string): Promise<Result<void>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user || !reminderId || reminderId.includes("/")) {
      return {ok: false, error: {
        code: "INVALID_REMINDER", message: "Rappel ou session invalide.",
      }};
    }
    const snapshot = await getDoc(doc(getUserCollection(user.uid, "reminders"), reminderId));
    if (!snapshot.exists()) return {ok: false, error: {
      code: "REMINDER_NOT_FOUND", message: "Rappel introuvable.",
    }};
    const original = snapshot.data() as Reminder;
    if (!original.enabled) return {ok: true, value: undefined};
    const updated: Reminder = {...original, enabled: false};
    const written = await putCloudRecord(user.uid, "reminders", reminderId, updated);
    return written.ok ? {ok: true, value: undefined} : written;
  } catch {
    return {ok: false, error: {
      code: "REMINDER_DISABLE_FAILED", message: "Désactivation du rappel indisponible.",
    }};
  }
}

/** M42 · Désactiver les rappels orphelins après changement de type ou d'horaire.
 * ownerType est un filtre de vue sur O31, jamais une collection Event/Task.
 * Cette opération ne fabrique pas d'autre rappel sans choix de l'utilisatrice.
 */
export async function reconcileReminders(
  ownerType: "event" | "task", ownerId: string,
): Promise<Result<void>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user || !ownerId || ownerId.includes("/")) return {ok: false, error: {
      code: "INVALID_ACTIVITY", message: "Activité ou session invalide.",
    }};
    const storedReminders = await fetchCloudRecords<Reminder>(user.uid, "reminders");
    if (!storedReminders.ok) return storedReminders;
    const owned = storedReminders.value.filter(item => item.activityId === ownerId && item.enabled);
    if (!owned.length) return {ok: true, value: undefined};
    const snapshot = await getDoc(doc(getUserCollection(user.uid, "activities"), ownerId));
    const activity = snapshot.exists() ? snapshot.data() as Activity : null;
    const invalidOwner = !activity || Boolean(activity.deletedAt)
      || !classifyActivity(activity).includes(ownerType);
    for (const reminder of owned) {
      let disable = invalidOwner;
      if (!disable && activity) {
        const date = reminder.occurrenceKey.slice((ownerId + "@").length);
        if (!reminder.occurrenceKey.startsWith(ownerId + "@")
          || !/^\d{4}-\d{2}-\d{2}$/.test(date)
          || !Number.isFinite(Date.parse(date + "T00:00:00Z"))) {
          disable = true;
        } else {
          const center = Date.parse(date + "T00:00:00Z");
          const occurrences = expandActivityOccurrences(activity, {
            from: new Date(center - 2 * 86_400_000).toISOString(),
            to: new Date(center + 3 * 86_400_000).toISOString(),
          });
          disable = !occurrences.some(item => item.occurrenceKey === reminder.occurrenceKey);
        }
      }
      if (disable) {
        const result = await disableReminder(reminder.id);
        if (!result.ok) return result;
      }
    }
    return {ok: true, value: undefined};
  } catch {
    return {ok: false, error: {
      code: "REMINDER_RECONCILE_FAILED", message: "Réconciliation des rappels indisponible.",
    }};
  }
}
