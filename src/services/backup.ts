/** F34 / D26 · Sauvegardes indépendantes S10, données privées de l'UID.
 * Code préparatoire non testé (D23). Aucun fichier téléchargé automatiquement.
 * Les flux multimédias sont ajoutés plus bas, séparés du JSON Firestore.
 */
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { doc, getFirestore, runTransaction } from "firebase/firestore";
import { fetchCloudRecords, getUserCollection } from "./cloudRepository";
import { openMediaDb } from "../storage/mediaDb";
import type {
  BackupEnvelope, BackupScope, CloudCollection, RestoreReport, Result,
  ImageMetadata, LocalMediaBlob, MediaArchiveManifest,
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

/** M72 / D26 · Restauration par ID sous transaction Firebase.
 * merge ne touche jamais à un document existant, même créé entre deux
 * lectures. replace nécessite la confirmation explicite du panneau F19 ;
 * aucun document absent de l'archive ne peut être supprimé.
 */
export async function restoreData(
  backup:BackupEnvelope,mode:"merge"|"replace",
):Promise<Result<RestoreReport>> {
  if(mode!=="merge"&&mode!=="replace")return {ok:false,error:{
    code:"INVALID_RESTORE_MODE",message:"Mode de restauration non reconnu.",
  }};
  let serialized:string;
  try{serialized=JSON.stringify(backup);}catch{return {ok:false,error:{
    code:"INVALID_BACKUP",message:"Cette archive ne peut pas être validée.",
  }};}
  const checked=await validateBackup(new File(
    [serialized],"organiseur-data.json",{type:"application/json"}));
  if(!checked.ok)return checked;
  try{
    const user=getAuth(getApp("organiseur-personnel")).currentUser;
    if(!user||checked.value.ownerUid!==user.uid)
      return {ok:false,error:{
        code:"RESTORE_ACCOUNT_MISMATCH",
        message:"Cette archive appartient à un autre compte ou la session est absente.",
      }};
    if(typeof navigator!=="undefined"&&navigator.onLine===false)
      return {ok:false,error:{
        code:"RESTORE_OFFLINE",
        message:"Reconnecte l'appareil avant de restaurer des données cloud.",
      }};
    const db=getFirestore(getApp("organiseur-personnel"));
    const report:RestoreReport={
      mode,created:0,updated:0,skipped:0,warnings:[],
    };
    for(const raw of checked.value.records){
      const entry=raw as {kind:BackupKind;id:string;data:Record<string,unknown>};
      let action:"created"|"updated"|"skipped";
      try{
        action=await runTransaction(db,async transaction=>{
          const target=doc(getUserCollection(user.uid,entry.kind),entry.id);
          const snapshot=await transaction.get(target);
          const present=snapshot.exists()
            ?snapshot.data() as Record<string,unknown>:undefined;
          if(present){
            if(mode==="merge"
              ||entry.kind==="activityCompletions"
                &&present.status==="manually_undone"
                &&entry.data.status!=="manually_undone"
              ||entry.kind==="carryOverDecisions"
                &&present.decision!==entry.data.decision)
              return "skipped" as const;
            // Éviter de réécrire une ancienne décision d'historique avec
            // une copie antérieure même sous confirmation « replace ».
            if(entry.kind==="carryOverDecisions"
              &&typeof present.updatedAt==="string"
              &&typeof entry.data.updatedAt==="string"
              &&Date.parse(present.updatedAt)>Date.parse(entry.data.updatedAt))
              return "skipped" as const;
          }
          transaction.set(target,entry.data);
          return present?"updated" as const:"created" as const;
        },{maxAttempts:3});
      }catch{return {ok:false,error:{
        code:"RESTORE_PARTIAL",
        message:"Restauration arrêtée après "+(report.created+report.updated)+
          " écriture(s). Vérifie la synchronisation avant de réessayer ; "+
          "aucun autre document n'a été supprimé.",
      }};}
      if(action==="created")report.created++;
      else if(action==="updated")report.updated++;
      else report.skipped++;
    }
    report.warnings.push(
      "Les fichiers personnels nécessitent leur archive multimédia distincte.");
    return {ok:true,value:report};
  }catch{return {ok:false,error:{
    code:"RESTORE_FAILED",
    message:"Restauration non terminée. Certaines écritures précédentes sont possibles.",
  }};}
}

/** M73 · Archive binaire indépendante O21, aucun encodage base64.
 * En-tête "OPMEDIA1\n" + 8 chiffres hex de la taille du manifeste + "\n".
 * Les tranches binaires suivent le JSON UTF-8, sans bibliothèque ZIP.
 * L'archive et sa destination sont choisies par l'utilisatrice dans F19.
 */
export async function exportMediaArchive(): Promise<Result<Blob>> {
  const opened=await openMediaDb();
  if(!opened.ok)return opened;
  try{
    const read=await new Promise<Result<{
      media:LocalMediaBlob[];images:ImageMetadata[];
    }>>(resolve=>{
      const tx=opened.value.transaction(["mediaBlobs","imageMetadata"],"readonly");
      const media=tx.objectStore("mediaBlobs").getAll();
      const images=tx.objectStore("imageMetadata").getAll();
      tx.oncomplete=()=>resolve({ok:true,value:{
        media:media.result as LocalMediaBlob[],
        images:images.result as ImageMetadata[],
      }});
      tx.onerror=()=>resolve({ok:false,error:{
        code:"MEDIA_ARCHIVE_READ_FAILED",
        message:"Le stockage des médias ne peut pas être parcouru.",
      }});
      tx.onabort=()=>resolve({ok:false,error:{
        code:"MEDIA_ARCHIVE_READ_FAILED",
        message:"La lecture de la bibliothèque a été interrompue.",
      }});
    });
    if(!read.ok)return read;
    const media=read.value.media;
    if(media.length>500)return {ok:false,error:{
      code:"MEDIA_ARCHIVE_LIMIT",
      message:"Plus de 500 médias : archive impossible sans découpage.",
    }};
    let offset=0;
    const entries:Array<{
      id:string;kind:"audio"|"image";mimeType:string;byteSize:number;
      checksum:string;importedAt:string;offset:number;length:number;
    }>=[];
    const binaries:Blob[]=[];
    const validIds=new Set<string>();
    for(const item of media){
      const max=item.kind==="audio"?80*1024*1024:20*1024*1024;
      if(!item||typeof item.id!=="string"
        ||!/^[A-Za-z0-9_.@-]{1,150}$/.test(item.id)
        ||validIds.has(item.id)
        ||(item.kind!=="audio"&&item.kind!=="image")
        ||!(item.blob instanceof Blob)
        ||item.blob.size<1||item.blob.size>max
        ||item.blob.size!==item.byteSize
        ||typeof item.mimeType!=="string"
        ||!/^[-a-z0-9/+]+$/.test(item.mimeType)
        ||item.blob.type!==item.mimeType
        ||typeof item.importedAt!=="string"
        ||!Number.isFinite(Date.parse(item.importedAt)))
        return {ok:false,error:{
          code:"INVALID_LOCAL_MEDIA",
          message:"Un fichier local est absent ou ses métadonnées sont incohérentes.",
        }};
      const digest=new Uint8Array(await crypto.subtle.digest(
        "SHA-256",await item.blob.arrayBuffer()));
      const checksum=Array.from(digest).map(n=>n.toString(16).padStart(2,"0")).join("");
      if(checksum!==item.checksum)return {ok:false,error:{
        code:"MEDIA_CHECKSUM_MISMATCH",
        message:"L'intégrité d'un fichier local ne correspond plus à son empreinte.",
      }};
      validIds.add(item.id);
      entries.push({
        id:item.id,kind:item.kind,mimeType:item.mimeType,
        byteSize:item.byteSize,checksum,importedAt:item.importedAt,
        offset,length:item.blob.size,
      });
      offset+=item.blob.size;
      if(offset>249*1024*1024)return {ok:false,error:{
        code:"MEDIA_ARCHIVE_LIMIT",message:"Bibliothèque trop volumineuse pour une archive unique.",
      }};
      binaries.push(item.blob);
    }
    const images=read.value.images.filter(image=>
      image.source==="imported"&&typeof image.mediaId==="string"
      &&validIds.has(image.mediaId)&&media.find(m=>
        m.id===image.mediaId)?.kind==="image");
    const manifest:MediaArchiveManifest={
      schemaVersion:1,createdAt:new Date().toISOString(),
      mediaEntries:entries,metadata:{images},
      checksums:entries.map(entry=>entry.checksum),
    };
    const json=new TextEncoder().encode(JSON.stringify(manifest));
    if(json.byteLength>512*1024)return {ok:false,error:{
      code:"MEDIA_MANIFEST_LIMIT",message:"Métadonnées d'archive trop volumineuses.",
    }};
    const hex=json.byteLength.toString(16).toUpperCase().padStart(8,"0");
    const archive=new Blob(["OPMEDIA1\n",hex,"\n",json,...binaries],
      {type:"application/octet-stream"});
    if(archive.size>250*1024*1024)return {ok:false,error:{
      code:"MEDIA_ARCHIVE_LIMIT",message:"L'archive dépasse 250 Mio.",
    }};
    return {ok:true,value:archive};
  }catch{return {ok:false,error:{
    code:"MEDIA_ARCHIVE_FAILED",
    message:"Impossible de produire une archive multimédia intégrale.",
  }};}finally{opened.value.close();}
}

/** M74 · Vérifier toutes les tranches et leurs SHA-256 AVANT la transaction.
 * La transaction IndexedDB ajoute seulement les identifiants absents ;
 * aucune archive ne remplace un média local différent sous le même ID.
 */
export async function importMediaArchive(file:File):Promise<Result<RestoreReport>> {
  if(!(file instanceof Blob)||file.size<18||file.size>250*1024*1024)
    return {ok:false,error:{
      code:"MEDIA_ARCHIVE_INVALID",
      message:"Archive multimédia manquante ou supérieure à 250 Mio.",
    }};
  try{
    const header=await file.slice(0,18).text();
    if(!/^OPMEDIA1\n[0-9A-F]{8}\n$/.test(header))
      throw Error("Signature d'archive invalide");
    const manifestLength=parseInt(header.slice(9,17),16);
    if(!Number.isSafeInteger(manifestLength)||manifestLength<10
      ||manifestLength>512*1024||18+manifestLength>file.size)
      throw Error("Longueur du manifeste invalide");
    const raw:unknown=JSON.parse(await file.slice(18,18+manifestLength).text());
    if(!raw||typeof raw!=="object"||Array.isArray(raw))
      throw Error("Manifeste absent");
    const manifest=raw as Record<string,unknown>;
    if(manifest.schemaVersion!==1
      ||typeof manifest.createdAt!=="string"
      ||!Number.isFinite(Date.parse(manifest.createdAt))
      ||!Array.isArray(manifest.mediaEntries)
      ||manifest.mediaEntries.length>500
      ||!Array.isArray(manifest.checksums)
      ||manifest.checksums.length!==manifest.mediaEntries.length
      ||!manifest.metadata||typeof manifest.metadata!=="object"
      ||Array.isArray(manifest.metadata))
      throw Error("Manifeste incomplet ou version inconnue");
    const meta=manifest.metadata as Record<string,unknown>;
    if(Object.keys(meta).sort().join(",")!=="images"
      ||!Array.isArray(meta.images)||meta.images.length>500)
      throw Error("Métadonnées d'image invalides");
    const validated:Array<{
      id:string;kind:"audio"|"image";mimeType:string;byteSize:number;
      checksum:string;importedAt:string;offset:number;length:number;blob:Blob;
    }>=[];
    const ids=new Set<string>();
    const mediaMime={
      audio:["audio/mpeg","audio/mp3","audio/mp4","audio/x-m4a",
        "audio/wav","audio/x-wav","audio/ogg","audio/aac"],
      image:["image/jpeg","image/png","image/webp","image/heic",
        "image/heif","image/gif"],
    };
    let offset=0;
    for(const [index,source] of manifest.mediaEntries.entries()){
      if(!source||typeof source!=="object"||Array.isArray(source))
        throw Error("Entrée de média non conforme");
      const entry=source as Record<string,unknown>;
      if(typeof entry.id!=="string"
        ||!/^[A-Za-z0-9_.@-]{1,150}$/.test(entry.id)
        ||ids.has(entry.id)
        ||(entry.kind!=="audio"&&entry.kind!=="image")
        ||typeof entry.mimeType!=="string"
        ||!mediaMime[entry.kind as "audio"|"image"].includes(entry.mimeType)
        ||typeof entry.byteSize!=="number"
        ||!Number.isSafeInteger(entry.byteSize)
        ||entry.byteSize<1
        ||entry.byteSize>(entry.kind==="audio"?80:20)*1024*1024
        ||entry.offset!==offset
        ||entry.length!==entry.byteSize
        ||typeof entry.checksum!=="string"
        ||!(/^[a-f0-9]{64}$/).test(entry.checksum)
        ||manifest.checksums[index]!==entry.checksum
        ||typeof entry.importedAt!=="string"
        ||!Number.isFinite(Date.parse(entry.importedAt)))
        throw Error("Identifiant, taille ou ordre des médias non conforme");
      const start=18+manifestLength+offset;
      const end=start+entry.byteSize;
      if(end>file.size)throw Error("Données de fichier tronquées");
      const blob=file.slice(start,end,entry.mimeType);
      const digest=new Uint8Array(await crypto.subtle.digest(
        "SHA-256",await blob.arrayBuffer()));
      const hash=Array.from(digest).map(n=>n.toString(16).padStart(2,"0")).join("");
      if(hash!==entry.checksum)throw Error("Empreinte binaire incorrecte");
      validated.push({
        id:entry.id,kind:entry.kind,mimeType:entry.mimeType,
        byteSize:entry.byteSize,checksum:entry.checksum,
        importedAt:entry.importedAt,offset,length:entry.byteSize,blob,
      });
      ids.add(entry.id);
      offset+=entry.byteSize;
    }
    if(18+manifestLength+offset!==file.size)
      throw Error("Octets superflus ou segments manquants");

    const images:ImageMetadata[]=[];
    const imageIds=new Set<string>();
    for(const entry of meta.images){
      if(!entry||typeof entry!=="object"||Array.isArray(entry))
        throw Error("Métadonnée image malformée");
      const image=entry as unknown as ImageMetadata;
      if(typeof image.id!=="string"
        ||!/^[A-Za-z0-9_.@-]{1,150}$/.test(image.id)
        ||imageIds.has(image.id)
        ||image.source!=="imported"
        ||typeof image.name!=="string"||!image.name.trim()
        ||image.name.length>250
        ||typeof image.mediaId!=="string"
        ||!validated.some(row=>row.id===image.mediaId&&row.kind==="image")
        ||!Array.isArray(image.tags)||image.tags.length>30
        ||image.tags.some(tag=>typeof tag!=="string"||tag.length>40)
        ||typeof image.updatedAt!=="string"
        ||!Number.isFinite(Date.parse(image.updatedAt)))
        throw Error("Référence d'image invalide");
      imageIds.add(image.id);
      images.push({
        id:image.id,name:image.name,source:"imported",mediaId:image.mediaId,
        tags:image.tags,updatedAt:image.updatedAt,
      });
    }

    const opened=await openMediaDb();
    if(!opened.ok)return opened;
    try{
      const report:RestoreReport={
        mode:"merge",created:0,updated:0,skipped:0,warnings:[],
      };
      const saved=await new Promise<Result<RestoreReport>>(resolve=>{
        const tx=opened.value.transaction(["mediaBlobs","imageMetadata"],"readwrite");
        const mediaStore=tx.objectStore("mediaBlobs");
        const imageStore=tx.objectStore("imageMetadata");
        let reason="Impossible de restaurer tous les médias dans IndexedDB.";
        // Toutes les vérifications de conflits se font dans le même
        // transaction write-read : aucune perte par remplacement.
        for(const item of validated){
          const req=mediaStore.get(item.id);
          req.onsuccess=()=>{
            const previous=req.result as LocalMediaBlob|undefined;
            if(previous){
              if(previous.checksum!==item.checksum){
                reason="Conflit de fichier local : les données existantes sont conservées.";
                tx.abort();
                return;
              }
              report.skipped++;
            }else{
              mediaStore.add({
                id:item.id,kind:item.kind,mimeType:item.mimeType,
                byteSize:item.byteSize,checksum:item.checksum,
                importedAt:item.importedAt,blob:item.blob,
              } satisfies LocalMediaBlob);
              report.created++;
            }
          };
        }
        for(const image of images){
          const req=imageStore.get(image.id);
          req.onsuccess=()=>{
            const previous=req.result as ImageMetadata|undefined;
            if(previous) {
              if(previous.mediaId!==image.mediaId
                ||previous.source!=="imported"){
                reason="Conflit de référence image : aucune donnée remplacée.";
                tx.abort();
                return;
              }
              report.skipped++;
            }else{
              imageStore.add(image);
              report.created++;
            }
          };
        }
        tx.oncomplete=()=>{
          report.warnings.push(
            "Les pistes et playlists cloud sont restaurées séparément via le même compte et M72.");
          resolve({ok:true,value:report});
        };
        tx.onerror=()=>resolve({ok:false,error:{
          code:"MEDIA_RESTORE_FAILED",message:reason,
        }});
        tx.onabort=()=>resolve({ok:false,error:{
          code:"MEDIA_RESTORE_FAILED",message:reason,
        }});
      });
      return saved;
    }finally{opened.value.close();}
  }catch{return {ok:false,error:{
    code:"MEDIA_ARCHIVE_INVALID",
    message:"Archive ou empreintes incorrectes : aucun média n'a été importé.",
  }};}
}
