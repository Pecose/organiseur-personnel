/** F48 · S1 : classification et validation pures du seul objet métier Activity. */
import type { Activity, Result } from "../domain/types";

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
