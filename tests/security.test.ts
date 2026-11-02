/**
 * F42 / T05 · Tests de règles Firestore, exclusivement contre émulateurs locaux.
 *
 * Prérequis (hors application) : Auth emulator sur 127.0.0.1:9099,
 * Firestore emulator sur 127.0.0.1:8080, avec firestore.rules chargées.
 * Opt-in : FIREBASE_EMULATOR_TEST=1. Jamais contre Firebase réel.
 * Un test ignoré n'est PAS une preuve de sécurité.
 */
import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator, createUserWithEmailAndPassword, getAuth,
} from "firebase/auth";
import {
  connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc,
} from "firebase/firestore";

const env = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;

if (env?.FIREBASE_EMULATOR_TEST !== "1") {
  console.log("T05 SKIPPED : exécuter avec FIREBASE_EMULATOR_TEST=1 et deux émulateurs actifs.");
} else {
  void (async () => {
    const config = {
      apiKey: "demo-local-only",
      authDomain: "localhost",
      projectId: "demo-organiseur-personnel",
      appId: "1:123456789:web:demo",
    };
    const appA = initializeApp(config, "security-test-owner");
    const appB = initializeApp(config, "security-test-intruder");
    const authA = getAuth(appA);
    const authB = getAuth(appB);
    connectAuthEmulator(authA, "http://127.0.0.1:9099", { disableWarnings: true });
    connectAuthEmulator(authB, "http://127.0.0.1:9099", { disableWarnings: true });
    const dbA = getFirestore(appA);
    const dbB = getFirestore(appB);
    connectFirestoreEmulator(dbA, "127.0.0.1", 8080);
    connectFirestoreEmulator(dbB, "127.0.0.1", 8080);

    const owner = await createUserWithEmailAndPassword(
      authA, "owner-" + Date.now() + "@example.invalid", "demo-password-1234",
    );
    const intruder = await createUserWithEmailAndPassword(
      authB, "intruder-" + Date.now() + "@example.invalid", "demo-password-1234",
    );
    if (owner.user.uid === intruder.user.uid) throw new Error("T05 : UID identiques.");
    const ownerPath = doc(dbA, "users", owner.user.uid, "activities", "security-fixture");
    const otherPath = doc(dbB, "users", owner.user.uid, "activities", "security-fixture");

    await setDoc(ownerPath, {
      id: "security-fixture", uid: owner.user.uid, title: "Essai émulateur",
      timeZone: "Europe/Paris", autoComplete: false,
      updatedAt: "2026-11-03T00:00:00.000Z",
    });
    if (!(await getDoc(ownerPath)).exists()) throw new Error("T05 : lecture du propriétaire refusée.");

    let deniedRead = false;
    try {
      await getDoc(otherPath);
    } catch (error: unknown) {
      deniedRead = (error as { code?: string })?.code === "permission-denied";
    }
    if (!deniedRead) throw new Error("T05 : autre UID peut lire les activités !");

    let deniedWrite = false;
    try {
      await setDoc(otherPath, {
        id: "security-fixture", uid: owner.user.uid, title: "Usurpation",
        timeZone: "Europe/Paris", autoComplete: false,
        updatedAt: "2026-11-03T00:00:00.000Z",
      });
    } catch (error: unknown) {
      deniedWrite = (error as { code?: string })?.code === "permission-denied";
    }
    if (!deniedWrite) throw new Error("T05 : autre UID peut modifier les activités !");

    let deniedSecrets = false;
    try {
      await getDoc(doc(dbA, "users", owner.user.uid, "googleOAuthGrant", "primary"));
    } catch (error: unknown) {
      deniedSecrets = (error as { code?: string })?.code === "permission-denied";
    }
    if (!deniedSecrets) throw new Error("T05 : jetons Google accessibles au client !");

    let deniedReceipts = false;
    try {
      await setDoc(doc(dbA, "users", owner.user.uid, "dispatchReceipts", "attempt"), {
        reminderId: "test", occurrenceKey: "test", attemptedAt: "2026-11-03T00:00:00.000Z",
        outcome: "ok",
      });
    } catch (error: unknown) {
      deniedReceipts = (error as { code?: string })?.code === "permission-denied";
    }
    if (!deniedReceipts) throw new Error("T05 : écriture serveur autorisée au client !");

    console.log("T05 PASS (EMULATOR) : deux UID isolés, jetons et reçus interdits.");
  })().catch(error => {
    console.error("T05 FAIL : contrôles émulateur non validés.");
    throw error;
  });
}
