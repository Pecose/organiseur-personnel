/** F15 · Routage SPA par fragment : recharge sûre sur GitHub Pages. */
import type { UiRoute } from "../domain/types";
import { getAppState, setAppState } from "./state";
import { renderCommonStatus } from "../ui/components";

/** M03 · Routage strict sur les noms O20, pas de chemin arbitraire. */
export function resolveRoute(path: string): UiRoute {
  const raw = (path.split("#")[1] || "").split("?")[0].replace(/^\//, "");
  const allowed: UiRoute["name"][] = [
    "calendar", "tasks", "day", "habits", "lists", "music",
    "decor", "settings", "signin", "monthlyReview",
  ];
  return {name: allowed.includes(raw as UiRoute["name"])
    ? raw as UiRoute["name"] : "day"};
}

/** M02 · Les cinq onglets restent les mêmes dans chaque vue. */
export function navigate(route: UiRoute): void {
  const normalized = resolveRoute("#" + route.name);
  if (typeof history !== "undefined") {
    history.pushState(null, "", "#" + normalized.name);
  }
  setAppState({route: {...normalized, params: route.params}});
  renderRoute(normalized);
}

/** M04 · Compose le cadre des cinq onglets, puis la page courante. */
export function renderRoute(route: UiRoute): void {
  const app = document.getElementById("app");
  if (!app) return;
  const state = getAppState();
  app.replaceChildren();
  const page = document.createElement("div");
  page.className = "app-shell";
  const header = document.createElement("header");
  header.className = "app-top";
  const identity = document.createElement("div");
  identity.className = "identity";
  const overline = document.createElement("span");
  overline.className = "overline";
  overline.textContent = "MON PETIT ORGANISEUR";
  const title = document.createElement("h1");
  title.className = "app-title";
  title.textContent = "Ma journée";
  identity.append(overline, title);
  const tools = document.createElement("div");
  tools.className = "header-tools";
  for (const [name, symbol, label] of [
    ["music", "♫", "Musique"], ["decor", "✿", "Décoration"],
    ["settings", "⚙", "Paramètres"],
  ] as const) {
    const button = document.createElement("button");
    button.className = "icon-button";
    button.type = "button";
    button.textContent = symbol;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.onclick = () => navigate({name});
    tools.append(button);
  }
  header.append(identity, tools);

  const status = document.createElement("div");
  status.id = "sync-status";
  const content = document.createElement("main");
  content.id = "view";
  content.className = "content-area";
  content.tabIndex = -1;

  const nav = document.createElement("nav");
  nav.className = "bottom-tabs";
  nav.setAttribute("aria-label", "Navigation principale");
  const tabs: {name: UiRoute["name"]; icon: string; label: string}[] = [
    {name: "calendar", icon: "▦", label: "Calendrier"},
    {name: "tasks", icon: "☑", label: "Tâches"},
    {name: "day", icon: "☀", label: "Jour"},
    {name: "habits", icon: "◉", label: "Habitudes"},
    {name: "lists", icon: "☷", label: "Listes"},
  ];
  for (const tab of tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab-item" + (route.name === tab.name ? " active" : "")
      + (tab.name === "day" ? " tab-center" : "");
    button.setAttribute("aria-current", route.name === tab.name ? "page" : "false");
    const pictogram = document.createElement("span");
    pictogram.className = "tab-symbol";
    pictogram.textContent = tab.icon;
    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = tab.label;
    button.append(pictogram, label);
    button.onclick = () => navigate({name: tab.name});
    nav.append(button);
  }
  page.append(header, status, content, nav);
  app.append(page);
  renderCommonStatus(state.sync);

  // F19 importe M02 pour ses actions. Chargement différé pour supprimer
  // le cycle statique F15 ↔ F19, sans créer de service ni nouveau contrat.
  void import("../ui/screens").then(screens => {
    if (!content.isConnected || getAppState().route.name !== route.name) return;
    switch (route.name) {
      case "calendar": screens.renderAgenda(); break;
      case "tasks": screens.renderTasks(); break;
      case "habits": screens.renderHabits(); break;
      case "lists": screens.renderChecklists(); break;
      case "music": screens.renderMusic(); break;
      case "decor": screens.renderDecor(); break;
      case "settings": screens.renderSettings(); break;
      case "signin": screens.renderSignIn(); break;
      case "monthlyReview": {
        // O38 reste une projection, aucun document de bilan n'est créé.
        content.replaceChildren();
        const panel = document.createElement("section");
        panel.className = "page-intro";
        const title = document.createElement("h2");
        title.textContent = "Mon bilan mensuel";
        const intro = document.createElement("p");
        intro.className = "muted";
        intro.textContent = "Les accomplissements confirmés et présumés du mois.";
        const controls = document.createElement("div");
        controls.className = "review-filters";
        const month = document.createElement("input");
        month.type = "month";
        month.setAttribute("aria-label", "Mois du bilan");
        month.value = new Date().toLocaleDateString("sv-SE", {
          timeZone: getAppState().preferences.timeZone,
        }).slice(0, 7);
        const filter = document.createElement("select");
        filter.setAttribute("aria-label", "Importance des accomplissements");
        for (const [value, label] of [
          ["", "Toutes les étoiles"], ["3", "★★★"], ["2", "★★"], ["1", "★"],
        ] as const) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          filter.append(option);
        }
        const back = document.createElement("button");
        back.type = "button";
        back.className = "soft-button";
        back.textContent = "← Paramètres";
        back.onclick = () => navigate({name: "settings"});
        controls.append(month, filter, back);
        panel.append(title, intro, controls);
        const summary = document.createElement("p");
        summary.className = "muted";
        summary.setAttribute("role", "status");
        const results = document.createElement("div");
        results.className = "entry-list";
        content.append(panel, summary, results);
        let generation = 0;
        const refresh = () => {
          const requestId = ++generation;
          results.replaceChildren();
          if (!getAppState().user) {
            summary.textContent = "Connecte-toi pour consulter tes accomplissements.";
            return;
          }
          summary.textContent = "Calcul du bilan…";
          void import("../features/monthlyReview").then(async review => {
            const stars = filter.value ? Number(filter.value) as 1 | 2 | 3 : undefined;
            const result = await review.getMonthlyReview(month.value, stars);
            if (!content.isConnected || getAppState().route.name !== "monthlyReview"
              || requestId !== generation) return;
            results.replaceChildren();
            if (!result.ok) { summary.textContent = result.error.message; return; }
            summary.textContent = result.value.entries.length + " accomplissement(s) · "
              + result.value.assumedCount + " présumé(s) terminé(s).";
            if (!result.value.entries.length) {
              results.textContent = "Aucun accomplissement dans cette sélection.";
            }
            for (const item of result.value.entries) {
              const article = document.createElement("article");
              article.className = "activity-row";
              const details = document.createElement("div");
              details.className = "activity-details";
              const name = document.createElement("strong");
              name.textContent = item.activity.title;
              const meta = document.createElement("span");
              meta.className = "activity-meta";
              meta.textContent = item.occurrence.localDate
                + " · " + "★".repeat(item.activity.stars || 0)
                + " · " + (item.completion.status === "auto_assumed"
                  ? "Présumé terminé (corrigible depuis Jour)"
                  : "Confirmé manuellement");
              details.append(name, meta);
              article.append(details);
              results.append(article);
            }
          }).catch(() => {
            if (requestId === generation && content.isConnected) {
              summary.textContent = "Bilan indisponible.";
            }
          });
        };
        month.onchange = refresh;
        filter.onchange = refresh;
        refresh();
        break;
      }
      case "day":
      default: screens.renderHome();
    }
  }).catch(() => {
    if (content.isConnected) {
      content.textContent = "Cette page ne peut pas être chargée.";
    }
  });
}
