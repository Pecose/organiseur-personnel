/** F34 / D26 · Sauvegardes indépendantes S10, données privées de l'UID.
 * Code préparatoire non testé (D23). Aucun fichier téléchargé automatiquement.
 * Les flux multimédias sont ajoutés plus bas, séparés du JSON Firestore.
 */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { fetchCloudRecords, putCloudRecord } from "./cloudRepository";
import type {
  BackupEnvelope, BackupScope, CloudCollection, RestoreReport, Result,
} from "../domain/types";

const permittedKinds = [
  "activities", "activityCompletions", "carryOverDecisions", "reminders",
  "checklists", "checklistItems", "tracks", "playlists", "preferences",
] as const;
type BackupKind = typeof permittedKinds[number];

/** M70 · Copie indépendante des données légères, jamais du Push/OAuth.
 * Les références aux fichiers personnels persistent ; le fichier binaire
 * doit être sauvegardé via M73 dans une archive distincte.
 */
export async function exportDataJson(
  scope: BackupScope,
): Promise<Result<Blob>> {
  const groups: Record<BackupScope, readonly BackupKind[]> = {
    all: permittedKinds,
    agenda: ["activities", "activityCompletions", "carryOverDecisions", "reminders"],
    lists: ["checklists", "checklistItems"],
    music: ["tracks", "playlists"],
    preferences: ["preferences"],
  };
  if (!Object.prototype.hasOwnProperty.call(groups, scope))
    return {ok:false,error:{
      code:"INVALID_BACKUP_SCOPE",message:"Périmètre de sauvegarde inconnu.",
    }};
  try {
    const user=getAuth(getApp("organiseur-personnel")).currentUser;
    if(!user)return {ok:false,error:{
      code:"AUTH_REQUIRED",message:"Connexion nécessaire pour sauvegarder les données.",
    }};
    const records:Array<{kind:BackupKind;id:string;data:Record<string,unknown>}>=[];
    for(const kind of groups[scope]){
      const result=await fetchCloudRecords<Record<string,unknown>>(
        user.uid,kind as CloudCollection);
      if(!result.ok)return {ok:false,error:{
        code:"BACKUP_READ_FAILED",
        message:"Lecture incomplète : aucune archive tronquée n'a été produite.",
      }};
      for(const data of result.value){
        const id=kind==="preferences"?"profile":data.id;
        if(typeof id!=="string"||!/^[A-Za-z0-9_.@-]{1,150}$/.test(id)
          ||(kind!=="preferences"&&data.id!==id)
          ||typeof data!=="object"||data===null||Array.isArray(data)
          ||("uid" in data&&data.uid!==user.uid)){
          return {ok:false,error:{
            code:"INVALID_CLOUD_RECORD",
            message:"Une donnée cloud n'est pas exportable sans vérification.",
          }};
        }
        records.push({kind,id,data});
        if(records.length>3000)return {ok:false,error:{
          code:"BACKUP_RECORD_LIMIT",message:"Trop d'enregistrements pour cet export.",
        }};
      }
    }
    // Une seule empreinte pour la liste ordonnée canonique.
    const encoded=new TextEncoder().encode(JSON.stringify(records));
    if(encoded.byteLength>7*1024*1024)return {ok:false,error:{
      code:"BACKUP_TOO_LARGE",message:"La sauvegarde dépasse la limite sécurisée.",
    }};
    const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",encoded));
    const checksum=Array.from(hash).map(n=>n.toString(16).padStart(2,"0")).join("");
    const envelope:BackupEnvelope={
      schemaVersion:1,exportedAt:new Date().toISOString(),
      dataType:"organiseur-cloud-json",ownerUid:user.uid,
      records,checksums:[checksum],
    };
    const blob=new Blob([JSON.stringify(envelope)],{type:"application/json"});
    if(blob.size>8*1024*1024)return {ok:false,error:{
      code:"BACKUP_TOO_LARGE",message:"Archive trop volumineuse pour un export sécurisé.",
    }};
    return {ok:true,value:blob};
  }catch{return {ok:false,error:{
    code:"BACKUP_FAILED",
    message:"Sauvegarde indisponible ; aucun export incomplet n'a été confirmé.",
  }};}
}

