/** F28 · Authentification Firebase, aucun mot de passe stocké ni journalisé. */
import { getApp } from "firebase/app";
import {
  createUserWithEmailAndPassword, getAuth, onAuthStateChanged,
  sendPasswordResetEmail, signInWithEmailAndPassword, signOut as firebaseSignOut,
} from "firebase/auth";
import type { AuthUser, Result, Unsubscribe } from "../domain/types";

/** M17 */
export async function signIn(email: string, password: string): Promise<Result<AuthUser>> {
  if (!email.trim() || !password) {
    return { ok: false, error: { code: "INVALID_CREDENTIALS", message: "Identifiants manquants." } };
  }
  try {
    const result = await signInWithEmailAndPassword(getAuth(getApp("organiseur-personnel")), email, password);
    return { ok: true, value: { uid: result.user.uid, email: result.user.email } };
  } catch {
    return { ok: false, error: { code: "AUTH_FAILED", message: "Connexion refusée. Vérifie tes identifiants." } };
  }
}

/** M18 · Les écrans privés doivent être masqués lors du changement de session. */
export async function signOut(): Promise<Result<void>> {
  try {
    await firebaseSignOut(getAuth(getApp("organiseur-personnel")));
    return { ok: true, value: undefined };
  } catch {
    return { ok: false, error: { code: "SIGN_OUT_FAILED", message: "Déconnexion impossible." } };
  }
}

/** M19 · Ne pas divulguer si l'adresse possède un compte. */
export async function sendPasswordReset(email: string): Promise<Result<void>> {
  if (!email.trim()) {
    return { ok: false, error: { code: "INVALID_EMAIL", message: "Adresse e-mail requise." } };
  }
  try {
    await sendPasswordResetEmail(getAuth(getApp("organiseur-personnel")), email);
    return { ok: true, value: undefined };
  } catch {
    return { ok: false, error: { code: "RESET_REQUEST_FAILED", message: "Demande de réinitialisation non aboutie." } };
  }
}

/** M20 */
export function observeAuth(cb: (u: AuthUser | null) => void): Unsubscribe {
  return onAuthStateChanged(getAuth(getApp("organiseur-personnel")),
    user => cb(user ? { uid: user.uid, email: user.email } : null));
}

/** M90 */
export async function registerAccount(email: string, password: string): Promise<Result<AuthUser>> {
  if (!email.trim() || password.length < 8) {
    return { ok: false, error: { code: "INVALID_SIGNUP", message: "Adresse et mot de passe de huit caractères minimum requis." } };
  }
  try {
    const result = await createUserWithEmailAndPassword(getAuth(getApp("organiseur-personnel")), email, password);
    return { ok: true, value: { uid: result.user.uid, email: result.user.email } };
  } catch {
    return { ok: false, error: { code: "SIGNUP_FAILED", message: "Inscription refusée." } };
  }
}
