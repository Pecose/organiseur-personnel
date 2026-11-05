/** F37 · S9A : classification sûre des erreurs de Google Calendar.
 * Le Worker OAuth/Cron reste volontairement NON CONFIGURÉ et NON DÉPLOYÉ.
 * Aucun endpoint HTTP, aucun jeton, aucun secret, aucun compte activé ici.
 */
import type {
  Activity, CalendarSyncConflict, CalendarSyncRun, GoogleCalendarChange,
  GoogleCalendarSyncError, GoogleEventLink, GoogleSyncCursor, Reminder,
  PushSubscriptionRecord, NotificationTestResult, DispatchSummary,
  ReminderDispatchCandidate, PushDeliveryResult, PushPayload, Result,
} from "../../../src/domain/types";

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
    ||typeof payload.sub!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(payload.sub)
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

/** M87 / D25 · Signature VAPID ES256, jamais exposée au navigateur.
 * Le JWT autorise seulement l'origine du fournisseur Push désigné.
 * Ne déclenche aucun envoi : l'ordonnanceur et M100 restent bloqués.
 */
async function createVapidJWT(endpoint:string,env:WorkerEnv):Promise<string> {
  const target=new URL(endpoint);
  const trusted=new Set([
    "web.push.apple.com",
    "fcm.googleapis.com",
    "updates.push.services.mozilla.com",
  ]);
  if(target.protocol!=="https:" || !trusted.has(target.hostname)
    || target.port || target.username || target.password || target.hash
    || target.pathname.length<2 || endpoint.length>2200)
    throw Error("Fournisseur Web Push non autorisé");
  const contact=env.VAPID_CONTACT;
  if(!contact || contact.length>200 ||
    !(/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)
      || /^https:\/\/[a-zA-Z0-9.-]+\/[^\s]*$/.test(contact)))
    throw Error("Contact VAPID non configuré");
  const pub=unb64(env.VAPID_PUBLIC_KEY??"");
  if(pub.length!==65 || pub[0]!==4)
    throw Error("Clé publique VAPID invalide");
  const privateKey=await crypto.subtle.importKey(
    "pkcs8",unb64(env.VAPID_PRIVATE_KEY??""),
    {name:"ECDSA",namedCurve:"P-256"},false,["sign"],
  );
  const now=Math.floor(Date.now()/1000);
  const header=b64url(codec.encode(JSON.stringify({typ:"JWT",alg:"ES256"})));
  const claims=b64url(codec.encode(JSON.stringify({
    aud:target.origin,exp:now+3600,sub:contact,
  })));
  const body=header+"."+claims;
  // WebCrypto ECDSA produit la signature IEEE P1363 r||s attendue par ES256.
  const signature=new Uint8Array(await crypto.subtle.sign(
    {name:"ECDSA",hash:"SHA-256"},privateKey,codec.encode(body),
  ));
  if(signature.length!==64)throw Error("Signature VAPID inattendue");
  return body+"."+b64url(signature);
}

/** M87 / RFC8291 + RFC8188 · Chiffrement AES128GCM Web Push.
 * Le contenu reste minimal (test ou identifiant de rappel) ; aucune donnée
 * d'agenda ni clé privée ne passe dans la réponse au navigateur.
 * Une unique trame finale de 4096 octets maximum est construite.
 */
async function encryptWebPush(
  payload:PushPayload,subscription:PushSubscriptionRecord,
):Promise<Uint8Array> {
  if(!subscription || typeof subscription.p256dh!=="string"
    || typeof subscription.auth!=="string")throw Error("Abonnement incomplet");
  const receiver=unb64(subscription.p256dh);
  const auth=unb64(subscription.auth);
  if(receiver.length!==65 || receiver[0]!==4 || auth.length!==16)
    throw Error("Clés d'abonnement invalides");
  let cleanPayload:PushPayload;
  if(payload.kind==="test")cleanPayload={kind:"test"};
  else if(payload.kind==="reminder" &&
    typeof payload.reminderId==="string" &&
    /^[a-zA-Z0-9_-]{1,150}$/.test(payload.reminderId))
    cleanPayload={kind:"reminder",reminderId:payload.reminderId};
  else throw Error("Charge Push interdite");
  const plaintext=codec.encode(JSON.stringify(cleanPayload));
  // RFC8291 : 4096 octets au total, en-tête (86), délimiteur (1), tag (16).
  if(plaintext.length>3993)throw Error("Message Push trop volumineux");
  const remoteKey=await crypto.subtle.importKey(
    "raw",receiver,{name:"ECDH",namedCurve:"P-256"},false,[],
  );
  const localKey=await crypto.subtle.generateKey(
    {name:"ECDH",namedCurve:"P-256"},true,["deriveBits"],
  );
  const sender=new Uint8Array(await crypto.subtle.exportKey("raw",localKey.publicKey));
  if(sender.length!==65 || sender[0]!==4)throw Error("Clé ECDH invalide");
  const secret=new Uint8Array(await crypto.subtle.deriveBits(
    {name:"ECDH",public:remoteKey},localKey.privateKey,256,
  ));
  // RFC8291 : HKDF-Extract(auth_secret, ECDH) puis
  // HKDF-Expand(PRK, "WebPush: info\0" || ua_public || as_public, 32).
  const keyInfo=new Uint8Array(codec.encode("WebPush: info\0").length+
    receiver.length+sender.length);
  keyInfo.set(codec.encode("WebPush: info\0"));
  keyInfo.set(receiver,codec.encode("WebPush: info\0").length);
  keyInfo.set(sender,codec.encode("WebPush: info\0").length+receiver.length);
  const initial=await crypto.subtle.importKey("raw",secret,"HKDF",false,["deriveBits"]);
  const ikm=new Uint8Array(await crypto.subtle.deriveBits({
    name:"HKDF",hash:"SHA-256",salt:auth,info:keyInfo,
  },initial,256));
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const material=await crypto.subtle.importKey("raw",ikm,"HKDF",false,["deriveBits"]);
  const cek=new Uint8Array(await crypto.subtle.deriveBits({
    name:"HKDF",hash:"SHA-256",salt,
    info:codec.encode("Content-Encoding: aes128gcm\0"),
  },material,128));
  const nonce=new Uint8Array(await crypto.subtle.deriveBits({
    name:"HKDF",hash:"SHA-256",salt,
    info:codec.encode("Content-Encoding: nonce\0"),
  },material,96));
  const padded=new Uint8Array(plaintext.length+1);
  padded.set(plaintext);padded[padded.length-1]=2; // RFC8188 : fin du record.
  const aes=await crypto.subtle.importKey("raw",cek,"AES-GCM",false,["encrypt"]);
  const sealed=new Uint8Array(await crypto.subtle.encrypt(
    {name:"AES-GCM",iv:nonce,tagLength:128},aes,padded,
  ));
  // RFC8188 : salt(16) + rs(4 BE) + idlen(1) + keyid(65) + ciphertext.
  const output=new Uint8Array(21+sender.length+sealed.length);
  output.set(salt);
  new DataView(output.buffer).setUint32(16,4096,false);
  output[20]=sender.length;
  output.set(sender,21);
  output.set(sealed,21+sender.length);
  return output;
}

