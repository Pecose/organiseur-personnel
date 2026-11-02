/**
 * F40 / T01 — Tests S0 autonomes.
 * Sans bibliothèques ajoutées : compilation TypeScript stricte puis exécution Node.
 * Commandes d'essai sans modifier le dépôt :
 * tsc --strict --target ES2022 --module commonjs --lib ES2022,DOM \
 *   --outDir /tmp/pecose-s0 src/domain/types.ts src/domain/dates.ts \
 *   src/features/decor.ts tests/domain.test.ts
 * node /tmp/pecose-s0/tests/domain.test.js
 */
import { expandOccurrences, formatZonedTime, normalizeInstant } from "../src/domain/dates";
import { resolveSeason } from "../src/features/decor";
import type {
  AppVersion, AuthUser, BackupEnvelope, CatalogEntry, Checklist, DaySelection,
  GoogleCalendarChange, GoogleEventLink, LocalMediaBlob, NotificationTestResult,
  PlaybackState, ProfilePreferences, RecurrenceRule, SyncStatus, UiRoute,
} from "../src/domain/types";

const baseInstant = "2026-11-02T08:00:00.000Z";
const parisStart = normalizeInstant("2026-03-29", "Europe/Paris");
if (!parisStart.ok || parisStart.value !== "2026-03-28T23:00:00.000Z") {
  throw new Error("M28 : heure d'été Paris incorrecte.");
}
const parisEnd = normalizeInstant("2026-10-25", "Europe/Paris");
if (!parisEnd.ok || parisEnd.value !== "2026-10-24T22:00:00.000Z") {
  throw new Error("M28 : heure d'hiver Paris incorrecte.");
}
const pacific = normalizeInstant("2026-01-01", "Pacific/Kiritimati");
if (!pacific.ok || pacific.value !== "2025-12-31T10:00:00.000Z") {
  throw new Error("M28 : fuseau UTC+14 incorrect.");
}
const invalidDate = normalizeInstant("2026-02-29", "Europe/Paris");
if (invalidDate.ok || invalidDate.error.code !== "INVALID_DATE") {
  throw new Error("M28 : date impossible non rejetée.");
}
const invalidZone = normalizeInstant("2026-11-02", "Europe/Atlantide");
if (invalidZone.ok || invalidZone.error.code !== "INVALID_TIME_ZONE") {
  throw new Error("M28 : fuseau inconnu non rejeté.");
}
const skipped = normalizeInstant("2011-12-30", "Pacific/Apia");
if (skipped.ok || skipped.error.code !== "SKIPPED_LOCAL_DATE") {
  throw new Error("M28 : jour entièrement sauté dans Pacific/Apia non détecté.");
}

if (formatZonedTime("2026-07-01T18:00:00.000Z", "Europe/Paris") !== "20:00") {
  throw new Error("M45 : heure de Paris en été incorrecte.");
}
if (formatZonedTime("2026-01-01T18:00:00.000Z", "Europe/Paris") !== "19:00") {
  throw new Error("M45 : heure de Paris en hiver incorrecte.");
}
let invalidInstantRejected = false;
try { formatZonedTime("n'importe quoi", "Europe/Paris"); } catch { invalidInstantRejected = true; }
if (!invalidInstantRejected) throw new Error("M45 : instant invalide accepté.");

const daily: RecurrenceRule = { frequency: "daily", interval: 2 };
const dailyOccurrences = expandOccurrences(daily, baseInstant, {
  from: baseInstant, to: "2026-11-09T08:00:00.000Z",
});
if (dailyOccurrences.map((x) => x.startsAt.slice(0, 10)).join(",") !==
  "2026-11-02,2026-11-04,2026-11-06,2026-11-08") {
  throw new Error("M29 : répétition quotidienne 2 jours incorrecte.");
}
if (dailyOccurrences[0].key !== dailyOccurrences[0].startsAt) {
  throw new Error("M29 : clé d'occurrence non stable.");
}
const limitedByCount = expandOccurrences({ ...daily, count: 2 }, baseInstant, {
  from: "2026-11-04T00:00:00.000Z", to: "2026-11-20T00:00:00.000Z",
});
if (limitedByCount.length !== 1 || !limitedByCount[0].startsAt.startsWith("2026-11-04")) {
  throw new Error("M29 : count doit s'appliquer depuis le début, même hors plage.");
}
const limitedByUntil = expandOccurrences({ ...daily, until: "2026-11-05" }, baseInstant, {
  from: baseInstant, to: "2026-11-12T00:00:00.000Z",
});
if (limitedByUntil.length !== 2) throw new Error("M29 : limite until incluse incorrecte.");
const weekly = expandOccurrences({ frequency: "weekly", interval: 2, weekdays: [1, 3] },
  baseInstant, { from: baseInstant, to: "2026-11-24T00:00:00.000Z" });
