/** F50 · Listes indépendantes O34/O35. Aucun état parent n'est validé ici.
 * S6 : code en préparation, tests et déploiement explicitement différés D23.
 */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { fetchCloudRecords, getUserCollection, putCloudRecord } from "../services/cloudRepository";
import { attachChecklist } from "./activities";
import type {
  Activity, Checklist, ChecklistDraft, ChecklistItem, ChecklistItemDraft, Result,
} from "../domain/types";

/** M143 · Toutes les listes non archivées du compte connecté. */
export async function listChecklists(): Promise<Result<Checklist[]>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return { ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connexion requise pour consulter les listes.",
    }};
    const result = await fetchCloudRecords<Checklist>(user.uid, "checklists");
    if (!result.ok) return result;
    return { ok: true, value: result.value.filter(list => !list.archived)
      .sort((a, b) => a.name.localeCompare(b.name, "fr")) };
  } catch {
    return { ok: false, error: {
      code: "CHECKLISTS_UNAVAILABLE", message: "Listes indisponibles.",
    }};
  }
}

/** M144 · Enregistre la liste nommée sans toucher aux articles associés. */
export async function saveChecklist(input: ChecklistDraft): Promise<Result<Checklist>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return { ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connexion requise pour modifier les listes.",
    }};
    if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 250
      || (input.iconId !== undefined && typeof input.iconId !== "string")) {
      return { ok: false, error: {
        code: "INVALID_CHECKLIST", message: "Nom ou icône de liste invalide.",
      }};
    }
    const id = input.id ?? crypto.randomUUID();
    if (!id || id.includes("/")) return { ok: false, error: {
      code: "INVALID_ID", message: "Identifiant de liste invalide.",
    }};
    const list: Checklist = {
      id, name: input.name.trim(), updatedAt: new Date().toISOString(),
      ...(input.iconId !== undefined ? { iconId: input.iconId } : {}),
      ...(input.archived !== undefined ? { archived: input.archived } : {}),
    };
    const result = await putCloudRecord(user.uid, "checklists", id, list);
    return result.ok ? { ok: true, value: list } : result;
  } catch {
    return { ok: false, error: {
      code: "SAVE_CHECKLIST_FAILED", message: "Enregistrement de liste indisponible.",
    }};
  }
}

/** M146 · Une coche d'article ne modifie jamais le statut de l'activité liée. */
export async function setChecklistItemChecked(
  id: string, checked: boolean,
): Promise<Result<ChecklistItem>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user || !id || id.includes("/") || typeof checked !== "boolean") {
      return { ok: false, error: {
        code: "INVALID_ITEM", message: "Article ou session invalide.",
      }};
    }
    const ref = doc(getUserCollection(user.uid, "checklistItems"), id);
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) return { ok: false, error: {
      code: "ITEM_NOT_FOUND", message: "Article introuvable.",
    }};
    const previous = snapshot.data() as ChecklistItem;
    const updated: ChecklistItem = {
      ...previous, checked, updatedAt: new Date().toISOString(),
    };
    const result = await putCloudRecord(user.uid, "checklistItems", id, updated);
    return result.ok ? { ok: true, value: updated } : result;
  } catch {
    return { ok: false, error: {
      code: "CHECK_ITEM_FAILED", message: "Modification d'article indisponible.",
    }};
  }
}

