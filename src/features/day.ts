/** F51 · M131 : deux groupes Jour, indépendants des catégories métier. */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { fetchCloudRecords } from "../services/cloudRepository";
import { expandActivityOccurrences } from "./habits";
import type {
  Activity, ActivityCompletion, ActivityOccurrenceView, DayGroups, LocalDate, Result,
} from "../domain/types";

export function groupDayEntries(entries: ActivityOccurrenceView[]): DayGroups {
  const withoutTime: ActivityOccurrenceView[] = [];
  const withTime: ActivityOccurrenceView[] = [];
  for (const entry of entries) {
    if (entry.occurrence.startsAt === undefined) withoutTime.push(entry);
    else withTime.push(entry);
  }
  // Trier les copies : ne jamais modifier l'ordre des entrées fournies.
  withoutTime.sort((a, b) => a.activity.title.localeCompare(b.activity.title, "fr") ||
    a.occurrence.occurrenceKey.localeCompare(b.occurrence.occurrenceKey));
  withTime.sort((a, b) => a.occurrence.startsAt!.localeCompare(b.occurrence.startsAt!) ||
    a.occurrence.occurrenceKey.localeCompare(b.occurrence.occurrenceKey));
  return { withoutTime, withTime };
}

/** M129 · Occurrences de la date sélectionnée, jamais les tâches non datées.
 * Une lecture des activités et validations du compte suffit pour cette vue.
 */
export async function getDayEntries(
  date: LocalDate,
): Promise<Result<ActivityOccurrenceView[]>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
    || Number.isNaN(Date.parse(date + "T00:00:00Z"))
    || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) {
    return { ok: false, error: {
      code: "INVALID_DATE", message: "Date du calendrier invalide.",
    }};
  }
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return {ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connecte-toi pour afficher les activités du jour.",
    }};
    const records = await fetchCloudRecords<Activity>(user.uid, "activities");
    if (!records.ok) return records;
    const completions = await fetchCloudRecords<ActivityCompletion>(
      user.uid, "activityCompletions",
    );
    if (!completions.ok) return completions;
    const completionByKey = new Map(completions.value.map(item => [item.occurrenceKey, item]));
    const midnight = Date.parse(date + "T00:00:00Z");
    const range = {
      from: new Date(midnight - 2 * 86_400_000).toISOString(),
      to: new Date(midnight + 3 * 86_400_000).toISOString(),
    };
    const entries: ActivityOccurrenceView[] = [];
    for (const activity of records.value) {
      if (activity.deletedAt || (!activity.startAt && !activity.plannedOn)) continue;
      try {
        const occurrences = expandActivityOccurrences(activity, range);
        for (const occurrence of occurrences) {
          if (occurrence.localDate === date) {
            const completion = completionByKey.get(occurrence.occurrenceKey);
            entries.push({
              activity, occurrence,
              ...(completion ? { completion } : {}),
            });
          }
        }
      } catch {
        return { ok: false, error: {
          code: "INVALID_ACTIVITY_OCCURRENCES",
          message: "Une activité contient une récurrence invalide.",
        }};
      }
    }
    return { ok: true, value: entries };
  } catch {
    return { ok: false, error: {
      code: "DAY_UNAVAILABLE", message: "La journée ne peut pas être chargée.",
    }};
  }
}
