/** F37 · S9A : classification sûre des erreurs de Google Calendar.
 * Le Worker OAuth/Cron reste volontairement NON CONFIGURÉ et NON DÉPLOYÉ.
 * Aucun endpoint HTTP, aucun jeton, aucun secret, aucun compte activé ici.
 */
import type { GoogleCalendarSyncError } from "../../../src/domain/types";

/** M118 · Parser uniquement le statut HTTP et une catégorie contrôlée.
 * Ne jamais recopier dans les logs ni l'UI une erreur brute de Google qui
 * pourrait contenir un code OAuth, un jeton ou un titre d'événement.
 */
export function parseGoogleSyncError(error: unknown): GoogleCalendarSyncError {
  let status: number | undefined;
  if (typeof error === "object" && error !== null) {
    const root = error as Record<string, unknown>;
    const raw = root.status ?? root.statusCode ?? root.code;
    if (typeof raw === "number" && Number.isInteger(raw)) status = raw;
    if (typeof raw === "string" && /^[0-9]{3}$/.test(raw)) status = Number(raw);
    if (status === undefined && root.response && typeof root.response === "object") {
      const response = root.response as Record<string, unknown>;
      if (typeof response.status === "number" && Number.isInteger(response.status)) {
        status = response.status;
      }
    }
  }
  switch (status) {
    case 400:
      return {
        code: "GOOGLE_INVALID_REQUEST", message: "La requête Agenda n'est pas valide.",
        retryable: false, action: "none",
      };
    case 401:
      return {
        code: "GOOGLE_REAUTHORIZE", message: "La connexion Google Agenda doit être renouvelée.",
        retryable: false, action: "reauthorize",
      };
    case 403:
      return {
        code: "GOOGLE_PERMISSION_OR_QUOTA",
        message: "Accès refusé ou quota Google atteint. Vérifie les autorisations avant de réessayer.",
        retryable: false, action: "resolve",
      };
    case 409:
    case 412:
      return {
        code: "GOOGLE_CONFLICT",
        message: "L'événement a changé sur Google. Une décision est nécessaire.",
        retryable: false, action: "resolve",
      };
    case 410:
      return {
        code: "GOOGLE_SYNC_TOKEN_EXPIRED",
        message: "Le curseur Agenda est périmé. Une resynchronisation prudente est nécessaire.",
        retryable: true, action: "resync",
      };
    case 429:
      return {
        code: "GOOGLE_RATE_LIMIT",
        message: "Trop de requêtes Google. La synchronisation doit attendre.",
        retryable: true, action: "wait",
      };
    case 500:
    case 502:
    case 503:
    case 504:
      return {
        code: "GOOGLE_TEMPORARY_ERROR",
        message: "Google Agenda est momentanément indisponible.",
        retryable: true, action: "wait",
      };
    default:
      return {
        code: "GOOGLE_SYNC_UNKNOWN",
        message: "La synchronisation Google Agenda n'a pas abouti.",
        retryable: false, action: "none",
      };
  }
}

/** D25 · Bindings Cloudflare : noms seulement, jamais de valeurs dans GitHub. */
interface WorkerEnv {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_SERVICE_ACCOUNT_EMAIL: string;
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  GOOGLE_GRANT_AES_KEY: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_CONTACT: string;
  APP_ORIGIN: string;
  ENABLE_CRON?: string;
}

const codec = new TextEncoder();
const readable = new TextDecoder();
const calendarScope = "https://www.googleapis.com/auth/calendar.events.owned";
type RecordDoc = Record<string,unknown> & {__updateTime?:string;__name?:string};

function b64url(input:Uint8Array):string {
  let ascii="";
  for(const value of input)ascii+=String.fromCharCode(value);
  return btoa(ascii).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function unb64(input:string):Uint8Array {
  if(!/^[a-zA-Z0-9_-]+$/.test(input)||input.length>100000)throw Error("Invalid encoding");
  const pad=input.replace(/-/g,"+").replace(/_/g,"/");
  return Uint8Array.from(atob(pad+"=".repeat((4-pad.length%4)%4)),value=>value.charCodeAt(0));
}
function randomId():string {
  return b64url(crypto.getRandomValues(new Uint8Array(24)));
}
function configured(env:WorkerEnv):boolean {
  return Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_SERVICE_ACCOUNT_EMAIL
    && env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY
    && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    && env.GOOGLE_REDIRECT_URI && env.GOOGLE_GRANT_AES_KEY
    && env.APP_ORIGIN==="https://pecose.github.io");
}
function respond(value:unknown,origin:string,status=200):Response {
  return new Response(JSON.stringify(value),{
    status,headers:{"Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store", "Access-Control-Allow-Origin":origin,
      "Access-Control-Allow-Headers":"authorization, content-type",
      "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
      "Vary":"Origin","X-Content-Type-Options":"nosniff"},
  });
}

/** D25 · Contrôle cryptographique Firebase SecureToken, UID serveur fiable. */
let secureKeys: {until:number;keys:JsonWebKey[]} | undefined;
async function verifyFirebaseToken(token:string,env:WorkerEnv):Promise<string> {
  const segments=token.split(".");
  if(segments.length!==3||token.length>9000)throw Error("Token invalide");
  const header=JSON.parse(readable.decode(unb64(segments[0]))) as {alg?:string;kid?:string};
  const payload=JSON.parse(readable.decode(unb64(segments[1]))) as Record<string,unknown>;
  const now=Math.floor(Date.now()/1000);
  if(header.alg!=="RS256"||typeof header.kid!=="string"
    ||payload.aud!==env.FIREBASE_PROJECT_ID
    ||payload.iss!=="https://securetoken.google.com/"+env.FIREBASE_PROJECT_ID
    ||typeof payload.sub!=="string"||payload.sub.length<1||payload.sub.length>128
    ||typeof payload.exp!=="number"||payload.exp<=now
    ||typeof payload.iat!=="number"||payload.iat>now+60
    ||typeof payload.auth_time!=="number"||payload.auth_time>now+60)
    throw Error("Token Firebase non accepté");
  if(!secureKeys||secureKeys.until<Date.now()){
    const response=await fetch(
      "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
      {redirect:"error"},
    );
    if(!response.ok)throw Error("Clés publiques Firebase indisponibles");
    const data=await response.json() as {keys?:JsonWebKey[]};
    if(!Array.isArray(data.keys))throw Error("Clés publiques incorrectes");
    secureKeys={keys:data.keys,until:Date.now()+20*60*1000};
  }
  const signingKey=secureKeys.keys.find(entry=>entry.kid===header.kid);
  if(!signingKey)throw Error("Signature Firebase inconnue");
  const key=await crypto.subtle.importKey("jwk",signingKey,
    {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  if(!await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,
    unb64(segments[2]),codec.encode(segments[0]+"."+segments[1])))
    throw Error("Signature Firebase invalide");
  return payload.sub;
}
