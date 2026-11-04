/** F46 · D25/S9A : passerelle HTTPS vers le Worker Cloudflare.
 * Les jetons Google restent exclusivement dans F37, jamais dans la PWA.
 * Aucun appel n'est lancé sans action/consentement côté UI.
 */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import type { Result } from "../domain/types";

/** Helper F46/D25 · Une enveloppe à UID déterminé par le JWT Firebase vérifié
 * côté Worker. Aucune route autre que la liste contractuelle ne peut sortir.
 */
export async function workerRequest<T>(
  route: string, method: "GET" | "POST", payload?: unknown,
): Promise<Result<T>> {
  const accepted: Readonly<Record<string, "GET" | "POST">> = {
    "/api/google/link": "POST",
    "/api/google/sync": "POST",
    "/api/google/status": "GET",
    "/api/google/unlink": "POST",
    "/api/google/conflicts": "GET",
    "/api/google/resolve": "POST",
    "/api/push/test": "POST",
  };
  if (accepted[route] !== method) return {ok:false,error:{
    code:"WORKER_ROUTE_FORBIDDEN",message:"Opération distante non autorisée.",
  }};
  const address = import.meta.env.VITE_WORKER_ORIGIN as string | undefined;
  if (!address) return {ok:false,error:{
    code:"WORKER_NOT_CONFIGURED",
    message:"Le service gratuit externe n'est pas encore configuré.",
  }};
  try {
    const base = new URL(address);
    if (base.protocol !== "https:" || base.username || base.password
      || base.pathname !== "/" || base.search || base.hash) return {ok:false,error:{
      code:"WORKER_URL_INVALID",message:"Adresse du service externe invalide.",
    }};
    const user = getAuth(getApp("organiseur-personnel")).currentUser;
    if (!user) return {ok:false,error:{
      code:"AUTH_REQUIRED",message:"Connexion nécessaire pour accéder à Google Agenda.",
    }};
    const jwt = await user.getIdToken();
    const body = method === "POST" ? JSON.stringify(payload ?? {}) : undefined;
    if (body && body.length > 16_384) return {ok:false,error:{
      code:"WORKER_PAYLOAD_TOO_LARGE",message:"Requête trop volumineuse.",
    }};
    const response = await fetch(new URL(route, base).toString(), {
      method,
      headers: {
        "Authorization": "Bearer " + jwt,
        "Accept": "application/json",
        ...(method === "POST" ? {"Content-Type":"application/json"} : {}),
      },
      ...(body ? {body} : {}),
      cache:"no-store",
      credentials:"omit",
      redirect:"error",
    });
    if (!response.ok) return {ok:false,error:{
      code:"WORKER_HTTP_" + response.status,
      message:response.status===401?"Session expirée ou non reconnue.":
        response.status===403?"Accès au service refusé.":
        response.status===429?"Trop de demandes, réessaie plus tard.":
        "Le service distant n'a pas confirmé cette opération.",
    }};
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("ok" in data)) throw Error("Bad envelope");
    const result = data as Result<T>;
    if (result.ok) return result;
    // Ne jamais afficher une erreur brute ou une URL avec jeton retournée par un serveur.
    return {ok:false,error:{
      code:typeof result.error?.code==="string" ? result.error.code : "REMOTE_FAILURE",
      message:typeof result.error?.message==="string" ? result.error.message:
        "Opération distante non confirmée.",
    }};
  } catch {
    return {ok:false,error:{
      code:"WORKER_UNAVAILABLE",
      message:"Service distant indisponible. Aucune synchronisation confirmée.",
    }};
  }
}
