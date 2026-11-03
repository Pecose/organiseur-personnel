/** F52 · Bilan mensuel O38, projection calculée sur O31/O32/O33.
 * Aucun document supplémentaire ni écriture Firestore. S8/D23 : non testé.
 */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { fetchCloudRecords } from "../services/cloudRepository";
import { expandActivityOccurrences } from "./habits";
import type {
  Activity, ActivityCompletion, MonthlyAchievement, MonthlyReview, Result,
} from "../domain/types";

/** M147 · 3→2→1 étoiles, sans étoiles en dernier, puis date chronologique.
 * Les validations présumées restent distinguées des validations manuelles.
 * Les décisions d'annulation sont exclues des accomplissements.
 */
export async function getMonthlyReview(
  month: string, stars?: 1 | 2 | 3,
): Promise<Result<MonthlyReview>> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    || (stars !== undefined && stars !== 1 && stars !== 2 && stars !== 3)) {
    return {ok: false, error: {
      code: "INVALID_REVIEW_FILTER", message: "Mois ou filtre par étoiles invalide.",
    }};
  }
  const first = new Date(month + "-01T00:00:00.000Z");
  if (Number.isNaN(first.getTime())) return {ok: false, error: {
    code: "INVALID_REVIEW_MONTH", message: "Mois invalide.",
  }};
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return {ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connexion nécessaire au bilan mensuel.",
    }};
    // Une lecture groupée par collection, sans requête par jour ou par occurrence.
    const activities = await fetchCloudRecords<Activity>(user.uid, "activities");
    if (!activities.ok) return activities;
    const completions = await fetchCloudRecords<ActivityCompletion>(
      user.uid, "activityCompletions",
    );
    if (!completions.ok) return completions;

    const next = new Date(Date.UTC(
      first.getUTCFullYear(), first.getUTCMonth() + 1, 1,
    ));
    const start = first.getTime();
    const end = next.getTime();
    const range = {
      from: new Date(start - 2 * 86_400_000).toISOString(),
      to: new Date(end + 2 * 86_400_000).toISOString(),
    };
    const accepted = new Map<string, ActivityCompletion>();
    for (const completion of completions.value) {
      if (completion.status !== "manual_done"
        && completion.status !== "auto_assumed") continue;
      if (completion.occurrenceKey !== completion.id) continue;
      const suffix = completion.occurrenceKey.slice(completion.activityId.length + 1);
      if (!completion.occurrenceKey.startsWith(completion.activityId + "@")
        || !/^\d{4}-\d{2}-\d{2}$/.test(suffix)
        || suffix.slice(0, 7) !== month) continue;
      accepted.set(completion.occurrenceKey, completion);
    }

    const entries: MonthlyAchievement[] = [];
    for (const activity of activities.value) {
      // Conserver les réalisations historiques des activités archivées.
      if (stars !== undefined && activity.stars !== stars) continue;
      if (!activity.plannedOn && !activity.startAt) continue;
      const occurrences = expandActivityOccurrences(activity, range);
      for (const occurrence of occurrences) {
        if (occurrence.localDate.slice(0, 7) !== month) continue;
        const completion = accepted.get(occurrence.occurrenceKey);
        if (!completion || completion.activityId !== activity.id) continue;
        if (completion.status !== "manual_done" && completion.status !== "auto_assumed") continue;
        entries.push({
          activity,
          occurrence,
          completion: {
            ...completion,
            status: completion.status,
          },
        });
      }
    }
    entries.sort((a, b) =>
      (b.activity.stars ?? 0) - (a.activity.stars ?? 0)
      || a.occurrence.localDate.localeCompare(b.occurrence.localDate)
      || a.occurrence.occurrenceKey.localeCompare(b.occurrence.occurrenceKey));
    const review: MonthlyReview = {
      month,
      ...(stars !== undefined ? {starFilter: stars} : {}),
      entries,
      assumedCount: entries.filter(item =>
        item.completion.status === "auto_assumed").length,
    };
    return {ok: true, value: review};
  } catch {
    return {ok: false, error: {
      code: "MONTHLY_REVIEW_UNAVAILABLE",
      message: "Le bilan mensuel ne peut pas être calculé.",
    }};
  }
}
