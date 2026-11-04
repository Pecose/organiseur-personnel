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

/** D25 · Jeton Firestore serveur uniquement, non retourné au navigateur. */
let serviceCache: {token:string;until:number}|undefined;
async function serviceAccessToken(env:WorkerEnv):Promise<string> {
  if(!env.FIREBASE_SERVICE_ACCOUNT_EMAIL||!env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY)
    throw Error("Accès Firestore non configuré");
  if(serviceCache&&serviceCache.until>Date.now())return serviceCache.token;
  const stamp=Math.floor(Date.now()/1000);
  const header=b64url(codec.encode(JSON.stringify({alg:"RS256",typ:"JWT"})));
  const claims=b64url(codec.encode(JSON.stringify({
    iss:env.FIREBASE_SERVICE_ACCOUNT_EMAIL,
    aud:"https://oauth2.googleapis.com/token",
    scope:"https://www.googleapis.com/auth/datastore",
    iat:stamp,exp:stamp+3500,
  })));
  const data=header+"."+claims;
  const clean=env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY
    .replace(/\\n/g,"\n").replace(/-----[^-]+-----/g,"").replace(/\s+/g,"");
  const privateKey=await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(clean),c=>c.charCodeAt(0)),
    {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"],
  );
  const signature=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",
    privateKey,codec.encode(data));
  const assertion=data+"."+b64url(new Uint8Array(signature));
  const response=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({
      grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),redirect:"error",
  });
  if(!response.ok)throw Error("Autorisation du service Firestore refusée");
  const result=await response.json() as {access_token?:string;expires_in?:number};
  if(!result.access_token)throw Error("Jeton Firestore absent");
  serviceCache={token:result.access_token,until:Date.now()+
    Math.max(60,Math.min((result.expires_in??3600)-120,3000))*1000};
  return result.access_token;
}

/** D25 · Sérialisation contrôlée des documents Firestore REST. */
function firestoreField(value:unknown):unknown {
  if(value==null)return {nullValue:null};
  if(typeof value==="string")return {stringValue:value};
  if(typeof value==="boolean")return {booleanValue:value};
  if(typeof value==="number"){
    if(!Number.isFinite(value))throw Error("Valeur Firestore invalide");
    return Number.isInteger(value)?{integerValue:String(value)}:{doubleValue:value};
  }
  if(Array.isArray(value))return {arrayValue:{values:value.map(firestoreField)}};
  if(typeof value==="object"){
    const fields:Record<string,unknown>={};
    for(const [key,entry]of Object.entries(value))
      if(entry!==undefined)fields[key]=firestoreField(entry);
    return {mapValue:{fields}};
  }
  throw Error("Type Firestore interdit");
}
function unpackField(input:unknown):unknown {
  if(!input||typeof input!=="object")return null;
  const field=input as Record<string,unknown>;
  if("nullValue" in field)return null;
  if("stringValue" in field)return field.stringValue;
  if("booleanValue" in field)return field.booleanValue;
  if("integerValue" in field)return Number(field.integerValue);
  if("doubleValue" in field)return Number(field.doubleValue);
  if("timestampValue" in field)return field.timestampValue;
  if("arrayValue" in field)
    return ((field.arrayValue as {values?:unknown[]}).values??[]).map(unpackField);
  if("mapValue" in field){
    const data=(field.mapValue as {fields?:Record<string,unknown>}).fields??{};
    const obj:Record<string,unknown>={};
    for(const [key,val] of Object.entries(data))obj[key]=unpackField(val);
    return obj;
  }
  throw Error("Type Firestore inconnu");
}
function unpackDocument(input:unknown):RecordDoc {
  const item=input as {name?:string;updateTime?:string;fields?:Record<string,unknown>};
  const result:RecordDoc={};
  for(const [key,val] of Object.entries(item.fields??{}))result[key]=unpackField(val);
  result.__name=item.name;
  result.__updateTime=item.updateTime;
  return result;
}
function firestoreUrl(path:string,env:WorkerEnv):URL {
  if(path.length>650||!/^[-a-zA-Z0-9_@./]+$/.test(path)
    ||path.includes("..")||path.startsWith("/")||path.endsWith("/"))
    throw Error("Chemin Firestore interdit");
  return new URL("https://firestore.googleapis.com/v1/projects/"+
    encodeURIComponent(env.FIREBASE_PROJECT_ID)+
    "/databases/(default)/documents/"+path);
}
async function readDocument(path:string,env:WorkerEnv):Promise<RecordDoc|null> {
  const response=await fetch(firestoreUrl(path,env),{
    headers:{Authorization:"Bearer "+await serviceAccessToken(env)},
    redirect:"error",cache:"no-store",
  });
  if(response.status===404)return null;
  if(!response.ok)throw Error("Lecture Firestore refusée");
  return unpackDocument(await response.json());
}
async function writeDocument(path:string,data:Record<string,unknown>,env:WorkerEnv,
  condition?:{exists?:boolean;updateTime?:string}):Promise<void>{
  const url=firestoreUrl(path,env);
  if(condition?.exists!==undefined)
    url.searchParams.set("currentDocument.exists",String(condition.exists));
  if(condition?.updateTime)
    url.searchParams.set("currentDocument.updateTime",condition.updateTime);
  const fields:Record<string,unknown>={};
  for(const [key,value]of Object.entries(data))
    if(!key.startsWith("__")&&value!==undefined)fields[key]=firestoreField(value);
  const response=await fetch(url,{method:"PATCH",headers:{
    Authorization:"Bearer "+await serviceAccessToken(env),
    "Content-Type":"application/json",
  },body:JSON.stringify({fields}),redirect:"error",cache:"no-store"});
  if(!response.ok)throw Error("Écriture Firestore refusée ou périmée");
}
async function listDocuments(path:string,env:WorkerEnv):Promise<RecordDoc[]> {
  const results:RecordDoc[]=[];let cursor:string|undefined;
  for(let page=0;page<3;page++){
    const url=firestoreUrl(path,env);
    url.searchParams.set("pageSize","100");
    if(cursor)url.searchParams.set("pageToken",cursor);
    const response=await fetch(url,{headers:{
      Authorization:"Bearer "+await serviceAccessToken(env),
    },redirect:"error",cache:"no-store"});
    if(response.status===404)return results;
    if(!response.ok)throw Error("Consultation Firestore indisponible");
    const data=await response.json() as {
      documents?:unknown[];nextPageToken?:string;
    };
    for(const item of data.documents??[])results.push(unpackDocument(item));
    if(!data.nextPageToken)return results;
    cursor=data.nextPageToken;
  }
  throw Error("Pagination au-delà du budget sécurisé de cette opération");
}