/** D25 / O27 · Grant chiffré AES-256-GCM, UID lié cryptographiquement. */
type TokenResponse = {access_token:string;refresh_token?:string;expires_in?:number;scope?:string};
async function sealGoogleGrant(uid:string,token:TokenResponse,env:WorkerEnv):Promise<string> {
  const secret=unb64(env.GOOGLE_GRANT_AES_KEY);
  if(secret.length!==32)throw Error("Clé de chiffrement absente ou invalide");
  const key=await crypto.subtle.importKey("raw",secret,"AES-GCM",false,["encrypt"]);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({
    name:"AES-GCM",iv,additionalData:codec.encode(uid),
  },key,codec.encode(JSON.stringify(token)));
  const bytes=new Uint8Array(12+encrypted.byteLength);
  bytes.set(iv);bytes.set(new Uint8Array(encrypted),12);
  return b64url(bytes);
}
async function openGoogleGrant(uid:string,stored:RecordDoc,env:WorkerEnv):Promise<TokenResponse> {
  if(stored.uid!==uid||stored.keyVersion!=="v1"||stored.revokedAt
    ||typeof stored.ciphertext!=="string")throw Error("Autorisation Google inaccessible");
  const secret=unb64(env.GOOGLE_GRANT_AES_KEY);
  const raw=unb64(stored.ciphertext);
  if(secret.length!==32||raw.length<29)throw Error("Grant chiffré invalide");
  const key=await crypto.subtle.importKey("raw",secret,"AES-GCM",false,["decrypt"]);
  const clear=await crypto.subtle.decrypt({
    name:"AES-GCM",iv:raw.slice(0,12),additionalData:codec.encode(uid),
  },key,raw.slice(12));
  const data=JSON.parse(readable.decode(clear)) as TokenResponse;
  if(!data.refresh_token)throw Error("Google doit être reconnecté");
  return data;
}
async function googleAccessToken(uid:string,env:WorkerEnv):Promise<string> {
  const grant=await readDocument("users/"+uid+"/googleOAuthGrant/primary",env);
  if(!grant)throw Error("Google non lié");
  const data=await openGoogleGrant(uid,grant,env);
  const response=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({
      client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,
      refresh_token:data.refresh_token!,
      grant_type:"refresh_token",
    }),redirect:"error",
  });
  if(!response.ok)throw Error("Réautorisation Google nécessaire");
  const token=await response.json() as {access_token?:string};
  if(!token.access_token)throw Error("Jeton Google absent");
  return token.access_token;
}
async function googleRequest(path:string,init:RequestInit,uid:string,env:WorkerEnv):Promise<Response> {
  const url=new URL(path,"https://www.googleapis.com");
  if(url.hostname!=="www.googleapis.com"||!url.pathname.startsWith("/calendar/v3/")
    ||url.protocol!=="https:")throw Error("Destination Google refusée");
  return fetch(url,{
    ...init,headers:{...init.headers,Authorization:"Bearer "+await googleAccessToken(uid,env)},
    redirect:"error",cache:"no-store",
  });
}

/** M104 · Consentement Google restreint aux événements possédés. */
function buildGoogleOAuthUrl(uid:string,stateId:string,env:WorkerEnv):{url:string} {
  if(!uid||!stateId||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_REDIRECT_URI)
    throw Error("OAuth non configuré");
  const redirect=new URL(env.GOOGLE_REDIRECT_URI);
  if(redirect.protocol!=="https:"||redirect.pathname!=="/oauth/google/callback"
    ||redirect.search||redirect.hash)throw Error("Callback OAuth non autorisé");
  const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id",env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri",redirect.toString());
  url.searchParams.set("response_type","code");
  url.searchParams.set("scope",calendarScope);
  url.searchParams.set("state",stateId);
  url.searchParams.set("access_type","offline");
  url.searchParams.set("prompt","consent");
  return {url:url.toString()};
}

/** M105 · Chaque tentative est liée à un UID Firebase vérifié. */
async function beginGoogleOAuth(idToken:string,env:WorkerEnv):Promise<{url:string}> {
  const uid=await verifyFirebaseToken(idToken,env);
  const stateId=randomId();
  const now=new Date();
  await writeDocument("serverOAuthStates/"+stateId,{
    stateId,uid,nonce:randomId(),
    redirectPath:"/organiseur-personnel/#calendar",
    expiresAt:new Date(now.getTime()+10*60*1000).toISOString(),
  },env,{exists:false});
  return buildGoogleOAuthUrl(uid,stateId,env);
}

/** M120 · L'état OAuth n'est jamais accepté deux fois. */
async function validateGoogleOAuthState(state:string,env:WorkerEnv):Promise<RecordDoc> {
  if(!/^[a-zA-Z0-9_-]{32}$/.test(state))throw Error("État OAuth invalide");
  const doc=await readDocument("serverOAuthStates/"+state,env);
  if(!doc||doc.stateId!==state||doc.consumedAt
    ||typeof doc.uid!=="string"||typeof doc.nonce!=="string"
    ||typeof doc.expiresAt!=="string"||Date.parse(doc.expiresAt)<=Date.now()
    ||!doc.__updateTime)throw Error("État OAuth expiré ou utilisé");
  return doc;
}

/** M106 · Consomme l'état atomiquement AVANT l'échange du code Google.
 * Sur échec de réseau, l'utilisatrice peut redémarrer le lien volontairement.
 */
async function completeGoogleOAuthCallback(
  code:string,state:string,env:WorkerEnv,
):Promise<{uid:string;calendarId:"primary";status:"active"}> {
  if(!code||code.length>4096)throw Error("Code OAuth invalide");
  const stored=await validateGoogleOAuthState(state,env);
  const uid=stored.uid as string;
  const {__updateTime:revision,...original}=stored;
  delete original.__name;
  await writeDocument("serverOAuthStates/"+state,{
    ...original,consumedAt:new Date().toISOString(),
  },env,{updateTime:revision});
  const response=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({
      code,client_id:env.GOOGLE_CLIENT_ID,
      client_secret:env.GOOGLE_CLIENT_SECRET,
      redirect_uri:env.GOOGLE_REDIRECT_URI,
      grant_type:"authorization_code",
    }),redirect:"error",
  });
  if(!response.ok)throw Error("Code OAuth non accepté");
  const token=await response.json() as TokenResponse;
  if(!token.refresh_token||!token.access_token
    ||!token.scope?.split(" ").includes(calendarScope))
    throw Error("Consentement Google insuffisant");
  const ciphertext=await sealGoogleGrant(uid,token,env);
  await writeDocument("users/"+uid+"/googleOAuthGrant/primary",{
    uid,calendarId:"primary",ciphertext,keyVersion:"v1",
    scopes:[calendarScope],issuedAt:new Date().toISOString(),
  },env);
  const status={uid,calendarId:"primary" as const,status:"active" as const};
  await writeDocument("users/"+uid+"/googleCalendarConnection/status",status,env);
  return status;
}

