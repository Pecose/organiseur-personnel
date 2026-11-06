/** F19 · Vues mobile natives : calendrier, tâches, Jour, habitudes, listes.
 * Les écrans secondaires restent hors de la barre de navigation principale.
 * S7 est codée sans test ni déploiement selon D23.
 */
import { getApps } from "firebase/app";
import { getAppState } from "../app/state";
import { navigate } from "../app/router";
import { setSelectedDay } from "../app/state";
import { getCalendarWeek, selectCalendarDate } from "../features/agenda";
import { listTasks } from "../features/tasks";
import { listHabits } from "../features/habits";
import { groupDayEntries, getDayEntries, getCarryOverPrompt, applyCarryOver } from "../features/day";
import {
  getOccurrenceCompletion, setOccurrenceCompletion, undoOccurrenceCompletion,
} from "../features/activities";
import {
  listChecklists, getChecklistDetails, saveChecklist,
  saveChecklistItem, setChecklistItemChecked, deleteChecklist,
} from "../features/checklists";
import {
  listTracks, importAudio, setTrackFavorite, listPlaylists, savePlaylist, deletePlaylist, reorderPlaylist,
} from "../features/music";
import {
  playTrack, pausePlayback, nextTrack, previousTrack, setPlaybackMode, setPlaybackQueue,
} from "../features/player";
import { readMedia } from "../storage/mediaDb";
import { resolveCatalogAsset } from "../storage/catalog";
import { listImages, importImage, cropImage, composeDecorImage } from "../features/decor";
import {
  exportDataJson, validateBackup, restoreData,
  exportMediaArchive, importMediaArchive,
} from "../services/backup";
import { signIn, signOut, sendPasswordReset, registerAccount } from "../services/auth";
import { configurePersistence } from "../services/sync";
import { requestPushPermission, subscribeToPush, testPushSubscription, unsubscribeFromPush } from "../services/push";
import {
  startGoogleCalendarLink, requestGoogleCalendarSync, readGoogleCalendarStatus,
  queryGoogleCalendarConflicts, resolveGoogleCalendarConflict, unlinkGoogleCalendar,
} from "../features/googleCalendar";
import { openActivityEditor } from "./dayComponents";
import { formatZonedTime } from "../domain/dates";
import type { ActivityOccurrenceView, DecorLayer, LocalDate } from "../domain/types";

/** M05 · Le vrai écran d'accueil est Jour, pas une sixième page. */
export function renderHome(): void {
  renderDay(getAppState().daySelection.selectedDate);
}

/** M149 · Deux groupes uniques, sans horaire puis avec horaire chronologique. */
export function renderDay(date: LocalDate): void {
  const root = document.getElementById("view");
  if (!root) return;
  root.replaceChildren();
  const panel = document.createElement("section");
  panel.className = "page-intro";
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "UNE JOURNÉE À LA FOIS";
  const heading = document.createElement("h2");
  heading.textContent = new Date(date + "T12:00:00Z").toLocaleDateString("fr-FR", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long",
  });
  const description = document.createElement("p");
  description.className = "muted";
  description.textContent = date === getAppState().daySelection.today
    ? "Ton espace pour aujourd'hui." : "Les activités prévues pour cette date.";
  const actions = document.createElement("div");
  actions.className = "header-actions";
  const todayButton = document.createElement("button");
  todayButton.className = "soft-button";
  todayButton.type = "button";
  todayButton.textContent = "Aujourd'hui";
  todayButton.onclick = () => {
    const today = new Date().toLocaleDateString("sv-SE", {
      timeZone: getAppState().preferences.timeZone,
    });
    setSelectedDay(today, "navigation");
    renderDay(today);
  };
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "primary-button compact";
  addButton.textContent = "+ Activité";
  addButton.onclick = () => openActivityEditor("");
  actions.append(todayButton, addButton);
  panel.append(eyebrow, heading, description, actions);
  root.append(panel);

  // Deux sections, y compris dans les états vides, sans troisième catégorie.
  const sections: {id: string; title: string; sub: string}[] = [
    {id:"untimed", title:"Sans horaire", sub:"À ton rythme"},
    {id:"timed", title:"Avec horaire", sub:"Dans l'ordre de la journée"},
  ];
  for (const section of sections) {
    const block = document.createElement("section");
    block.className = "day-section";
    const header = document.createElement("div");
    header.className = "section-heading";
    const label = document.createElement("h3");
    label.textContent = section.title;
    const tag = document.createElement("span");
    tag.className = "subtle-tag";
    tag.textContent = section.sub;
    header.append(label, tag);
    const list = document.createElement("div");
    list.id = "entries-" + section.id;
    list.className = "entry-list";
    const loading = document.createElement("p");
    loading.className = "empty-copy";
    loading.textContent = "Chargement…";
    list.append(loading);
    block.append(header, list);
    root.append(block);
  }
  if (!getAppState().user) {
    for (const id of ["untimed", "timed"]) {
      const target = document.getElementById("entries-" + id)!;
      target.replaceChildren();
      const note = document.createElement("p");
      note.className = "empty-copy";
      note.textContent = "Connecte-toi pour voir tes activités. Aucune donnée d'exemple n'est affichée.";
      target.append(note);
    }
    const connect = document.createElement("button");
    connect.className = "soft-button";
    connect.textContent = "Me connecter";
    connect.onclick = () => navigate({name:"signin"});
    root.append(connect);
    return;
  }

  // FL16 : une invitation discrète, jamais une fenêtre réaffichée sans action.
  // Un seul panneau groupé est ouvert après un clic explicite.
  const realToday = new Date().toLocaleDateString("sv-SE", {
    timeZone: getAppState().preferences.timeZone,
  });
  if (date === realToday) {
    void getCarryOverPrompt(date).then(result => {
      if (!root.isConnected || getAppState().route.name !== "day"
        || getAppState().daySelection.selectedDate !== date
        || !result.ok || !result.value.candidates.length) return;
      const notice = document.createElement("aside");
      notice.className = "carry-notice";
      const message = document.createElement("p");
      message.textContent = result.value.candidates.length
        + " tâche(s) de la veille à revoir. Rien ne sera déplacé sans ton accord.";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "soft-button";
      button.textContent = "Examiner les reports";
      notice.append(message, button);
      root.insertBefore(notice, root.querySelector(".day-section"));
      button.onclick = () => {
        if (document.querySelector(".carry-backdrop")) return;
        const backdrop = document.createElement("div");
        backdrop.className = "editor-backdrop carry-backdrop";
        const panel = document.createElement("section");
        panel.className = "editor-sheet";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "true");
        panel.setAttribute("aria-label", "Reporter les tâches oubliées");
        const heading = document.createElement("h2");
        heading.textContent = "Et les tâches d'hier ?";
        const explanation = document.createElement("p");
        explanation.className = "muted";
        explanation.textContent = "Pour chaque tâche, choisis une action. "
          + "Rien ne bougera avant ta confirmation.";
        const form = document.createElement("form");
        form.className = "carry-form";
        const selectors: {activityId: string; select: HTMLSelectElement}[] = [];
        for (const candidate of result.value.candidates) {
          const row = document.createElement("label");
          row.className = "carry-choice";
          const title = document.createElement("strong");
          title.textContent = candidate.title;
          const select = document.createElement("select");
          for (const [value, label] of [
            ["later", "Me le redemander plus tard"],
            ["move", "Reporter à aujourd'hui"],
            ["keep", "Laisser à hier"],
          ] as const) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            select.append(option);
          }
          row.append(title, select);
          selectors.push({activityId: candidate.id, select});
          form.append(row);
        }
        const feedback = document.createElement("p");
        feedback.className = "form-error";
        feedback.setAttribute("role", "alert");
        const controls = document.createElement("div");
        controls.className = "header-actions";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "soft-button";
        cancel.textContent = "Fermer sans changement";
        const confirm = document.createElement("button");
        confirm.type = "submit";
        confirm.className = "primary-button compact";
        confirm.textContent = "Confirmer les choix";
        controls.append(cancel, confirm);
        form.append(feedback, controls);
        panel.append(heading, explanation, form);
        backdrop.append(panel);
        document.body.append(backdrop);
        cancel.onclick = () => backdrop.remove();
        backdrop.onclick = event => {
          if (event.target === backdrop) backdrop.remove();
        };
        form.onsubmit = event => {
          event.preventDefault();
          confirm.disabled = true;
          feedback.textContent = "Enregistrement groupé en cours…";
          const choices = selectors.map(({activityId, select}) => ({
            activityId,
            fromDate: result.value.fromDate,
            toDate: result.value.toDate,
            decision: select.value as "move" | "keep" | "later",
          }));
          void applyCarryOver(choices).then(saved => {
            confirm.disabled = false;
            if (!saved.ok) {feedback.textContent = saved.error.message; return;}
            backdrop.remove();
            renderDay(date);
          }).catch(() => {
            confirm.disabled = false;
            feedback.textContent = "Impossible de confirmer les reports. Réessaie en ligne.";
          });
        };
      };
    }).catch(() => {
      // Un échec de la suggestion n'altère pas la journée ni les tâches.
    });
  }

  void getDayEntries(date).then(result => {
    if (!root.isConnected || getAppState().route.name !== "day"
      || getAppState().daySelection.selectedDate !== date) return;
    if (!result.ok) {
      for (const id of ["untimed", "timed"]) {
        const list = root.querySelector<HTMLElement>("#entries-" + id);
        if (list) list.textContent = result.error.message;
      }
      return;
    }
    const grouped = groupDayEntries(result.value);
    for (const [id, items] of [
      ["untimed", grouped.withoutTime],
      ["timed", grouped.withTime],
    ] as [string, ActivityOccurrenceView[]][]) {
      const list = root.querySelector<HTMLElement>("#entries-" + id);
      if (!list) continue;
      list.replaceChildren();
      if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "empty-copy";
        empty.textContent = id === "untimed"
          ? "Rien de prévu sans horaire pour ce jour."
          : "Aucun rendez-vous avec horaire.";
        list.append(empty);
        continue;
      }
      for (const item of items) {
        const article = document.createElement("article");
        article.className = "activity-row";
        const icon = document.createElement("button");
        icon.type = "button";
        icon.className = "activity-icon";
        icon.setAttribute("aria-label", "Modifier " + item.activity.title);
        icon.title = "Modifier l'activité";
        icon.textContent = item.activity.iconId || (item.activity.recurrence ? "✿" : "✦");
        icon.onclick = () => openActivityEditor(item.activity.id);
        const details = document.createElement("div");
        details.className = "activity-details";
        const name = document.createElement("strong");
        name.textContent = item.activity.title;
        const meta = document.createElement("span");
        meta.className = "activity-meta";
        const chunks: string[] = [];
        if (item.occurrence.startsAt) {
          try {
            chunks.push(formatZonedTime(item.occurrence.startsAt, item.activity.timeZone));
          } catch {
            chunks.push("Horaire invalide");
          }
        }
        if (item.activity.stars) chunks.push("★".repeat(item.activity.stars));
        if (item.completion?.status === "auto_assumed") chunks.push("Présumé terminé");
        if (item.completion?.status === "manually_undone") chunks.push("Annulation conservée");
        meta.textContent = chunks.join(" · ");
        details.append(name, meta);
        const completed = item.completion?.status === "manual_done"
          || item.completion?.status === "auto_assumed";
        const check = document.createElement("button");
        check.type = "button";
        check.className = "check-control" + (completed ? " is-checked" : "");
        check.textContent = completed ? "✓" : "○";
        check.setAttribute("aria-label", (completed ? "Annuler la validation de " : "Terminer ") + item.activity.title);
        check.setAttribute("aria-pressed", completed ? "true" : "false");
        check.onclick = () => {
          check.disabled = true;
          void (completed
            ? undoOccurrenceCompletion(item.occurrence.occurrenceKey)
            : setOccurrenceCompletion(item.occurrence.occurrenceKey, "manual_done"))
            .then(saved => {
              if (saved.ok) renderDay(date);
              else {
                check.disabled = false;
                check.title = saved.error.message;
                check.setAttribute("aria-label", saved.error.message);
              }
            });
        };
        article.append(icon, details, check);
        list.append(article);
      }
    }
  }).catch(() => {
    if (root.isConnected && getAppState().route.name === "day") {
      const target = root.querySelector<HTMLElement>("#entries-untimed");
      if (target) target.textContent = "La journée ne peut pas être chargée.";
    }
  });
}

