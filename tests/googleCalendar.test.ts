/** F47 · Worker Google, avec Firebase et Google simulés. Aucun secret réel. */
import worker from "../workers/reminders/src/index";

void (async () => {
  const appOrigin = "https://pecose.github.io";
  const project = "demo-organiseur-personnel";
  const uid = "test-owner";
  const path = "/v1/projects/" + project + "/databases/(default)/documents/";
  const statusPath = "users/" + uid + "/googleCalendarConnection/status";
  const lockPath = "users/" + uid + "/googleCalendarSync/lock";
  const activitiesPath = "users/" + uid + "/activities";
  const grantPath = "users/" + uid + "/googleOAuthGrant/primary";
  const cursorPath = "users/" + uid + "/googleCalendarSync/state";
  const encoder = new TextEncoder();
  const asBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  const asUrl = (bytes: Uint8Array) => asBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const key = await crypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256",
  }, true, ["sign", "verify"]);
  const jwk = {...await crypto.subtle.exportKey("jwk", key.publicKey), kid: "test-key"};
  const aes = new Uint8Array(32);
  const iv = new Uint8Array(12);
  const encryptionKey = await crypto.subtle.importKey("raw", aes, "AES-GCM", false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    {name: "AES-GCM", iv, additionalData: encoder.encode(uid)}, encryptionKey,
    encoder.encode(JSON.stringify({access_token: "fake", refresh_token: "fake"})),
  ));
  const seal = new Uint8Array(iv.length + encrypted.length);
  seal.set(iv);
  seal.set(encrypted, iv.length);
  const instant = Math.floor(Date.now() / 1000);
  const claims = asUrl(encoder.encode(JSON.stringify({
    iss: "https://securetoken.google.com/" + project, aud: project,
    sub: uid, iat: instant, auth_time: instant, exp: instant + 600,
  })));
  const unsigned = asUrl(encoder.encode(JSON.stringify({alg: "RS256", kid: "test-key"}))) + "." + claims;
  const signed = unsigned + "." + asUrl(new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key.privateKey, encoder.encode(unsigned),
  )));
  const env = {
    FIREBASE_PROJECT_ID: project, FIREBASE_SERVICE_ACCOUNT_EMAIL: "local@example.invalid",
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: asBase64(new Uint8Array(
      await crypto.subtle.exportKey("pkcs8", key.privateKey))),
    GOOGLE_CLIENT_ID: "fake", GOOGLE_CLIENT_SECRET: "fake", GOOGLE_GRANT_AES_KEY: asUrl(aes),
    GOOGLE_REDIRECT_URI: "https://worker.example.invalid/oauth/google/callback",
    VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", VAPID_CONTACT: "", APP_ORIGIN: appOrigin,
  };

  type FirestoreDoc = {name: string; updateTime: string; fields: Record<string, unknown>};
  const records = new Map<string, FirestoreDoc>();
  let revision = 0;
  const put = (target: string, fields: Record<string, unknown>) => {
    records.set(target, {
      name: "projects/" + project + "/databases/(default)/documents/" + target,
      updateTime: new Date(1730000000000 + revision++).toISOString(), fields,
    });
  };
  const str = (stringValue: string) => ({stringValue});
  put(statusPath, {uid: str(uid), status: str("active"), calendarId: str("primary")});
  put(grantPath, {uid: str(uid), keyVersion: str("v1"), ciphertext: str(asUrl(seal))});
  const request = (token: string, origin = appOrigin) => new Request(
    "https://worker.example.invalid/api/google/sync", {
      method: "POST", headers: {Origin: origin, Authorization: "Bearer " + token},
      body: JSON.stringify({reason: "manual"}),
    },
  );
  let pulled = 0;
  let expired = false;
  let markPull!: () => void;
  let finishPull!: () => void;
  const pulling = new Promise<void>(resolve => { markPull = resolve; });
  const pendingPull = new Promise<void>(resolve => { finishPull = resolve; });
  const remoteFixture = {
    id: "weekly", summary: "Cours", etag: "remote-v1", status: "confirmed",
    updated: "2026-11-19T12:00:00Z",
    start: {dateTime: "2026-11-25T19:00:00+01:00", timeZone: "Europe/Paris"},
    end: {dateTime: "2026-11-25T20:00:00+01:00", timeZone: "Europe/Paris"},
    recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=WE"],
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.pathname.includes("service_accounts")) return Response.json({keys: [jwk]});
    if (url.hostname === "oauth2.googleapis.com") {
      return Response.json({access_token: "fake-authorized-access", expires_in: 3600});
    }
    if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/events")) {
      pulled++;
      if (pulled === 1) { markPull(); await pendingPull; }
      if (url.searchParams.has("syncToken") && !expired) {
        expired = true;
        return new Response(null, {status: 410});
      }
      return Response.json({items: [remoteFixture], nextSyncToken: "next-" + pulled});
    }
    if (url.hostname !== "firestore.googleapis.com" || !url.pathname.startsWith(path)) {
      throw new Error("Destination inattendue pendant F47.");
    }
    const target = url.pathname.slice(path.length);
    const previous = records.get(target);
    if (options?.method === "PATCH") {
      if ((url.searchParams.get("currentDocument.exists") === "false" && previous)
        || (url.searchParams.has("currentDocument.updateTime")
          && url.searchParams.get("currentDocument.updateTime") !== previous?.updateTime)) {
        return new Response(null, {status: 412});
      }
      put(target, (JSON.parse(String(options.body)) as {fields: Record<string,unknown>}).fields);
      return Response.json(records.get(target));
    }
    if (url.searchParams.has("pageSize")) {
      return Response.json({documents: [...records].filter(([key]) =>
        key.startsWith(target + "/")).map(([, document]) => document)});
    }
    return previous ? Response.json(previous) : new Response(null, {status: 404});
  };
  try {
    if ((await worker.fetch(request(signed, "https://elsewhere.example"), env)).status !== 403
      || (await worker.fetch(request(unsigned + ".invalid", appOrigin), env)).status !== 401) {
      throw Error("F47 : origine ou identité invalide acceptée.");
    }
    const first = worker.fetch(request(signed), env);
    await Promise.race([pulling, first.then(() => { throw Error("F47 : premier passage refusé."); })]);
    try {
      const competing = await worker.fetch(request(signed), env);
      const body = await competing.json();
      if (competing.status !== 409 || body.error?.code !== "GOOGLE_SYNC_BUSY" || pulled !== 1) {
        throw Error("F47 : deux passages Google ont pu se chevaucher.");
      }
    } finally {
      finishPull();
    }
    if (!(await first).ok || !records.has(cursorPath) || !records.has(lockPath)) {
      throw Error("F47 : passage initial ou curseur non confirmé.");
    }
    const retry = await worker.fetch(request(signed), env);
    const activities = [...records].filter(([key]) => key.startsWith(activitiesPath + "/"));
    if (!retry.ok || !expired || activities.length !== 1 || !activities[0][1].fields.recurrence) {
      throw Error("F47 : reprise du curseur ou récurrence mal conservée.");
    }
    let cronBlocked = false;
    try { await worker.scheduled({}, {...env, ENABLE_CRON: "true"}); }
    catch (error) { cronBlocked = (error as Error).message === "CRON_NOT_VALIDATED"; }
    if (!cronBlocked) throw Error("F47 : Cron actif sans recette.");
    console.log("F47 : origine, identité, verrou, reprise du curseur, récurrence et Cron vérifiés.");
  } finally {
    globalThis.fetch = originalFetch;
  }
})();