/** M71 · Contrôle complet AVANT toute restauration.
 * Le fichier doit être choisi par l'utilisatrice ; un Blob arbitraire
 * ne peut pas devenir un document Firestore sans validation de ses champs.
 */
export async function validateBackup(
  file: File,
): Promise<Result<BackupEnvelope>> {
  if(!(file instanceof Blob)||file.size<1||file.size>8*1024*1024)
    return {ok:false,error:{
      code:"INVALID_BACKUP_FILE",message:"Fichier absent ou trop volumineux (8 Mio maximum).",
    }};
  try{
    const input:unknown=JSON.parse(await file.text());
    if(!input||typeof input!=="object"||Array.isArray(input))
      throw Error("Racine invalide");
    const data=input as Record<string,unknown>;
    if(data.schemaVersion!==1||data.dataType!=="organiseur-cloud-json"
      ||typeof data.exportedAt!=="string"
      ||!/Z$/.test(data.exportedAt)
      ||!Number.isFinite(Date.parse(data.exportedAt))
      ||typeof data.ownerUid!=="string"
      ||!/^[A-Za-z0-9_-]{1,128}$/.test(data.ownerUid)
      ||!Array.isArray(data.records)||data.records.length>3000
      ||!Array.isArray(data.checksums)||data.checksums.length!==1
      ||typeof data.checksums[0]!=="string"
      ||!/^[a-f0-9]{64}$/.test(data.checksums[0]))
      throw Error("En-tête de sauvegarde non conforme");

    const allowed:Record<BackupKind,readonly string[]>={
      activities:["id","uid","title","description","iconId","imageId",
        "stars","plannedOn","startAt","endAt","timeZone","recurrence",
        "autoComplete","checklistId","deletedAt","updatedAt","googleLink"],
      activityCompletions:["id","activityId","occurrenceKey","status",
        "completedAt","overriddenAt","updatedAt"],
      carryOverDecisions:["id","activityId","fromDate","toDate","decision",
        "promptedAt","decidedAt","updatedAt"],
      reminders:["id","activityId","occurrenceKey","scheduledFor","leadMinutes",
        "timeZone","enabled","dispatchStatus"],
      checklists:["id","name","iconId","archived","updatedAt"],
      checklistItems:["id","checklistId","text","checked","position","updatedAt"],
      tracks:["id","title","artist","album","source","catalogId","mediaId",
        "artworkId","duration","favorite","updatedAt"],
      playlists:["id","name","trackIds","updatedAt"],
      preferences:["themeId","backgroundImageId","autoSeason","locale","timeZone",
        "notificationEnabled","updatedAt"],
    };
    const keys=new Set<string>();
    for(const raw of data.records){
      if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error("Entrée invalide");
      const entry=raw as Record<string,unknown>;
      if(Object.keys(entry).sort().join(",")!=="data,id,kind"
        ||typeof entry.kind!=="string"
        ||!permittedKinds.includes(entry.kind as BackupKind)
        ||typeof entry.id!=="string"
        ||!/^[A-Za-z0-9_.@-]{1,150}$/.test(entry.id)
        ||!entry.data||typeof entry.data!=="object"
        ||Array.isArray(entry.data))throw Error("Collection ou enregistrement interdit");
      const kind=entry.kind as BackupKind;
      const payload=entry.data as Record<string,unknown>;
      if((kind==="preferences"&&entry.id!=="profile")
        ||(kind!=="preferences"&&payload.id!==entry.id)
        ||("uid" in payload&&payload.uid!==data.ownerUid)
        ||(kind==="activities"&&payload.uid!==data.ownerUid)
        ||Object.keys(payload).some(key=>!allowed[kind].includes(key)))
        throw Error("Champ ou propriétaire non autorisé");
      const composite=kind+"/"+entry.id;
      if(keys.has(composite))throw Error("ID dupliqué");
      keys.add(composite);
    }
    const canonical=new TextEncoder().encode(JSON.stringify(data.records));
    const actual=new Uint8Array(await crypto.subtle.digest("SHA-256",canonical));
    const hash=Array.from(actual).map(n=>n.toString(16).padStart(2,"0")).join("");
    if(hash!==data.checksums[0])throw Error("Empreinte de sauvegarde incorrecte");
    return {ok:true,value:data as unknown as BackupEnvelope};
  }catch{return {ok:false,error:{
    code:"INVALID_BACKUP",
    message:"Format, propriétés ou empreinte de sauvegarde incorrects. Rien n'a été restauré.",
  }};}
}