/** M06 · Calendrier hebdomadaire, dimanche replié par défaut. */
export function renderAgenda(): void {
  const state = getAppState();
  const selected = new Date(state.daySelection.selectedDate + "T00:00:00Z");
  const weekday = (selected.getUTCDay() + 6) % 7;
  const monday = new Date(selected.getTime() - weekday * 86_400_000).toISOString().slice(0, 10);
  renderCalendarWeek(monday, false);
}

/** M150 · Six cases sur 3 × 2, dimanche dans un panneau facultatif. */
export function renderCalendarWeek(monday: LocalDate, showSunday: boolean): void {
  const root = document.getElementById("view");
  if (!root) return;
  root.replaceChildren();
  const header = document.createElement("section");
  header.className = "page-intro";
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "UN PEU DE RECUL";
  const heading = document.createElement("h2");
  heading.textContent = "Mon calendrier";
  const bar = document.createElement("div");
  bar.className = "header-actions";
  for (const [text, offset, label] of [
    ["‹", -7, "Semaine précédente"], ["Aujourd'hui", 0, "Revenir à aujourd'hui"],
    ["›", 7, "Semaine suivante"],
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "soft-button";
    button.textContent = text;
    button.setAttribute("aria-label", label);
    button.onclick = () => {
      if (offset === 0) {
        const date = new Date().toLocaleDateString("sv-SE", {
          timeZone: getAppState().preferences.timeZone,
        });
        const current = new Date(date + "T00:00:00Z");
        const wd = (current.getUTCDay() + 6) % 7;
        renderCalendarWeek(
          new Date(current.getTime() - wd * 86_400_000).toISOString().slice(0, 10), false,
        );
      } else {
        renderCalendarWeek(new Date(Date.parse(monday + "T00:00:00Z") +
          offset * 86_400_000).toISOString().slice(0, 10), showSunday);
      }
    };
    bar.append(button);
  }
  header.append(eyebrow, heading, bar);
  root.append(header);

  const days = document.createElement("div");
  days.className = "week-grid";
  const start = Date.parse(monday + "T00:00:00Z");
  const selectedDate = getAppState().daySelection.selectedDate;
  const today = getAppState().daySelection.today;
  const buttons: HTMLButtonElement[] = [];
  for (let index = 0; index < 7; index++) {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day" + (date === selectedDate ? " selected" : "")
      + (date === today ? " is-today" : "");
    cell.setAttribute("aria-label", new Date(date + "T12:00:00Z")
      .toLocaleDateString("fr-FR", {weekday:"long", day:"numeric", month:"long",timeZone:"UTC"}));
    const weekday = document.createElement("span");
    weekday.className = "calendar-weekday";
    weekday.textContent = ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"][index];
    const number = document.createElement("strong");
    number.textContent = date.slice(8);
    const summary = document.createElement("span");
    summary.className = "calendar-counter";
    summary.textContent = " ";
    cell.append(weekday, number, summary);
    cell.onclick = () => selectCalendarDate(date);
    if (index === 6) {
      const container = document.createElement("div");
      container.className = "sunday-panel" + (showSunday ? "" : " is-collapsed");
      container.append(cell);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "soft-button sunday-toggle";
      toggle.textContent = showSunday ? "Masquer le dimanche" : "Afficher le dimanche";
      toggle.setAttribute("aria-expanded", String(showSunday));
      toggle.onclick = () => renderCalendarWeek(monday, !showSunday);
      root.append(toggle, container);
    } else {
      days.append(cell);
    }
    buttons.push(cell);
  }
  root.insertBefore(days, root.querySelector(".sunday-toggle"));
  const notice = document.createElement("p");
  notice.className = "muted calendar-footnote";
  notice.textContent = "Choisis une date pour ouvrir les activités de ce jour.";
  root.append(notice);
  if (!getAppState().user) {
    const message = document.createElement("p");
    message.className = "empty-copy";
    message.textContent = "Connecte-toi pour afficher les activités de chaque journée.";
    root.append(message);
    return;
  }
  void getCalendarWeek(monday).then(result => {
    if (!root.isConnected || getAppState().route.name !== "calendar") return;
    if (!result.ok) {
      notice.textContent = result.error.message;
      return;
    }
    for (let i = 0; i < 7; i++) {
      const counter = buttons[i].querySelector<HTMLElement>(".calendar-counter");
      if (counter) {
        const count = result.value[i]?.count || 0;
        counter.textContent = count ? count + (count > 1 ? " activités" : " activité") : "Libre";
      }
    }
  });
}

/** M07 · Tâches non cycliques, y compris sans date (restent hors de Jour). */
export function renderTasks(): void {
  const root = document.getElementById("view");
  if (!root) return;
  root.innerHTML = `<section class="page-intro"><p class="eyebrow">L'ESPRIT LÉGER</p>
    <h2>Mes tâches</h2><p class="muted">Tout ce que tu veux faire, sans être pressée.</p>
    <button type="button" class="primary-button compact" id="new-task">+ Tâche</button></section>
    <section class="day-section"><h3>À faire</h3><div id="task-list" class="entry-list"></div></section>`;
  root.querySelector<HTMLButtonElement>("#new-task")!.onclick = () => openActivityEditor("");
  const list = root.querySelector<HTMLElement>("#task-list")!;
  if (!getAppState().user) {
    list.textContent = "Connecte-toi pour voir tes tâches.";
    return;
  }
  list.textContent = "Chargement…";
  void listTasks().then(result => {
    if (!root.isConnected || getAppState().route.name !== "tasks") return;
    list.replaceChildren();
    if (!result.ok) { list.textContent = result.error.message; return; }
    if (!result.value.length) { list.textContent = "Aucune tâche pour le moment."; return; }
    for (const task of result.value) {
      const card = document.createElement("article");
      card.className = "activity-row";
      const icon = document.createElement("button");
      icon.type = "button";
      icon.className = "activity-icon";
      icon.textContent = task.iconId || "✦";
      icon.setAttribute("aria-label", "Modifier " + task.title);
      icon.onclick = () => openActivityEditor(task.id);
      const details = document.createElement("div");
      details.className = "activity-details";
      const title = document.createElement("strong");
      title.textContent = task.title;
      const date = document.createElement("span");
      date.className = "activity-meta";
      date.textContent = (task.plannedOn || "Sans date") +
        (task.stars ? " · " + "★".repeat(task.stars) : "");
      details.append(title, date);
      const check = document.createElement("button");
      check.type = "button";
      check.className = "check-control";
      check.textContent = "○";
      if (!task.plannedOn) {
        check.disabled = true;
        check.title = "Ajoute une date pour valider une occurrence.";
        check.setAttribute("aria-label", "Ajoute une date pour terminer " + task.title);
      } else {
        const key = task.id + "@" + task.plannedOn;
        check.setAttribute("aria-label", "Terminer " + task.title);
        check.onclick = () => {
          const checked = check.dataset.completed === "true";
          check.disabled = true;
          void (checked
            ? undoOccurrenceCompletion(key)
            : setOccurrenceCompletion(key, "manual_done")).then(result => {
              check.disabled = false;
              if (result.ok) {
                check.dataset.completed = checked ? "false" : "true";
                check.textContent = checked ? "○" : "✓";
                check.classList.toggle("is-checked", !checked);
                check.setAttribute("aria-label",
                  (checked ? "Terminer " : "Annuler la validation de ") + task.title);
              } else {
                check.title = result.error.message;
              }
            });
        };
        void getOccurrenceCompletion(key).then(result => {
          if (!result.ok || !check.isConnected) return;
          const checked = result.value?.status === "manual_done"
            || result.value?.status === "auto_assumed";
          check.dataset.completed = checked ? "true" : "false";
          check.textContent = checked ? "✓" : "○";
          check.classList.toggle("is-checked", checked);
          check.setAttribute("aria-label",
            (checked ? "Annuler la validation de " : "Terminer ") + task.title);
        });
      }
      card.append(icon, details, check);
      list.append(card);
    }
  });
}

/** M151 · Les habitudes sont des vues de O31 et peuvent avoir un horaire. */
export function renderHabits(): void {
  const root = document.getElementById("view");
  if (!root) return;
  root.innerHTML = `<section class="page-intro"><p class="eyebrow">LES PETITS RITUELS</p>
    <h2>Mes habitudes</h2><p class="muted">Un peu, souvent, à ta manière.</p>
    <button type="button" id="new-habit" class="primary-button compact">+ Habitude</button></section>
    <section class="day-section"><h3>Mes rituels</h3><div class="entry-list" id="habits-list"></div></section>`;
  root.querySelector<HTMLButtonElement>("#new-habit")!.onclick = () => openActivityEditor("");
  const list = root.querySelector<HTMLElement>("#habits-list")!;
  if (!getAppState().user) { list.textContent = "Connecte-toi pour retrouver tes habitudes."; return; }
  list.textContent = "Chargement…";
  void listHabits().then(result => {
    if (!root.isConnected || getAppState().route.name !== "habits") return;
    list.replaceChildren();
    if (!result.ok) { list.textContent = result.error.message; return; }
    if (!result.value.length) { list.textContent = "Aucune habitude créée."; return; }
    for (const habit of result.value) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "habit-card";
      const icon = document.createElement("span");
      icon.className = "habit-picto";
      icon.textContent = habit.iconId || "✿";
      const text = document.createElement("span");
      text.className = "habit-text";
      const title = document.createElement("strong");
      title.textContent = habit.title;
      const meta = document.createElement("small");
      meta.textContent = ({
        daily: "Chaque jour", weekly: "Chaque semaine",
        monthly: "Chaque mois", yearly: "Chaque année",
      } as Record<string, string>)[habit.recurrence?.frequency || ""]
        + (habit.startAt ? " · Avec horaire" : " · Sans horaire");
      text.append(title, meta);
      const arrow = document.createElement("span");
      arrow.textContent = "›";
      card.append(icon, text, arrow);
      card.onclick = () => openActivityEditor(habit.id);
      list.append(card);
    }
  });
}

