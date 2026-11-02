/**
 * F18 · Utilitaires purs de dates (S0).
 * Les calculs d'occurrences à heure locale d'une Activity sont réservés à M130/S2.
 * Aucune dépendance réseau, Firebase ou bibliothèques externes.
 */
import type { DateRange, ISOInstant, Occurrence, RecurrenceRule, Result } from "./types";

/**
 * M28 — Premier instant existant d'une date civile dans le fuseau demandé.
 * Les frontières de journées DST peuvent être 23 h ou 25 h ; ne jamais
 * supposer qu'un jour local correspond à 00:00 UTC.
 */
export function normalizeInstant(localDate: string, timeZone: string): Result<string> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) {
    return { ok: false, error: { code: "INVALID_DATE", message: "Date attendue au format YYYY-MM-DD." } };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (year < 100 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return { ok: false, error: { code: "INVALID_DATE", message: "Date civile inexistante." } };
  }

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return { ok: false, error: { code: "INVALID_TIME_ZONE", message: "Fuseau horaire IANA invalide." } };
  }

  // Une date civile locale peut commencer à UTC±14 h. Recherche monotone
  // du premier milliseconde correspondant à cette date (ou la suivant).
  const target = year * 10_000 + month * 100 + day;
  const center = check.getTime();
  let low = center - 2 * 86_400_000;
  let high = center + 2 * 86_400_000;

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    const parts = formatter.formatToParts(new Date(mid));
    const yy = Number(parts.find((part) => part.type === "year")?.value);
    const mm = Number(parts.find((part) => part.type === "month")?.value);
    const dd = Number(parts.find((part) => part.type === "day")?.value);
    const observed = yy * 10_000 + mm * 100 + dd;
    if (observed < target) low = mid + 1;
    else high = mid;
  }

  const actual = formatter.formatToParts(new Date(low));
  const dateSeen = Number(actual.find((p) => p.type === "year")?.value) * 10_000
    + Number(actual.find((p) => p.type === "month")?.value) * 100
    + Number(actual.find((p) => p.type === "day")?.value);
  if (dateSeen !== target) {
    return { ok: false, error: { code: "SKIPPED_LOCAL_DATE", message: "Cette date civile n'existe pas dans le fuseau choisi." } };
  }

  return { ok: true, value: new Date(low).toISOString() };
}

/**
 * M29 — Expansion UTC générique, fenêtre [from, to).
 * Pour les habitudes à heure locale (ex. chaque mercredi à 19 h Paris),
 * utiliser ensuite M130/S2 avec le fuseau d'Activity.
 */
export function expandOccurrences(rule: RecurrenceRule, base: string, range: DateRange): Occurrence[] {
  if (!Number.isInteger(rule.interval) || rule.interval < 1
      || (rule.count !== undefined && (!Number.isInteger(rule.count) || rule.count < 1))
      || (rule.weekdays !== undefined && (rule.weekdays.length === 0
        || rule.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)))) {
    throw new RangeError("Règle de récurrence invalide.");
  }

  const anchor = new Date(base);
  const from = new Date(range.from);
  const to = new Date(range.to);
  if (Number.isNaN(anchor.getTime()) || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())
      || from.getTime() >= to.getTime()) {
    throw new RangeError("Date de début ou intervalle invalide.");
  }
  if (!["daily", "weekly", "monthly", "yearly"].includes(rule.frequency)) {
    throw new RangeError("Fréquence inconnue.");
  }

  let untilMillis = Number.POSITIVE_INFINITY;
  if (rule.until !== undefined) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(rule.until)) {
      const lastDay = new Date(rule.until + "T00:00:00.000Z");
      if (Number.isNaN(lastDay.getTime()) || lastDay.toISOString().slice(0, 10) !== rule.until) {
        throw new RangeError("Date de fin invalide.");
      }
      untilMillis = lastDay.getTime() + 86_400_000 - 1;
    } else {
      untilMillis = Date.parse(rule.until);
      if (Number.isNaN(untilMillis)) throw new RangeError("Date de fin invalide.");
    }
  }

  const baseMillis = anchor.getTime();
  const upper = Math.min(to.getTime() - 1, untilMillis);
  if (upper < baseMillis) return [];
  // Garde-fou explicite contre des requêtes couvrant plusieurs siècles.
  const days = Math.floor((upper - baseMillis) / 86_400_000);
  if (days > 36_600) throw new RangeError("Plage de récurrence trop longue (> 100 ans).");

  const startDay = Math.floor(baseMillis / 86_400_000) * 86_400_000;
  const baseWeekDay = (anchor.getUTCDay() + 6) % 7; // lundi=0.
  const weekStart = startDay - baseWeekDay * 86_400_000;
  const baseYear = anchor.getUTCFullYear();
  const baseMonth = anchor.getUTCMonth();
  const baseDate = anchor.getUTCDate();
  const baseIsoWeekday = baseWeekDay + 1;
  const results: Occurrence[] = [];
  let occurrenceNumber = 0;

  for (let offset = 0; offset <= days; offset += 1) {
    const at = baseMillis + offset * 86_400_000;
    const d = new Date(at);
    const weekday = (d.getUTCDay() + 6) % 7 + 1;
    let applies = false;

    if (rule.frequency === "daily") {
      applies = offset % rule.interval === 0;
    } else if (rule.frequency === "weekly") {
      const weekIndex = Math.floor((Math.floor(at / 86_400_000) * 86_400_000
        - ((weekday + 6) % 7) * 86_400_000 - weekStart) / (7 * 86_400_000));
      applies = weekIndex % rule.interval === 0
        && (rule.weekdays ? rule.weekdays.includes(weekday) : weekday === baseIsoWeekday);
    } else if (rule.frequency === "monthly") {
      const deltaMonths = (d.getUTCFullYear() - baseYear) * 12 + (d.getUTCMonth() - baseMonth);
      applies = deltaMonths % rule.interval === 0 && d.getUTCDate() === baseDate;
    } else {
      applies = (d.getUTCFullYear() - baseYear) % rule.interval === 0
        && d.getUTCMonth() === baseMonth && d.getUTCDate() === baseDate;
    }

    if (!applies || at > untilMillis) continue;
    occurrenceNumber += 1;
    if (rule.count !== undefined && occurrenceNumber > rule.count) break;

    if (at >= from.getTime() && at < to.getTime()) {
      const iso: ISOInstant = d.toISOString();
      results.push({ key: iso, startsAt: iso });
      if (results.length > 10_000) throw new RangeError("Trop d'occurrences dans une seule plage.");
    }
  }
  return results;
}

/** M45 — Horaire HH:mm d'un instant dans un fuseau IANA, format 24 h. */
export function formatZonedTime(instant: string, timeZone: string): string {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) throw new RangeError("Instant invalide.");
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(parsed);
}
