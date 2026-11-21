/**
 * F26 · M67 (saisons), M64/M65/M95 (images personnelles locales).
 * Les opérations sensibles non testées restent réservées à la recette D23.
 */
import { openMediaDb, storeMedia, readMedia, removeMedia } from "../storage/mediaDb";
import { loadBundledCatalog, resolveCatalogAsset } from "../storage/catalog";
import { getAppState, setAppState } from "../app/state";
import { putCloudRecord } from "../services/cloudRepository";
import type {
  CropRect, DecorLayer, ImageMetadata, ProfilePreferences, Result, Season, ThemeDefinition,
} from "../domain/types";

const themes: readonly ThemeDefinition[] = [
  { id: "sage", name: "Vert sauge", season: "spring", colors: {
    accent: "#476c59", tint: "#e5eee6", highlight: "#b5d0bd", backdrop: "#f7f5f0",
  }},
  { id: "cream", name: "Crème", season: "summer", colors: {
    accent: "#765630", tint: "#f5ead5", highlight: "#e8d2a8", backdrop: "#faf5ea",
  }},
  { id: "lavender", name: "Lavande", season: "autumn", colors: {
    accent: "#644e79", tint: "#eee6f4", highlight: "#dbcae9", backdrop: "#f8f4fa",
  }},
  { id: "blue", name: "Bleu poudré", season: "winter", colors: {
    accent: "#385d7a", tint: "#e4eff7", highlight: "#bed6e8", backdrop: "#f2f7fa",
  }},
];

/** M66 · Choisir une palette fixe ou suivre les saisons. */
export async function selectTheme(themeId: string): Promise<Result<void>> {
  const {user, preferences} = getAppState();
  if (!user) return {ok: false, error: {
    code: "AUTH_REQUIRED", message: "Connecte-toi pour enregistrer ton thème.",
  }};
  const autoSeason = themeId === "seasonal";
  if (!autoSeason && !themes.some(theme => theme.id === themeId)) {
    return {ok: false, error: {
      code: "UNKNOWN_THEME", message: "Ce thème est indisponible.",
    }};
  }
  const revised: ProfilePreferences = {
    ...preferences, themeId: autoSeason ? preferences.themeId : themeId,
    autoSeason, updatedAt: new Date().toISOString(),
  };
  const saved = await putCloudRecord(user.uid, "preferences", "profile", revised);
  if (saved.ok && getAppState().user?.uid === user.uid && getAppState().preferences === preferences) {
    setAppState({preferences: revised});
  }
  return saved;
}

/** M68 · Calculer la palette active avec un repli sur la palette d'origine. */
export function getActiveTheme(date: string, preferences: ProfilePreferences): ThemeDefinition {
  let season: Season | undefined;
  if (preferences.autoSeason) {
    try {
      season = resolveSeason(date, preferences.timeZone);
    } catch {
      // Un ancien profil mal configuré conserve son thème fixe.
    }
  }
  const theme = (season ? themes.find(item => item.season === season)
    : themes.find(item => item.id === preferences.themeId)) ?? themes[0];
  return { ...theme, backgroundImageId: preferences.backgroundImageId };
}

/** M96 · Enregistrer seulement l'identifiant du fond, le fichier reste local. */
export async function setBackground(imageId: string): Promise<Result<void>> {
  const {user, preferences} = getAppState();
  if (!user) return {ok: false, error: {
    code: "AUTH_REQUIRED", message: "Connecte-toi pour enregistrer ton fond.",
  }};
  if (imageId) {
    const images = await listImages();
    if (!images.ok) return images;
    const image = images.value.find(entry => entry.id === imageId);
    if (!image) return {ok: false, error: {
      code: "IMAGE_NOT_FOUND", message: "Cette image est indisponible.",
    }};
    if (image.mediaId) {
      const binary = await readMedia(image.mediaId);
      if (!binary.ok) return binary;
    }
  }
  if (getAppState().user?.uid !== user.uid) return {ok: false, error: {
    code: "AUTH_REQUIRED", message: "La session a changé. Réessaie après connexion.",
  }};
  const current = getAppState().preferences;
  const revised = {...current, updatedAt: new Date().toISOString()};
  if (imageId) revised.backgroundImageId = imageId;
  else delete revised.backgroundImageId;
  const saved = await putCloudRecord(user.uid, "preferences", "profile", revised);
  if (saved.ok && getAppState().user?.uid === user.uid && getAppState().preferences === current) {
    setAppState({preferences: revised});
  }
  return saved;
}