/** M152 · Listes indépendantes de la coche des activités. */
export function renderChecklists(): void {
  const root = document.getElementById("view");
  if (!root) return;
  root.innerHTML = `<section class="page-intro"><p class="eyebrow">LES CHOSES À NE PAS OUBLIER</p>
    <h2>Mes listes</h2><p class="muted">Tes idées et tes petites choses à cocher.</p>
    <form id="new-list-form" class="inline-form"><input aria-label="Nom de la liste" required maxlength="250"
      name="name" placeholder="Une nouvelle liste"><button type="submit" class="primary-button compact">Créer</button></form></section>
    <section class="day-section"><h3>Toutes mes listes</h3>
      <div id="checklist-list" class="entry-list"></div>
      <div class="form-error" id="checklist-error" role="alert"></div></section>`;
  const box = root.querySelector<HTMLElement>("#checklist-list")!;
  const feedback = root.querySelector<HTMLElement>("#checklist-error")!;
  root.querySelector<HTMLFormElement>("#new-list-form")!.onsubmit = event => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    if (!getAppState().user) { navigate({name:"signin"}); return; }
    void saveChecklist({name}).then(result => {
      if (result.ok) renderChecklists();
      else feedback.textContent = result.error.message;
    });
  };
  if (!getAppState().user) { box.textContent = "Connecte-toi pour retrouver tes listes."; return; }
  box.textContent = "Chargement…";
  void listChecklists().then(result => {
    if (!root.isConnected || getAppState().route.name !== "lists") return;
    box.replaceChildren();
    if (!result.ok) { box.textContent = result.error.message; return; }
    if (!result.value.length) { box.textContent = "Aucune liste enregistrée."; return; }
    for (const list of result.value) {
      const article = document.createElement("article");
      article.className = "checklist-card";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "checklist-open";
      button.textContent = (list.iconId || "☷") + "  " + list.name;
      button.setAttribute("aria-expanded", "false");
      const details = document.createElement("div");
      details.className = "checklist-detail";
      button.onclick = () => {
        const open = button.getAttribute("aria-expanded") === "true";
        button.setAttribute("aria-expanded", String(!open));
        details.replaceChildren();
        if (open) return;
        details.textContent = "Chargement des articles…";
        void getChecklistDetails(list.id).then(loaded => {
          if (!details.isConnected) return;
          details.replaceChildren();
          if (!loaded.ok) { details.textContent = loaded.error.message; return; }
          for (const item of loaded.value.items) {
            const row = document.createElement("label");
            row.className = "checklist-item";
            const check = document.createElement("input");
            check.type = "checkbox";
            check.checked = item.checked;
            const name = document.createElement("span");
            name.textContent = item.text;
            check.onchange = () => {
              check.disabled = true;
              void setChecklistItemChecked(item.id, check.checked).then(saved => {
                check.disabled = false;
                if (!saved.ok) {
                  check.checked = !check.checked;
                  feedback.textContent = saved.error.message;
                }
              });
            };
            row.append(check, name);
            details.append(row);
          }
          const add = document.createElement("form");
          add.className = "inline-form";
          const input = document.createElement("input");
          input.name = "text";
          input.required = true;
          input.maxLength = 500;
          input.placeholder = "Ajouter un article";
          input.setAttribute("aria-label", "Nouvel article");
          const submit = document.createElement("button");
          submit.type = "submit";
          submit.className = "soft-button";
          submit.textContent = "+";
          add.append(input, submit);
          add.onsubmit = event => {
            event.preventDefault();
            const text = input.value.trim();
            if (!text) return;
            void saveChecklistItem({
              checklistId: list.id, text, checked: false, position: loaded.value.items.length,
            }).then(saved => {
              if (saved.ok) { button.setAttribute("aria-expanded", "false"); button.click(); }
              else feedback.textContent = saved.error.message;
            });
          };
          details.append(add);
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "text-button destructive";
          remove.textContent = "Archiver cette liste";
          remove.onclick = () => {
            void deleteChecklist(list.id).then(saved => {
              if (saved.ok) renderChecklists();
              else if (saved.error.code !== "CANCELLED") feedback.textContent = saved.error.message;
            });
          };
          details.append(remove);
        });
      };
      article.append(button, details);
      box.append(article);
    }
  });
}

