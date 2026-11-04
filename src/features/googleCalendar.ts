/** F45 · S9A : interface volontaire avec Google Agenda via F46.
 * Google OAuth est DISTINCT de Firebase Auth. Aucun jeton Google dans la PWA.
 * Synchronisation distante seulement avec configuration et session actives.
 */
import {getApp} from "firebase/app";
import {getAuth} from "firebase/auth";
import {workerRequest} from "../services/googleCalendarBridge";
import type {
  AuthorizationUrl, CalendarSyncConflict, CalendarSyncRun,
  GoogleCalendarConnection, Result,
} from "../domain/types";

/** M103 · Construire la demande d'autorisation, sans naviguer à la place de l'UI. */
export async function startGoogleCalendarLink(): Promise<Result<AuthorizationUrl>> {
  const answer = await workerRequest<AuthorizationUrl>("/api/google/link","POST");
  if (!answer.ok) return answer;
  try {
    const target = new URL(answer.value.url);
    if (target.protocol !== "https:" || target.hostname !== "accounts.google.com"
      || target.pathname !== "/o/oauth2/v2/auth") throw Error("Bad OAuth target");
    return answer;
  } catch {
    return {ok:false,error:{
      code:"GOOGLE_OAUTH_URL_INVALID",
      message:"L'adresse Google reçue n'est pas reconnue. Liaison annulée.",
    }};
  }
}

/** M108 · Au démarrage, à une modification ou sur action de synchronisation. */
export async function requestGoogleCalendarSync(
  reason: "startup" | "edit" | "manual",
): Promise<Result<CalendarSyncRun>> {
  if (!["startup","edit","manual"].includes(reason)) return {ok:false,error:{
    code:"INVALID_SYNC_REASON",message:"Motif de synchronisation inconnu.",
  }};
  return workerRequest<CalendarSyncRun>("/api/google/sync","POST",{reason});
}

/** M115 · Statut non secret de la liaison OAuth. */
export async function readGoogleCalendarStatus(): Promise<Result<GoogleCalendarConnection>> {
  return workerRequest<GoogleCalendarConnection>("/api/google/status","GET");
}

/** M119 · Liste des conflits privés : jamais résolus sans choix de l'utilisatrice. */
export async function queryGoogleCalendarConflicts(): Promise<Result<CalendarSyncConflict[]>> {
  return workerRequest<CalendarSyncConflict[]>("/api/google/conflicts","GET");
}

/** M113 · Aucun arbitrage silencieux entre la version locale et Google. */
export async function resolveGoogleCalendarConflict(
  conflictId: string, choice: "keepLocal" | "keepGoogle" | "keepBoth",
): Promise<Result<void>> {
  if (!/^[a-zA-Z0-9@_-]{1,150}$/.test(conflictId)
    || !["keepLocal","keepGoogle","keepBoth"].includes(choice)) return {
    ok:false,error:{code:"INVALID_CONFLICT",message:"Conflit ou choix invalide."},
  };
  return workerRequest<void>("/api/google/resolve","POST",{conflictId,choice});
}

/** M107 · Délier le grant Google seulement, sans supprimer les événements locaux. */
export async function unlinkGoogleCalendar(uid: string): Promise<Result<void>> {
  try {
    const current = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!current || current.uid !== uid) return {ok:false,error:{
      code:"AUTH_REQUIRED",message:"Session différente de celle de Google Agenda.",
    }};
    return workerRequest<void>("/api/google/unlink","POST");
  } catch {
    return {ok:false,error:{
      code:"GOOGLE_UNLINK_UNAVAILABLE",message:"Déliaison non confirmée.",
    }};
  }
}