if (weekly.map((x) => x.startsAt.slice(0, 10)).join(",") !==
  "2026-11-02,2026-11-04,2026-11-16,2026-11-18") {
  throw new Error("M29 : jours choisis toutes les deux semaines incorrects.");
}
const monthly = expandOccurrences({ frequency: "monthly", interval: 1 },
  "2026-01-31T08:00:00.000Z",
  { from: "2026-01-01T00:00:00.000Z", to: "2026-04-01T00:00:00.000Z" });
if (monthly.map((x) => x.startsAt.slice(0, 10)).join(",") !== "2026-01-31,2026-03-31") {
  throw new Error("M29 : le 31 février ne doit pas être inventé.");
}
const yearly = expandOccurrences({ frequency: "yearly", interval: 1 },
  "2024-02-29T10:00:00.000Z",
  { from: "2024-01-01T00:00:00.000Z", to: "2029-01-01T00:00:00.000Z" });
if (yearly.map((x) => x.startsAt.slice(0, 10)).join(",") !== "2024-02-29,2028-02-29") {
  throw new Error("M29 : années bissextiles incorrectes.");
}
let invalidRuleRejected = false;
try { expandOccurrences({ frequency: "daily", interval: 0 }, baseInstant,
  { from: baseInstant, to: "2026-11-05T00:00:00.000Z" }); } catch { invalidRuleRejected = true; }
if (!invalidRuleRejected) throw new Error("M29 : intervalle nul non rejeté.");
let hugeRangeRejected = false;
try { expandOccurrences({ frequency: "yearly", interval: 1 }, baseInstant,
  { from: baseInstant, to: "2200-01-01T00:00:00.000Z" }); } catch { hugeRangeRejected = true; }
if (!hugeRangeRejected) throw new Error("M29 : plage immense non limitée.");

if (resolveSeason("2026-03-01", "Europe/Paris") !== "spring"
    || resolveSeason("2026-06-01", "Europe/Paris") !== "summer"
    || resolveSeason("2026-09-01", "Europe/Paris") !== "autumn"
    || resolveSeason("2026-12-01", "Europe/Paris") !== "winter") {
  throw new Error("M67 : découpage saisonnier incorrect.");
}
if (resolveSeason("2026-03-01T00:30:00.000Z", "America/New_York") !== "winter") {
  throw new Error("M67 : saison d'un instant doit utiliser le fuseau local.");
}
let invalidSeasonRejected = false;
try { resolveSeason("pas une date", "Europe/Paris"); } catch { invalidSeasonRejected = true; }
if (!invalidSeasonRejected) throw new Error("M67 : date invalide non rejetée.");

// Les objets de S0 sont soumis à un contrôle de type statique, sans I/O.
const user: AuthUser = { uid: "test-user", email: null };
const preferences: ProfilePreferences = {
  themeId: "sage", autoSeason: true, locale: "fr-FR", timeZone: "Europe/Paris",
  notificationEnabled: false, updatedAt: baseInstant,
};
const blob: LocalMediaBlob = {
  id: "local1", kind: "audio", blob: new Blob(["test"]), mimeType: "audio/mpeg",
  byteSize: 4, checksum: "fixture", importedAt: baseInstant,
};
const catalog: CatalogEntry = {
  id: "fixture", revision: "1", kind: "image", url: "/fixture.png", title: "Décor",
  checksum: "fixture", redistributionAllowed: true,
};
const sync: SyncStatus = { state: "local", pendingCount: 0 };
const backup: BackupEnvelope = {
  schemaVersion: 1, exportedAt: baseInstant, dataType: "agenda", records: [],
};
const version: AppVersion = {
  version: "0.0.0", cacheRevision: "0", catalogRevision: "0", releasedAt: baseInstant,
};
const player: PlaybackState = {
  queueIds: [], position: 0, paused: true, repeatMode: "normal", shuffle: false,
};
const route: UiRoute = { name: "day" };
const notification: NotificationTestResult = { supported: false, permitted: false, subscribed: false };
const googleLink: GoogleEventLink = {
  calendarId: "primary", googleEventId: "evt", pending: "none", source: "google",
};
const googleChange: GoogleCalendarChange = {
  calendarId: "primary", eventId: "evt", updatedAt: baseInstant,
  status: "confirmed", payload: {},
};
const checklist: Checklist = { id: "list", name: "Courses", updatedAt: baseInstant };
const selection: DaySelection = {
  selectedDate: "2026-11-02", today: "2026-11-02", source: "startup",
};
if (!user.uid || !preferences.themeId || blob.byteSize !== 4 || !catalog.redistributionAllowed
    || sync.pendingCount !== 0 || backup.records.length !== 0 || !version.version
    || player.position !== 0 || route.name !== "day" || notification.supported
    || googleLink.pending !== "none" || googleChange.status !== "confirmed"
    || !checklist.name || selection.selectedDate !== selection.today) {
  throw new Error("F17 : incohérence des objets autonomes.");
}

console.log("S0 / T01 : vérifications des 15 objets et des 4 fonctions réussies.");