/** M08 · Import et lecteur local, sans hébergement audio distant. */
export function renderMusic(): void {
  const root = document.getElementById("view");
  if (!root) return;
  root.innerHTML =
    "<section class='page-intro'><p class='eyebrow'>UNE PETITE PAUSE</p>" +
    "<h2>Ma musique</h2><p class='muted'>Les fichiers personnels restent sur cet appareil.</p>" +
    "<button type='button' class='soft-button' data-back>← Revenir à Jour</button></section>" +
    "<section class='day-section'><h3>Ajouter un morceau</h3>" +
    "<form id='audio-import' class='media-import'><label>Fichier audio local" +
    "<input type='file' name='file' accept='audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/aac' required></label>" +
    "<button type='submit' class='primary-button compact'>Importer</button></form>" +
    "<p id='music-feedback' role='status' aria-live='polite' class='muted'></p></section>" +
    "<section class='day-section'><h3>Lecture</h3><div class='player-controls'>" +
    "<button type='button' id='player-previous' class='soft-button' aria-label='Morceau précédent'>⏮</button>" +
    "<button type='button' id='player-pause' class='soft-button' aria-label='Pause'>⏸</button>" +
    "<button type='button' id='player-next' class='soft-button' aria-label='Morceau suivant'>⏭</button>" +
    "<label>Mode <select id='player-mode'><option value='normal'>Normal</option>" +
    "<option value='repeat'>Répéter le morceau</option><option value='shuffle'>Aléatoire</option></select></label>" +
    "</div><p class='muted'>Lecture en arrière-plan iPhone à vérifier lors de la recette.</p></section>" +
    "<section class='day-section'><h3>Mes playlists</h3>" +
    "<form id='playlist-form' class='inline-form'><input name='name' aria-label='Nom de la playlist' maxlength='250' required placeholder='Nouvelle playlist'>" +
    "<button type='submit' class='soft-button'>Créer</button></form>" +
    "<div id='playlist-list' class='entry-list'></div></section>" +
    "<section class='day-section'><h3>Bibliothèque musicale</h3>" +
    "<div id='music-list' class='entry-list'></div></section>";
  root.querySelector<HTMLButtonElement>("[data-back]")!.onclick = () => navigate({name:"day"});
  const feedback = root.querySelector<HTMLElement>("#music-feedback")!;
  const list = root.querySelector<HTMLElement>("#music-list")!;
  const playlistList = root.querySelector<HTMLElement>("#playlist-list")!;
  const importForm = root.querySelector<HTMLFormElement>("#audio-import")!;
  const playlistForm = root.querySelector<HTMLFormElement>("#playlist-form")!;
  const playPrevious = root.querySelector<HTMLButtonElement>("#player-previous")!;
  const playPause = root.querySelector<HTMLButtonElement>("#player-pause")!;
  const playNext = root.querySelector<HTMLButtonElement>("#player-next")!;
  root.querySelector<HTMLSelectElement>("#player-mode")!.onchange = event => {
    setPlaybackMode((event.currentTarget as HTMLSelectElement).value as "normal" | "repeat" | "shuffle");
    feedback.textContent = "Mode de lecture modifié.";
  };
  playPause.onclick = () => {
    pausePlayback();
    feedback.textContent = "Lecture en pause.";
  };
  playPrevious.onclick = () => {
    void previousTrack().then(result => {
      feedback.textContent = result.ok ? "Lecture de la piste précédente." : result.error.message;
    });
  };
  playNext.onclick = () => {
    void nextTrack().then(result => {
      feedback.textContent = result.ok ? "Lecture de la piste suivante." : result.error.message;
    });
  };
  if (!getAppState().user) {
    list.textContent = "Connecte-toi pour retrouver les titres et métadonnées.";
    playlistList.textContent = "Playlists disponibles après connexion.";
    importForm.querySelector<HTMLButtonElement>("[type=submit]")!.disabled = true;
    playlistForm.querySelector<HTMLButtonElement>("[type=submit]")!.disabled = true;
    return;
  }
  importForm.onsubmit = event => {
    event.preventDefault();
    const file = (importForm.elements.namedItem("file") as HTMLInputElement).files?.[0];
    if (!file) return;
    const submit = importForm.querySelector<HTMLButtonElement>("[type=submit]")!;
    submit.disabled = true;
    feedback.textContent = "Import local du morceau…";
    void importAudio(file, {}).then(result => {
      submit.disabled = false;
      if (result.ok) renderMusic();
      else feedback.textContent = result.error.message;
    }).catch(() => {
      submit.disabled = false;
      feedback.textContent = "L'import audio a échoué.";
    });
  };
  playlistForm.onsubmit = event => {
    event.preventDefault();
    const name = (playlistForm.elements.namedItem("name") as HTMLInputElement).value.trim();
    if (!name) return;
    const submit = playlistForm.querySelector<HTMLButtonElement>("[type=submit]")!;
    submit.disabled = true;
    void savePlaylist({
      id: crypto.randomUUID(), name, trackIds: [], updatedAt: new Date().toISOString(),
    }).then(result => {
      submit.disabled = false;
      if (result.ok) renderMusic();
      else feedback.textContent = result.error.message;
    }).catch(() => {
      submit.disabled = false;
      feedback.textContent = "Impossible de créer la playlist.";
    });
  };
  playlistList.textContent = "Chargement des playlists…";
  list.textContent = "Chargement des morceaux…";
  // Une seule lecture de bibliothèque pour la page entière : évite de
  // multiplier les requêtes lors du classement des playlists.
  void Promise.all([listPlaylists(), listTracks()]).then(([playlists, tracks]) => {
    if (!root.isConnected || getAppState().route.name !== "music") return;
    playlistList.replaceChildren();
    list.replaceChildren();

    if (!playlists.ok) {
      playlistList.textContent = playlists.error.message;
    } else if (!playlists.value.length) {
      playlistList.textContent = "Aucune playlist créée.";
    } else {
      const known = new Map<string, string>(
        (tracks.ok ? tracks.value : []).map(track => [track.id, track.title] as const),
      );
      for (const playlist of playlists.value) {
        const item = document.createElement("article");
        item.className = "day-section";
        const title = document.createElement("h4");
        title.textContent = "♫  " + playlist.name + " · " + playlist.trackIds.length + " titres";
        item.append(title);

        const removePlaylist = document.createElement("button");
        removePlaylist.type = "button";
        removePlaylist.className = "soft-button compact";
        removePlaylist.textContent = "Supprimer la playlist";
        removePlaylist.setAttribute("aria-label", "Supprimer la playlist " + playlist.name);
        removePlaylist.onclick = () => {
          if (!window.confirm("Supprimer « " + playlist.name +
            " » ? Les morceaux et leurs fichiers seront conservés.")) return;
          removePlaylist.disabled = true;
          void deletePlaylist(playlist.id).then(result => {
            if (result.ok) renderMusic();
            else {
              removePlaylist.disabled = false;
              feedback.textContent = result.error.message;
            }
          }).catch(() => {
            removePlaylist.disabled = false;
            feedback.textContent = "Suppression de playlist indisponible.";
          });
        };
        item.append(removePlaylist);

        const entries = document.createElement("div");
        entries.className = "entry-list";
        if (!playlist.trackIds.length) {
          const empty = document.createElement("p");
          empty.className = "muted";
          empty.textContent = "Playlist vide. Choisis un morceau ci-dessous.";
          entries.append(empty);
        }
        for (const [index, trackId] of playlist.trackIds.entries()) {
          const entry = document.createElement("div");
          entry.className = "activity-row";
          const name = document.createElement("span");
          name.className = "activity-details";
          name.textContent = known.get(trackId) ?? "Morceau indisponible sur cet appareil";
          entry.append(name);
          for (const direction of [-1, 1] as const) {
            const to = index + direction;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "soft-button compact";
            button.disabled = to < 0 || to >= playlist.trackIds.length;
            button.textContent = direction < 0 ? "↑" : "↓";
            button.setAttribute("aria-label", (direction < 0 ? "Monter " : "Descendre ")
              + (known.get(trackId) ?? trackId));
            button.onclick = () => {
              button.disabled = true;
              const reordered = [...playlist.trackIds];
              [reordered[index], reordered[to]] = [reordered[to], reordered[index]];
              void reorderPlaylist(playlist.id, reordered).then(result => {
                if (result.ok) renderMusic();
                else {
                  button.disabled = false;
                  feedback.textContent = result.error.message;
                }
              }).catch(() => {
                button.disabled = false;
                feedback.textContent = "Réordonnancement indisponible.";
              });
            };
            entry.append(button);
          }
          const unlink = document.createElement("button");
          unlink.type = "button";
          unlink.className = "soft-button compact";
          unlink.textContent = "Retirer";
          unlink.setAttribute("aria-label", "Retirer " + (known.get(trackId) ?? trackId)
            + " de la playlist " + playlist.name);
          unlink.onclick = () => {
            unlink.disabled = true;
            void savePlaylist({
              ...playlist, trackIds:playlist.trackIds.filter(id => id !== trackId),
            }).then(result => {
              if (result.ok) renderMusic();
              else {
                unlink.disabled = false;
                feedback.textContent = result.error.message;
              }
            }).catch(() => {
              unlink.disabled = false;
              feedback.textContent = "Modification de playlist indisponible.";
            });
          };
          entry.append(unlink);
          entries.append(entry);
        }
        item.append(entries);

        if (tracks.ok) {
          const available = tracks.value.filter(track => !playlist.trackIds.includes(track.id));
          if (available.length) {
            const addRow = document.createElement("div");
            addRow.className = "inline-form";
            const choice = document.createElement("select");
            choice.setAttribute("aria-label", "Ajouter un morceau à " + playlist.name);
            for (const track of available) {
              const option = document.createElement("option");
              option.value = track.id;
              option.textContent = track.title;
              choice.append(option);
            }
            const add = document.createElement("button");
            add.type = "button";
            add.className = "soft-button compact";
            add.textContent = "Ajouter";
            add.setAttribute("aria-label", "Ajouter à " + playlist.name);
            add.onclick = () => {
              if (!choice.value) return;
              add.disabled = true;
              void savePlaylist({
                ...playlist, trackIds:[...playlist.trackIds,choice.value],
              }).then(result => {
                if (result.ok) renderMusic();
                else {
                  add.disabled = false;
                  feedback.textContent = result.error.message;
                }
              }).catch(() => {
                add.disabled = false;
                feedback.textContent = "Ajout à la playlist indisponible.";
              });
            };
            addRow.append(choice,add);
            item.append(addRow);
          }
        }
        playlistList.append(item);
      }
    }

    if (!tracks.ok) {
      list.textContent = tracks.error.message;
      return;
    }
    if (!tracks.value.length) {
      list.textContent = "Aucun morceau importé sur cet appareil.";
      return;
    }
    setPlaybackQueue(tracks.value.map(track => track.id));
    for (const track of tracks.value) {
      const row = document.createElement("article");
      row.className = "activity-row";
      const play = document.createElement("button");
      play.type = "button";
      play.className = "activity-icon";
      play.textContent = "▶";
      play.setAttribute("aria-label", "Lire " + track.title);
      play.onclick = () => {
        feedback.textContent = "Chargement de " + track.title + "…";
        void playTrack(track.id).then(loaded => {
          feedback.textContent = loaded.ok ? "Lecture : " + track.title : loaded.error.message;
        });
      };
      const name = document.createElement("div");
      name.className = "activity-details";
      const title = document.createElement("strong");
      title.textContent = track.title;
      const meta = document.createElement("span");
      meta.className = "activity-meta";
      meta.textContent = (track.artist || "Artiste non renseigné")
        + (track.source === "imported" ? " · Fichier personnel" : " · Catalogue");
      name.append(title, meta);
      const favorite = document.createElement("button");
      favorite.type = "button";
      favorite.className = "check-control";
      favorite.textContent = track.favorite ? "★" : "☆";
      favorite.setAttribute("aria-label", (track.favorite ? "Retirer des favoris : " : "Ajouter aux favoris : ") + track.title);
      favorite.onclick = () => {
        favorite.disabled = true;
        void setTrackFavorite(track.id, !track.favorite).then(saved => {
          favorite.disabled = false;
          if (saved.ok) renderMusic();
          else feedback.textContent = saved.error.message;
        });
      };
      row.append(play, name, favorite);
      list.append(row);
    }
  }).catch(() => {
    if (playlistList.isConnected) playlistList.textContent = "Playlists indisponibles.";
    if (list.isConnected) list.textContent = "Bibliothèque indisponible.";
  });
}

