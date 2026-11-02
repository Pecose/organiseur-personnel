/** F51 · M131 : deux groupes Jour, indépendants des catégories métier. */
import type { ActivityOccurrenceView, DayGroups } from "../domain/types";

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
