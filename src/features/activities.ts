/** F48 · S1 : classification et validation pures du seul objet métier Activity. */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { doc, getDoc, getFirestore, runTransaction } from "firebase/firestore";
import { fetchCloudRecords, getUserCollection, putCloudRecord } from "../services/cloudRepository";
import { expandActivityOccurrences } from "./habits";
import type { Activity, ActivityCompletion, ActivityDraft, ActivityOccurrenceView, ActivitySchedule, RecurrenceRule, Result } from "../domain/types";

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
    // Même ID fourni par l'appelant : ne jamais écraser une activité existante.
    if (input.id) {
      const existing = await getDoc(doc(getUserCollection(user.uid, "activities"), id));
      if (existing.exists()) return { ok: false, error: {
        code: "ACTIVITY_ALREADY_EXISTS", message: "Cet identifiant d'activité existe déjà.",
      }};
    }
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

/** M138 · Définir date et horaires sans modifier l'identité de l'activité. */
export async function setActivitySchedule(
  id: string, schedule: ActivitySchedule,
): Promise<Result<Activity>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user || !id || id.includes("/")) return { ok: false, error: {
      code: "INVALID_ACTIVITY", message: "Session ou activité invalide.",
    }};
    const snapshot = await getDoc(doc(getUserCollection(user.uid, "activities"), id));
    if (!snapshot.exists()) return { ok: false, error: {
      code: "ACTIVITY_NOT_FOUND", message: "Activité introuvable.",
    }};
    const original = snapshot.data() as Activity;
    const revised: Activity = { ...original };
    delete revised.plannedOn;
    delete revised.startAt;
    delete revised.endAt;
    if (schedule.plannedOn !== undefined) revised.plannedOn = schedule.plannedOn;
    if (schedule.startAt !== undefined) revised.startAt = schedule.startAt;
    if (schedule.endAt !== undefined) revised.endAt = schedule.endAt;
    revised.timeZone = schedule.timeZone;
    revised.autoComplete = Boolean(schedule.startAt)
      && (schedule.autoComplete ?? (original.startAt ? original.autoComplete : true));
    return await updateActivity(revised);
  } catch {
    return { ok: false, error: {
      code: "SCHEDULE_FAILED", message: "Planification indisponible.",
    }};
  }
}

/** M139 · Ajouter ou enlever la récurrence sans créer de deuxième activité. */
export async function setActivityRecurrence(
  id: string, rule: RecurrenceRule | null,
): Promise<Result<Activity>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user || !id || id.includes("/")) return { ok: false, error: {
      code: "INVALID_ACTIVITY", message: "Session ou activité invalide.",
    }};
    const snapshot = await getDoc(doc(getUserCollection(user.uid, "activities"), id));
    if (!snapshot.exists()) return { ok: false, error: {
      code: "ACTIVITY_NOT_FOUND", message: "Activité introuvable.",
    }};
    const revised = snapshot.data() as Activity;
    if (rule === null) delete revised.recurrence;
    else revised.recurrence = rule;
    return await updateActivity(revised);
  } catch {
    return { ok: false, error: {
      code: "RECURRENCE_FAILED", message: "Récurrence indisponible.",
    }};
  }
}

/** M140 · Importance 1–3 étoiles ou suppression de l'importance. */
export async function setActivityStars(
  id: string, stars: 1 | 2 | 3 | null,
): Promise<Result<Activity>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user || !id || id.includes("/")) return { ok: false, error: {
      code: "INVALID_ACTIVITY", message: "Session ou activité invalide.",
    }};
    const snapshot = await getDoc(doc(getUserCollection(user.uid, "activities"), id));
    if (!snapshot.exists()) return { ok: false, error: {
      code: "ACTIVITY_NOT_FOUND", message: "Activité introuvable.",
    }};
    const revised = snapshot.data() as Activity;
    if (stars === null) delete revised.stars;
    else revised.stars = stars;
    return await updateActivity(revised);
  } catch {
    return { ok: false, error: {
      code: "STARS_FAILED", message: "Importance indisponible.",
    }};
  }
}

/** M141 · Change uniquement l'icône affichée à gauche de la ligne. */
export async function setActivityIcon(
  id: string, iconId: string,
): Promise<Result<Activity>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user || !id || id.includes("/") || !iconId.trim()) return {
      ok: false, error: {
        code: "INVALID_ICON", message: "Icône ou activité invalide.",
      },
    };
    const snapshot = await getDoc(doc(getUserCollection(user.uid, "activities"), id));
    if (!snapshot.exists()) return { ok: false, error: {
      code: "ACTIVITY_NOT_FOUND", message: "Activité introuvable.",
    }};
    const revised = snapshot.data() as Activity;
    revised.iconId = iconId;
    return await updateActivity(revised);
  } catch {
    return { ok: false, error: {
      code: "ICON_FAILED", message: "Modification d'icône indisponible.",
    }};
  }
}