/** M09 · Galerie et import privé, sans rendre publics les fichiers locaux. */
export function renderDecor(): void {
  const root = document.getElementById("view");
  if (!root) return;
  root.innerHTML =
    "<section class='page-intro'><p class='eyebrow'>UNE TOUCHE PERSONNELLE</p>" +
    "<h2>Mes décors</h2><p class='muted'>Les images importées restent sur ce téléphone.</p>" +
    "<button type='button' class='soft-button' data-back>← Revenir à Jour</button></section>" +
    "<section class='day-section'><h3>Importer une image</h3>" +
    "<form id='image-import' class='media-import'><label>Image de ton appareil" +
    "<input type='file' name='file' accept='image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif' required></label>" +
    "<button type='submit' class='primary-button compact'>Importer</button></form>" +
    "<p id='image-feedback' class='muted' role='status' aria-live='polite'></p></section>" +
    "<section class='day-section'><h3>Ma galerie</h3>" +
    "<label class='muted'>Texte facultatif sur le fond portrait" +
    "<input id='decor-caption' type='text' maxlength='160' placeholder='Une phrase, un rappel…'></label>" +
    "<div id='decor-list' class='image-gallery'></div></section>";
  root.querySelector<HTMLButtonElement>("[data-back]")!.onclick = () => navigate({name:"day"});
  const feedback = root.querySelector<HTMLElement>("#image-feedback")!;
  const target = root.querySelector<HTMLElement>("#decor-list")!;
  const form = root.querySelector<HTMLFormElement>("#image-import")!;
  form.onsubmit = event => {
    event.preventDefault();
    const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
    if (!file) return;
    const submit = form.querySelector<HTMLButtonElement>("[type=submit]")!;
    submit.disabled = true;
    feedback.textContent = "Import local de l'image…";
    void importImage(file).then(result => {
      submit.disabled = false;
      if (result.ok) renderDecor();
      else feedback.textContent = result.error.message;
    }).catch(() => {
      submit.disabled = false;
      feedback.textContent = "Import impossible sur cet appareil.";
    });
  };
  target.textContent = "Chargement de la galerie…";
  void listImages().then(result => {
    if (!root.isConnected || getAppState().route.name !== "decor") return;
    target.replaceChildren();
    if (!result.ok) { target.textContent = result.error.message; return; }
    if (!result.value.length) { target.textContent = "Aucune image importée pour l'instant."; return; }
    for (const image of result.value) {
      const tile = document.createElement("figure");
      tile.className = "image-tile";
      const preview = document.createElement("img");
      preview.loading = "lazy";
      preview.alt = image.name;
      preview.decoding = "async";
      const caption = document.createElement("figcaption");
      caption.textContent = image.name;
      tile.append(preview, caption);
      const actions=document.createElement("div");
      actions.className="header-actions";
      const portrait=document.createElement("button");
      portrait.type="button";
      portrait.className="soft-button compact";
      portrait.textContent="Créer un fond portrait";
      portrait.setAttribute("aria-label","Créer un fond portrait avec "+image.name);
      portrait.onclick=()=>{
        portrait.disabled=true;
        feedback.textContent="Composition locale du fond portrait…";
        const text=root.querySelector<HTMLInputElement>("#decor-caption")?.value.trim()??"";
        const layers:DecorLayer[]=[{
          kind:"image",imageId:image.id,
          x:0,y:0,width:1080,height:1920,opacity:1,
        }];
        if(text)layers.push({
          kind:"text",text,
          x:80,y:1560,width:920,height:200,
          fontSize:64,color:"#FFFFFF",opacity:1,
        });
        void composeDecorImage(layers).then(result=>{
          portrait.disabled=false;
          if(!result.ok){feedback.textContent=result.error.message;return;}
          const url=URL.createObjectURL(result.value);
          const link=document.createElement("a");
          link.href=url;
          link.download="mon-fond-"+new Date().toISOString().slice(0,10)+".png";
          link.textContent="Enregistrer le fond PNG";
          feedback.replaceChildren(link);
          // PNG privé : le téléchargement est un nouveau geste explicite.
        }).catch(()=>{
          portrait.disabled=false;
          feedback.textContent="Création du fond indisponible.";
        });
      };
      const square=document.createElement("button");
      square.type="button";
      square.className="soft-button compact";
      square.textContent="Recadrer au carré";
      square.setAttribute("aria-label","Exporter une copie carrée de "+image.name);
      square.onclick=()=>{
        square.disabled=true;
        feedback.textContent="Recadrage local de l'image…";
        void (async()=>{
          let binary:Blob;
          if(image.source==="imported"&&image.mediaId){
            const local=await readMedia(image.mediaId);
            if(!local.ok)throw Error(local.error.message);
            binary=local.value;
          }else if(image.source==="bundled"&&image.catalogId){
            const asset=resolveCatalogAsset(image.catalogId);
            if(!asset.ok)throw Error(asset.error.message);
            const url=new URL(asset.value);
            if(url.origin!==location.origin)throw Error("Origine d'image interdite");
            const response=await fetch(url.toString(),{
              credentials:"same-origin",redirect:"error",
            });
            if(!response.ok)throw Error("Image du catalogue indisponible");
            binary=await response.blob();
          }else throw Error("Image sans fichier accessible");
          const bitmap=await createImageBitmap(binary);
          const side=Math.min(bitmap.width,bitmap.height);
          const rect={
            x:Math.floor((bitmap.width-side)/2),
            y:Math.floor((bitmap.height-side)/2),
            width:side,height:side,
          };
          bitmap.close();
          return await cropImage(binary,rect);
        })().then(result=>{
          square.disabled=false;
          if(!result.ok){feedback.textContent=result.error.message;return;}
          const url=URL.createObjectURL(result.value);
          const link=document.createElement("a");
          link.href=url;
          link.download="image-carree-"+new Date().toISOString().slice(0,10)+".png";
          link.textContent="Enregistrer le recadrage PNG";
          feedback.replaceChildren(link);
        }).catch(()=>{
          square.disabled=false;
          feedback.textContent="Recadrage indisponible sur cet appareil.";
        });
      };
      actions.append(portrait,square);
      tile.append(actions);
      target.append(tile);
      if (image.source === "imported" && image.mediaId) {
        void readMedia(image.mediaId).then(binary => {
          if (!tile.isConnected) return;
          if (!binary.ok) {
            caption.textContent = image.name + " · fichier local manquant";
            return;
          }
          const url = URL.createObjectURL(binary.value);
          preview.onload = () => URL.revokeObjectURL(url);
          preview.onerror = () => {
            URL.revokeObjectURL(url);
            caption.textContent = image.name + " · aperçu indisponible";
          };
          preview.src = url;
        }).catch(() => {
          if (tile.isConnected) caption.textContent = image.name + " · aperçu indisponible";
        });
      } else if (image.source === "bundled" && image.catalogId) {
        const linked = resolveCatalogAsset(image.catalogId);
        if (linked.ok) preview.src = linked.value;
      }
    }
  }).catch(() => { if (target.isConnected) target.textContent = "Galerie indisponible."; });
}

