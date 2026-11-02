/**
 * F56 / T19 · S4 : contrats des deux objets terminaux et règles de classement.
 * Aucun Firestore, pas d'appel Google ni d'envoi Push.
 *
 * Ce test vérifie la règle de tri documentée à partir de fixtures :
 * il NE constitue PAS une implémentation de M147, qui attend M89 (S8).
 */
import type {
  Activity, ActivityCompletion, ActivityOccurrence, DispatchReceipt,
  MonthlyAchievement, MonthlyReview,
} from "../src/domain/types";

const base: Activity = {
  id: "base", uid: "user", title: "Exemple", timeZone: "Europe/Paris",
  autoComplete: false, updatedAt: "2026-10-01T10:00:00.000Z",
};
const entries: MonthlyAchievement[] = [
  {
    activity: { ...base, id: "one", title: "Une étoile", stars: 1 },
    occurrence: { activityId: "one", occurrenceKey: "one@2026-10-05", localDate: "2026-10-05", recurring: false },
    completion: { id: "one@2026-10-05", activityId: "one", occurrenceKey: "one@2026-10-05", status: "manual_done", updatedAt: "2026-10-05T19:00:00.000Z" },
  },
  {
    activity: { ...base, id: "three-late", title: "Trois étoiles plus tard", stars: 3 },
    occurrence: { activityId: "three-late", occurrenceKey: "three-late@2026-10-21", localDate: "2026-10-21", recurring: true },
    completion: { id: "three-late@2026-10-21", activityId: "three-late", occurrenceKey: "three-late@2026-10-21", status: "auto_assumed", updatedAt: "2026-10-21T20:00:00.000Z" },
  },
  {
    activity: { ...base, id: "two", title: "Deux étoiles", stars: 2 },
    occurrence: { activityId: "two", occurrenceKey: "two@2026-10-03", localDate: "2026-10-03", recurring: false },
    completion: { id: "two@2026-10-03", activityId: "two", occurrenceKey: "two@2026-10-03", status: "manual_done", updatedAt: "2026-10-03T11:00:00.000Z" },
  },
  {
    activity: { ...base, id: "three-early", title: "Trois étoiles plus tôt", stars: 3 },
    occurrence: { activityId: "three-early", occurrenceKey: "three-early@2026-10-02", localDate: "2026-10-02", recurring: true },
    completion: { id: "three-early@2026-10-02", activityId: "three-early", occurrenceKey: "three-early@2026-10-02", status: "manual_done", updatedAt: "2026-10-02T09:00:00.000Z" },
  },
  {
    activity: { ...base, id: "no-star", title: "Sans étoile" },
    occurrence: { activityId: "no-star", occurrenceKey: "no-star@2026-10-01", localDate: "2026-10-01", recurring: false },
    completion: { id: "no-star@2026-10-01", activityId: "no-star", occurrenceKey: "no-star@2026-10-01", status: "auto_assumed", updatedAt: "2026-10-01T11:00:00.000Z" },
  },
];
for (const entry of entries) {
  if (entry.occurrence.activityId !== entry.activity.id
    || entry.completion.activityId !== entry.activity.id
    || entry.completion.occurrenceKey !== entry.occurrence.occurrenceKey) {
    throw new Error("S4 : un bilan ne peut pas rattacher une coche à une autre occurrence.");
  }
}
// Le bilan exclut un état en attente ou annulé ; le contrat ne porte
// que les réalisations terminées ou seulement présumées.
const invalidCompletion: MonthlyAchievement = {
  activity: { ...base, id: "pending" },
  occurrence: { activityId: "pending", occurrenceKey: "pending@2026-10-05", localDate: "2026-10-05", recurring: false },
  // @ts-expect-error S4 : pending n'est pas une réalisation du bilan
  completion: { id: "pending@2026-10-05", activityId: "pending", occurrenceKey: "pending@2026-10-05", status: "pending", updatedAt: "2026-10-05T12:00:00.000Z" },
};
void invalidCompletion;
const original = entries.map(e => e.activity.id).join(",");
const sorted = [...entries].sort((a, b) =>
  (b.activity.stars ?? 0) - (a.activity.stars ?? 0)
  || a.occurrence.localDate.localeCompare(b.occurrence.localDate)
  || a.occurrence.occurrenceKey.localeCompare(b.occurrence.occurrenceKey));
if (sorted.map(e => e.activity.id).join(",") !==
    "three-early,three-late,two,one,no-star") {
  throw new Error("S4 : classement 3→2→1, sans étoile en dernier et chronologie incorrects.");
}
if (entries.map(e => e.activity.id).join(",") !== original) {
  throw new Error("S4 : une projection ne doit pas muter ses sources.");
}
const filtered = sorted.filter(e => e.activity.stars === 3);
if (filtered.length !== 2 || filtered.some(e => e.activity.stars !== 3)) {
  throw new Error("S4 : filtrage trois étoiles incorrect.");
}
const assumedCount = sorted.filter(e => e.completion.status === "auto_assumed").length;
const review: MonthlyReview = {
  month: "2026-10",
  entries: sorted,
  assumedCount,
};
if (review.assumedCount !== 2 || review.entries.length !== 5
  || review.entries.some(e => e.completion.status !== "manual_done" &&
      e.completion.status !== "auto_assumed")) {
  throw new Error("S4 : le bilan doit distinguer confirmations et présomptions.");
}
const reviewFiltered: MonthlyReview = {
  month: "2026-10", starFilter: 3,
  entries: filtered,
  assumedCount: filtered.filter(e => e.completion.status === "auto_assumed").length,
};
if (reviewFiltered.assumedCount !== 1 || reviewFiltered.entries.length !== 2) {
  throw new Error("S4 : le compteur de présomptions doit suivre la vue filtrée.");
}
const reminder: DispatchReceipt = {
  reminderId: "reminder-5",
  occurrenceKey: "theatre@2026-11-04",
  attemptedAt: "2026-11-04T17:50:00.000Z",
  outcome: "retry_required",
  retryAfter: "2026-11-04T17:55:00.000Z",
};
if (reminder.reminderId !== "reminder-5"
  || reminder.occurrenceKey !== "theatre@2026-11-04"
  || !(Date.parse(reminder.retryAfter!) > Date.parse(reminder.attemptedAt))) {
  throw new Error("S4 : reçu d'envoi mal relié au rappel ou tentative de reprise invalide.");
}
console.log("S4 / T19 : O19/O38 typés, tri, filtres et présomptions testés (M147 prévu en S8).");