/**
 * M67 — Saison météorologique de l'hémisphère Nord :
 * printemps mars–mai, été juin–août, automne septembre–novembre,
 * hiver décembre–février. Une date civile YYYY-MM-DD est locale ;
 * un instant ISO est converti dans timeZone.
 */
export function resolveSeason(date: string, timeZone: string): Season {
  // Valide aussi le fuseau quand on reçoit une simple date civile.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "numeric",
    calendar: "gregory",
    numberingSystem: "latn",
  });

  let month: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parsed = new Date(date + "T00:00:00.000Z");
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new RangeError("Date civile invalide.");
    }
    month = parsed.getUTCMonth() + 1;
  } else {
    // Interdire un texte local ambigu, qui dépendrait du fuseau du navigateur.
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(date)) {
      throw new RangeError("Instant ISO avec décalage explicite attendu.");
    }
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) throw new RangeError("Instant invalide.");
    month = Number(formatter.formatToParts(parsed).find((part) => part.type === "month")?.value);
  }
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

/** M64 · Importer une image personnelle en local, avec réduction facultative.
 * Aucune image n'est envoyée vers Firestore ni publiée dans le dépôt.
 */
export async function importImage(file: File): Promise<Result<ImageMetadata>> {
  if (!(file instanceof Blob) || !file.size || !file.name) return {ok: false, error: {
    code: "INVALID_IMAGE", message: "Fichier image manquant.",
  }};
  let image = file;
  try {
    // Préserver les animations GIF. Redimensionnement seulement si le navigateur
    // dispose d'un décodeur et d'un canevas ; en cas d'échec, garder l'original.
    if (file.type !== "image/gif" && typeof createImageBitmap === "function"
      && typeof document !== "undefined") {
      const bitmap = await createImageBitmap(file);
      try {
        const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
        if (scale < 1 || file.size > 6 * 1024 * 1024) {
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const outputType = file.type === "image/png" || file.type === "image/webp"
              ? "image/webp" : "image/jpeg";
            const result = await new Promise<Blob | null>(resolve =>
              canvas.toBlob(resolve, outputType, 0.84));
            if (result && result.size > 0 && result.size < file.size) {
              image = new File([result], file.name, {type: result.type});
            }
          }
        }
      } finally {
        bitmap.close();
      }
    }
  } catch {
    // Une HEIC ou autre image non décodable reste importable sans conversion,
    // sous réserve des limites MIME et de taille de M47.
  }
  const stored = await storeMedia(image, "image");
  if (!stored.ok) return stored;
  const entry: ImageMetadata = {
    id: crypto.randomUUID(),
    name: file.name,
    source: "imported",
    mediaId: stored.value.id,
    tags: [],
    updatedAt: new Date().toISOString(),
  };
  const open = await openMediaDb();
  if (!open.ok) return open;
  try {
    return await new Promise<Result<ImageMetadata>>(resolve => {
      const tx = open.value.transaction("imageMetadata", "readwrite");
      tx.objectStore("imageMetadata").put(entry);
      tx.oncomplete = () => resolve({ok: true, value: entry});
      tx.onerror = () => resolve({ok: false, error: {
        code: "IMAGE_METADATA_FAILED", message: "Informations d'image non enregistrées.",
      }});
      tx.onabort = () => resolve({ok: false, error: {
        code: "IMAGE_METADATA_FAILED", message: "Enregistrement de l'image interrompu.",
      }});
    });
  } catch {
    return {ok: false, error: {
      code: "IMAGE_METADATA_FAILED", message: "Stockage des informations de l'image indisponible.",
    }};
  } finally {
    open.value.close();
  }
}

