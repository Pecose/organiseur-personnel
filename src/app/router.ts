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
      case "monthlyReview":
        content.textContent = "Le bilan mensuel sera disponible après S8.";
        break;
      case "day":
      default: screens.renderHome();
    }
  }).catch(() => {
    if (content.isConnected) {
      content.textContent = "Cette page ne peut pas être chargée.";
    }
  });
}
