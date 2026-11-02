/**
 * F26 · S0 uniquement : M67, résolution pure de la saison.
 * Les fonctionnalités de galerie et d'éditeur F26 attendent les strates ultérieures.
 */
import type { Season } from "../domain/types";

/**
 * M67 — Saison météorologique de l'hémisphère Nord :
 * printemps mars–mai, été juin–août, automne septembre–novembre,
 * hiver décembre–février. Une date civile YYYY-MM-DD est locale ;
 * un instant ISO est converti dans timeZone.
 */
export function resolveSeason(date: string, timeZone: string): Season {
  // Valide aussi le fuseau quand on reçoit une simple date civile.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "numeric",
    calendar: "gregory",
    numberingSystem: "latn",
  });

  let month: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parsed = new Date(date + "T00:00:00.000Z");
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new RangeError("Date civile invalide.");
    }
    month = parsed.getUTCMonth() + 1;
  } else {
    // Interdire un texte local ambigu, qui dépendrait du fuseau du navigateur.
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(date)) {
      throw new RangeError("Instant ISO avec décalage explicite attendu.");
    }
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) throw new RangeError("Instant invalide.");
    month = Number(formatter.formatToParts(parsed).find((part) => part.type === "month")?.value);
  }
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}
