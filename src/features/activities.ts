/** F48 · S1 : classification et validation pures du seul objet métier Activity. */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { getUserCollection, putCloudRecord } from "../services/cloudRepository";
import type { Activity, ActivityDraft, ActivityOccurrenceView, Result } from "../domain/types";

/** M124 : les vues se recoupent ; une habitude horaire est aussi un événement. */
export function classifyActivity(activity: Activity): ("task" | "habit" | "event")[] {
  const views: ("task" | "habit" | "event")[] = [];
  if (!activity.recurrence && !activity.startAt) views.push("task");
  if (activity.recurrence) views.push("habit");
  if (activity.startAt) views.push("event");
  return views;
}

/**
 * M157 : n'accepte qu'une structure O31 complète et cohérente.
 * Ne lit pas Firestore, ne transforme pas l'objet et ne fabrique pas d'ID.
 */
export function validateActivity(input: unknown): Result<Activity> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: { code: "INVALID_ACTIVITY", message: "Activité attendue." } };
  }
  const data = input as Record<string, unknown>;
  if (typeof data.id !== "string" || !data.id.trim()
    || typeof data.uid !== "string" || !data.uid.trim()
    || typeof data.title !== "string" || !data.title.trim()
    || typeof data.timeZone !== "string" || !data.timeZone.trim()
    || typeof data.autoComplete !== "boolean") {
    return { ok: false, error: { code: "INVALID_ACTIVITY", message: "Identité, titre, fuseau ou validation manquants." } };
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: data.timeZone });
  } catch {
    return { ok: false, error: { code: "INVALID_TIME_ZONE", message: "Fuseau horaire invalide." } };
  }
  if (typeof data.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(data.updatedAt)
    || Number.isNaN(Date.parse(data.updatedAt))) {
    return { ok: false, error: { code: "INVALID_INSTANT", message: "Date de modification UTC invalide." } };
  }
  for (const name of ["description", "iconId", "imageId", "checklistId"] as const) {
    if (data[name] !== undefined && typeof data[name] !== "string") {
      return { ok: false, error: { code: "INVALID_ACTIVITY", message: "Champ texte invalide : " + name } };
    }
  }
  if (data.stars !== undefined && data.stars !== 1 && data.stars !== 2 && data.stars !== 3) {
    return { ok: false, error: { code: "INVALID_STARS", message: "Importance comprise entre 1 et 3 étoiles." } };
  }
  if (data.plannedOn !== undefined) {
    if (typeof data.plannedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.plannedOn)) {
      return { ok: false, error: { code: "INVALID_DATE", message: "Date civile attendue au format YYYY-MM-DD." } };
    }
    const parsedDate = new Date(data.plannedOn + "T00:00:00.000Z");
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== data.plannedOn) {
      return { ok: false, error: { code: "INVALID_DATE", message: "Date civile inexistante." } };
    }
  }
  for (const name of ["startAt", "endAt", "deletedAt"] as const) {
    if (data[name] !== undefined && (typeof data[name] !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(data[name])
      || Number.isNaN(Date.parse(data[name])))) {
      return { ok: false, error: { code: "INVALID_INSTANT", message: "Instant UTC invalide : " + name } };
    }
  }
  if (data.endAt !== undefined && (data.startAt === undefined
    || Date.parse(data.endAt as string) < Date.parse(data.startAt as string))) {
    return { ok: false, error: { code: "INVALID_SCHEDULE", message: "Heure de fin antérieure au début ou début absent." } };
  }
  if (data.autoComplete && data.startAt === undefined) {
    return { ok: false, error: { code: "INVALID_SCHEDULE", message: "Validation automatique sans horaire." } };
  }
  if (data.recurrence !== undefined) {
    if (typeof data.recurrence !== "object" || data.recurrence === null || Array.isArray(data.recurrence)) {
      return { ok: false, error: { code: "INVALID_RECURRENCE", message: "Règle cyclique invalide." } };
    }
    const rule = data.recurrence as Record<string, unknown>;
    if (!(["daily", "weekly", "monthly", "yearly"] as unknown[]).includes(rule.frequency)
      || !Number.isInteger(rule.interval) || (rule.interval as number) < 1
      || (rule.count !== undefined && (!Number.isInteger(rule.count) || (rule.count as number) < 1))
      || (rule.until !== undefined && (typeof rule.until !== "string" || Number.isNaN(Date.parse(rule.until))))
      || (rule.weekdays !== undefined && (!Array.isArray(rule.weekdays) || rule.weekdays.length === 0
        || rule.weekdays.some((day: unknown) => !Number.isInteger(day) || (day as number) < 1 || (day as number) > 7)))) {
      return { ok: false, error: { code: "INVALID_RECURRENCE", message: "Fréquence, intervalle, fin ou jours invalides." } };
    }
  }
  if (data.googleLink !== undefined) {
    if (typeof data.googleLink !== "object" || data.googleLink === null || Array.isArray(data.googleLink)) {
      return { ok: false, error: { code: "INVALID_GOOGLE_LINK", message: "Liaison agenda invalide." } };
    }
    const link = data.googleLink as Record<string, unknown>;
    if (typeof link.calendarId !== "string" || !link.calendarId
      || typeof link.googleEventId !== "string" || !link.googleEventId
      || link.pending !== "none" && link.pending !== "upsert" && link.pending !== "delete"
      || link.source !== "app" && link.source !== "google") {
      return { ok: false, error: { code: "INVALID_GOOGLE_LINK", message: "Identifiants ou état de liaison invalides." } };
    }
    for (const name of ["etag", "remoteUpdatedAt"] as const) {
      if (link[name] !== undefined && typeof link[name] !== "string") {
        return { ok: false, error: { code: "INVALID_GOOGLE_LINK", message: "Métadonnée Google invalide." } };
      }
    }
  }
  return { ok: true, value: input as Activity };
}