/** M65 · Galerie locale et images librement distribuables du catalogue. */
export async function listImages(): Promise<Result<ImageMetadata[]>> {
  const opened = await openMediaDb();
  if (!opened.ok) return opened;
  try {
    const local = await new Promise<Result<ImageMetadata[]>>(resolve => {
      const tx = opened.value.transaction("imageMetadata", "readonly");
      const req = tx.objectStore("imageMetadata").getAll();
      req.onsuccess = () => resolve({ok: true, value: req.result as ImageMetadata[]});
      req.onerror = () => resolve({ok: false, error: {
        code: "IMAGES_UNAVAILABLE", message: "Galerie locale indisponible.",
      }});
      tx.onabort = () => resolve({ok: false, error: {
        code: "IMAGES_UNAVAILABLE", message: "Consultation des images interrompue.",
      }});
    });
    if (!local.ok) return local;
    const merged = new Map<string, ImageMetadata>();
    const bundled = await loadBundledCatalog();
    if (bundled.ok) for (const entry of bundled.value) {
      if (entry.kind !== "image") continue;
      merged.set(entry.id, {
        id: entry.id, name: entry.title, source: "bundled",
        catalogId: entry.id, tags: [], updatedAt: "1970-01-01T00:00:00.000Z",
      });
    }
    for (const item of local.value) merged.set(item.id, item);
    return {ok: true, value: [...merged.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "fr") || a.id.localeCompare(b.id))};
  } catch {
    return {ok: false, error: {
      code: "IMAGES_UNAVAILABLE", message: "Consultation de la galerie indisponible.",
    }};
  } finally {
    opened.value.close();
  }
}

/** M69 · Effacer uniquement une image personnelle dont le fichier est vérifié. */
export async function removeImportedImage(imageId: string): Promise<Result<void>> {
  const images = await listImages();
  if (!images.ok) return images;
  const image = images.value.find(entry => entry.id === imageId);
  if (image?.source !== "imported" || !image.mediaId) return {ok: false, error: {
    code: "IMAGE_READ_ONLY", message: "Cette image ne peut pas être supprimée de la galerie.",
  }};
  return removeMedia(image.mediaId);
}

/** M95 · Renommer/classer une image personnelle sans réécrire le binaire. */
export async function updateImageMetadata(image: ImageMetadata): Promise<Result<void>> {
  if (!image || !image.id || image.id.includes("/") || image.source !== "imported"
    || !image.name?.trim() || image.name.length > 250
    || !Array.isArray(image.tags) || image.tags.length > 30
    || image.tags.some(tag => typeof tag !== "string" || !tag.trim() || tag.length > 40)) {
    return {ok: false, error: {
      code: "INVALID_IMAGE", message: "Informations d'image invalides.",
    }};
  }
  const opened = await openMediaDb();
  if (!opened.ok) return opened;
  try {
    const old = await new Promise<Result<ImageMetadata>>(resolve => {
      const tx = opened.value.transaction("imageMetadata", "readonly");
      const req = tx.objectStore("imageMetadata").get(image.id);
      req.onsuccess = () => req.result
        ? resolve({ok: true, value: req.result as ImageMetadata})
        : resolve({ok: false, error: {
          code: "IMAGE_NOT_FOUND", message: "Image personnelle introuvable.",
        }});
      req.onerror = () => resolve({ok: false, error: {
        code: "IMAGE_READ_FAILED", message: "Métadonnées locales indisponibles.",
      }});
    });
    if (!old.ok) return old;
    if (old.value.source !== "imported" || !old.value.mediaId) return {
      ok: false, error: {
        code: "IMAGE_READ_ONLY", message: "Une image du catalogue ne peut pas être modifiée.",
      },
    };
    const revised: ImageMetadata = {
      ...old.value, name: image.name.trim(),
      tags: image.tags.map(tag => tag.trim()),
      updatedAt: new Date().toISOString(),
    };
    return await new Promise<Result<void>>(resolve => {
      const tx = opened.value.transaction("imageMetadata", "readwrite");
      tx.objectStore("imageMetadata").put(revised);
      tx.oncomplete = () => resolve({ok: true, value: undefined});
      tx.onerror = () => resolve({ok: false, error: {
        code: "IMAGE_WRITE_FAILED", message: "Modification d'image indisponible.",
      }});
      tx.onabort = () => resolve({ok: false, error: {
        code: "IMAGE_WRITE_FAILED", message: "Modification d'image interrompue.",
      }});
    });
  } catch {
    return {ok: false, error: {
      code: "IMAGE_WRITE_FAILED", message: "Modification des informations impossible.",
    }};
  } finally {
    opened.value.close();
  }
}



