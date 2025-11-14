// FILE: /store/credits.js
// Gestione crediti giornalieri via Firestore
// Usato da fourth.html e fifth.html

// ✅ Usa l'app già inizializzata in firebase.init.js
import { auth, db } from "../firebase.init.js";

import {
  doc,
  getDoc,
  setDoc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

// 🔢 limite giornaliero (puoi cambiarlo qui)
const DAILY_LIMIT = 3;

// YYYY-MM-DD
const todayISO = () => new Date().toISOString().slice(0, 10);

function getUser() {
  const u = auth.currentUser;
  if (!u) throw new Error("no_user");
  return u;
}

function walletRef(uid) {
  return doc(db, "wallets", uid);
}

/**
 * Crea/normalizza il documento wallet:
 * - se non esiste → lo crea con DAILY_LIMIT / usedToday = 0
 * - se il giorno è cambiato → resetta usedToday = 0 e aggiorna day
 */
export async function bootCredits() {
  const user = getUser();
  const ref  = walletRef(user.uid);
  const today = todayISO();

  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      day: today,
      dailyLimit: DAILY_LIMIT,
      usedToday: 0,
      totalUsed: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return;
  }

  const data = snap.data() || {};
  const day  = typeof data.day === "string" ? data.day : today;

  // nuovo giorno → reset
  if (day !== today) {
    const dailyLimit = Number.isFinite(+data.dailyLimit)
      ? +data.dailyLimit
      : DAILY_LIMIT;

    await setDoc(ref, {
      ...data,
      day: today,
      dailyLimit,
      usedToday: 0,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
}

/**
 * Ritorna il saldo disponibile per oggi
 */
export async function getBalance() {
  let user;
  try {
    user = getUser();
  } catch {
    return 0;
  }

  const ref = walletRef(user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const today = todayISO();
    await setDoc(ref, {
      day: today,
      dailyLimit: DAILY_LIMIT,
      usedToday: 0,
      totalUsed: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return DAILY_LIMIT;
  }

  const data = snap.data() || {};
  const today = todayISO();
  const day  = typeof data.day === "string" ? data.day : today;

  const dailyLimit = Number.isFinite(+data.dailyLimit)
    ? +data.dailyLimit
    : DAILY_LIMIT;

  let usedToday = Number.isFinite(+data.usedToday)
    ? +data.usedToday
    : 0;

  if (day !== today) {
    usedToday = 0;
  }

  const balance = Math.max(0, dailyLimit - usedToday);
  return balance;
}

/**
 * Consuma 1 credito se disponibile.
 * true  → credito scalato
 * false → saldo finito
 */
export async function consumeCredit() {
  let user;
  try {
    user = getUser();
  } catch {
    return false;
  }

  const ref = walletRef(user.uid);
  const today = todayISO();

  try {
    const result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);

      if (!snap.exists()) {
        const base = {
          day: today,
          dailyLimit: DAILY_LIMIT,
          usedToday: 1,
          totalUsed: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        tx.set(ref, base);
        return true;
      }

      const data = snap.data() || {};
      const day  = typeof data.day === "string" ? data.day : today;

      const dailyLimit = Number.isFinite(+data.dailyLimit)
        ? +data.dailyLimit
        : DAILY_LIMIT;

      let usedToday = Number.isFinite(+data.usedToday)
        ? +data.usedToday
        : 0;

      if (day !== today) {
        usedToday = 0;
      }

      const balance = dailyLimit - usedToday;
      if (balance <= 0) {
        return false;
      }

      usedToday += 1;
      const totalUsed = Number.isFinite(+data.totalUsed)
        ? (+data.totalUsed + 1)
        : 1;

      tx.set(ref, {
        ...data,
        day: today,
        dailyLimit,
        usedToday,
        totalUsed,
        updatedAt: serverTimestamp()
      }, { merge: true });

      return true;
    });

    return result === true;
  } catch (err) {
    console.error("consumeCredit Firestore error:", err);
    return false;
  }
}
