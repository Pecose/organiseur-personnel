/** F22 · Vue Tâches (M125), filtre de l'unique objet Activity O31. */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { fetchCloudRecords } from "../services/cloudRepository";
import type { Activity, Result } from "../domain/types";
import { classifyActivity } from "./activities";

/** M125 · Tâches non horaires et non récurrentes, datées ou non. */
export async function listTasks(): Promise<Result<Activity[]>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return { ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connecte-toi pour consulter les tâches.",
    }};
    const result = await fetchCloudRecords<Activity>(user.uid, "activities");
    if (!result.ok) return result;
    return { ok: true, value: result.value.filter(activity =>
      !activity.deletedAt && classifyActivity(activity).includes("task")) };
  } catch {
    return { ok: false, error: {
      code: "TASKS_UNAVAILABLE", message: "Liste des tâches indisponible.",
    }};
  }
}