/** M97 / D26 · Recadrage local en pixels source, export PNG uniquement.
 * Les originaux ne sont jamais modifiés ; sans permission iOS supplémentaire.
 */
export async function cropImage(
  blob:Blob,rect:CropRect,
):Promise<Result<Blob>> {
  if(!(blob instanceof Blob)||blob.size<1||blob.size>20*1024*1024
    ||!blob.type.startsWith("image/")
    ||!rect||![rect.x,rect.y,rect.width,rect.height].every(
      value=>Number.isSafeInteger(value))
    ||rect.x<0||rect.y<0||rect.width<1||rect.height<1
    ||typeof createImageBitmap!=="function"
    ||typeof document==="undefined")
    return {ok:false,error:{
      code:"INVALID_CROP",
      message:"Le fichier ou le rectangle de recadrage est invalide.",
    }};
  try{
    const bitmap=await createImageBitmap(blob);
    try{
      if(bitmap.width<1||bitmap.height<1
        ||bitmap.width>8192||bitmap.height>8192
        ||rect.x+rect.width>bitmap.width
        ||rect.y+rect.height>bitmap.height)
        return {ok:false,error:{
          code:"CROP_OUT_OF_BOUNDS",
          message:"Le recadrage dépasse les dimensions de l'image.",
        }};
      const canvas=document.createElement("canvas");
      canvas.width=rect.width;
      canvas.height=rect.height;
      const ctx=canvas.getContext("2d");
      if(!ctx)return {ok:false,error:{
        code:"CANVAS_UNAVAILABLE",message:"Canevas de recadrage indisponible.",
      }};
      ctx.drawImage(bitmap,rect.x,rect.y,rect.width,rect.height,
        0,0,rect.width,rect.height);
      const result=await new Promise<Blob|null>(resolve=>
        canvas.toBlob(resolve,"image/png"));
      return result&&result.size>0
        ?{ok:true,value:result}
        :{ok:false,error:{code:"IMAGE_ENCODE_FAILED",
          message:"Impossible d'encoder l'image recadrée."}};
    }finally{bitmap.close();}
  }catch{return {ok:false,error:{
    code:"CROP_FAILED",message:"Impossible de décoder ou recadrer ce fichier sur cet appareil.",
  }};}
}

/** M98 / D26 · Composition privée portrait 1080×1920 en couches O11/O13.
 * Ni URL fournie par l'appelant ni texte HTML ne sont interprétés.
 */
