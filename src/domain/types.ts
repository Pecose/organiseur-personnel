import type { FirebaseApp, FirebaseOptions } from "firebase/app";
import type { Auth } from "firebase/auth";
import type { Firestore, CollectionReference, DocumentData } from "firebase/firestore";

/**
 * F17 · Types contractuels.
 * S0 uniquement : objets autonomes O01/O05/O07/O10/O13/O15/O16/
 * O17/O18/O20/O22/O24/O29/O34/O37 et types techniques déjà inscrits.
 * Aucun accès au réseau, au système de fichiers ou à Firebase.
 */

export type LocalDate = string; // YYYY-MM-DD, fuseau civil explicite dans le contrat appelant.
export type ISOInstant = string; // ISO 8601 en UTC, ex. 2026-11-02T08:00:00.000Z.
export type Season = "spring" | "summer" | "autumn" | "winter";
/** F17 / M46 : adaptateur natif IndexedDB, sans bibliothèque ni nouveau store. */
export type MediaDb = IDBDatabase;

export interface AppError {
  code: string;
  message: string;
}
export type Result<T, E = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface DateRange {
  /** Borne inclusive, ISO 8601 UTC. */
  from: ISOInstant;
  /** Borne exclusive, ISO 8601 UTC. */
  to: ISOInstant;
}
export interface Occurrence {
  /** Clé stable : l'instant UTC d'origine de cette occurrence. */
  key: string;
  startsAt: ISOInstant;
}

/** O01 */
export interface AuthUser {
  uid: string;
  email: string | null;
}

/** O05 — règles ; l'expansion à heure locale est de la responsabilité de M130/S2. */
export interface RecurrenceRule {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  /** Intervalle strictement positif (1 = chaque période). */
  interval: number;
  /** Fin incluse de la série, date civile ou instant ISO. */
  until?: string;
  /** Nombre maximal d'occurrences dans la série depuis son origine. */
  count?: number;
  /** Jours ISO : lundi=1, ..., dimanche=7. Significatif en fréquence weekly. */
  weekdays?: readonly (1 | 2 | 3 | 4 | 5 | 6 | 7)[];
}

/** O07 */
export interface ProfilePreferences {
  themeId: string;
  backgroundImageId?: string;
  autoSeason: boolean;
  locale: string;
  timeZone: string;
  notificationEnabled: boolean;
  updatedAt: ISOInstant;
}

/** O10 — local IndexedDB uniquement, ne pas écrire le Blob dans Firestore. */
export interface LocalMediaBlob {
  id: string;
  kind: "audio" | "image";
  blob: Blob;
  mimeType: string;
  byteSize: number;
  checksum: string;
  importedAt: ISOInstant;
}

/** O13 — catalogue statique versionné et publiquement redistribuable. */
export interface CatalogEntry {
  id: string;
  revision: string;
  kind: "audio" | "image";
  url: string;
  title: string;
  checksum: string;
  redistributionAllowed: boolean;
}

/** O15 */
export interface SyncStatus {
  state: "local" | "pending" | "synced" | "error";
  pendingCount: number;
  lastServerAckAt?: ISOInstant;
  message?: string;
}

/** O16 — le contenu est inconnu avant validation (M71, S10). */
export interface BackupEnvelope {
  schemaVersion: number;
  exportedAt: ISOInstant;
  dataType: string;
  ownerUid?: string;
  records: unknown[];
  checksums?: readonly string[];
}

/** O17 */
export interface AppVersion {
  version: string;
  cacheRevision: string;
  catalogRevision: string;
  releasedAt: ISOInstant;
}

/** O18 */
export interface PlaybackState {
  trackId?: string;
  queueIds: string[];
  position: number;
  paused: boolean;
  repeatMode: "normal" | "repeat"; // shuffle est suivi par le champ booléen séparé.
  shuffle: boolean;
}

/** O20 — les cinq premiers noms sont les onglets principaux, dans l'ordre D14. */
export interface UiRoute {
  name:
    | "calendar"
    | "tasks"
    | "day"
    | "habits"
    | "lists"
    | "music"
    | "decor"
    | "settings"
    | "signin"
    | "monthlyReview";
  params?: Readonly<Record<string, string>>;
}

/** O22 */
export interface NotificationTestResult {
  supported: boolean;
  permitted: boolean;
  subscribed: boolean;
  sent?: boolean;
  message?: string;
}

/** O24 — liaison serveur/app entre O31 et Google, sans secret OAuth. */
export interface GoogleEventLink {
  calendarId: string;
  googleEventId: string;
  etag?: string;
  remoteUpdatedAt?: ISOInstant;
  pending: "none" | "upsert" | "delete";
  source: "app" | "google";
}