/** M142 · Une liste peut être reliée à plusieurs activités, sans transfert. */
export async function attachChecklist(
  activityId: string, checklistId: string | null,
): Promise<Result<Activity>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user || !activityId || activityId.includes("/")) return {
      ok: false, error: { code: "INVALID_ACTIVITY", message: "Activité ou session invalide." },
    };
    const snapshot = await getDoc(doc(getUserCollection(user.uid, "activities"), activityId));
    if (!snapshot.exists()) return { ok: false, error: {
      code: "ACTIVITY_NOT_FOUND", message: "Activité introuvable.",
    }};
    const revised = snapshot.data() as Activity;
    if (checklistId === null) delete revised.checklistId;
    else {
      if (!checklistId || checklistId.includes("/")) return { ok: false, error: {
        code: "INVALID_CHECKLIST", message: "Liste invalide.",
      }};
      const list = await getDoc(doc(getUserCollection(user.uid, "checklists"), checklistId));
      if (!list.exists() || list.data().archived === true) return { ok: false, error: {
        code: "CHECKLIST_NOT_FOUND", message: "Liste absente ou archivée.",
      }};
      revised.checklistId = checklistId;
    }
    return await updateActivity(revised);
  } catch {
    return { ok: false, error: {
      code: "CHECKLIST_ATTACH_FAILED", message: "Association de liste indisponible.",
    }};
  }
}

/** M155 · Lire une validation isolée (une date, pas la série complète). */
export async function getOccurrenceCompletion(
  key: string,
): Promise<Result<ActivityCompletion | null>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user || !key || key.includes("/")) return { ok: false, error: {
      code: "INVALID_OCCURRENCE", message: "Session ou occurrence invalide.",
    }};
    const result = await getDoc(doc(getUserCollection(user.uid, "activityCompletions"), key));
    return { ok: true, value: result.exists() ? result.data() as ActivityCompletion : null };
  } catch {
    return { ok: false, error: {
      code: "COMPLETION_READ_FAILED", message: "Lecture de validation indisponible.",
    }};
  }
}

/** M132 · Coche manuelle transactionnelle de la seule occurrence visée. */
export async function setOccurrenceCompletion(
  key: string, mode: "manual_done" | "pending",
): Promise<Result<ActivityCompletion>> {
  const sep = key.lastIndexOf("@");
  const activityId = key.slice(0, sep);
  const day = key.slice(sep + 1);
  if (!["manual_done", "pending"].includes(mode) || sep < 1
    || !activityId || activityId.includes("/") || key.includes("/")
    || !/^\d{4}-\d{2}-\d{2}$/.test(day)
    || !Number.isFinite(Date.parse(day + "T00:00:00Z"))
    || new Date(day + "T00:00:00Z").toISOString().slice(0, 10) !== day) {
    return {ok: false, error: {
      code: "INVALID_OCCURRENCE", message: "Occurrence ou action manuelle invalide.",
    }};
  }
  try {
    const app = getApp("organiseur-personnel");
    const user = getAuth(app).currentUser;
    if (!user) return {ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connexion requise pour valider l'occurrence.",
    }};
    const activityRef = doc(getUserCollection(user.uid, "activities"), activityId);
    const completionRef = doc(getUserCollection(user.uid, "activityCompletions"), key);
    return await runTransaction(getFirestore(app), async tx => {
      const [record, existing] = await Promise.all([
        tx.get(activityRef), tx.get(completionRef),
      ]);
      if (!record.exists() || (record.data() as Activity).deletedAt) return {
        ok: false, error: {
          code: "ACTIVITY_NOT_FOUND", message: "Activité absente ou archivée.",
        },
      } as Result<ActivityCompletion>;
      const parent = record.data() as Activity;
      const center = Date.parse(day + "T00:00:00Z");
      const matches = expandActivityOccurrences(parent, {
        from: new Date(center - 2 * 86_400_000).toISOString(),
        to: new Date(center + 3 * 86_400_000).toISOString(),
      });
      if (!matches.some(item => item.occurrenceKey === key)) return {
        ok: false, error: {
          code: "OCCURRENCE_NOT_FOUND", message: "Cette occurrence n'existe plus.",
        },
      } as Result<ActivityCompletion>;
      const before = existing.exists() ? existing.data() as ActivityCompletion : null;
      if (before?.status === "manual_done" && mode === "manual_done") {
        return {ok: true, value: before} as Result<ActivityCompletion>;
      }
      if (mode === "pending" && before && before.status !== "pending") return {
        ok: false, error: {
          code: "USE_MANUAL_UNDO", message: "Utilise l'annulation manuelle pour retirer la coche.",
        },
      } as Result<ActivityCompletion>;
      const now = new Date().toISOString();
      const completion: ActivityCompletion = {
        id: key, activityId, occurrenceKey: key,
        status: mode, updatedAt: now,
        ...(mode === "manual_done" ? {completedAt: now} : {}),
      };
      tx.set(completionRef, completion);
      return {ok: true, value: completion} as Result<ActivityCompletion>;
    });
  } catch {
    return {ok: false, error: {
      code: "COMPLETION_TRANSACTION_FAILED",
      message: "Coche non confirmée. Une connexion est nécessaire.",
    }};
  }
}