/** M109 · Pagination et syncToken Google, sans destruction si 410 Gone. */
async function pullGoogleCalendarChanges(uid:string,cursor:GoogleSyncCursor,
  env:WorkerEnv):Promise<{changes:GoogleCalendarChange[];token?:string}> {
  const all:GoogleCalendarChange[]=[];
  let page:string|undefined;let nextToken:string|undefined;
  let resetOnce=false;
  for(let count=0;count<4;count++){
    const uri=new URL("/calendar/v3/calendars/primary/events","https://www.googleapis.com");
    uri.searchParams.set("maxResults","100");
    uri.searchParams.set("showDeleted","true");
    if(cursor.nextSyncToken)uri.searchParams.set("syncToken",cursor.nextSyncToken);
    // Synchronisation initiale non filtrée : nécessaire à un syncToken cohérent.
    if(page)uri.searchParams.set("pageToken",page);
    const response=await googleRequest(uri.pathname+uri.search,{},uid,env);
    if(response.status===410 && cursor.nextSyncToken&&!resetOnce){
      cursor.nextSyncToken=undefined;resetOnce=true;page=undefined;count=-1;all.length=0;
      continue;
    }
    if(!response.ok)throw Error("Google Calendar pull failed");
    const data=await response.json() as {
      items?:Array<Record<string,unknown>>;
      nextPageToken?:string;nextSyncToken?:string;
    };
    for(const item of data.items??[]){
      if(typeof item.id!=="string"||!item.id)continue;
      all.push({
        calendarId:"primary",
        eventId:item.id,etag:typeof item.etag==="string"?item.etag:undefined,
        status:item.status==="cancelled"?"cancelled":"confirmed",
        updatedAt:typeof item.updated==="string"?item.updated:new Date().toISOString(),
        start:item.start,end:item.end,recurrence:item.recurrence,
        payload:{
          summary:typeof item.summary==="string"?item.summary:"Sans titre",
          ...(typeof item.recurringEventId==="string"
            ?{recurringEventId:item.recurringEventId}:{}),
        },
      });
    }
    if(!data.nextPageToken) {
      nextToken=data.nextSyncToken;
      return {changes:all,token:nextToken};
    }
    page=data.nextPageToken;
  }
  throw Error("Google Calendar pagination exceeds bounded free batch");
}

/** M111 · Transformation prudente d'un événement horaire non récurrent.
 * Cas complexes : résultat d'erreur, à traiter comme conflit explicite.
 */
async function mapGoogleEvent(change:GoogleCalendarChange,uid:string,
  local?:Activity):Promise<{ok:true;value:Activity}|{ok:false;error:{code:string;message:string}}> {
  const start=change.start as {dateTime?:string;timeZone?:string}|undefined;
  const end=change.end as {dateTime?:string;timeZone?:string}|undefined;
  const payload=change.payload as {summary?:string;recurringEventId?:string};
  if(change.status==="cancelled"||!start?.dateTime||!end?.dateTime
    ||change.recurrence||payload?.recurringEventId) return {ok:false,error:{
      code:"UNSUPPORTED_GOOGLE_EVENT",
      message:"Récurrence, exception ou événement sans horaire : résolution manuelle nécessaire.",
    }};
  const t1=Date.parse(start.dateTime),t2=Date.parse(end.dateTime);
  if(!Number.isFinite(t1)||!Number.isFinite(t2)||t2<t1) return {ok:false,error:{
    code:"INVALID_GOOGLE_DATES",message:"Horaires de l'événement non reconnus.",
  }};
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",
    codec.encode(change.calendarId+":"+change.eventId)));
  const id=local?.id??("g_"+b64url(digest).slice(0,30));
  const zone=start.timeZone||local?.timeZone||"Europe/Paris";
  try{new Intl.DateTimeFormat("fr-FR",{timeZone:zone});}catch{
    return {ok:false,error:{code:"GOOGLE_ZONE_INVALID",message:"Fuseau horaire non reconnu."}};
  }
  const link:GoogleEventLink={
    calendarId:change.calendarId,googleEventId:change.eventId,etag:change.etag,
    remoteUpdatedAt:change.updatedAt,pending:"none",source:local?.googleLink?.source??"google",
  };
  const result:Activity={
    ...(local??{}),id,uid,
    title:(payload.summary||"Sans titre").slice(0,500),
    startAt:new Date(t1).toISOString(),endAt:new Date(t2).toISOString(),
    timeZone:zone,autoComplete:local?.autoComplete??true,
    updatedAt:new Date().toISOString(),googleLink:link,
  };
  delete result.deletedAt;
  return {ok:true,value:result};
}

/** M110 · Écriture Google seulement pour une activité liée explicitement.
 * ETag strict pour modifier/supprimer un événement existant.
 */
async function pushGoogleCalendarEvent(uid:string,activity:Activity,
  env:WorkerEnv):Promise<{ok:true;value:GoogleEventLink}|{ok:false;error:{code:string;message:string}}> {
  const link=activity.googleLink;
  if(activity.uid!==uid||!link||link.pending==="none"
    ||link.calendarId!=="primary")return {ok:false,error:{
      code:"GOOGLE_LINK_REQUIRED",message:"Événement non lié ou sans modification demandée.",
    }};
  if(link.pending==="delete" && !link.googleEventId) return {ok:false,error:{
    code:"GOOGLE_EVENT_ID_MISSING",message:"Suppression sans événement distant identifié.",
  }};
  if(link.pending==="upsert"&&(!activity.startAt||!activity.endAt
    ||activity.recurrence))return {ok:false,error:{
      code:"GOOGLE_EVENT_UNSUPPORTED",
      message:"Seuls les événements horaires simples et complets peuvent être exportés.",
    }};
  const base="/calendar/v3/calendars/primary/events";
  const target=link.googleEventId
    ?base+"/"+encodeURIComponent(link.googleEventId):base;
  const method=link.pending==="delete"?"DELETE":link.googleEventId?"PATCH":"POST";
  const headers:Record<string,string>={};
  if(method!=="DELETE")headers["Content-Type"]="application/json";
  if(link.googleEventId && link.etag)headers["If-Match"]=link.etag;
  // Sans ETag sur une cible existante, pas d'écrasement aveugle.
  if(link.googleEventId&&!link.etag) return {ok:false,error:{
    code:"GOOGLE_ETAG_REQUIRED",message:"Version Google inconnue, synchronise avant modification.",
  }};
  const payload=method==="DELETE"?undefined:JSON.stringify({
    summary:activity.title,
    start:{dateTime:activity.startAt,timeZone:activity.timeZone},
    end:{dateTime:activity.endAt,timeZone:activity.timeZone},
  });
  const response=await googleRequest(target,{
    method,headers,...(payload?{body:payload}:{}),
  },uid,env);
  if(!response.ok)return {ok:false,error:{
    code:response.status===409||response.status===412?"GOOGLE_CONFLICT":"GOOGLE_PUSH_FAILED",
    message:"Google n'a pas confirmé la modification, les données locales sont conservées.",
  }};
  const remote=method==="DELETE"?null:await response.json() as {
    id?:string;etag?:string;updated?:string;
  };
  const finalGoogleEventId=remote?.id??link.googleEventId;
  if(!finalGoogleEventId)return {ok:false,error:{
    code:"GOOGLE_EVENT_ID_MISSING",message:"Identifiant Google non confirmé.",
  }};
  return {ok:true,value:{
    calendarId:"primary",googleEventId:finalGoogleEventId,
    etag:remote?.etag??link.etag,
    remoteUpdatedAt:remote?.updated??new Date().toISOString(),
    pending:"none",source:link.source,
  }};
}

/** M112 · Rapprochement sans clonage ni dernière-écriture-gagnante.
 * O26 matérialise chaque événement distant non pris en charge ou concurrent.
 */