/** M10 · Compte, session et consentement au cache persistant. */
export function renderSettings(): void {
  const root = document.getElementById("view");
  if (!root) return;
  const state = getAppState();
  root.innerHTML = `<section class="page-intro"><p class="eyebrow">MON PETIT ESPACE</p>
    <h2>Paramètres</h2><p class="muted" id="account-label"></p></section>
    <section class="day-section settings-list">
    <button type="button" class="soft-button" id="settings-monthly">Voir mon bilan mensuel</button>
    <button type="button" class="soft-button" id="settings-cache">Activer le mode hors ligne sur appareil de confiance</button>
    <h3>Notifications sur cet iPhone</h3>
    <p class="muted">Demander l'autorisation ne déclenche aucun rappel : l'abonnement et le serveur gratuit doivent encore être configurés.</p>
    <button type="button" class="soft-button" id="settings-push-permission">Autoriser les notifications</button>
    <button type="button" class="soft-button" id="settings-push-subscribe">Abonner cet appareil (après configuration)</button>
    <button type="button" class="soft-button" id="settings-push-test">Demander un test de notification</button>
    <button type="button" class="soft-button" id="settings-push-revoke">Retirer l'abonnement de cet appareil</button>
    <p class="muted" id="settings-push-status" role="status" aria-live="polite">Aucun envoi distant n'est actif.</p>
    <button type="button" class="soft-button" id="settings-signout">Se déconnecter</button>
    <button type="button" class="soft-button" id="settings-login">Connexion</button>
    <p class="muted" id="settings-status" role="status"></p>
    <h3>Google Agenda (facultatif)</h3>
    <p class="muted">La connexion Google est distincte de celle de l'organiseur. Aucune synchronisation n'est active sans autorisation explicite.</p>
    <button type="button" class="soft-button" id="google-link">Connecter mon Google Agenda</button>
    <button type="button" class="soft-button" id="google-status">Vérifier le statut Google</button>
    <button type="button" class="soft-button" id="google-sync">Synchroniser maintenant</button>
    <button type="button" class="soft-button" id="google-conflicts">Afficher les conflits</button>
    <button type="button" class="soft-button" id="google-unlink">Délier Google Agenda</button>
    <div id="google-conflict-list" class="entry-list"></div>
    <p class="muted" id="google-feedback" role="status" aria-live="polite">Google Agenda n'est pas configuré.</p>
    <h3>Sauvegardes indépendantes</h3>
    <p class="muted">Les données de l'agenda et les fichiers personnels sont deux archives différentes. Les exports ne sont pas chiffrés : conserve-les dans un endroit privé. La restauration n'efface pas les données absentes d'une archive.</p>
    <button type="button" class="soft-button" id="backup-export-json">Exporter mes données (JSON)</button>
    <label class="muted">Archive de données
      <input id="backup-import-json" type="file" accept=".json,application/json">
    </label>
    <label class="muted">Restauration
      <select id="backup-json-mode">
        <option value="merge">Ajouter sans modifier l'existant</option>
        <option value="replace">Remplacer les ID présents dans l'archive (confirmation)</option>
      </select>
    </label>
    <button type="button" class="soft-button" id="backup-restore-json">Restaurer les données</button>
    <button type="button" class="soft-button" id="backup-export-media">Exporter mes musiques et images</button>
    <label class="muted">Archive multimédia de l'ancien iPhone
      <input id="backup-import-media" type="file" accept=".opmedia,application/octet-stream">
    </label>
    <button type="button" class="soft-button" id="backup-restore-media">Restaurer les médias locaux</button>
    <p id="backup-feedback" role="status" aria-live="polite" class="muted">Aucune sauvegarde déclenchée automatiquement.</p></section>`;
  root.querySelector<HTMLElement>("#account-label")!.textContent =
    state.user?.email || "Aucun compte connecté.";

  // M10 / S10 : seules les actions explicites de l'utilisatrice accèdent
  // au contenu du compte ou aux archives locales. Pas d'upload de fichier.
  const backupFeedback=root.querySelector<HTMLElement>("#backup-feedback")!;
  const backupExport=root.querySelector<HTMLButtonElement>("#backup-export-json")!;
  const backupRestore=root.querySelector<HTMLButtonElement>("#backup-restore-json")!;
  const backupExportMedia=root.querySelector<HTMLButtonElement>("#backup-export-media")!;
  const backupRestoreMedia=root.querySelector<HTMLButtonElement>("#backup-restore-media")!;
  backupExport.disabled=!state.user;
  backupRestore.disabled=!state.user;

  backupExport.onclick=()=>{
    backupExport.disabled=true;
    backupFeedback.textContent="Préparation de la sauvegarde des données…";
    void exportDataJson("all").then(result=>{
      backupExport.disabled=false;
      if(!result.ok){backupFeedback.textContent=result.error.message;return;}
      const url=URL.createObjectURL(result.value);
      const link=document.createElement("a");
      link.href=url;
      link.download="organiseur-donnees-"+new Date().toISOString().slice(0,10)+".json";
      link.textContent="Enregistrer la sauvegarde JSON dans Fichiers";
      backupFeedback.replaceChildren(link);
      // Le téléchargement exige un nouveau geste sur iPhone Safari.
      // Le lien reste disponible sur l'écran ; il n'y a pas de sauvegarde auto.
    }).catch(()=>{
      backupExport.disabled=false;
      backupFeedback.textContent="Export des données indisponible.";
    });
  };
  backupRestore.onclick=()=>{
    const file=root.querySelector<HTMLInputElement>("#backup-import-json")!.files?.[0];
    if(!file){backupFeedback.textContent="Choisis d'abord ton fichier JSON.";return;}
    backupRestore.disabled=true;
    backupFeedback.textContent="Contrôle d'intégrité de l'archive…";
    void validateBackup(file).then(async checked=>{
      if(!checked.ok){backupFeedback.textContent=checked.error.message;return;}
      const selected=root.querySelector<HTMLSelectElement>("#backup-json-mode")!.value;
      const mode=selected==="replace"?"replace":"merge";
      const question=mode==="replace"
        ?"Confirmer le remplacement des documents aux mêmes ID ? Les autres documents seront conservés."
        :"Ajouter seulement les documents absents du compte ? Rien ne sera effacé.";
      if(!window.confirm(question)){
        backupFeedback.textContent="Restauration annulée : aucune écriture.";
        return;
      }
      backupFeedback.textContent="Restauration des données sélectionnées…";
      const result=await restoreData(checked.value,mode);
      backupFeedback.textContent=result.ok
        ?"Restauration préparée : "+result.value.created+" ajouté(s), "+
          result.value.updated+" remplacé(s), "+result.value.skipped+
          " conservé(s). Vérifie la synchronisation cloud."
        :result.error.message;
    }).catch(()=>{
      backupFeedback.textContent="Restauration interrompue : vérifie la synchronisation avant de recommencer.";
    }).finally(()=>{backupRestore.disabled=!getAppState().user;});
  };
  backupExportMedia.onclick=()=>{
    backupExportMedia.disabled=true;
    backupFeedback.textContent="Lecture et vérification des fichiers locaux…";
    void exportMediaArchive().then(result=>{
      backupExportMedia.disabled=false;
      if(!result.ok){backupFeedback.textContent=result.error.message;return;}
      const url=URL.createObjectURL(result.value);
      const link=document.createElement("a");
      link.href=url;
      link.download="organiseur-medias-"+new Date().toISOString().slice(0,10)+".opmedia";
      link.textContent="Enregistrer l'archive multimédia dans Fichiers";
      backupFeedback.replaceChildren(link);
    }).catch(()=>{
      backupExportMedia.disabled=false;
      backupFeedback.textContent="Export des médias indisponible.";
    });
  };
  backupRestoreMedia.onclick=()=>{
    const file=root.querySelector<HTMLInputElement>("#backup-import-media")!.files?.[0];
    if(!file){backupFeedback.textContent="Choisis une archive multimédia.";return;}
    if(!window.confirm("Importer les médias dans cet appareil ? Les fichiers existants resteront intacts."))
      return;
    backupRestoreMedia.disabled=true;
    backupFeedback.textContent="Vérification des empreintes avant restauration…";
    void importMediaArchive(file).then(result=>{
      backupFeedback.textContent=result.ok
        ?"Import local : "+result.value.created+" éléments ajoutés, "+
          result.value.skipped+" déjà présents. Les playlists se récupèrent avec le compte et l'archive JSON."
        :result.error.message;
    }).catch(()=>{
      backupFeedback.textContent="Restauration des fichiers locaux impossible.";
    }).finally(()=>{backupRestoreMedia.disabled=false;});
  };
  const cache = root.querySelector<HTMLButtonElement>("#settings-cache")!;
  const logout = root.querySelector<HTMLButtonElement>("#settings-signout")!;
  cache.disabled = !state.user;
  logout.disabled = !state.user;
  const pushPermission = root.querySelector<HTMLButtonElement>("#settings-push-permission")!;
  const pushRevoke = root.querySelector<HTMLButtonElement>("#settings-push-revoke")!;
  const pushStatus = root.querySelector<HTMLElement>("#settings-push-status")!;
  // La demande d'autorisation n'est jamais initiée au chargement de l'écran.
  pushPermission.disabled = !state.user;
  pushRevoke.disabled = !state.user;
  const subscribe = root.querySelector<HTMLButtonElement>("#settings-push-subscribe")!;
  const pushTest = root.querySelector<HTMLButtonElement>("#settings-push-test")!;
  subscribe.disabled = !state.user;
  pushTest.disabled = !state.user;
  subscribe.onclick = () => {
    subscribe.disabled = true;
    void subscribeToPush().then(result => {
      subscribe.disabled = false;
      pushStatus.textContent = result.ok
        ? "Abonnement local enregistré ; les rappels distants restent inactifs sans serveur."
        : result.error.message;
    }).catch(() => {
      subscribe.disabled = false;
      pushStatus.textContent = "Abonnement non confirmé.";
    });
  };
  pushTest.onclick = () => {
    pushTest.disabled = true;
    void testPushSubscription().then(result => {
      pushTest.disabled = false;
      pushStatus.textContent = result.ok
        ? result.value.message ?? "Demande de test reçue, livraison non garantie."
        : result.error.message;
    }).catch(() => {
      pushTest.disabled = false;
      pushStatus.textContent = "Aucun test distant confirmé.";
    });
  };
  pushPermission.onclick = () => {
    // Appelé directement par le geste utilisateur requis sur iPhone.
    void requestPushPermission().then(result => {
      pushStatus.textContent = result.ok
        ? result.value === "granted"
          ? "Autorisation accordée. Aucun abonnement distant actif pour le moment."
          : result.value === "denied"
            ? "Autorisation refusée dans les réglages du téléphone."
            : "Autorisation non accordée. Aucun envoi de notification n'est actif."
        : result.error.message;
    }).catch(() => {pushStatus.textContent = "Autorisation non confirmée.";});
  };
  pushRevoke.onclick = () => {
    pushRevoke.disabled = true;
    void unsubscribeFromPush().then(result => {
      pushRevoke.disabled = false;
      pushStatus.textContent = result.ok
        ? "Abonnement retiré de cet appareil, ou aucun abonnement enregistré."
        : result.error.message;
    }).catch(() => {
      pushRevoke.disabled = false;
      pushStatus.textContent = "Révocation non confirmée.";
    });
  };
  root.querySelector<HTMLButtonElement>("#settings-monthly")!.onclick = () => navigate({name:"monthlyReview"});
  root.querySelector<HTMLButtonElement>("#settings-login")!.onclick = () => navigate({name:"signin"});
  const feedback = root.querySelector<HTMLElement>("#settings-status")!;
  const googleFeedback = root.querySelector<HTMLElement>("#google-feedback")!;
  const conflicts = root.querySelector<HTMLElement>("#google-conflict-list")!;
  const googleIds = ["google-link","google-status","google-sync","google-conflicts","google-unlink"];
  for (const id of googleIds)
    root.querySelector<HTMLButtonElement>("#"+id)!.disabled = !state.user;
  root.querySelector<HTMLButtonElement>("#google-link")!.onclick = () => {
    googleFeedback.textContent = "Préparation du consentement Google…";
    void startGoogleCalendarLink().then(result => {
      if (result.ok) window.location.assign(result.value.url);
      else googleFeedback.textContent = result.error.message;
    }).catch(() => {googleFeedback.textContent = "Connexion Google indisponible.";});
  };
  root.querySelector<HTMLButtonElement>("#google-status")!.onclick = () => {
    googleFeedback.textContent = "Lecture du statut de liaison…";
    void readGoogleCalendarStatus().then(result => {
      googleFeedback.textContent = result.ok
        ? "Google Agenda : "+result.value.status+
          (result.value.lastSyncAt ? " · dernière synchronisation : "+result.value.lastSyncAt : "")
        : result.error.message;
    });
  };
  root.querySelector<HTMLButtonElement>("#google-sync")!.onclick = () => {
    googleFeedback.textContent = "Demande de synchronisation…";
    void requestGoogleCalendarSync("manual").then(result => {
      googleFeedback.textContent = result.ok
        ? "Synchronisation : "+result.value.status+" · "+
          result.value.pulled+" reçus · "+result.value.pushed+" envoyés · "+
          result.value.conflicts+" conflits"
        : result.error.message;
    });
  };
  root.querySelector<HTMLButtonElement>("#google-conflicts")!.onclick = () => {
    conflicts.replaceChildren();
    googleFeedback.textContent = "Recherche des conflits…";
    void queryGoogleCalendarConflicts().then(result => {
      if (!result.ok) {googleFeedback.textContent = result.error.message;return;}
      googleFeedback.textContent = result.value.length+" conflit(s) accessible(s).";
      for (const conflict of result.value) {
        if (conflict.status !== "open") continue;
        const row = document.createElement("article");
        row.className = "checklist-card";
        const info = document.createElement("p");
        info.textContent = "Conflit "+conflict.kind+" sur l'activité "+conflict.localEventId;
        const choices = document.createElement("div");
        choices.className = "header-actions";
        for (const [choice,label] of [
          ["keepLocal","Conserver dans l'organiseur"],
          ["keepGoogle","Conserver Google"],
          ["keepBoth","Garder les deux"],
        ] as const) {
          const button = document.createElement("button");
          button.className = "soft-button";
          button.type = "button";
          button.textContent = label;
          button.onclick = () => {
            if (!window.confirm("Confirmer : "+label+" ?")) return;
            button.disabled = true;
            void resolveGoogleCalendarConflict(conflict.id,choice).then(saved => {
              button.disabled = false;
              if (saved.ok) {
                googleFeedback.textContent = "Conflit résolu, demande une nouvelle synchronisation.";
                row.remove();
              } else googleFeedback.textContent = saved.error.message;
            });
          };
          choices.append(button);
        }
        row.append(info,choices);
        conflicts.append(row);
      }
    });
  };
  root.querySelector<HTMLButtonElement>("#google-unlink")!.onclick = () => {
    if (!state.user || !window.confirm(
      "Délier Google Agenda ? Tes activités locales seront conservées.",
    )) return;
    googleFeedback.textContent = "Déliaison en cours…";
    void unlinkGoogleCalendar(state.user.uid).then(result => {
      googleFeedback.textContent = result.ok
        ? "Google Agenda délié, activités locales conservées." : result.error.message;
    });
  };

  cache.onclick = () => {
    void configurePersistence().then(result => {
      feedback.textContent = result.ok
        ? "Mode local configuré. Vérifie le comportement sur iPhone lors de la recette."
        : result.error.message;
    });
  };
  logout.onclick = () => {
    // Ne pas laisser une piste privée audible après fermeture de la session.
    pausePlayback();
    void signOut().then(result => {
      if (result.ok) navigate({name:"signin"});
      else feedback.textContent = result.error.message;
    });
  };
}

