/** F16 · M13–M15 : état UI en mémoire, aucune donnée métier dupliquée. */
import type {
  AppVersion, AuthUser, DaySelection, ProfilePreferences, SyncStatus,
  UiRoute, Unsubscribe,
} from "../domain/types";

/** Agrégat AppState explicitement réservé dans §4.1 du registre. */
export interface AppState {
  route: UiRoute;
  daySelection: DaySelection;
  user: AuthUser | null;
  sync: SyncStatus;
  version: AppVersion;
  preferences: ProfilePreferences;
}

const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
let state: AppState = {
  route: { name: "day" },
  daySelection: { selectedDate: today, today, source: "startup" },
  user: null,
  sync: { state: "local", pendingCount: 0, message: "Connexion non configurée." },
  version: {
    version: "0.1.0", cacheRevision: "s7-dev", catalogRevision: "0",
    releasedAt: "2026-11-03T00:00:00.000Z",
  },
  preferences: {
    themeId: "sage", autoSeason: false, locale: "fr-FR",
    timeZone: "Europe/Paris", notificationEnabled: false,
    updatedAt: "2026-11-03T00:00:00.000Z",
  },
};
const listeners = new Set<(value: AppState) => void>();

/** M13 · Les modifications du jour restent une sélection, pas une tâche clonée. */
export function setAppState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

/** M14 */
export function getAppState(): Readonly<AppState> {
  return state;
}

/** M15 */
export function watchAppState(listener: (s: AppState) => void): Unsubscribe {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
