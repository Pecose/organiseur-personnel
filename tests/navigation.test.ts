/** F55 : tests S2 de M130/M131 et typage des cinq objets composés. */
import { expandActivityOccurrences } from "../src/features/habits";
import { groupDayEntries } from "../src/features/day";
import type {
  Activity, ActivityOccurrence, Playlist, GoogleCalendarConnection,
  CalendarSyncConflict, CarryOverDecision,
} from "../src/domain/types";

const baseline: Activity = {
  id: "theatre", uid: "owner", title: "Théâtre",
  startAt: "2026-03-18T18:00:00.000Z", timeZone: "Europe/Paris",
  autoComplete: true, updatedAt: "2026-03-18T18:00:00.000Z",
  recurrence: { frequency: "weekly", interval: 1, weekdays: [3] },
};
const weekly = expandActivityOccurrences(baseline, {
  from: "2026-03-18T00:00:00Z", to: "2026-04-09T00:00:00Z",
});
if (weekly.length !== 4 || weekly[0].startsAt !== "2026-03-18T18:00:00.000Z"
  || weekly[2].startsAt !== "2026-04-01T17:00:00.000Z"
  || weekly.some(x => x.occurrenceKey !== `theatre@${x.localDate}` || !x.recurring)) {
  throw new Error("S2/M130 : répétition mercredi 19 h / DST ou identité instable.");
}
const reading: Activity = {
  ...baseline, id: "read", title: "Lire",
  plannedOn: "2026-03-18", startAt: undefined, autoComplete: false,
};
const allDay = expandActivityOccurrences(reading, {
  from: "2026-03-20T00:00:00Z", to: "2026-04-02T00:00:00Z",
});
if (allDay.map(x => x.localDate).join(",") !== "2026-03-25,2026-04-01"
  || allDay.some(x => x.startsAt !== undefined)) {
  throw new Error("S2/M130 : récurrences sans horaire incorrectes.");
}
const monthly: Activity = {
  ...reading, id: "monthly", plannedOn: "2026-01-31",
  recurrence: { frequency: "monthly", interval: 1 },
};
const monthDates = expandActivityOccurrences(monthly, {
  from: "2026-01-01T00:00:00Z", to: "2026-04-01T00:00:00Z",
});
if (monthDates.map(x => x.localDate).join(",") !== "2026-01-31,2026-03-31") {
  throw new Error("S2/M130 : le 31 février ne doit jamais exister.");
}
const leap: Activity = {
  ...reading, id: "leap", plannedOn: "2024-02-29",
  recurrence: { frequency: "yearly", interval: 1 },
};
const leapDates = expandActivityOccurrences(leap, {
  from: "2024-01-01T00:00:00Z", to: "2029-01-01T00:00:00Z",
});
if (leapDates.map(x => x.localDate).join(",") !== "2024-02-29,2028-02-29") {
  throw new Error("S2/M130 : répétition anniversaire 29 février incorrecte.");
}
const count: Activity = {
  ...reading, id: "count", recurrence: { frequency: "weekly", interval: 1, weekdays: [3], count: 2 },
};
const countDates = expandActivityOccurrences(count, {
  from: "2026-03-24T00:00:00Z", to: "2026-04-20T00:00:00Z",
});
if (countDates.map(x => x.localDate).join(",") !== "2026-03-25") {
  throw new Error("S2/M130 : count doit inclure les occurrences avant la plage.");
}
const oneShot: Activity = { ...baseline, recurrence: undefined };
const once = expandActivityOccurrences(oneShot, {
  from: "2026-03-18T00:00:00Z", to: "2026-03-19T00:00:00Z",
});
if (once.length !== 1 || once[0].recurring) throw new Error("S2/M130 : événement unique incorrect.");
if (expandActivityOccurrences({ ...baseline, id: "inbox", plannedOn: undefined, startAt: undefined },
  { from: "2026-03-01T00:00:00Z", to: "2026-04-01T00:00:00Z" }).length !== 0) {
  throw new Error("S2/M130 : tâche non datée ne doit pas apparaître dans Jour.");
}
const grouped = groupDayEntries([
  { activity: baseline, occurrence: weekly[1] },
  { activity: reading, occurrence: allDay[0] },
  { activity: baseline, occurrence: weekly[0] },
]);
if (grouped.withoutTime.length !== 1 || grouped.withTime.length !== 2
  || grouped.withTime[0].occurrence.startsAt !== weekly[0].startsAt) {
  throw new Error("S2/M131 : groupes sans horaire puis ordre chronologique incorrect.");
}
const expectedId = weekly[0].occurrenceKey;
const item: ActivityOccurrence = weekly[0];
if (item.activityId !== "theatre" || item.occurrenceKey !== expectedId) {
  throw new Error("S2/O32 : occurrence liée à une autre activité.");
}
const playlist: Playlist = { id: "p1", name: "Favoris", trackIds: ["song1"], updatedAt: baseline.updatedAt };
const google: GoogleCalendarConnection = { uid: "owner", calendarId: "primary", status: "disconnected" };
const conflict: CalendarSyncConflict = {
  id: "conflict1", uid: "owner", localEventId: baseline.id, googleEventId: "g1",
  kind: "update", localVersion: "v1", googleVersion: "v2", detectedAt: baseline.updatedAt, status: "open",
};
const decision: CarryOverDecision = {
  id: "carry1", activityId: reading.id, fromDate: "2026-11-01", toDate: "2026-11-02",
  decision: "later", promptedAt: baseline.updatedAt, updatedAt: baseline.updatedAt,
};
if (!playlist.trackIds.length || google.calendarId !== "primary" || conflict.status !== "open" || decision.decision !== "later") {
  throw new Error("S2/O09/O23/O26/O36 : contrats composites incorrects.");
}

/** Gestion explicite d'une heure ambiguë et d'une heure inexistante (DST). */
const fall: Activity = {
  ...baseline, id: "fall", timeZone: "America/New_York",
  startAt: "2026-10-25T05:30:00.000Z",
  recurrence: { frequency: "weekly", interval: 1, weekdays: [7] },
};
const fallHours = expandActivityOccurrences(fall, {
  from: "2026-10-25T00:00:00Z", to: "2026-11-10T00:00:00Z",
});
if (fallHours.length !== 3 || fallHours[1].startsAt !== "2026-11-01T05:30:00.000Z") {
  throw new Error("M130 : heure répétée à l'automne, première occurrence attendue.");
}
const spring: Activity = { ...fall, id: "spring", startAt: "2026-03-01T07:30:00.000Z" };
const springHours = expandActivityOccurrences(spring, {
  from: "2026-03-01T00:00:00Z", to: "2026-03-17T00:00:00Z",
});
if (springHours.length !== 2 || springHours.some(x => x.localDate === "2026-03-08")) {
  throw new Error("M130 : heure locale inexistante au printemps non filtrée.");
}

console.log("S2 : 5 objets + M130/M131, récurrences locales et groupes Jour vérifiés.");