/** O29 — données Google externes non validées (traitement prévu en S9). */
export interface GoogleCalendarChange {
  calendarId: string;
  eventId: string;
  etag?: string;
  status: "confirmed" | "cancelled";
  updatedAt: ISOInstant;
  start?: unknown;
  end?: unknown;
  recurrence?: unknown;
  payload: unknown;
}

/** O34 — la liste est autonome ; ses articles O35 sont construits en S1. */
export interface Checklist {
  id: string;
  name: string;
  iconId?: string;
  archived?: boolean;
  updatedAt: ISOInstant;
}

/** O37 — état mémoire de navigation, pas un document Firestore. */
export interface DaySelection {
  selectedDate: LocalDate;
  today: LocalDate;
  source: "startup" | "calendar" | "navigation";
}

/** S1 · Objets composés uniquement d'éléments S0 (O08/O11/O12/O14/O21/O25/O27/O28/O31/O35). */

/** O08 : seuls les champs descriptifs et les références sont synchronisables. */
export interface TrackMetadata {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  source: "bundled" | "imported";
  catalogId?: string;
  mediaId?: string;
  artworkId?: string;
  duration?: number;
  favorite: boolean;
  updatedAt: ISOInstant;
}

/** O11 : les blobs d'images personnelles restent dans IndexedDB (O10). */
export interface ImageMetadata {
  id: string;
  name: string;
  source: "bundled" | "imported";
  catalogId?: string;
  mediaId?: string;
  tags: string[];
  updatedAt: ISOInstant;
}

/** O12 : définition déclarative des couleurs, sans dépendance UI. */
export interface ThemeDefinition {
  id: string;
  name: string;
  season?: Season;
  colors: Readonly<Record<string, string>>;
  backgroundImageId?: string;
}

/** O14 : données d'abonnement sensibles, stockage cloud protégé. */
export interface PushSubscriptionRecord {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel?: string;
  expiresAt?: ISOInstant;
  updatedAt: ISOInstant;
}

/** O21 : manifeste d'export, pas une copie des fichiers médias. */
export interface MediaArchiveManifest {
  schemaVersion: number;
  createdAt: ISOInstant;
  mediaEntries: unknown[];
  metadata: unknown;
  checksums: string[];
}

/** O25 : token de synchronisation Google, serveur uniquement. */
export interface GoogleSyncCursor {
  uid: string;
  calendarId: string;
  nextSyncToken?: string;
  lastFullSyncAt?: ISOInstant;
  lastIncrementalSyncAt?: ISOInstant;
}

/** O27 : grant chiffré, jamais envoyé à la PWA ni committé dans GitHub. */
export interface EncryptedGoogleOAuthGrant {
  uid: string;
  calendarId: string;
  ciphertext: string;
  keyVersion: string;
  scopes: string[];
  issuedAt: ISOInstant;
  revokedAt?: ISOInstant;
}

/** O28 : état OAuth à usage unique et durée limitée, serveur uniquement. */
export interface GoogleOAuthState {
  stateId: string;
  uid: string;
  nonce: string;
  redirectPath: string;
  expiresAt: ISOInstant;
  consumedAt?: ISOInstant;
}

/** O31 : une seule identité métier pour tâche, événement et habitude. */
export interface Activity {
  id: string;
  uid: string;
  title: string;
  description?: string;
  iconId?: string;
  imageId?: string;
  stars?: 1 | 2 | 3;
  plannedOn?: LocalDate;
  startAt?: ISOInstant;
  endAt?: ISOInstant;
  timeZone: string;
  recurrence?: RecurrenceRule;
  autoComplete: boolean;
  checklistId?: string;
  deletedAt?: ISOInstant;
  updatedAt: ISOInstant;
  googleLink?: GoogleEventLink;
}

/** O35 : une coche dans la liste ne coche pas automatiquement l'activité. */
export interface ChecklistItem {
  id: string;
  checklistId: string;
  text: string;
  checked: boolean;
  position: number;
  updatedAt: ISOInstant;
}

/** S2 : contrats dérivés des objets S0/S1. */
export interface Playlist { id: string; name: string; trackIds: string[]; updatedAt: ISOInstant; }
export interface GoogleCalendarConnection {
 uid: string; calendarId: "primary"; googleAccountLabel?: string;
 status: "disconnected" | "authorizing" | "active" | "reauthorization_required" | "error";
 lastSyncAt?: ISOInstant; lastError?: string;
}
export interface CalendarSyncConflict {
 id: string; uid: string; localEventId: string; googleEventId?: string;
 kind: "update" | "delete" | "recurrence" | "mapping";
 localVersion: string; googleVersion: string; detectedAt: ISOInstant;
 status: "open" | "resolved";
}
export interface ActivityOccurrence {
 activityId: string; occurrenceKey: string; localDate: LocalDate;
 startsAt?: ISOInstant; endsAt?: ISOInstant; recurring: boolean;
}
export interface CarryOverDecision {
 id: string; activityId: string; fromDate: LocalDate; toDate: LocalDate;
 decision: "move" | "keep" | "later";
 promptedAt: ISOInstant; decidedAt?: ISOInstant; updatedAt: ISOInstant;
}
/** Types de présentation F17, non persistés. */
export interface ActivityOccurrenceView { activity: Activity; occurrence: ActivityOccurrence; completion?: ActivityCompletion; }
export interface DayGroups { withoutTime: ActivityOccurrenceView[]; withTime: ActivityOccurrenceView[]; }

