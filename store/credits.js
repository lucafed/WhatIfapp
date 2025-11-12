// /store/credits.js
// Gestione crediti su Firestore: ricarica giornaliera, consumo, reward da annuncio.

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

// --- Inizializzazione Firebase (non duplica se già inizializzato altrove)
const firebaseConfig = {
  apiKey: "AIzaSyAeWhmo9BtwWUVVeBxwJKUgLODMDQNUZTE",
  authDomain: "whatif-oracolo-bc15d.firebaseapp.com",
  projectId: "whatif-oracolo-bc15d",
  storageBucket: "whatif-oracolo-bc15d.firebasestorage.app",
  messagingSenderId: "857481137283",
  appId: "1:857481137283:web:ff8f766d14392835cf5fb6"
};
if (!getApps().length) initializeApp(firebaseConfig);

const auth = getAuth();
const db   = getFirestore();

// --- Helper: stesso giorno?
function sameDay(ts) {
  if (!ts) return false;
  const d = new Date((ts.seconds ?? 0) * 1000);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

// --- Config globale (config/global)
export async function getGlobalConfig() {
  const snap = await getDoc(doc(db, "config", "global"));
  if (!snap.exists()) throw new Error("Config globale mancante");
  return snap.data();
}

// --- Crea doc utente se non esiste
export async function ensureUserDoc(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      credits: 3,
      adsWatched: 0,
      premium: false,
      lastRechargeAt: serverTimestamp()
    });
    return (await getDoc(ref)).data();
  }
  return snap.data();
}

// --- Ricarica giornaliera se serve
export async function rechargeIfNeeded(uid, cfg, userDoc) {
  if (!cfg?.dailyRechargeEnabled) return userDoc;
  if (sameDay(userDoc?.lastRechargeAt)) return userDoc;

  const base   = Number(cfg?.dailyFreeCredits ?? 3);
  const bonus  = Number(cfg?.dailyFreeSurprise ?? 0);
  const next   = base + bonus;

  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    credits: next,
    adsWatched: 0,
    lastRechargeAt: serverTimestamp()
  });

  return { ...userDoc, credits: next, adsWatched: 0, lastRechargeAt: { seconds: Math.floor(Date.now()/1000) } };
}

// --- Boot: crea doc e ricarica se è giorno nuovo (da chiamare DOPO login)
export async function bootCredits() {
  const u = auth.currentUser;
  if (!u) return null;
  const cfg = await getGlobalConfig();
  let ud    = await ensureUserDoc(u.uid);
  ud        = await rechargeIfNeeded(u.uid, cfg, ud);
  return { cfg, ud };
}

// --- Lettura saldo
export async function getBalance() {
  const u = auth.currentUser;
  if (!u) throw new Error("Non autenticato");
  const snap = await getDoc(doc(db, "users", u.uid));
  return snap.exists() ? Number(snap.data().credits || 0) : 0;
}

// --- Consuma 1 credito (true se ok; false se finiti). Admin = ∞
export async function consumeCredit() {
  const u = auth.currentUser;
  if (!u) throw new Error("Non autenticato");
  const cfg = await getGlobalConfig();
  const isAdmin = Array.isArray(cfg?.admins) && cfg.admins.includes(u.uid);
  if (isAdmin) return true;

  const ref  = doc(db, "users", u.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("User doc assente");
  const d = snap.data();
  const cur = Number(d.credits || 0);
  if (cur <= 0) return false;
  await updateDoc(ref, { credits: cur - 1 });
  return true;
}

// --- Aggiunge crediti (per acquisto/test/bonus)
export async function addCredits(n = 1) {
  const u = auth.currentUser;
  if (!u) throw new Error("Non autenticato");
  const ref  = doc(db, "users", u.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("User doc assente");
  const cur = Number(snap.data().credits || 0);
  await updateDoc(ref, { credits: cur + Number(n) });
  return cur + Number(n);
}

// --- Reward da annuncio (rispetta cap giornaliero)
export async function grantAdCredit() {
  const u = auth.currentUser;
  if (!u) throw new Error("Non autenticato");

  const cfg    = await getGlobalConfig();
  const cap    = Number(cfg?.dailyAdCap ?? 5);
  const reward = Number(cfg?.adReward ?? 1);

  const ref  = doc(db, "users", u.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("User doc assente");
  const d = snap.data();

  const watched = Number(d.adsWatched || 0);
  if (watched >= cap) return { ok:false, reason:"cap_reached" };

  await updateDoc(ref, {
    adsWatched: watched + 1,
    credits: Number(d.credits || 0) + reward
  });
  return { ok:true };
}