async function reconcileGoogleCalendar(uid:string,changes:GoogleCalendarChange[],
  env:WorkerEnv):Promise<{pulled:number;conflicts:number}> {
  const path="users/"+uid+"/activities";
  const previous=await listDocuments(path,env);
  const byId=new Map(previous.map(item=>[item.id as string,item]));
  let conflicts=0;
  for(const change of changes){
    const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",
      codec.encode(change.calendarId+":"+change.eventId)));
    const id="g_"+b64url(digest).slice(0,30);
    const existing=previous.find(record=>{
      const link=record.googleLink as GoogleEventLink|undefined;
      return link?.calendarId===change.calendarId&&link.googleEventId===change.eventId;
    })??byId.get(id);
    const effectiveId=existing?.id as string|undefined ?? id;
    const stored=existing as unknown as Activity|undefined;
    const pending=stored?.googleLink?.pending;
    const mapped=await mapGoogleEvent(change,uid,stored);
    const other= mapped.ok ? previous.find(local=>
      local.id!==effectiveId && !local.googleLink
      && local.title===mapped.value.title && local.startAt===mapped.value.startAt
      && !local.deletedAt) : undefined;
    const mustResolve=(!mapped.ok && change.status!=="cancelled")
      ||Boolean(pending&&pending!=="none")||Boolean(other);
    if(mustResolve){
      const conflictHash=new Uint8Array(await crypto.subtle.digest("SHA-256",
        codec.encode(uid+":"+change.eventId)));
      const conflictId="c_"+b64url(conflictHash).slice(0,28);
      const conflict:CalendarSyncConflict={
        id:conflictId,uid,localEventId:(other?.id as string)||effectiveId,
        googleEventId:change.eventId,
        kind:!mapped.ok ? "recurrence" : other ? "mapping" : "update",
        localVersion:stored?.updatedAt??"",
        googleVersion:change.etag??change.updatedAt,
        detectedAt:new Date().toISOString(),status:"open",
      };
      await writeDocument("users/"+uid+"/googleCalendarConflicts/"+conflictId,
        conflict as unknown as Record<string,unknown>,env);
      conflicts++;
      continue;
    }
    if(change.status==="cancelled"){
      if(!stored||stored.deletedAt)continue;
      const {__updateTime:revision}=existing!;
      await writeDocument(path+"/"+effectiveId,{
        ...stored,deletedAt:new Date().toISOString(),
        updatedAt:new Date().toISOString(),
        googleLink:{...stored.googleLink,pending:"none",remoteUpdatedAt:change.updatedAt},
      },env,revision?{updateTime:revision}:undefined);
      continue;
    }
    if(!mapped.ok)continue;
    if(existing?.googleLink && (existing.googleLink as GoogleEventLink).etag===change.etag)
      continue;
    await writeDocument(path+"/"+effectiveId,mapped.value as unknown as Record<string,unknown>,
      env,existing?.__updateTime
        ?{updateTime:existing.__updateTime}:{exists:false});
  }
  return {pulled:changes.length,conflicts};
}

/** M108 · Synchronisation volontaire ou à l'ouverture, en petites tranches.
 * La première association IMPORTE les événements distants sans pousser tous
 * les événements locaux dépourvus de lien explicite.
 */
async function syncGoogleCalendar(uid:string,
  reason:"startup"|"edit"|"manual",env:WorkerEnv):Promise<CalendarSyncRun> {
  const startedAt=new Date().toISOString();
  const statePath="users/"+uid+"/googleCalendarSync/state";
  const cursorDoc=await readDocument(statePath,env);
  const cursor:GoogleSyncCursor={
    uid,calendarId:"primary",
    ...(typeof cursorDoc?.nextSyncToken==="string"
      ?{nextSyncToken:cursorDoc.nextSyncToken}:{}),
  };
  const gathered=await pullGoogleCalendarChanges(uid,cursor,env);
  const merged=await reconcileGoogleCalendar(uid,gathered.changes,env);
  let pushed=0,conflicts=merged.conflicts;
  const activities=await listDocuments("users/"+uid+"/activities",env);
  // Les changements locaux doivent porter explicitement O24.pending.
  for(const item of activities){
    const local=item as unknown as Activity;
    if(local.uid!==uid||!local.googleLink
      ||local.googleLink.pending==="none")continue;
    const result=await pushGoogleCalendarEvent(uid,local,env);
    if(result.ok){
      await writeDocument("users/"+uid+"/activities/"+local.id,{
        ...local,googleLink:result.value,updatedAt:new Date().toISOString(),
      },env,item.__updateTime?{updateTime:item.__updateTime}:undefined);
      pushed++;
    }else{
      conflicts++;
      const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",
        codec.encode(uid+":"+local.id+":"+local.googleLink.googleEventId)));
      const id="c_"+b64url(digest).slice(0,28);
      const record:CalendarSyncConflict={
        id,uid,localEventId:local.id,googleEventId:local.googleLink.googleEventId,
        kind:local.deletedAt?"delete":"update",localVersion:local.updatedAt,
        googleVersion:local.googleLink.etag??"",
        detectedAt:new Date().toISOString(),status:"open",
      };
      await writeDocument("users/"+uid+"/googleCalendarConflicts/"+id,
        record as unknown as Record<string,unknown>,env);
    }
  }
  const finishedAt=new Date().toISOString();
  await writeDocument(statePath,{
    uid,calendarId:"primary",
    ...(gathered.token?{nextSyncToken:gathered.token}:{}),
    ...(cursor.nextSyncToken?{}:{lastFullSyncAt:finishedAt}),
    lastIncrementalSyncAt:finishedAt,
  },env,cursorDoc?.__updateTime
    ?{updateTime:cursorDoc.__updateTime}:{exists:false});
  // Précondition optimiste sur O25 : une autre synchronisation ayant avancé
  // le curseur interdit toute écriture d'un état périmé (pas de rollback).
  await writeDocument("users/"+uid+"/googleCalendarConnection/status",{
    uid,calendarId:"primary",status:"active",lastSyncAt:finishedAt,
  },env);
  return {
    uid,calendarId:"primary",startedAt,finishedAt,
    pulled:merged.pulled,pushed,conflicts,
    status:conflicts?"partial":"ok",
    details:conflicts?"Certains événements nécessitent une décision.":undefined,
  };
}

/** M113 · La décision d'une personne prime sur les versions concurrentes.
 * En cas d'événement Google non représentable, le conflit reste ouvert.
 */