export async function composeDecorImage(
  layers:DecorLayer[],
):Promise<Result<Blob>> {
  if(!Array.isArray(layers)||layers.length<1||layers.length>12
    ||typeof document==="undefined"
    ||typeof createImageBitmap!=="function")
    return {ok:false,error:{
      code:"INVALID_DECOR_LAYERS",
      message:"Une composition nécessite entre une et douze couches.",
    }};
  const width=1080,height=1920;
  for(const layer of layers){
    if(!layer||(layer.kind!=="image"&&layer.kind!=="text")
      ||![layer.x,layer.y,layer.width,layer.height].every(
        value=>Number.isSafeInteger(value))
      ||layer.x<0||layer.y<0||layer.width<1||layer.height<1
      ||layer.x+layer.width>width||layer.y+layer.height>height
      ||!Number.isFinite(layer.opacity)||layer.opacity<0||layer.opacity>1
      ||(layer.kind==="image"&&(
        typeof layer.imageId!=="string"
        ||!/^[A-Za-z0-9_.@-]{1,150}$/.test(layer.imageId)))
      ||(layer.kind==="text"&&(
        typeof layer.text!=="string"||!layer.text.trim()
        ||layer.text.length>160
        ||!Number.isSafeInteger(layer.fontSize)
        ||layer.fontSize<8||layer.fontSize>160
        ||!/^#[a-fA-F0-9]{6}$/.test(layer.color))))
      return {ok:false,error:{
        code:"INVALID_DECOR_LAYER",
        message:"Une couche contient des coordonnées ou un contenu non autorisé.",
      }};
  }
  try{
    const canvas=document.createElement("canvas");
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext("2d");
    if(!ctx)return {ok:false,error:{
      code:"CANVAS_UNAVAILABLE",message:"Canevas de décoration indisponible.",
    }};
    const images=await listImages();
    if(!images.ok)return images;
    const byId=new Map(images.value.map(image=>[image.id,image]));
    for(const layer of layers){
      ctx.save();
      try{
        ctx.globalAlpha=layer.opacity;
        if(layer.kind==="text"){
          ctx.beginPath();
          ctx.rect(layer.x,layer.y,layer.width,layer.height);
          ctx.clip();
          ctx.font=layer.fontSize+"px system-ui, sans-serif";
          ctx.textAlign="left";
          ctx.textBaseline="top";
          ctx.fillStyle=layer.color;
          ctx.fillText(layer.text,layer.x,layer.y,layer.width);
        }else{
          const selected=byId.get(layer.imageId);
          if(!selected)return {ok:false,error:{
            code:"DECOR_IMAGE_NOT_FOUND",
            message:"Une image de la composition n'existe plus.",
          }};
          let binary:Blob;
          if(selected.source==="imported"&&selected.mediaId){
            const local=await readMedia(selected.mediaId);
            if(!local.ok)return local;
            binary=local.value;
          }else if(selected.source==="bundled"&&selected.catalogId){
            const asset=resolveCatalogAsset(selected.catalogId);
            if(!asset.ok)return asset;
            const url=new URL(asset.value);
            if(url.origin!==location.origin)throw Error("Origine d'image non autorisée");
            const fetched=await fetch(url.toString(),{
              credentials:"same-origin",redirect:"error",
            });
            if(!fetched.ok)throw Error("Image du catalogue indisponible");
            binary=await fetched.blob();
          }else{return {ok:false,error:{
            code:"DECOR_IMAGE_INVALID",
            message:"Image de composition non référencée localement.",
          }};}
          if(binary.size<1||binary.size>20*1024*1024
            ||!binary.type.startsWith("image/"))
            throw Error("Image de composition invalide");
          const bitmap=await createImageBitmap(binary);
          try{
            if(bitmap.width<1||bitmap.height<1
              ||bitmap.width>8192||bitmap.height>8192)
              throw Error("Image de composition trop grande");
            ctx.drawImage(bitmap,layer.x,layer.y,layer.width,layer.height);
          }finally{bitmap.close();}
        }
      }finally{ctx.restore();}
    }
    const output=await new Promise<Blob|null>(resolve=>
      canvas.toBlob(resolve,"image/png"));
    if(!output||output.size<1)return {ok:false,error:{
      code:"DECOR_EXPORT_FAILED",message:"Impossible d'encoder le décor.",
    }};
    return {ok:true,value:output};
  }catch{return {ok:false,error:{
    code:"DECOR_COMPOSE_FAILED",
    message:"Composition impossible sur cet iPhone ou image inaccessible.",
  }};}
}