/** M134 · Veto atomique : l'autovalidation concurrente ne peut plus le remplacer. */
export async function undoOccurrenceCompletion(
  key: string,
): Promise<Result<ActivityCompletion>> {
  if (!key || !key.includes("@") || key.includes("/")) return {
    ok: false, error: {
      code: "INVALID_OCCURRENCE", message: "Clé d'occurrence invalide.",
    },
  };
  try {
    const app = getApp("organiseur-personnel");
    const user = getAuth(app).currentUser;
    if (!user) return {ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connexion requise pour retirer une coche.",
    }};
    const reference = doc(getUserCollection(user.uid, "activityCompletions"), key);
    return await runTransaction(getFirestore(app), async tx => {
      const snapshot = await tx.get(reference);
      if (!snapshot.exists()) return {ok: false, error: {
        code: "COMPLETION_NOT_FOUND", message: "Aucune coche à annuler.",
      }} as Result<ActivityCompletion>;
      const before = snapshot.data() as ActivityCompletion;
      if (before.occurrenceKey !== key || before.id !== key
        || before.activityId !== key.slice(0, key.lastIndexOf("@"))) {
        return {ok: false, error: {
          code: "COMPLETION_MISMATCH", message: "La coche ne correspond pas à l'occurrence.",
        }} as Result<ActivityCompletion>;
      }
      if (before.status === "manually_undone") return {
        ok: true, value: before,
      } as Result<ActivityCompletion>;
      const now = new Date().toISOString();
      const completion: ActivityCompletion = {
        ...before,
        status: "manually_undone",
        overriddenAt: now,
        updatedAt: now,
      };
      delete completion.completedAt;
      tx.set(reference, completion);
      return {ok: true, value: completion} as Result<ActivityCompletion>;
    });
  } catch {
    return {ok: false, error: {
      code: "COMPLETION_UNDO_FAILED",
      message: "Annulation non enregistrée. Réessaie en ligne.",
    }};
  }
}

/** M158 · Présomption atomique ; une annulation manuelle a toujours priorité.
 * Relecture de O31 et O33 dans la même transaction Firestore. Pas de Push ni timer.
 */
export async function markAutoCompletion(
  key: string, at: string,
): Promise<Result<ActivityCompletion>> {
  const sep = key.lastIndexOf("@");
  const activityId = key.slice(0, sep);
  const localDate = key.slice(sep + 1);
  const nowMs = Date.parse(at);
  if (sep < 1 || !activityId || activityId.includes("/") || key.includes("/")
    || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)
    || !Number.isFinite(Date.parse(localDate + "T00:00:00Z"))
    || new Date(localDate + "T00:00:00Z").toISOString().slice(0, 10) !== localDate
    || !Number.isFinite(nowMs)) return {ok: false, error: {
    code: "INVALID_OCCURRENCE", message: "Occurrence ou instant invalide.",
  }};
  try {
    const app = getApp("organiseur-personnel");
    const user = getAuth(app).currentUser;
    if (!user) return {ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connexion requise pour la validation automatique.",
    }};
    const activityRef = doc(getUserCollection(user.uid, "activities"), activityId);
    const completionRef = doc(getUserCollection(user.uid, "activityCompletions"), key);
    return await runTransaction(getFirestore(app), async tx => {
      const [storedActivity, storedCompletion] = await Promise.all([
        tx.get(activityRef), tx.get(completionRef),
      ]);
      if (!storedActivity.exists()) return {ok: false, error: {
        code: "ACTIVITY_NOT_FOUND", message: "Activité introuvable.",
      }} as Result<ActivityCompletion>;
      const activity = storedActivity.data() as Activity;
      if (activity.uid !== user.uid || activity.deletedAt || !activity.autoComplete) {
        return {ok: false, error: {
          code: "AUTO_COMPLETION_DISABLED", message: "Validation automatique indisponible.",
        }} as Result<ActivityCompletion>;
      }
      const center = Date.parse(localDate + "T00:00:00Z");
      const occurrences = expandActivityOccurrences(activity, {
        from: new Date(center - 2 * 86_400_000).toISOString(),
        to: new Date(center + 3 * 86_400_000).toISOString(),
      });
      const occurrence = occurrences.find(item => item.occurrenceKey === key);
      if (!occurrence) return {ok: false, error: {
        code: "OCCURRENCE_NOT_FOUND", message: "Occurrence absente ou déplacée.",
      }} as Result<ActivityCompletion>;
      const previous = storedCompletion.exists()
        ? storedCompletion.data() as ActivityCompletion : null;
      if (!shouldAutoComplete({
        activity, occurrence, ...(previous ? {completion: previous} : {}),
      }, at)) return {ok: false, error: {
        code: "AUTO_COMPLETION_NOT_DUE",
        message: "Déjà validé, annulé manuellement ou horaire non atteint.",
      }} as Result<ActivityCompletion>;
      const now = new Date().toISOString();
      const completion: ActivityCompletion = {
        id: key, activityId, occurrenceKey: key,
        status: "auto_assumed", completedAt: at, updatedAt: now,
      };
      tx.set(completionRef, completion);
      return {ok: true, value: completion} as Result<ActivityCompletion>;
    });
  } catch {
    return {ok: false, error: {
      code: "AUTO_COMPLETION_TRANSACTION_FAILED",
      message: "Validation non confirmée. Réessaie lorsque la connexion est disponible.",
    }};
  }
}

