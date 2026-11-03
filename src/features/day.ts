/** F51 · M131 : deux groupes Jour, indépendants des catégories métier. */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { doc, getFirestore, runTransaction } from "firebase/firestore";
import { fetchCloudRecords, getUserCollection } from "../services/cloudRepository";
import { findMissedTasks } from "./tasks";
import { expandActivityOccurrences } from "./habits";
import type {
  Activity, ActivityCompletion, ActivityOccurrenceView, CarryOverChoice, CarryOverDecision, CarryOverPrompt, DayGroups, LocalDate, Result,
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

/** M136 · Une seule proposition groupée pour les tâches d'hier.
 * Les décisions existantes bloquent les répétitions ; "later" expire après 4 h.
 */
export async function getCarryOverPrompt(today: LocalDate): Promise<Result<CarryOverPrompt>> {
  const midnight = Date.parse(today + "T00:00:00.000Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(midnight)
    || new Date(midnight).toISOString().slice(0, 10) !== today) {
    return {ok: false, error: {
      code: "INVALID_DATE", message: "Date de proposition invalide.",
    }};
  }
  const yesterday = new Date(midnight - 86_400_000).toISOString().slice(0, 10);
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return {ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connexion requise pour les reports.",
    }};
    const tasks = await findMissedTasks(yesterday);
    if (!tasks.ok) return tasks;
    const decisions = await fetchCloudRecords<CarryOverDecision>(
      user.uid, "carryOverDecisions",
    );
    if (!decisions.ok) return decisions;
    const logged = new Map(decisions.value.filter(item =>
      item.fromDate === yesterday && item.toDate === today)
      .map(item => [item.activityId, item]));
    const now = Date.now();
    const candidates = tasks.value.filter(task => {
      const decision = logged.get(task.id);
      if (!decision) return true;
      if (decision.decision !== "later") return false;
      const acknowledged = Date.parse(decision.decidedAt || decision.promptedAt);
      return Number.isFinite(acknowledged) && now - acknowledged >= 4 * 60 * 60 * 1000;
    });
    return {ok: true, value: {
      fromDate: yesterday, toDate: today, candidates,
    }};
  } catch {
    return {ok: false, error: {
      code: "CARRY_OVER_PROMPT_FAILED",
      message: "Impossible de récupérer les propositions de report.",
    }};
  }
}

/** M137 · Un seul commit atomique des décisions explicites.
 * O31 garde le même ID, O36 trace chaque décision ; pas de copie de tâche.
 * Les transactions Firestore nécessitent le réseau ; en échec, aucune
 * confirmation n'est annoncée et l'utilisatrice peut réessayer.
 */
