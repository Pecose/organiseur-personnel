/** F54 / S1 : les dix objets composites et M124/M157, sans accès au réseau. */
import { classifyActivity, validateActivity } from "../src/features/activities";
import type {
  Activity, ChecklistItem, EncryptedGoogleOAuthGrant, GoogleOAuthState,
  GoogleSyncCursor, ImageMetadata, MediaArchiveManifest, PushSubscriptionRecord,
  ThemeDefinition, TrackMetadata,
} from "../src/domain/types";

const now = "2026-11-02T10:00:00.000Z";
const track: TrackMetadata = {id:"track",title:"Essai",source:"imported",mediaId:"local",favorite:true,updatedAt:now};
const image: ImageMetadata = {id:"image",name:"Fond",source:"bundled",catalogId:"base",tags:[],updatedAt:now};
const theme: ThemeDefinition = {id:"sage",name:"Vert sauge",season:"autumn",colors:{background:"#f0f0e9"}};
const push: PushSubscriptionRecord = {id:"device",endpoint:"https://example.invalid/push",p256dh:"demo",auth:"demo",updatedAt:now};
const archive: MediaArchiveManifest = {schemaVersion:1,createdAt:now,mediaEntries:[],metadata:{},checksums:[]};
const cursor: GoogleSyncCursor = {uid:"user",calendarId:"primary",nextSyncToken:"cursor"};
const grant: EncryptedGoogleOAuthGrant = {uid:"user",calendarId:"primary",ciphertext:"encrypted-fixture",keyVersion:"v1",scopes:[],issuedAt:now};
const state: GoogleOAuthState = {stateId:"id",uid:"user",nonce:"nonce",redirectPath:"/callback",expiresAt:now};
const listItem: ChecklistItem = {id:"item",checklistId:"list",text:"Pain",checked:false,position:0,updatedAt:now};
const base: Activity = {id:"a-1",uid:"user",title:"Lire",timeZone:"Europe/Paris",autoComplete:false,updatedAt:now};

if(!track.favorite||image.tags.length!==0||theme.season!=="autumn"||!push.endpoint
  ||archive.schemaVersion!==1||!cursor.nextSyncToken||!grant.ciphertext||!state.stateId
  ||listItem.checked||!base.title)throw new Error("S1 : les dix types composites ne sont pas cohérents.");

const task=classifyActivity(base);
if(task.length!==1||task[0]!=="task")throw new Error("M124 : tâche non horaire mal classée.");
const scheduled: Activity={...base,plannedOn:"2026-11-04",startAt:"2026-11-04T18:00:00.000Z",autoComplete:true};
const event=classifyActivity(scheduled);
if(event.length!==1||event[0]!=="event")throw new Error("M124 : événement non reconnu.");
const habit: Activity={...base,recurrence:{frequency:"weekly",interval:1,weekdays:[3]}};
const habitView=classifyActivity(habit);
if(habitView.length!==1||habitView[0]!=="habit")throw new Error("M124 : habitude non reconnue.");
const timedHabit: Activity={...scheduled,recurrence:{frequency:"weekly",interval:1,weekdays:[3]}};
if(classifyActivity(timedHabit).join(",")!=="habit,event")throw new Error("M124 : habitude horaire doit être visible dans deux vues.");
if(!validateActivity(base).ok||!validateActivity(scheduled).ok||!validateActivity(timedHabit).ok)throw new Error("M157 : entrée valide rejetée.");

const bad: unknown[]=[
  null,[],{},
  {...base,id:""},
  {...base,title:" "},
  {...base,timeZone:"Atlantide/Inconnu"},
  {...base,stars:4},
  {...base,plannedOn:"2026-02-30"},
  {...base,updatedAt:"demain"},
  {...base,autoComplete:true},
  {...base,endAt:"2026-11-04T20:00:00.000Z"},
  {...scheduled,endAt:"2026-11-04T17:00:00.000Z"},
  {...base,recurrence:{frequency:"weekly",interval:0}},
  {...base,recurrence:{frequency:"weekly",interval:1,weekdays:[0]}},
  {...base,recurrence:{frequency:"daily",interval:1,until:"pas une date"}},
  {...base,googleLink:{calendarId:"",googleEventId:"invalid",pending:"none",source:"app"}},
];
for(const input of bad){if(validateActivity(input).ok)throw new Error("M157 : structure incohérente acceptée : "+JSON.stringify(input));}
const linked: Activity={...scheduled,googleLink:{calendarId:"primary",googleEventId:"google-1",pending:"upsert",source:"app"}};
if(!validateActivity(linked).ok)throw new Error("M157 : lien Google correct rejeté.");
console.log("S1 / T02 : 10 types composites, classification et validation pure vérifiés.");
