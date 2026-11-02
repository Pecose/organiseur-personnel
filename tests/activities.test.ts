/** F54 / S1 : les dix objets composites et M124/M157, sans accès au réseau. */
import { classifyActivity, validateActivity, shouldAutoComplete } from "../src/features/activities";
import { expandActivityOccurrences } from "../src/features/habits";
import type {
  Activity, ActivityCompletion, ActivityOccurrenceView, Reminder, CalendarSyncRun, ChecklistItem, EncryptedGoogleOAuthGrant, GoogleOAuthState,
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

/** S3 · Contrats O06/O30/O33 : états par occurrence, sans envoi réel. */
const currentOccurrence = "theatre@2026-11-04";
const nextOccurrence = "theatre@2026-11-11";
const pending: ActivityCompletion = {
  id: currentOccurrence, activityId: "theatre", occurrenceKey: currentOccurrence,
  status: "pending", updatedAt: now,
};
const manuallyCompleted: ActivityCompletion = {
  ...pending, status: "manual_done", completedAt: now,
};
const autoAssumed: ActivityCompletion = {
  ...pending, status: "auto_assumed", completedAt: now,
};
const undone: ActivityCompletion = {
  ...pending, status: "manually_undone", overriddenAt: now,
};
const future: ActivityCompletion = {
  id: nextOccurrence, activityId: "theatre", occurrenceKey: nextOccurrence,
  status: "pending", updatedAt: now,
};
if (pending.occurrenceKey === future.occurrenceKey
  || manuallyCompleted.occurrenceKey !== undone.occurrenceKey
  || autoAssumed.status === undone.status
  || future.status !== "pending") {
  throw new Error("S3 / O33 : identités ou états des occurrences incohérents.");
}
const reminder: Reminder = {
  id: "reminder-4", activityId: "theatre", occurrenceKey: currentOccurrence,
  scheduledFor: "2026-11-04T18:00:00.000Z", leadMinutes: 10,
  timeZone: "Europe/Paris", enabled: true, dispatchStatus: "pending",
};
if (reminder.occurrenceKey !== pending.occurrenceKey || reminder.activityId !== pending.activityId) {
  throw new Error("S3 / O06 : rappel non lié à la bonne occurrence.");
}
const syncRun: CalendarSyncRun = {
  uid: "user", calendarId: "primary", startedAt: now,
  pulled: 0, pushed: 0, conflicts: 0, status: "ok",
};
if (syncRun.conflicts !== 0 || syncRun.uid !== "user") {
  throw new Error("S3 / O30 : rapport technique incorrect.");
}
console.log("S3 / O06 O30 O33 : contrats typés et exemples d'occurrences vérifiés (M133 en attente).");

/** S3 / M133 : récurrence par mercredi, fenêtre de début/fin et veto persistant. */
const theatre: Activity = {
  id: "theatre", uid: "user", title: "Cours de théâtre",
  startAt: "2026-11-04T18:00:00.000Z", endAt: "2026-11-04T19:00:00.000Z",
  timeZone: "Europe/Paris", autoComplete: true, updatedAt: now,
  recurrence: { frequency: "weekly", interval: 1, weekdays: [3] },
};
const wednesdays = expandActivityOccurrences(theatre, {
  from: "2026-11-04T00:00:00.000Z", to: "2026-11-12T00:00:00.000Z",
});
if (wednesdays.length !== 2
    || wednesdays[0].occurrenceKey !== "theatre@2026-11-04"
    || wednesdays[1].occurrenceKey !== "theatre@2026-11-11"
    || wednesdays[1].endsAt !== "2026-11-11T19:00:00.000Z") {
  throw new Error("S3 / M133 : occurrences hebdomadaires mal construites par M130.");
}
const firstWednesday: ActivityOccurrenceView = {
  activity: theatre, occurrence: wednesdays[0],
};
const secondWednesday: ActivityOccurrenceView = {
  activity: theatre, occurrence: wednesdays[1],
};
if (shouldAutoComplete(firstWednesday, "2026-11-04T18:59:59.999Z")) {
  throw new Error("S3 / M133 : la validation ne doit pas se déclencher avant la fin.");
}
if (!shouldAutoComplete(firstWednesday, "2026-11-04T19:00:00.000Z")) {
  throw new Error("S3 / M133 : la fin est prioritaire et inclusive.");
}
const completedWednesday: ActivityCompletion = {
  id: "theatre@2026-11-04", activityId: "theatre",
  occurrenceKey: "theatre@2026-11-04",
  status: "auto_assumed", completedAt: "2026-11-04T19:00:00.000Z",
  updatedAt: "2026-11-04T19:00:00.000Z",
};
const overrideWednesday: ActivityCompletion = {
  ...completedWednesday, status: "manually_undone",
  overriddenAt: "2026-11-04T19:00:01.000Z",
};
const manualWednesday: ActivityCompletion = {
  ...completedWednesday, status: "manual_done",
};
const pendingWednesday: ActivityCompletion = {
  ...completedWednesday, status: "pending",
};
for (const completion of [completedWednesday, overrideWednesday, manualWednesday]) {
  if (shouldAutoComplete({ ...firstWednesday, completion }, "2026-11-12T10:00:00.000Z")) {
    throw new Error("S3 / M133 : une coche déjà décidée ne doit pas se recréer.");
  }
}
if (!shouldAutoComplete({ ...firstWednesday, completion: pendingWednesday },
  "2026-11-04T19:00:00.000Z")) {
  throw new Error("S3 / M133 : une occurrence en attente reste éligible.");
}
if (shouldAutoComplete({ ...firstWednesday, completion: {
  ...pendingWednesday, occurrenceKey: "theatre@2026-11-11",
}}, "2026-11-12T10:00:00.000Z")) {
  throw new Error("S3 / M133 : une coche appartenant à une autre occurrence ne doit jamais être réutilisée.");
}
if (shouldAutoComplete({ ...firstWednesday, completion: {
  ...pendingWednesday, activityId: "different",
}}, "2026-11-12T10:00:00.000Z")) {
  throw new Error("S3 / M133 : une coche appartenant à une autre activité ne doit jamais être réutilisée.");
}
if (shouldAutoComplete({ activity: { ...theatre, id: "different" },
  occurrence: wednesdays[0] }, "2026-11-12T10:00:00.000Z")) {
  throw new Error("S3 / M133 : la vue doit désigner la même activité que l'occurrence.");
}
if (shouldAutoComplete({ ...firstWednesday, activity: {
  ...theatre, autoComplete: false,
}}, "2026-11-12T10:00:00.000Z")) {
  throw new Error("S3 / M133 : l'option désactivée doit être respectée.");
}
if (shouldAutoComplete(firstWednesday, "pas une date")) {
  throw new Error("S3 / M133 : un instant d'évaluation invalide ne doit pas valider.");
}
if (shouldAutoComplete({ ...firstWednesday, occurrence: {
  ...wednesdays[0], endsAt: "date impossible",
}}, "2026-11-12T10:00:00.000Z")) {
  throw new Error("S3 / M133 : un horaire de fin invalide ne doit pas être ignoré.");
}
if (shouldAutoComplete({
  ...firstWednesday, occurrence: { ...wednesdays[0], startsAt: undefined, endsAt: undefined },
}, "2026-11-12T10:00:00.000Z")) {
  throw new Error("S3 / M133 : aucune autovalidation pour une activité sans heure.");
}
const startOnly: ActivityOccurrenceView = {
  activity: { ...theatre, endAt: undefined },
  occurrence: { ...wednesdays[0], endsAt: undefined },
};
if (!shouldAutoComplete(startOnly, "2026-11-04T18:00:00.000Z")
    || shouldAutoComplete(startOnly, "2026-11-04T17:59:59.999Z")) {
  throw new Error("S3 / M133 : sans heure de fin, valider à partir du début.");
}
const firstManuallyUndone: ActivityOccurrenceView = {
  ...firstWednesday, completion: overrideWednesday,
};
const secondStillPending: ActivityOccurrenceView = {
  ...secondWednesday, completion: {
    ...pendingWednesday, id: "theatre@2026-11-11", occurrenceKey: "theatre@2026-11-11",
  },
};
const beforeM133 = JSON.stringify([firstManuallyUndone, secondStillPending]);
if (shouldAutoComplete(firstManuallyUndone, "2026-11-11T19:00:01.000Z")
    || !shouldAutoComplete(secondStillPending, "2026-11-11T19:00:01.000Z")) {
  throw new Error("S3 / M133 : annuler un mercredi ne doit pas bloquer le mercredi suivant.");
}
if (JSON.stringify([firstManuallyUndone, secondStillPending]) !== beforeM133) {
  throw new Error("S3 / M133 : la fonction pure ne doit modifier aucune donnée.");
}
console.log("S3 / M133 : fin prioritaire, annulation persistante et indépendance des mercredis validées.");
