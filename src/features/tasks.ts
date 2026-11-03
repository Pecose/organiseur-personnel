/** F22 · Vue Tâches (M125), filtre de l'unique objet Activity O31. */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { fetchCloudRecords } from "../services/cloudRepository";
import type { Activity, ActivityCompletion, LocalDate, Result } from "../domain/types";
import { classifyActivity } from "./activities";

/** M125 · Tâches non horaires et non récurrentes, datées ou non. */
export async function listTasks(): Promise<Result<Activity[]>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return { ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connecte-toi pour consulter les tâches.",
    }};
    const result = await fetchCloudRecords<Activity>(user.uid, "activities");
    if (!result.ok) return result;
    return { ok: true, value: result.value.filter(activity =>
      !activity.deletedAt && classifyActivity(activity).includes("task")) };
  } catch {
    return { ok: false, error: {
      code: "TASKS_UNAVAILABLE", message: "Liste des tâches indisponible.",
    }};
  }
}

/** M135 · Seulement les tâches d'hier, datées, non horaires et non cycliques,
 * sans complétion confirmée ou présumée. Les décisions O36 sont filtrées
 * par M136 : cette fonction ne provoque ni dialogue ni report.
 */
export async function findMissedTasks(
  yesterday: LocalDate,
): Promise<Result<Activity[]>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yesterday)
    || Number.isNaN(Date.parse(yesterday + "T00:00:00.000Z"))
    || new Date(yesterday + "T00:00:00.000Z").toISOString().slice(0, 10) !== yesterday) {
    return {ok: false, error: {
      code: "INVALID_DATE", message: "Date de la veille invalide.",
    }};
  }
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return {ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connecte-toi pour retrouver les tâches oubliées.",
    }};
    const tasks = await listTasks();
    if (!tasks.ok) return tasks;
    const done = await fetchCloudRecords<ActivityCompletion>(
      user.uid, "activityCompletions",
    );
    if (!done.ok) return done;
    const completedKeys = new Set(done.value.filter(item =>
      item.status === "manual_done" || item.status === "auto_assumed")
      .map(item => item.occurrenceKey));
    const candidates = tasks.value.filter(task =>
      task.plannedOn === yesterday
      && !task.startAt && !task.recurrence
      && !completedKeys.has(task.id + "@" + yesterday));
    candidates.sort((a, b) =>
      (b.stars ?? 0) - (a.stars ?? 0)
      || a.title.localeCompare(b.title, "fr")
      || a.id.localeCompare(b.id));
    return {ok: true, value: candidates};
  } catch {
    return {ok: false, error: {
      code: "MISSED_TASKS_UNAVAILABLE",
      message: "Les tâches oubliées ne sont pas accessibles.",
    }};
  }
}
