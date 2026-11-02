/** F49 · M130 : occurrences bornées dans le fuseau civil de l'activité. */
import type { Activity, ActivityOccurrence, DateRange } from "../domain/types";
import { expandOccurrences, normalizeInstant } from "../domain/dates";

export function expandActivityOccurrences(activity: Activity, range: DateRange): ActivityOccurrence[] {
  const fromMs = Date.parse(range.from);
  const toMs = Date.parse(range.to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    throw new RangeError("Plage UTC invalide.");
  }
  if (toMs - fromMs > 36600 * 86400000) throw new RangeError("Plage supérieure à cent ans.");
  if (!activity.plannedOn && !activity.startAt) return [];
  const zone = activity.timeZone;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, calendar: "gregory", numberingSystem: "latn",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const first = activity.startAt
    ? Object.fromEntries(fmt.formatToParts(new Date(activity.startAt))
      .map(part => [part.type, Number(part.value)])) as Record<string, number>
    : undefined;
  const anchor = activity.plannedOn || (first &&
    `${String(first.year).padStart(4, "0")}-${String(first.month).padStart(2, "0")}-${String(first.day).padStart(2, "0")}`);
  if (!anchor || !/^\d{4}-\d{2}-\d{2}$/.test(anchor) || !Number.isFinite(Date.parse(anchor + "T00:00:00Z"))) {
    throw new RangeError("Date de référence invalide.");
  }
  const candidates = activity.recurrence
    ? expandOccurrences(activity.recurrence, `${anchor}T00:00:00.000Z`, {
      from: new Date(Math.max(Date.parse(anchor + "T00:00:00.000Z"), fromMs - 3 * 86400000)).toISOString(),
      to: new Date(toMs + 3 * 86400000).toISOString(),
    }).map(x => x.startsAt.slice(0, 10))
    : [anchor];
  const duration = activity.startAt && activity.endAt
    ? Date.parse(activity.endAt) - Date.parse(activity.startAt) : undefined;
  if (duration !== undefined && duration < 0) throw new RangeError("Fin antérieure au début.");
  const result: ActivityOccurrence[] = [];
  for (const date of candidates) {
    const occurrence: ActivityOccurrence = {
      activityId: activity.id, occurrenceKey: `${activity.id}@${date}`,
      localDate: date, recurring: Boolean(activity.recurrence),
    };
    if (!activity.startAt) {
      const begin = normalizeInstant(date, zone);
      if (!begin.ok) continue;
      // Une date locale peut être supprimée lors d'un changement de fuseau.
      let nextDayMs = Date.parse(date + "T00:00:00Z") + 86400000;
      let finish = normalizeInstant(new Date(nextDayMs).toISOString().slice(0, 10), zone);
      for (let extra = 0; !finish.ok && extra < 3; extra++) {
        nextDayMs += 86400000;
        finish = normalizeInstant(new Date(nextDayMs).toISOString().slice(0, 10), zone);
      }
      if (!finish.ok) throw new RangeError("Impossible de borner le jour local.");
      if (Date.parse(begin.value) < toMs && Date.parse(finish.value) > fromMs) result.push(occurrence);
    } else {
      let startMs: number;
      if (!activity.recurrence) {
        startMs = Date.parse(activity.startAt);
      } else {
        // Résoudre l'heure locale à partir des décalages UTC voisins.
        // Heure inexistante au printemps : ignorer l'occurrence.
        // Heure répétée à l'automne : choisir la première chronologiquement.
        const [yr, mo, day] = date.split("-").map(Number);
        const target = Date.UTC(yr, mo - 1, day, first!.hour, first!.minute, first!.second,
          new Date(activity.startAt).getUTCMilliseconds());
        const matches: number[] = [];
        for (const probe of [target - 36 * 3600000, target, target + 36 * 3600000]) {
          const here = Object.fromEntries(fmt.formatToParts(new Date(probe))
            .map(part => [part.type, Number(part.value)])) as Record<string, number>;
          const offset = Date.UTC(here.year, here.month - 1, here.day,
            here.hour, here.minute, here.second) - Math.floor(probe / 1000) * 1000;
          const candidate = target - offset;
          const test = Object.fromEntries(fmt.formatToParts(new Date(candidate))
            .map(part => [part.type, Number(part.value)])) as Record<string, number>;
          if (test.year === yr && test.month === mo && test.day === day &&
              test.hour === first!.hour && test.minute === first!.minute && test.second === first!.second) {
            matches.push(candidate);
          }
        }
        if (!matches.length) continue;
        startMs = Math.min(...matches);
      }
      // `until` horodaté est une borne absolue et pas seulement civile.
      if (activity.recurrence?.until?.includes("T") &&
          startMs > Date.parse(activity.recurrence.until)) continue;
      if (startMs >= fromMs && startMs < toMs) {
        occurrence.startsAt = new Date(startMs).toISOString();
        if (duration !== undefined) occurrence.endsAt = new Date(startMs + duration).toISOString();
        result.push(occurrence);
      }
    }
  }
  return result;
}