/**
 * M133 (S3) · Prédicat pur de validation automatique.
 * Chaque décision concerne une occurrence, pas toute la série récurrente.
 * Une coche manuelle, une présomption déjà inscrite ou une annulation explicite
 * sont prioritaires sur l'heure passée. Le statut "pending" reste éligible.
 *
 * La persistance et le traitement au retour de l'application seront assurés
 * ultérieurement par M158/M154, sans minuteur Web ni appel serveur ici.
 */
export function shouldAutoComplete(occ: ActivityOccurrenceView, now: string): boolean {
  if (!occ.activity.autoComplete || occ.activity.id !== occ.occurrence.activityId) {
    return false;
  }
  if (occ.completion) {
    // Ne jamais utiliser la validation d'un autre mercredi ou d'une autre activité.
    if (occ.completion.activityId !== occ.occurrence.activityId
        || occ.completion.occurrenceKey !== occ.occurrence.occurrenceKey) {
      return false;
    }
    // "manually_undone" interdit tout recochage, "manual_done" et
    // "auto_assumed" signifient qu'il n'y a rien à refaire.
    if (occ.completion.status !== "pending") return false;
  }

  // Une date seule ne représente pas un créneau horaire.
  // La fin prime toujours si elle existe.
  const scheduledAt = occ.occurrence.endsAt ?? occ.occurrence.startsAt;
  if (scheduledAt === undefined) return false;

  const deadlineMs = Date.parse(scheduledAt);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(nowMs)) return false;
  return nowMs >= deadlineMs;
}

/** M121 · Une activité canonique, à ID stable ; aucune catégorie stockée. */
export async function createActivity(input: ActivityDraft): Promise<Result<Activity>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return { ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connecte-toi pour créer une activité.",
    }};
    const id = input.id ?? crypto.randomUUID();
    const { id: _draftId, autoComplete: requestedAuto, ...fields } = input;
    const candidate: Activity = {
      ...fields,
      id,
      uid: user.uid,
      autoComplete: requestedAuto ?? Boolean(input.startAt),
      updatedAt: new Date().toISOString(),
    };
    const valid = validateActivity(candidate);
    if (!valid.ok) return valid;
    const clean = Object.fromEntries(Object.entries(valid.value)
      .filter(([_name, value]) => value !== undefined)) as Activity;
    const saved = await putCloudRecord(user.uid, "activities", id, clean);
    if (!saved.ok) return saved;
    return { ok: true, value: clean };
  } catch {
    return { ok: false, error: {
      code: "CREATE_ACTIVITY_FAILED", message: "Création impossible ou session indisponible.",
    }};
  }
}

/** M122 · Écriture du même ID, jamais de duplication en changeant le planning. */
export async function updateActivity(activity: Activity): Promise<Result<Activity>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user || user.uid !== activity.uid) return { ok: false, error: {
      code: "AUTH_REQUIRED", message: "Cette activité n'appartient pas à la session active.",
    }};
    const ref = doc(getUserCollection(user.uid, "activities"), activity.id);
    const original = await getDoc(ref);
    if (!original.exists()) return { ok: false, error: {
      code: "ACTIVITY_NOT_FOUND", message: "Activité introuvable.",
    }};
    const existing = original.data() as Activity;
    if (existing.deletedAt) return { ok: false, error: {
      code: "ACTIVITY_ARCHIVED", message: "Activité déjà supprimée.",
    }};
    const candidate: Activity = {
      ...activity,
      uid: user.uid,
      id: existing.id,
      googleLink: activity.googleLink ?? existing.googleLink,
      updatedAt: new Date().toISOString(),
    };
    const valid = validateActivity(candidate);
    if (!valid.ok) return valid;
    const clean = Object.fromEntries(Object.entries(valid.value)
      .filter(([_name, value]) => value !== undefined)) as Activity;
    const saved = await putCloudRecord(user.uid, "activities", existing.id, clean);
    if (!saved.ok) return saved;
    return { ok: true, value: clean };
  } catch {
    return { ok: false, error: {
      code: "UPDATE_ACTIVITY_FAILED", message: "Modification impossible.",
    }};
  }
}

/** M123 · Tombstone, sans effacer la liste associée ni les réalisations. */
export async function deleteActivity(id: string): Promise<Result<void>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user || !id || id.includes("/")) return { ok: false, error: {
      code: "INVALID_ACTIVITY", message: "Session ou identifiant invalide.",
    }};
    const snapshot = await getDoc(doc(getUserCollection(user.uid, "activities"), id));
    if (!snapshot.exists()) return { ok: false, error: {
      code: "ACTIVITY_NOT_FOUND", message: "Activité introuvable.",
    }};
    const activity = snapshot.data() as Activity;
    if (activity.deletedAt) return { ok: true, value: undefined };
    const now = new Date().toISOString();
    const archived: Activity = {
      ...activity,
      deletedAt: now,
      updatedAt: now,
      googleLink: activity.googleLink
        ? { ...activity.googleLink, pending: "delete" } : undefined,
    };
    const valid = validateActivity(archived);
    if (!valid.ok) return valid;
    const clean = Object.fromEntries(Object.entries(archived)
      .filter(([_name, value]) => value !== undefined)) as Activity;
    const written = await putCloudRecord(user.uid, "activities", id, clean);
    if (!written.ok) return written;
    return { ok: true, value: undefined };
  } catch {
    return { ok: false, error: {
      code: "DELETE_ACTIVITY_FAILED", message: "Archivage impossible.",
    }};
  }
}