async function resolveGoogleCalendarConflict(uid:string,conflictId:string,
  choice:"keepLocal"|"keepGoogle"|"keepBoth",env:WorkerEnv):Promise<void> {
  if(!/^[a-zA-Z0-9_-]{1,150}$/.test(conflictId)
    ||!["keepLocal","keepGoogle","keepBoth"].includes(choice))
    throw Error("Décision de conflit invalide");
  const conflictPath="users/"+uid+"/googleCalendarConflicts/"+conflictId;
  const issue=await readDocument(conflictPath,env);
  if(!issue||issue.uid!==uid||issue.status!=="open"
    ||typeof issue.localEventId!=="string"||typeof issue.googleEventId!=="string")
    throw Error("Conflit absent ou déjà traité");
  const localPath="users/"+uid+"/activities/"+issue.localEventId;
  const original=await readDocument(localPath,env);
  const local=original as unknown as Activity|null;
  if(choice==="keepLocal"){
    if(!original||!local?.googleLink)throw Error("Aucune liaison locale à pousser");
    await writeDocument(localPath,{
      ...local,googleLink:{...local.googleLink,pending:"upsert"},
      updatedAt:new Date().toISOString(),
    },env,original.__updateTime?{updateTime:original.__updateTime}:undefined);
  }else{
    const uri="/calendar/v3/calendars/primary/events/"+
      encodeURIComponent(issue.googleEventId);
    const response=await googleRequest(uri,{},uid,env);
    if(!response.ok)throw Error("Version distante inaccessible");
    const remote=await response.json() as Record<string,unknown>;
    const change:GoogleCalendarChange={
      calendarId:"primary",eventId:issue.googleEventId,
      etag:typeof remote.etag==="string"?remote.etag:undefined,
      status:remote.status==="cancelled"?"cancelled":"confirmed",
      updatedAt:typeof remote.updated==="string"?remote.updated:new Date().toISOString(),
      start:remote.start,end:remote.end,recurrence:remote.recurrence,
      payload:{
        summary:typeof remote.summary==="string"?remote.summary:"Sans titre",
        ...(typeof remote.recurringEventId==="string"
          ?{recurringEventId:remote.recurringEventId}:{}),
      },
    };
    const mapped=await mapGoogleEvent(change,uid,choice==="keepGoogle"?(local??undefined):undefined);
    if(!mapped.ok)throw Error("La récurrence doit être réglée manuellement dans Google");
    if(choice==="keepBoth"&&local&&original){
      const copyId="copy_"+randomId();
      await writeDocument("users/"+uid+"/activities/"+copyId,{
        ...local,id:copyId,googleLink:undefined,updatedAt:new Date().toISOString(),
      },env,{exists:false});
    }
    const dest="users/"+uid+"/activities/"+mapped.value.id;
    await writeDocument(dest,mapped.value as unknown as Record<string,unknown>,
      env,choice==="keepGoogle"&&original?.__updateTime
        ?{updateTime:original.__updateTime}:undefined);
  }
  await writeDocument(conflictPath,{
    ...issue,status:"resolved",
  },env,issue.__updateTime?{updateTime:issue.__updateTime}:undefined);
}

/** D25 · Routeur HTTPS à liste blanche, sans UID fourni par le client. */
async function handleWorkerRequest(req:Request,env:WorkerEnv):Promise<Response> {
  const url=new URL(req.url);
  const origin=req.headers.get("Origin")??"";
  const allowed=env.APP_ORIGIN==="https://pecose.github.io";
  const cors:HeadersInit={
    "Access-Control-Allow-Origin":env.APP_ORIGIN||"null",
    "Access-Control-Allow-Headers":"authorization, content-type",
    "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
    "Cache-Control":"no-store",
    "Vary":"Origin",
  };
  if(req.method==="OPTIONS"){
    if(!allowed||origin!==env.APP_ORIGIN)return new Response(null,{status:403});
    return new Response(null,{status:204,headers:cors});
  }
  // Google arrive sans Origin mais le code et l'état restent confidentiels :
  // seule l'URL de callback fixe peut les recevoir.
  if(url.pathname==="/oauth/google/callback"){
    if(req.method!=="GET"||!configured(env)
      ||url.origin+url.pathname!==env.GOOGLE_REDIRECT_URI
      ||!allowed)return new Response("Callback non disponible.",{status:503,
        headers:{"Cache-Control":"no-store"}});
    try{
      const code=url.searchParams.get("code")??"";
      const state=url.searchParams.get("state")??"";
      await completeGoogleOAuthCallback(code,state,env);
    }catch{
      // Aucun code OAuth ni état n'est jamais recopié dans la redirection.
      return new Response(null,{status:303,headers:{
        Location:env.APP_ORIGIN+"/organiseur-personnel/#settings",
        "Cache-Control":"no-store","Referrer-Policy":"no-referrer",
      }});
    }
    return new Response(null,{status:303,headers:{
      Location:env.APP_ORIGIN+"/organiseur-personnel/#calendar",
      "Cache-Control":"no-store","Referrer-Policy":"no-referrer",
    }});
  }
  if(!allowed||origin!==env.APP_ORIGIN)
    return new Response("Origine refusée.",{status:403,headers:{"Cache-Control":"no-store"}});
  if(!configured(env))return respond({ok:false,error:{
    code:"WORKER_NOT_CONFIGURED",message:"Les clés du service gratuit ne sont pas configurées.",
  }},origin,503);
  const routes:Record<string,string>={
    "/api/google/link":"POST","/api/google/sync":"POST",
    "/api/google/status":"GET","/api/google/unlink":"POST",
    "/api/google/conflicts":"GET","/api/google/resolve":"POST",
    "/api/push/test":"POST",
  };
  if(!routes[url.pathname])return respond({ok:false,error:{
    code:"NOT_FOUND",message:"Route inconnue.",
  }},origin,404);
  if(req.method!==routes[url.pathname])return respond({ok:false,error:{
    code:"METHOD_NOT_ALLOWED",message:"Méthode interdite.",
  }},origin,405);
  if(url.search)return respond({ok:false,error:{
    code:"QUERY_FORBIDDEN",message:"Paramètres URL interdits sur l'API.",
  }},origin,400);
  const auth=req.headers.get("Authorization")??"";
  if(!auth.startsWith("Bearer "))return respond({ok:false,error:{
    code:"AUTH_REQUIRED",message:"Session nécessaire.",
  }},origin,401);
  let uid:string;
  try{uid=await verifyFirebaseToken(auth.slice(7),env);}
  catch{return respond({ok:false,error:{
    code:"AUTH_INVALID",message:"La session Firebase n'est pas reconnue.",
  }},origin,401);}
  try{
    const length=Number(req.headers.get("Content-Length")??"0");
    if(length>16_384)throw Error("Body too large");
    const raw=req.method==="POST"?await req.text():"";
    if(raw.length>16_384)throw Error("Body too large");
    const input=raw?JSON.parse(raw) as Record<string,unknown>:{};
    if(!input||typeof input!=="object"||Array.isArray(input))
      throw Error("Body invalid");
    const path=url.pathname;
    if(path==="/api/google/link"){
      const result=await beginGoogleOAuth(auth.slice(7),env);
      return respond({ok:true,value:result},origin);
    }
    if(path==="/api/google/status"){
      const status=await readDocument("users/"+uid+"/googleCalendarConnection/status",env);
      const value=status?{
        uid,calendarId:"primary",status:status.status??"error",
        lastSyncAt:status.lastSyncAt,lastError:status.lastError,
      }:{uid,calendarId:"primary",status:"disconnected"};
      return respond({ok:true,value},origin);
    }
    if(path==="/api/google/sync"){
      if(!["startup","edit","manual"].includes(String(input.reason)))
        return respond({ok:false,error:{code:"INVALID_REASON",
          message:"Motif de synchronisation inconnu."}},origin,400);
      const status=await readDocument("users/"+uid+"/googleCalendarConnection/status",env);
      if(status?.status!=="active")return respond({ok:false,error:{
        code:"GOOGLE_NOT_CONNECTED",message:"Connecte d'abord Google Agenda.",
      }},origin,409);
      const result=await syncGoogleCalendar(uid,
        input.reason as "startup"|"edit"|"manual",env);
      return respond({ok:true,value:result},origin);
    }
    if(path==="/api/google/conflicts"){
      const docs=await listDocuments("users/"+uid+"/googleCalendarConflicts",env);
      const value=docs.filter(d=>d.uid===uid&&d.status==="open").map(item=>({
        id:item.id,uid,localEventId:item.localEventId,
        googleEventId:item.googleEventId,kind:item.kind,
        localVersion:item.localVersion,googleVersion:item.googleVersion,
        detectedAt:item.detectedAt,status:item.status,
      }));
      return respond({ok:true,value},origin);
    }
    if(path==="/api/google/resolve"){
      if(typeof input.conflictId!=="string"
        ||!["keepLocal","keepGoogle","keepBoth"].includes(String(input.choice)))
        return respond({ok:false,error:{code:"INVALID_CONFLICT",
          message:"Décision de conflit invalide."}},origin,400);
      await resolveGoogleCalendarConflict(uid,input.conflictId,
        input.choice as "keepLocal"|"keepGoogle"|"keepBoth",env);
      return respond({ok:true,value:null},origin);
    }
    if(path==="/api/google/unlink"){
      const grantPath="users/"+uid+"/googleOAuthGrant/primary";
      const stored=await readDocument(grantPath,env);
      if(stored&&!stored.revokedAt){
        const token=await openGoogleGrant(uid,stored,env);
        const response=await fetch("https://oauth2.googleapis.com/revoke",{
          method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
          body:new URLSearchParams({token:token.refresh_token??""}),
          redirect:"error",
        });
        if(!response.ok&&response.status!==400)throw Error("Révocation non confirmée");
        await writeDocument(grantPath,{
          uid,calendarId:"primary",ciphertext:"",keyVersion:"v1",
          scopes:[],issuedAt:stored.issuedAt,
          revokedAt:new Date().toISOString(),
        },env,stored.__updateTime?{updateTime:stored.__updateTime}:undefined);
      }
      await writeDocument("users/"+uid+"/googleCalendarConnection/status",{
        uid,calendarId:"primary",status:"disconnected",
      },env);
      return respond({ok:true,value:null},origin);
    }
    if(path==="/api/push/test"){
      if(typeof input.deviceId!=="string")
        return respond({ok:false,error:{code:"INVALID_DEVICE",
          message:"Identifiant d'abonnement invalide."}},origin,400);
      const result=await handlePushTestRequest(auth.slice(7),input.deviceId,env);
      return respond(result,origin,result.ok?200:409);
    }
    return respond({ok:false,error:{code:"NOT_FOUND",message:"Route absente."}},origin,404);
  }catch{
    // Jamais de réponse brute Google, Firestore ou OAuth contenant un secret.
    return respond({ok:false,error:{
      code:"REMOTE_OPERATION_FAILED",
      message:"Le serveur n'a pas confirmé l'opération. Réessaie sans risque.",
    }},origin,503);
  }
}