/** M11 · Firebase Auth existant, sans création de comptes factices. */
export function renderSignIn(): void {
  const root = document.getElementById("view");
  if (!root) return;
  root.innerHTML = `<section class="page-intro"><p class="eyebrow">BIENVENUE</p>
    <h2>Mon compte</h2><p class="muted">Connecte-toi pour retrouver tes activités.</p></section>
    <section class="auth-panel"><form id="auth-form">
      <label>Adresse e-mail <input type="email" name="email" autocomplete="email" required></label>
      <label>Mot de passe <input type="password" name="password" autocomplete="current-password" required></label>
      <button type="submit" class="primary-button">Me connecter</button>
      <div class="auth-actions"><button type="button" class="text-button" id="auth-register">Créer un compte</button>
      <button type="button" class="text-button" id="auth-reset">Mot de passe oublié</button></div>
    </form><p id="auth-feedback" class="form-error" role="alert" aria-live="polite"></p></section>`;
  const form = root.querySelector<HTMLFormElement>("#auth-form")!;
  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const feedback = root.querySelector<HTMLElement>("#auth-feedback")!;
  if (!getApps().some(app => app.name === "organiseur-personnel")) {
    feedback.textContent = "Firebase n'est pas encore configuré. Aucune connexion ne sera tentée.";
    form.querySelector<HTMLButtonElement>("[type=submit]")!.disabled = true;
    root.querySelector<HTMLButtonElement>("#auth-register")!.disabled = true;
    root.querySelector<HTMLButtonElement>("#auth-reset")!.disabled = true;
    return;
  }
  form.onsubmit = event => {
    event.preventDefault();
    feedback.textContent = "Connexion en cours…";
    void signIn(input("email").value.trim(), input("password").value).then(result => {
      if (result.ok) navigate({name:"day"});
      else feedback.textContent = result.error.message;
    });
  };
  root.querySelector<HTMLButtonElement>("#auth-register")!.onclick = () => {
    feedback.textContent = "Création du compte en cours…";
    void registerAccount(input("email").value.trim(), input("password").value).then(result => {
      if (result.ok) navigate({name:"day"});
      else feedback.textContent = result.error.message;
    });
  };
  root.querySelector<HTMLButtonElement>("#auth-reset")!.onclick = () => {
    feedback.textContent = "Si l'adresse est enregistrée, un message de récupération sera envoyé.";
    void sendPasswordReset(input("email").value.trim());
  };
}
