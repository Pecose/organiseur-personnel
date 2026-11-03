/** F21 · Calendrier unifié O31/O32, aucune collection « events » distincte. */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { fetchCloudRecords } from "../services/cloudRepository";
import { expandActivityOccurrences } from "./habits";
import { getDayEntries } from "./day";
import { setSelectedDay } from "../app/state";
import { navigate } from "../app/router";
import type {
  Activity, CalendarDaySummary, LocalDate, Result,
} from "../domain/types";

/** M156 · Résumé de la date. Aucune duplication des événements. */
export async function summarizeCalendarDay(
  date: LocalDate,
): Promise<Result<CalendarDaySummary>> {
  const entries = await getDayEntries(date);
  if (!entries.ok) return entries;
  return { ok: true, value: {
    date,
    count: entries.value.length,
    labels: entries.value.slice(0, 3).map(item => item.activity.title),
  }};
}

/** M127 · Semaine du lundi au dimanche, une seule lecture cloud pour sept jours.
 * Les six premières journées sont affichées, le dimanche est dépliable en UI.
 */
export async function getCalendarWeek(
  monday: LocalDate,
): Promise<Result<CalendarDaySummary[]>> {
  const start = new Date(monday + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(monday) || Number.isNaN(start.getTime())
    || start.toISOString().slice(0, 10) !== monday || start.getUTCDay() !== 1) {
    return {ok: false, error: {
      code: "INVALID_WEEK_START", message: "Le calendrier attend un lundi valide.",
    }};
  }
  const days: LocalDate[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
  }
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return {ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connecte-toi pour consulter les rendez-vous.",
    }};
    const records = await fetchCloudRecords<Activity>(user.uid, "activities");
    if (!records.ok) return records;
    const summaries = days.map(date => ({date, count: 0, labels: [] as string[]}));
    const lower = start.getTime();
    const range = {
      from: new Date(lower - 2 * 86_400_000).toISOString(),
      to: new Date(lower + 9 * 86_400_000).toISOString(),
    };
    for (const activity of records.value) {
      if (activity.deletedAt || (!activity.startAt && !activity.plannedOn)) continue;
      try {
        const occurrences = expandActivityOccurrences(activity, range);
        for (const occurrence of occurrences) {
          const summary = summaries.find(item => item.date === occurrence.localDate);
          if (!summary) continue;
          summary.count += 1;
          if (summary.labels.length < 3) summary.labels.push(activity.title);
        }
      } catch {
        return {ok: false, error: {
          code: "INVALID_CALENDAR_ITEM",
          message: "Un événement possède une règle de calendrier invalide.",
        }};
      }
    }
    return {ok: true, value: summaries};
  } catch {
    return {ok: false, error: {
      code: "CALENDAR_UNAVAILABLE", message: "Calendrier indisponible.",
    }};
  }
}

/** M128 · Toucher une date ouvre Jour sur cette même date. */
export function selectCalendarDate(date: LocalDate): void {
  setSelectedDay(date, "calendar");
  navigate({name: "day"});
}