/** M154 · Réconciliation bornée à sept jours et 25 coches par reprise.
 * Firestore ne fournit pas d'alarme OS en arrière-plan ; cette routine est
 * invoquée à l'ouverture/retour au premier plan de la PWA.
 */
export async function reconcileDueAutoCompletions(
  now: string,
): Promise<Result<number>> {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return {ok: false, error: {
    code: "INVALID_INSTANT", message: "Date de reprise invalide.",
  }};
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return {ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connexion requise pour les validations.",
    }};
    const { getAppState } = await import("../app/state");
    const zone = getAppState().preferences.timeZone;
    const localToday = new Date(nowMs).toLocaleDateString("sv-SE", {timeZone: zone});
    const todayUtc = Date.parse(localToday + "T00:00:00Z");
    if (!Number.isFinite(todayUtc)) return {ok: false, error: {
      code: "INVALID_TIME_ZONE", message: "Fuseau ou date locale invalide.",
    }};
    // Sept jours civils dont aujourd'hui ; marges DST pour l'expansion.
    const lower = todayUtc - 6 * 86_400_000;
    const range = {
      from: new Date(lower - 2 * 86_400_000).toISOString(),
      to: new Date(todayUtc + 3 * 86_400_000).toISOString(),
    };
    const [activityRecords, completionRecords] = await Promise.all([
      fetchCloudRecords<Activity>(user.uid, "activities"),
      fetchCloudRecords<ActivityCompletion>(user.uid, "activityCompletions"),
    ]);
    if (!activityRecords.ok) return activityRecords;
    if (!completionRecords.ok) return completionRecords;
    const byKey = new Map(completionRecords.value.map(c => [c.occurrenceKey, c]));
    const due: {key: string; at: string; deadline: number}[] = [];
    for (const activity of activityRecords.value) {
      if (activity.deletedAt || !activity.autoComplete || !activity.startAt) continue;
      const occurrences = expandActivityOccurrences(activity, range);
      for (const occurrence of occurrences) {
        const localTime = Date.parse(occurrence.localDate + "T00:00:00Z");
        if (localTime < lower || localTime > todayUtc) continue;
        const completion = byKey.get(occurrence.occurrenceKey);
        if (!shouldAutoComplete({
          activity, occurrence, ...(completion ? {completion} : {}),
        }, now)) continue;
        const timestamp = occurrence.endsAt ?? occurrence.startsAt;
        if (timestamp) due.push({
          key: occurrence.occurrenceKey,
          at: now,
          deadline: Date.parse(timestamp),
        });
      }
    }
    due.sort((a, b) => a.deadline - b.deadline || a.key.localeCompare(b.key));
    let count = 0;
    for (const candidate of due.slice(0, 25)) {
      const saved = await markAutoCompletion(candidate.key, candidate.at);
      if (saved.ok) count++;
      else if (!["AUTO_COMPLETION_NOT_DUE", "AUTO_COMPLETION_DISABLED",
        "OCCURRENCE_NOT_FOUND"].includes(saved.error.code)) return saved;
    }
    return {ok: true, value: count};
  } catch {
    return {ok: false, error: {
      code: "AUTO_RECONCILE_FAILED",
      message: "Réconciliation impossible, aucune confirmation automatique annoncée.",
    }};
  }
}
