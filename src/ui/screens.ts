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
import { groupDayEntries, getDayEntries } from "../features/day";
import {
  getOccurrenceCompletion, setOccurrenceCompletion, undoOccurrenceCompletion,
} from "../features/activities";
import {
  listChecklists, getChecklistDetails, saveChecklist,
  saveChecklistItem, setChecklistItemChecked, deleteChecklist,
} from "../features/checklists";
import {
  listTracks, importAudio, setTrackFavorite, listPlaylists, savePlaylist,
} from "../features/music";
import {
  playTrack, pausePlayback, nextTrack, previousTrack, setPlaybackMode, setPlaybackQueue,
} from "../features/player";
import { readMedia } from "../storage/mediaDb";
import { resolveCatalogAsset } from "../storage/catalog";
import { listImages, importImage } from "../features/decor";
import { signIn, signOut, sendPasswordReset, registerAccount } from "../services/auth";
import { configurePersistence } from "../services/sync";
import { openActivityEditor } from "./dayComponents";
import { formatZonedTime } from "../domain/dates";
import type { ActivityOccurrenceView, LocalDate } from "../domain/types";

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
  void listPlaylists().then(result => {
    if (!root.isConnected || getAppState().route.name !== "music") return;
    playlistList.replaceChildren();
    if (!result.ok) { playlistList.textContent = result.error.message; return; }
    if (!result.value.length) { playlistList.textContent = "Aucune playlist créée."; return; }
    for (const playlist of result.value) {
      const item = document.createElement("article");
      item.className = "activity-row";
      item.textContent = "♫  " + playlist.name + " · " + playlist.trackIds.length + " titres";
      playlistList.append(item);
    }
  }).catch(() => { if (playlistList.isConnected) playlistList.textContent = "Playlists indisponibles."; });

  list.textContent = "Chargement des morceaux…";
  void listTracks().then(result => {
    if (!root.isConnected || getAppState().route.name !== "music") return;
    list.replaceChildren();
    if (!result.ok) { list.textContent = result.error.message; return; }
    if (!result.value.length) { list.textContent = "Aucun morceau importé sur cet appareil."; return; }
    setPlaybackQueue(result.value.map(track => track.id));
    for (const track of result.value) {
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
  }).catch(() => { if (list.isConnected) list.textContent = "Bibliothèque indisponible."; });
}

/** M09 · Décoration secondaire, sans exposition d'images locales à Firestore. */
export function renderDecor(): void {
  const root = document.getElementById("view");
  if (!root) return;
  root.innerHTML = `<section class="page-intro"><p class="eyebrow">UNE TOUCHE PERSONNELLE</p>
    <h2>Mes décors</h2><p class="muted">Tes images personnelles restent sur ton téléphone.</p>
    <button type="button" class="soft-button" data-back>← Revenir à Jour</button></section>
    <section class="day-section"><h3>Galerie</h3><div id="decor-list" class="entry-list"></div></section>`;
  root.querySelector<HTMLButtonElement>("[data-back]")!.onclick = () => navigate({name:"day"});
  const target = root.querySelector<HTMLElement>("#decor-list")!;
  void listImages().then(result => {
    if (!root.isConnected || getAppState().route.name !== "decor") return;
    target.replaceChildren();
    if (!result.ok) { target.textContent = result.error.message; return; }
    if (!result.value.length) { target.textContent = "Aucune image importée pour l'instant."; return; }
    for (const image of result.value) {
      const entry = document.createElement("p");
      entry.className = "activity-row";
      entry.textContent = "✿  " + image.name;
      target.append(entry);
    }
  });
}

/** M10 · Compte, session et consentement au cache persistant. */
export function renderSettings(): void {
  const root = document.getElementById("view");
  if (!root) return;
  const state = getAppState();
  root.innerHTML = `<section class="page-intro"><p class="eyebrow">MON PETIT ESPACE</p>
    <h2>Paramètres</h2><p class="muted" id="account-label"></p></section>
    <section class="day-section settings-list">
    <button type="button" class="soft-button" id="settings-cache">Activer le mode hors ligne sur appareil de confiance</button>
    <button type="button" class="soft-button" id="settings-signout">Se déconnecter</button>
    <button type="button" class="soft-button" id="settings-login">Connexion</button>
    <p class="muted" id="settings-status" role="status"></p>
    <p class="muted">Les sauvegardes indépendantes et Google Agenda seront ajoutés plus tard.</p></section>`;
  root.querySelector<HTMLElement>("#account-label")!.textContent =
    state.user?.email || "Aucun compte connecté.";
  const cache = root.querySelector<HTMLButtonElement>("#settings-cache")!;
  const logout = root.querySelector<HTMLButtonElement>("#settings-signout")!;
  cache.disabled = !state.user;
  logout.disabled = !state.user;
  root.querySelector<HTMLButtonElement>("#settings-login")!.onclick = () => navigate({name:"signin"});
  const feedback = root.querySelector<HTMLElement>("#settings-status")!;
  cache.onclick = () => {
    void configurePersistence().then(result => {
      feedback.textContent = result.ok
        ? "Mode local configuré. Vérifie le comportement sur iPhone lors de la recette."
        : result.error.message;
    });
  };
  logout.onclick = () => {
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