export async function applyCarryOver(choices: CarryOverChoice[]): Promise<Result<void>> {
  if (!Array.isArray(choices) || choices.length === 0 || choices.length > 100) {
    return {ok: false, error: {
      code: "INVALID_CHOICES", message: "Choisis entre une et cent tâches à traiter.",
    }};
  }
  const selected = new Set<string>();
  for (const choice of choices) {
    if (!choice || !choice.activityId || choice.activityId.includes("/")
      || !["move", "keep", "later"].includes(choice.decision)
      || !/^\d{4}-\d{2}-\d{2}$/.test(choice.fromDate)
      || !/^\d{4}-\d{2}-\d{2}$/.test(choice.toDate)) {
      return {ok: false, error: {
        code: "INVALID_CHOICE", message: "Une décision de report est incorrecte.",
      }};
    }
    const d1 = Date.parse(choice.fromDate + "T00:00:00Z");
    const d2 = Date.parse(choice.toDate + "T00:00:00Z");
    if (!Number.isFinite(d1) || !Number.isFinite(d2)
      || d2 - d1 !== 86_400_000
      || new Date(d1).toISOString().slice(0, 10) !== choice.fromDate
      || new Date(d2).toISOString().slice(0, 10) !== choice.toDate
      || selected.has(choice.activityId + "@" + choice.fromDate)) {
      return {ok: false, error: {
        code: "INVALID_CHOICE", message: "Dates ou décisions de report répétées.",
      }};
    }
    selected.add(choice.activityId + "@" + choice.fromDate);
  }
  try {
    const app = getApp("organiseur-personnel");
    const user = getAuth(app).currentUser;
    if (!user) return {ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connexion requise avant report.",
    }};
    const activities = getUserCollection(user.uid, "activities");
    const completions = getUserCollection(user.uid, "activityCompletions");
    const decisions = getUserCollection(user.uid, "carryOverDecisions");
    const result = await runTransaction(getFirestore(app), async tx => {
      // Toutes les lectures sont terminées avant la moindre écriture.
      const docs = await Promise.all(choices.map(async choice => {
        const activityRef = doc(activities, choice.activityId);
        const completionRef = doc(completions, choice.activityId + "@" + choice.fromDate);
        const decisionRef = doc(decisions, choice.activityId + "@" + choice.fromDate);
        const [activity, completion, decision] = await Promise.all([
          tx.get(activityRef), tx.get(completionRef), tx.get(decisionRef),
        ]);
        return {choice, activity, completion, decision, activityRef, decisionRef};
      }));
      for (const entry of docs) {
        const {choice, activity, completion, decision} = entry;
        if (completion.exists()) {
          const status = completion.data() as ActivityCompletion;
          if (status.status === "manual_done" || status.status === "auto_assumed") {
            return {ok: false, error: {
              code: "TASK_ALREADY_DONE",
              message: "Cette tâche vient d'être validée et ne doit plus être reportée.",
            }} as Result<void>;
          }
        }
        if (!activity.exists()) return {ok: false, error: {
          code: "ACTIVITY_NOT_FOUND", message: "Une tâche n'existe plus.",
        }} as Result<void>;
        const item = activity.data() as Activity;
        if (item.uid !== user.uid || item.deletedAt || item.startAt
          || item.recurrence || item.plannedOn !== choice.fromDate) {
          const previous = decision.exists() ? decision.data() as CarryOverDecision : null;
          if (previous && previous.decision === choice.decision
            && (choice.decision !== "move" || item.plannedOn === choice.toDate)) continue;
          return {ok: false, error: {
            code: "TASK_CHANGED", message: "Une tâche a changé depuis la proposition.",
          }} as Result<void>;
        }
        if (decision.exists()) {
          const previous = decision.data() as CarryOverDecision;
          if (previous.decision !== "later") {
            if (previous.decision === choice.decision) continue;
            return {ok: false, error: {
              code: "DECISION_ALREADY_SAVED", message: "Cette tâche a déjà été traitée.",
            }} as Result<void>;
          }
        }
      }
      const now = new Date().toISOString();
      for (const entry of docs) {
        const {choice, activity, decision, activityRef, decisionRef} = entry;
        const item = activity.data() as Activity;
        const previous = decision.exists() ? decision.data() as CarryOverDecision : null;
        if (previous && previous.decision !== "later"
          && previous.decision === choice.decision) continue;
        if (choice.decision === "move") {
          tx.update(activityRef, {plannedOn: choice.toDate, updatedAt: now});
        }
        const record: CarryOverDecision = {
          id: choice.activityId + "@" + choice.fromDate,
          activityId: choice.activityId,
          fromDate: choice.fromDate,
          toDate: choice.toDate,
          decision: choice.decision,
          promptedAt: previous?.promptedAt || now,
          decidedAt: now,
          updatedAt: now,
        };
        // Réutilise la même clé documentaire à chaque tentative.
        tx.set(decisionRef, record);
      }
      return {ok: true, value: undefined} as Result<void>;
    });
    return result;
  } catch {
    return {ok: false, error: {
      code: "REPORT_TRANSACTION_FAILED",
      message: "Report non confirmé. Vérifie ta connexion et réessaie.",
    }};
  }
}
