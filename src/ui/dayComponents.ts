/** F53 · M153 : fiche d'édition de l'unique Activity.
 * Toutes les données utilisateur sont insérées avec textContent/value,
 * jamais interpolées en HTML. D23 : usage réel différé à la recette.
 */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { getUserCollection } from "../services/cloudRepository";
import {
  createActivity, updateActivity,
} from "../features/activities";
import { listChecklists } from "../features/checklists";
import { getAppState } from "../app/state";
import { renderRoute, navigate } from "../app/router";
import type { Activity, ActivityDraft, RecurrenceRule } from "../domain/types";

/** M153 · Une fiche unique, qu'on vienne de Jour, Tâches ou Habitudes. */
export function openActivityEditor(activityId: string): void {
  const user = getAppState().user;
  if (!user) {
    navigate({name: "signin"});
    return;
  }
  const old = document.querySelector(".editor-backdrop");
  if (old) old.remove();
  const overlay = document.createElement("div");
  overlay.className = "editor-backdrop";
  const dialog = document.createElement("section");
  dialog.className = "editor-sheet";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "edit-title");

  // Le gabarit est statique. Rien provenant de Firestore n'est interprété en HTML.
  dialog.innerHTML = `
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="sheet-header"><h2 id="edit-title">Mon activité</h2>
      <button type="button" class="icon-button" data-close aria-label="Fermer">✕</button></div>
    <form id="activity-form">
      <label>Nom de l'activité <input name="title" required maxlength="500" autocomplete="off" placeholder="Par exemple : promenade, musique…"></label>
      <label>Description <textarea name="description" rows="2" placeholder="Quelques détails, si besoin"></textarea></label>
      <div class="form-columns">
        <label>Icône <input name="icon" maxlength="32" placeholder="✿"></label>
        <label>Importance <select name="stars"><option value="0">Sans étoile</option><option value="1">★</option><option value="2">★★</option><option value="3">★★★</option></select></label>
      </div>
      <label>Date prévue <input name="plannedOn" type="date"></label>
      <div class="form-columns">
        <label>Heure de début <input name="start" type="time" step="60"></label>
        <label>Heure de fin <input name="end" type="time" step="60"></label>
      </div>
      <label class="inline-choice"><input type="checkbox" name="autoComplete"> Présumer l'activité terminée après son horaire (annulable)</label>
      <div class="form-columns">
        <label>Répétition <select name="recurrence">
          <option value="none">Aucune</option><option value="daily">Chaque jour</option>
          <option value="weekly">Chaque semaine</option><option value="monthly">Chaque mois</option>
          <option value="yearly">Chaque année</option>
        </select></label>
        <label>Tous les… <input type="number" name="interval" min="1" max="365" value="1"></label>
      </div>
      <fieldset class="weekday-field"><legend>Jours de répétition hebdomadaire</legend>
        <label><input type="checkbox" name="weekday" value="1"> L</label>
        <label><input type="checkbox" name="weekday" value="2"> M</label>
        <label><input type="checkbox" name="weekday" value="3"> M</label>
        <label><input type="checkbox" name="weekday" value="4"> J</label>
        <label><input type="checkbox" name="weekday" value="5"> V</label>
        <label><input type="checkbox" name="weekday" value="6"> S</label>
        <label><input type="checkbox" name="weekday" value="7"> D</label>
      </fieldset>
      <label>Liste associée <select name="checklist"><option value="">Aucune</option></select></label>
      <p class="form-error" role="alert" aria-live="polite"></p>
      <button type="submit" class="primary-button">Enregistrer l'activité</button>
    </form>`;
  overlay.append(dialog);
  document.body.append(overlay);
  const form = dialog.querySelector<HTMLFormElement>("#activity-form")!;
  const close = () => overlay.remove();
  dialog.querySelector<HTMLButtonElement>("[data-close]")!.onclick = close;
  overlay.onclick = event => { if (event.target === overlay) close(); };
  overlay.onkeydown = event => { if (event.key === "Escape") close(); };
  const field = (name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
    form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const feedback = dialog.querySelector<HTMLElement>(".form-error")!;
  const submit = form.querySelector<HTMLButtonElement>("[type=submit]")!;
  let activity: Activity | undefined;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris";

  void (async () => {
    if (activityId) {
      try {
        const ref = doc(getUserCollection(user.uid, "activities"), activityId);
        const snapshot = await getDoc(ref);
        if (!snapshot.exists()) {
          feedback.textContent = "Cette activité n'existe plus.";
          submit.disabled = true;
          return;
        }
        activity = snapshot.data() as Activity;
        field("title").value = activity.title;
        field("description").value = activity.description || "";
        field("icon").value = activity.iconId || "";
        field("stars").value = String(activity.stars || 0);
        field("plannedOn").value = activity.plannedOn ||
          (activity.startAt ? new Date(activity.startAt).toLocaleDateString("sv-SE") : "");
        field("start").value = activity.startAt
          ? new Date(activity.startAt).toLocaleTimeString("fr-FR", {hour:"2-digit", minute:"2-digit"}) : "";
        field("end").value = activity.endAt
          ? new Date(activity.endAt).toLocaleTimeString("fr-FR", {hour:"2-digit", minute:"2-digit"}) : "";
        (field("autoComplete") as HTMLInputElement).checked = activity.autoComplete;
        field("recurrence").value = activity.recurrence?.frequency || "none";
        field("interval").value = String(activity.recurrence?.interval || 1);
        const weekdays = activity.recurrence?.weekdays || [];
        form.querySelectorAll<HTMLInputElement>('input[name="weekday"]').forEach(box => {
          box.checked = weekdays.includes(Number(box.value) as 1 | 2 | 3 | 4 | 5 | 6 | 7);
        });
      } catch {
        feedback.textContent = "Impossible de charger cette fiche.";
        submit.disabled = true;
        return;
      }
    } else {
      const screen = getAppState().route.name;
      if (screen !== "tasks") {
        field("plannedOn").value = getAppState().daySelection.selectedDate;
      }
      if (screen === "habits") {
        field("recurrence").value = "weekly";
        const day = new Date(getAppState().daySelection.selectedDate + "T00:00:00Z");
        const isoWeekday = ((day.getUTCDay() + 6) % 7 + 1).toString();
        const selected = form.querySelector<HTMLInputElement>(
          'input[name="weekday"][value="' + isoWeekday + '"]',
        );
        if (selected) selected.checked = true;
      }
    }
    const lists = await listChecklists();
    if (lists.ok && overlay.isConnected) {
      const select = field("checklist") as HTMLSelectElement;
      for (const list of lists.value) {
        const option = document.createElement("option");
        option.value = list.id;
        option.textContent = list.name;
        select.append(option);
      }
      if (activity?.checklistId) select.value = activity.checklistId;
    }
  })();

  form.onsubmit = event => {
    event.preventDefault();
    void (async () => {
      feedback.textContent = "";
      const title = field("title").value.trim();
      const plannedOn = field("plannedOn").value;
      const startTime = field("start").value;
      const endTime = field("end").value;
      if (!title) { feedback.textContent = "Donne un nom à l'activité."; return; }
      if ((startTime || endTime) && !plannedOn) {
        feedback.textContent = "Choisis une date avant d'ajouter une heure.";
        return;
      }
      if (endTime && !startTime) {
        feedback.textContent = "L'heure de fin nécessite une heure de début.";
        return;
      }
      const startAt = startTime
        ? new Date(plannedOn + "T" + startTime + ":00").toISOString() : undefined;
      const endAt = endTime
        ? new Date(plannedOn + "T" + endTime + ":00").toISOString() : undefined;
      if (startAt && endAt && Date.parse(endAt) < Date.parse(startAt)) {
        feedback.textContent = "L'heure de fin doit suivre le début.";
        return;
      }
      const frequency = field("recurrence").value;
      const interval = Number(field("interval").value);
      if (!Number.isInteger(interval) || interval < 1 || interval > 365) {
        feedback.textContent = "L'intervalle de répétition est invalide.";
        return;
      }
      const weekdays = [...form.querySelectorAll<HTMLInputElement>('input[name="weekday"]:checked')]
        .map(box => Number(box.value) as 1 | 2 | 3 | 4 | 5 | 6 | 7);
      let recurrence: RecurrenceRule | undefined;
      if (frequency !== "none") {
        if (!plannedOn && !startAt && !activity?.startAt) {
          feedback.textContent = "Une habitude doit avoir une date de départ.";
          return;
        }
        recurrence = {
          frequency: frequency as RecurrenceRule["frequency"],
          interval,
          ...(frequency === "weekly" && weekdays.length ? {weekdays} : {}),
          ...(activity?.recurrence?.frequency === frequency && activity.recurrence.count
            ? {count: activity.recurrence.count} : {}),
          ...(activity?.recurrence?.frequency === frequency && activity.recurrence.until
            ? {until: activity.recurrence.until} : {}),
        };
      }
      const stars = Number(field("stars").value);
      const draft: ActivityDraft = {
        title, timeZone: activity?.timeZone || timezone,
        autoComplete: Boolean(startAt) && (field("autoComplete") as HTMLInputElement).checked,
        ...(field("description").value.trim()
          ? {description: field("description").value.trim()} : {}),
        ...(field("icon").value.trim() ? {iconId: field("icon").value.trim()} : {}),
        ...(stars > 0 ? {stars: stars as 1 | 2 | 3} : {}),
        ...(plannedOn ? {plannedOn} : {}),
        ...(startAt ? {startAt} : {}),
        ...(endAt ? {endAt} : {}),
        ...(recurrence ? {recurrence} : {}),
        ...(field("checklist").value ? {checklistId: field("checklist").value} : {}),
      };
      submit.disabled = true;
      const result = activity
        ? await updateActivity({
          ...activity,
          ...draft,
          id: activity.id,
          uid: activity.uid,
          updatedAt: activity.updatedAt,
          ...(field("description").value.trim() ? {} : {description: undefined}),
          ...(field("icon").value.trim() ? {} : {iconId: undefined}),
          ...(plannedOn ? {} : {plannedOn: undefined}),
          ...(startAt ? {} : {startAt: undefined}),
          ...(endAt ? {} : {endAt: undefined}),
          ...(recurrence ? {} : {recurrence: undefined}),
          ...(stars ? {} : {stars: undefined}),
          ...(field("checklist").value ? {} : {checklistId: undefined}),
        })
        : await createActivity(draft);
      submit.disabled = false;
      if (!result.ok) {
        feedback.textContent = result.error.message;
        return;
      }
      close();
      renderRoute(getAppState().route);
    })().catch(() => {
      submit.disabled = false;
      feedback.textContent = "Enregistrement impossible, vérifie les champs.";
    });
  };
  (field("title") as HTMLInputElement).focus();
}