/** S3 · États dépendant des objets O31/O32, sans effet de bord. */

/** O06 · Rappel pour une occurrence précise. L'envoi Web Push reste en S9B. */
export interface Reminder {
  id: string;
  activityId: string;
  occurrenceKey: string;
  scheduledFor: ISOInstant;
  leadMinutes: number;
  timeZone: string;
  enabled: boolean;
  dispatchStatus: string;
}

/** O30 · Bilan technique minimisé d'une synchronisation Google, sans jetons. */
export interface CalendarSyncRun {
  uid: string;
  calendarId: string;
  startedAt: ISOInstant;
  finishedAt?: ISOInstant;
  pulled: number;
  pushed: number;
  conflicts: number;
  status: "ok" | "partial" | "error";
  details?: string;
}

/** O33 · La coche est propre à une occurrence. Un refus manuel persiste. */
export interface ActivityCompletion {
  id: string;
  activityId: string;
  occurrenceKey: string;
  status: "pending" | "manual_done" | "auto_assumed" | "manually_undone";
  completedAt?: ISOInstant;
  overriddenAt?: ISOInstant;
  updatedAt: ISOInstant;
}

/** S4 · Objets terminaux, dérivés des contrats S0–S3. */

/**
 * O19 · Reçu d'une tentative de rappel. L'anti-doublon effectif et l'envoi
 * seront gérés côté Worker (S9B). Aucun jeton, adresse ni secret ici.
 */
export interface DispatchReceipt {
  reminderId: string;
  occurrenceKey: string;
  attemptedAt: ISOInstant;
  outcome: string;
  retryAfter?: ISOInstant;
}

/**
 * Type technique F17, déjà nommé dans l'architecture.
 * Réutilise exclusivement les champs approuvés O31/O32/O33 :
 * une réalisation par occurrence, confirmée manuellement ou présumée.
 * Aucune duplication de l'activité en base de données.
 */
export type MonthlyAchievement = ActivityOccurrenceView & {
  completion: ActivityCompletion & { status: "manual_done" | "auto_assumed" };
};

/**
 * O38 · Projection calculée du bilan mensuel, jamais une collection Firestore.
 * Le calcul M147 sera branché sur la persistance O31/O32/O33 en S8.
 * Tri prévu : étoiles 3→2→1 (sans étoile en dernier), puis date croissante ;
 * les auto_assumed restent reconnaissables et distincts des manual_done.
 */
export interface MonthlyReview {
  month: string; // YYYY-MM
  starFilter?: 1 | 2 | 3;
  entries: MonthlyAchievement[];
  assumedCount: number;
}

/**
 * F17 / S5 : types techniques prévus §4.2, pas de nouveau modèle métier.
 * La clé API d'une application Firebase Web est publique, les secrets de
 * service / les jetons privés doivent rester hors de la PWA.
 */
export type PublicFirebaseConfig = FirebaseOptions;
export interface FirebaseClients {
  app: FirebaseApp;
  auth: Auth;
  /** Créée seulement après M25 et le consentement au cache persistant. */
  db?: Firestore;
}
export type CollectionRef = CollectionReference<DocumentData, DocumentData>;
export type CloudCollection =
  | "activities" | "activityCompletions" | "checklists" | "checklistItems"
  | "carryOverDecisions" | "reminders" | "playlists" | "tracks"
  | "preferences" | "pushSubscriptions" | "dispatchReceipts";
export interface SnapshotMeta {
  fromCache: boolean;
  hasPendingWrites: boolean;
}
export interface Connectivity {
  online: boolean;
}
export type Unsubscribe = () => void;


/** Types techniques F17 / S6 explicitement prévus dans le registre §4.9. */
export type ActivityDraft = Omit<Activity,
  "id" | "uid" | "updatedAt" | "deletedAt" | "googleLink" | "autoComplete"> & {
  id?: string;
  autoComplete?: boolean;
};
export type ActivitySchedule = Pick<Activity,
  "plannedOn" | "startAt" | "endAt" | "timeZone"> & {
  autoComplete?: boolean;
};
export type ChecklistDraft = Pick<Checklist, "name" | "iconId"> & {
  id?: string;
  archived?: boolean;
};
export type ChecklistItemDraft = Pick<ChecklistItem,
  "checklistId" | "text" | "checked" | "position"> & {
  id?: string;
};