/** M100 · Test Push préparé, NON ACTIVÉ avant recette T07.
 * Interrupteur compilé à false : même un Worker déployé par erreur ne peut
 * expédier de notification. Le passage à true nécessite la recette et une
 * décision explicite de mise en service, sans ajout de compte payant.
 *
 * À l'activation future : UID JWT vérifié, endpoint appartenant à cet UID,
 * signature VAPID, charge chiffrée RFC8291 et claim Firestore atomique O19
 * limitant les essais d'un même appareil à un toutes les dix minutes.
 */
const PUSH_TEST_SECURITY_APPROVED=false;
async function handlePushTestRequest(
  authToken:string,deviceId:string,env:WorkerEnv,
):Promise<{ok:true;value:NotificationTestResult}|{ok:false;error:{code:string;message:string}}> {
  const uid=await verifyFirebaseToken(authToken,env);
  if(!/^[a-zA-Z0-9_-]{1,150}$/.test(deviceId))return {ok:false,error:{
    code:"INVALID_DEVICE",message:"Identifiant d'appareil invalide.",
  }};
  if(!PUSH_TEST_SECURITY_APPROVED)return {ok:false,error:{
    code:"PUSH_SENDING_NOT_READY",
    message:"L'envoi chiffré est préparé mais reste désactivé jusqu'à la recette de sécurité.",
  }};
  // La recherche est strictement sous l'UID vérifié, jamais depuis le corps.
  const stored=await readDocument("users/"+uid+"/pushSubscriptions/"+deviceId,env);
  if(!stored||stored.id!==deviceId||typeof stored.endpoint!=="string"
    ||typeof stored.p256dh!=="string"||typeof stored.auth!=="string")
    return {ok:false,error:{
      code:"PUSH_DEVICE_NOT_FOUND",message:"Aucun abonnement correspondant à cet appareil.",
    }};
  const subscription:PushSubscriptionRecord={
    id:deviceId,endpoint:stored.endpoint,p256dh:stored.p256dh,
    auth:stored.auth,updatedAt:String(stored.updatedAt??""),
  };
  // Chiffrer et signer AVANT de consommer un reçu de tentative.
  // createVapidJWT valide aussi la liste des fournisseurs HTTPS autorisés.
  const token=await createVapidJWT(subscription.endpoint,env);
  const payload=await encryptWebPush({kind:"test"},subscription);
  const now=Date.now();
  const receiptPath="users/"+uid+"/dispatchReceipts/test@"+deviceId;
  const previous=await readDocument(receiptPath,env);
  if(previous){
    const last=typeof previous.attemptedAt==="string"
      ?Date.parse(previous.attemptedAt):NaN;
    // En cas de date incohérente, refuser plutôt que contourner le quota.
    if(!Number.isFinite(last)||now-last<600_000)return {ok:false,error:{
      code:"PUSH_TEST_RATE_LIMITED",
      message:"Test déjà demandé récemment sur cet appareil. Réessaie plus tard.",
    }};
    if(!previous.__updateTime)throw Error("Reçu sans version Firestore");
  }
  const attemptedAt=new Date(now).toISOString();
  const receipt={
    reminderId:"test",occurrenceKey:deviceId,attemptedAt,
    outcome:"attempted",retryAfter:new Date(now+600_000).toISOString(),
  };
  // Précondition atomique Firestore : deux appels concurrents ne peuvent
  // pas tous les deux réserver le même créneau de dix minutes.
  await writeDocument(receiptPath,receipt,env,previous
    ?{updateTime:previous.__updateTime}:{exists:false});
  const claim=await readDocument(receiptPath,env);
  if(!claim||!claim.__updateTime
    ||claim.reminderId!=="test" ||claim.occurrenceKey!==deviceId
    ||claim.attemptedAt!==attemptedAt)
    throw Error("Réservation de test Push non confirmée");
  // Le retrait depuis ce téléphone est prioritaire : abonnement revérifié
  // juste avant l'appel au fournisseur, après la signature/chiffrement.
  const live=await readDocument(
    "users/"+uid+"/pushSubscriptions/"+deviceId,env);
  if(!live ||live.id!==deviceId
    ||live.endpoint!==subscription.endpoint
    ||live.p256dh!==subscription.p256dh
    ||live.auth!==subscription.auth)
    return {ok:false,error:{
      code:"PUSH_DEVICE_NOT_FOUND",
      message:"Cet appareil n'est plus abonné. Aucun test envoyé.",
    }};
  const accepted=await fetch(subscription.endpoint,{
    method:"POST",redirect:"error",cache:"no-store",
    headers:{
      "Authorization":"vapid t="+token+", k="+env.VAPID_PUBLIC_KEY,
      "Content-Encoding":"aes128gcm",
      "Content-Type":"application/octet-stream",
      "TTL":"120",
      "Urgency":"normal",
    },
    body:payload,
  });
  // Une erreur lors de l'écriture du résultat ne rend jamais la réservation
  // disponible dans la même fenêtre (sécurité anti-doublon avant confort).
  await writeDocument(receiptPath,{
    ...receipt,outcome:accepted.ok?"accepted":"rejected",
  },env,{updateTime:claim.__updateTime});
  if(!accepted.ok)return {ok:false,error:{
    code:"PUSH_PROVIDER_REJECTED",
    message:"Le fournisseur n'a pas accepté le test de notification.",
  }};
  return {ok:true,value:{
    supported:true,permitted:true,subscribed:true,sent:true,
    message:"Le fournisseur a accepté le test. Son affichage sur l'iPhone n'est pas garanti.",
  }};
}