/** M159 · Ajout, renommage ou déplacement d'un article (sans coche parent). */
export async function saveChecklistItem(
  input: ChecklistItemDraft,
): Promise<Result<ChecklistItem>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return { ok: false, error: {
      code: "AUTH_REQUIRED", message: "Connexion requise pour modifier les articles.",
    }};
    if (typeof input.checklistId !== "string" || !input.checklistId
      || input.checklistId.includes("/")
      || typeof input.text !== "string" || !input.text.trim() || input.text.length > 500
      || typeof input.checked !== "boolean"
      || !Number.isSafeInteger(input.position) || input.position < 0) {
      return { ok: false, error: {
        code: "INVALID_ITEM", message: "Article ou position invalide.",
      }};
    }
    const list = await getDoc(doc(getUserCollection(user.uid, "checklists"), input.checklistId));
    if (!list.exists() || (list.data() as Checklist).archived) return { ok: false, error: {
      code: "CHECKLIST_NOT_FOUND", message: "Liste inexistante ou archivée.",
    }};
    const id = input.id ?? crypto.randomUUID();
    if (!id || id.includes("/")) return { ok: false, error: {
      code: "INVALID_ID", message: "Identifiant d'article invalide.",
    }};
    if (input.id) {
      const existing = await getDoc(doc(getUserCollection(user.uid, "checklistItems"), id));
      if (!existing.exists() || (existing.data() as ChecklistItem).checklistId !== input.checklistId) {
        return { ok: false, error: {
          code: "ITEM_NOT_FOUND", message: "Impossible de déplacer l'article vers une autre liste.",
        }};
      }
    }
    const item: ChecklistItem = {
      id, checklistId: input.checklistId, text: input.text.trim(),
      checked: input.checked, position: input.position,
      updatedAt: new Date().toISOString(),
    };
    const result = await putCloudRecord(user.uid, "checklistItems", id, item);
    return result.ok ? { ok: true, value: item } : result;
  } catch {
    return { ok: false, error: {
      code: "SAVE_ITEM_FAILED", message: "Enregistrement d'article indisponible.",
    }};
  }
}

/** M160 · Lecture de la liste et de ses articles, sans lien destructif. */
export async function getChecklistDetails(id: string): Promise<Result<{
  list: Checklist; items: ChecklistItem[];
}>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user || !id || id.includes("/")) return { ok: false, error: {
      code: "INVALID_CHECKLIST", message: "Liste ou session invalide.",
    }};
    const list = await getDoc(doc(getUserCollection(user.uid, "checklists"), id));
    if (!list.exists()) return { ok: false, error: {
      code: "CHECKLIST_NOT_FOUND", message: "Liste introuvable.",
    }};
    const items = await fetchCloudRecords<ChecklistItem>(user.uid, "checklistItems");
    if (!items.ok) return items;
    return {
      ok: true,
      value: {
        list: list.data() as Checklist,
        items: items.value.filter(item => item.checklistId === id)
          .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
      },
    };
  } catch {
    return { ok: false, error: {
      code: "CHECKLIST_READ_FAILED", message: "Lecture de liste indisponible.",
    }};
  }
}

/** M145 · Supprimer de la vue une liste après consentement explicite.
 * L'archivage est non destructif : les articles restent récupérables,
 * et les activités liées conservent leurs propres historiques.
 * En cas d'échec partiel, relancer le traitement est sans danger.
 */
export async function deleteChecklist(id: string): Promise<Result<void>> {
  try {
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user || !id || id.includes("/")) return {ok: false, error: {
      code: "INVALID_CHECKLIST", message: "Identifiant ou session invalide.",
    }};
    const snapshot = await getDoc(doc(getUserCollection(user.uid, "checklists"), id));
    if (!snapshot.exists()) return {ok: false, error: {
      code: "CHECKLIST_NOT_FOUND", message: "Liste introuvable.",
    }};
    const existing = snapshot.data() as Checklist;
    if (existing.archived) return {ok: true, value: undefined};
    if (typeof window === "undefined" || typeof window.confirm !== "function"
        || !window.confirm(
          "Retirer cette liste de l'organiseur ? Les activités qui y sont liées seront détachées. " +
          "Les articles seront conservés dans les données archivées.",
        )) return {ok: false, error: {
      code: "CANCELLED", message: "Aucune liste supprimée sans confirmation.",
    }};

    const activities = await fetchCloudRecords<Activity>(user.uid, "activities");
    if (!activities.ok) return activities;
    for (const item of activities.value) {
      if (item.checklistId === id) {
        const removedLink = await attachChecklist(item.id, null);
        if (!removedLink.ok) return removedLink;
      }
    }
    const archived = await saveChecklist({
      id, name: existing.name, iconId: existing.iconId, archived: true,
    });
    return archived.ok ? {ok: true, value: undefined} : archived;
  } catch {
    return {ok: false, error: {
      code: "CHECKLIST_DELETE_FAILED", message: "Impossible d'archiver la liste.",
    }};
  }
}