/** M72 · Restaurer uniquement des documents légers autorisés.
 * merge ne touche jamais à un ID existant ; replace remplace les ID
 * listés mais ne purge jamais ceux absents de la sauvegarde.
 * Le geste explicite de confirmation 'replace' appartient à F19/M10.
 */
export async function restoreData(
  backup:BackupEnvelope,mode:"merge"|"replace",
):Promise<Result<RestoreReport>> {
  if(mode!=="merge"&&mode!=="replace")return {ok:false,error:{
    code:"INVALID_RESTORE_MODE",message:"Mode de restauration non reconnu.",
  }};
  const checked=await validateBackup(new File(
    [JSON.stringify(backup)],"organiseur-data.json",{type:"application/json"}));
  if(!checked.ok)return checked;
  try {
    const user=getAuth(getApp("organiseur-personnel")).currentUser;
    if(!user||checked.value.ownerUid!==user.uid)
      return {ok:false,error:{
        code:"RESTORE_ACCOUNT_MISMATCH",
        message:"Cette archive appartient à un autre compte ou la session est absente.",
      }};
    // La présence d'un réseau ne prouve pas un ACK serveur, mais son
    // absence connue interdit de promettre une restauration distante.
    if(typeof navigator!=="undefined"&&navigator.onLine===false)
      return {ok:false,error:{
        code:"RESTORE_OFFLINE",
        message:"Reconnecte l'appareil avant de restaurer des données cloud.",
      }};
    const collections=new Map<string,Map<string,Record<string,unknown>>>();
    for(const kind of permittedKinds){
      if(!checked.value.records.some(item=>
        (item as {kind?:unknown}).kind===kind))continue;
      const current=await fetchCloudRecords<Record<string,unknown>>(
        user.uid,kind as CloudCollection);
      if(!current.ok)return {ok:false,error:{
        code:"RESTORE_READ_FAILED",
        message:"Impossible de vérifier les données existantes ; aucune écriture lancée.",
      }};
      const map=new Map<string,Record<string,unknown>>();
      for(const row of current.value){
        const id=kind==="preferences"?"profile":row.id;
        if(typeof id!=="string")return {ok:false,error:{
          code:"RESTORE_READ_FAILED",message:"Enregistrement distant sans ID fiable.",
        }};
        map.set(id,row);
      }
      collections.set(kind,map);
    }
    const report:RestoreReport={
      mode,created:0,updated:0,skipped:0,warnings:[],
    };
    for(const raw of checked.value.records){
      const entry=raw as {kind:BackupKind;id:string;data:Record<string,unknown>};
      const present=collections.get(entry.kind)?.get(entry.id);
      if(present&&(mode==="merge"
        ||entry.kind==="activityCompletions"
          &&present.status==="manually_undone"
          &&entry.data.status!=="manually_undone"
        ||entry.kind==="carryOverDecisions"&&present.decision!==entry.data.decision)){
        report.skipped++;
        continue;
      }
      const written=await putCloudRecord(user.uid,entry.kind,entry.id,entry.data);
      if(!written.ok)return {ok:false,error:{
        code:"RESTORE_PARTIAL",
        message:"Restauration interrompue : "+(report.created+report.updated)+
          " écritures précédentes ont pu être enregistrées. Aucun autre élément effacé.",
      }};
      if(present)report.updated++;
      else report.created++;
      collections.get(entry.kind)?.set(entry.id,entry.data);
    }
    // L'ACK Firebase hors-ligne/cache doit être validé en recette D23.
    report.warnings.push(
      "Vérifie la synchronisation Firebase après restauration ; les médias utilisent une archive distincte.");
    return {ok:true,value:report};
  }catch{return {ok:false,error:{
    code:"RESTORE_FAILED",
    message:"Restauration interrompue : des écritures antérieures sont possibles. Aucun document absent n'est purgé.",
  }};}
}