/** M84–M88 · S9B / D25 : moteur de rappels préparé mais INACTIF.
 * Aucun envoi tant que T05/T07 et les vérifications de quotas ne sont pas
 * terminés. La lecture de collection group sans filtre évite un index
 * supplémentaire : plafond strict de 80 rappels, sinon erreur fermée.
 */
const CRON_SECURITY_APPROVED=false;
async function handleWorkerCron(now:string,env:WorkerEnv):Promise<void> {
  // Cette double barrière protège même si un Cron était publié par erreur.
  if(!CRON_SECURITY_APPROVED || env.ENABLE_CRON!=="true")
    throw Error("CRON_NOT_VALIDATED");

  /** M85 : accès serveur, jamais de liste d'UID fournie par le navigateur.
   * Le query group non filtré se limite à 81 documents (81e = saturation).
   * Ne jamais traiter un sous-ensemble arbitraire comme complet à la limite.
   */
  async function fetchDueReminders(
    current:string,
  ):Promise<Result<ReminderDispatchCandidate[]>> {
    const timestamp=Date.parse(current);
    if(!Number.isFinite(timestamp))return {ok:false,error:{
      code:"INVALID_INSTANT",message:"Date Cron invalide.",
    }};
    try {
      const url=new URL("https://firestore.googleapis.com/v1/projects/"+
        encodeURIComponent(env.FIREBASE_PROJECT_ID)+
        "/databases/(default)/documents:runQuery");
      const response=await fetch(url,{
        method:"POST",
        headers:{
          "Authorization":"Bearer "+await serviceAccessToken(env),
          "Content-Type":"application/json",
        },
        body:JSON.stringify({structuredQuery:{
          from:[{collectionId:"reminders",allDescendants:true}],
          limit:81,
        }}),
        redirect:"error",cache:"no-store",
      });
      if(!response.ok)throw Error("Lecture Firestore refusée");
      const raw:unknown=await response.json();
      if(!Array.isArray(raw))throw Error("Format Firestore inattendu");
      const found=raw.filter(entry=>entry&&typeof entry==="object"
        &&"document" in entry).map(entry=>
          unpackDocument((entry as {document:unknown}).document));
      if(found.length>80)return {ok:false,error:{
        code:"REMINDER_SCAN_LIMIT",
        message:"Trop de rappels : arrêt sécurisé de la collecte.",
      }};
      const due:{uid:string;reminder:Reminder;dueAt:number}[]=[];
      for(const document of found){
        const name=document.__name??"";
        const match=/\/documents\/users\/([A-Za-z0-9_-]{1,128})\/reminders\/([A-Za-z0-9_-]{1,150})$/.exec(name);
        if(!match || document.id!==match[2])continue;
        const item=document as unknown as Reminder;
        const when=Date.parse(item.scheduledFor);
        if(!item.enabled || item.dispatchStatus==="sent"
          || item.dispatchStatus==="cancelled"
          || !Number.isFinite(when)
          || !Number.isSafeInteger(item.leadMinutes)
          || item.leadMinutes<0 || item.leadMinutes>10080
          || typeof item.activityId!=="string"
          || !/^[A-Za-z0-9_-]{1,150}$/.test(item.activityId)
          || typeof item.occurrenceKey!=="string"
          || !/^[A-Za-z0-9_-]{1,150}@\d{4}-\d{2}-\d{2}$/.test(item.occurrenceKey)
          || !item.occurrenceKey.startsWith(item.activityId+"@"))continue;
        const dueAt=when-item.leadMinutes*60_000;
        if(dueAt<=timestamp)due.push({uid:match[1],reminder:item,dueAt});
      }
      due.sort((a,b)=>a.dueAt-b.dueAt||a.reminder.id.localeCompare(b.reminder.id));
      const candidates:ReminderDispatchCandidate[]=[];
      // Limite par Cron compatible avec les budgets de requêtes gratuits.
      for(const entry of due){
        if(candidates.length>=3)break;
        const subscriptions=await listDocuments(
          "users/"+entry.uid+"/pushSubscriptions",env);
        if(subscriptions.length>4)return {ok:false,error:{
          code:"PUSH_DEVICE_LIMIT",
          message:"Trop d'appareils abonnés : aucun envoi lancé.",
        }};
        const devices:PushSubscriptionRecord[]=[];
        for(const rawDevice of subscriptions){
          if(typeof rawDevice.id!=="string"
            || !/^[A-Za-z0-9_-]{1,150}$/.test(rawDevice.id)
            || typeof rawDevice.endpoint!=="string"
            || typeof rawDevice.p256dh!=="string"
            || typeof rawDevice.auth!=="string")continue;
          devices.push({
            id:rawDevice.id,endpoint:rawDevice.endpoint,
            p256dh:rawDevice.p256dh,auth:rawDevice.auth,
            updatedAt:String(rawDevice.updatedAt??""),
          });
        }
        if(devices.length)candidates.push({
          uid:entry.uid,reminder:entry.reminder,subscriptions:devices,
        });
      }
      return {ok:true,value:candidates};
    }catch{return {ok:false,error:{
      code:"REMINDER_SCAN_FAILED",
      message:"Collecte des rappels non confirmée.",
    }};}
  }

  /** M86 : idempotence par occurrence, création atomique O19.
   * Un reçu existant n'est pas relancé, même si l'acceptation du fournisseur
   * est inconnue. Pas de double envoi après timeout ou crash Worker.
   */
  async function claimReminderOccurrence(
    candidate:ReminderDispatchCandidate,
  ):Promise<Result<boolean>> {
    const {uid,reminder}=candidate;
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid)
      || !/^[A-Za-z0-9_-]{1,150}$/.test(reminder.id)
      || !/^[A-Za-z0-9_-]{1,150}@\d{4}-\d{2}-\d{2}$/.test(reminder.occurrenceKey))
      return {ok:false,error:{code:"INVALID_REMINDER",
        message:"Identifiants de rappel invalides."}};
    try{
      // Relecture au dernier moment pour éviter un rappel déjà désactivé.
      const fresh=await readDocument("users/"+uid+"/reminders/"+reminder.id,env);
      if(!fresh||fresh.enabled!==true ||fresh.dispatchStatus==="cancelled"
        ||fresh.dispatchStatus==="sent"
        ||fresh.occurrenceKey!==reminder.occurrenceKey
        ||fresh.scheduledFor!==reminder.scheduledFor
        ||fresh.leadMinutes!==reminder.leadMinutes)
        return {ok:true,value:false};
      const when=Date.parse(String(fresh.scheduledFor));
      if(!Number.isFinite(when)||!Number.isSafeInteger(fresh.leadMinutes)
        || when-Number(fresh.leadMinutes)*60_000>Date.parse(now))
        return {ok:true,value:false};
      const receiptPath="users/"+uid+"/dispatchReceipts/"+
        reminder.id+"@"+reminder.occurrenceKey;
      try {
        await writeDocument(receiptPath,{
          reminderId:reminder.id,occurrenceKey:reminder.occurrenceKey,
          attemptedAt:new Date().toISOString(),outcome:"attempted",
        },env,{exists:false});
        return {ok:true,value:true};
      }catch{
        // Une contention se distingue d'une panne serveur par relecture.
        if(await readDocument(receiptPath,env))
          return {ok:true,value:false};
        throw Error("Réservation non confirmée");
      }
    }catch{return {ok:false,error:{
      code:"REMINDER_CLAIM_FAILED",
      message:"Réservation atomique du rappel non confirmée.",
    }};}
  }

  /** M87 : uniquement des endpoints Push HTTPS approuvés par VAPID.
   * Accepter au moins un appareil => aucune relance automatique globale.
   */
  async function sendWebPush(
    candidate:ReminderDispatchCandidate,
  ):Promise<Result<PushDeliveryResult>> {
    if(!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY
      || !env.VAPID_CONTACT
      || candidate.subscriptions.length<1
      || candidate.subscriptions.length>4)return {ok:false,error:{
        code:"PUSH_NOT_CONFIGURED",
        message:"Envoi Web Push non configuré ou nombre d'appareils invalide.",
      }};
    let accepted=0;
    let lastStatus=0;
    let mayRetry=false;
    for(const subscription of candidate.subscriptions){
      try{
        // M87 : après le claim O19, relire le rappel ET l'abonnement
        // juste avant le réseau. Un rappel supprimé, déplacé ou désactivé
        // entre M86 et M87 ne doit pas être envoyé à partir d'un snapshot.
        const fresh=await readDocument(
          "users/"+candidate.uid+"/reminders/"+candidate.reminder.id,env);
        if(!fresh || fresh.enabled!==true
          || fresh.dispatchStatus==="cancelled" || fresh.dispatchStatus==="sent"
          || fresh.activityId!==candidate.reminder.activityId
          || fresh.occurrenceKey!==candidate.reminder.occurrenceKey
          || fresh.scheduledFor!==candidate.reminder.scheduledFor
          || fresh.leadMinutes!==candidate.reminder.leadMinutes){
          return {ok:true,value:{
            ok:accepted>0,status:accepted>0?202:0,retryable:false,
          }};
        }
        const liveDevice=await readDocument(
          "users/"+candidate.uid+"/pushSubscriptions/"+subscription.id,env);
        if(!liveDevice || liveDevice.id!==subscription.id
          || liveDevice.endpoint!==subscription.endpoint
          || liveDevice.p256dh!==subscription.p256dh
          || liveDevice.auth!==subscription.auth)continue;
        const token=await createVapidJWT(subscription.endpoint,env);
        const message=await encryptWebPush({
          kind:"reminder",reminderId:candidate.reminder.id,
        },subscription);
        const response=await fetch(subscription.endpoint,{
          method:"POST",redirect:"error",cache:"no-store",
          headers:{
            "Authorization":"vapid t="+token+", k="+env.VAPID_PUBLIC_KEY,
            "Content-Encoding":"aes128gcm",
            "Content-Type":"application/octet-stream",
            "TTL":"300",
            "Urgency":"normal",
          },body:message,
        });
        lastStatus=response.status;
        if(response.ok)accepted++;
        else if(response.status===429||response.status>=500)mayRetry=true;
      }catch{
        // Le fournisseur a peut-être accepté l'envoi avant la coupure.
        // Ne pas retenter aveuglément une issue réseau ambiguë.
        lastStatus=0;
      }
    }
    return {ok:true,value:{
      ok:accepted>0,status:accepted>0?202:lastStatus,
      retryable:accepted===0 && mayRetry,
    }};
  }

  /** M88 : le reçu initial reste présent en cas de panne.
   * Le résultat ne peut modifier que l'occurrence réclamée par ce Worker.
   */
  async function recordDispatchResult(
    candidate:ReminderDispatchCandidate,result:PushDeliveryResult,
  ):Promise<Result<void>> {
    const receiptPath="users/"+candidate.uid+"/dispatchReceipts/"+
      candidate.reminder.id+"@"+candidate.reminder.occurrenceKey;
    try{
      const receipt=await readDocument(receiptPath,env);
      if(!receipt||!receipt.__updateTime
        ||receipt.reminderId!==candidate.reminder.id
        ||receipt.occurrenceKey!==candidate.reminder.occurrenceKey
        ||receipt.outcome!=="attempted")
        return {ok:false,error:{
          code:"DISPATCH_RECEIPT_INVALID",
          message:"Reçu d'envoi absent, périmé ou déjà finalisé.",
        }};
      await writeDocument(receiptPath,{
        reminderId:candidate.reminder.id,
        occurrenceKey:candidate.reminder.occurrenceKey,
        attemptedAt:receipt.attemptedAt,
        outcome:result.ok?"accepted":"failed",
        ...(result.retryable
          ?{retryAfter:new Date(Date.now()+15*60_000).toISOString()} : {}),
      },env,{updateTime:receipt.__updateTime});
      return {ok:true,value:undefined};
    }catch{return {ok:false,error:{
      code:"DISPATCH_RECEIPT_WRITE_FAILED",
      message:"Journalisation sécurisée non confirmée.",
    }};}
  }

  /** M84 : un rappel réclamé ne sera jamais expédié une seconde fois.
   * Un retour fournisseur 2xx ne garantit PAS une notification iPhone.
   */
  async function runReminderCron(
    current:string,
  ):Promise<Result<DispatchSummary>> {
    const summary:DispatchSummary={scanned:0,claimed:0,sent:0,failed:0};
    const fetched=await fetchDueReminders(current);
    if(!fetched.ok)return fetched;
    summary.scanned=fetched.value.length;
    for(const candidate of fetched.value){
      const claimed=await claimReminderOccurrence(candidate);
      if(!claimed.ok)return claimed;
      if(!claimed.value)continue;
      summary.claimed++;
      const result=await sendWebPush(candidate);
      if(!result.ok){
        summary.failed++;
        const recorded=await recordDispatchResult(candidate,{
          ok:false,status:0,retryable:false,
        });
        if(!recorded.ok)return recorded;
        continue;
      }
      if(result.value.ok)summary.sent++;
      else summary.failed++;
      const recorded=await recordDispatchResult(candidate,result.value);
      if(!recorded.ok)return recorded;
    }
    return {ok:true,value:summary};
  }

  const outcome=await runReminderCron(now);
  if(!outcome.ok)throw Error(outcome.error.code);
}

/** F37 · Worker sans activation implicite. Aucun job Cron dans F38. */
export default {
  fetch(request:Request,env:WorkerEnv):Promise<Response> {
    return handleWorkerRequest(request,env);
  },
  async scheduled(_controller:unknown,env:WorkerEnv):Promise<void> {
    // Même en cas de configuration accidentelle d'un déclencheur,
    // aucune notification ni mutation distante n'a lieu sans recette.
    if(env.ENABLE_CRON!=="true")return;
    if(!CRON_SECURITY_APPROVED)throw Error("CRON_NOT_VALIDATED");
    await handleWorkerCron(new Date().toISOString(),env);
  },
};
