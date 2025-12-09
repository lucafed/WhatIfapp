// FILE: /store/credits.js
// Gestione crediti giornalieri via Firestore
// Usato da fourth.html, fifth.html e admin.html

// 👇 IMPORTA TUTTO da firebase.init.js (UNA SOLA FIRESTORE)
import {
  auth,
  db,
  doc,
  getDoc,
  setDoc,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "../firebase.init.js";

// 🔢 limite base (se il doc non esiste o è invalido)
const DEFAULT_DAILY_LIMIT = 1;

// YYYY-MM-DD
const todayISO = () => new Date().toISOString().slice(0, 10);

// ==== Helper ====

function isAdminMode() {
  // se esiste admin_token → crediti infiniti (per fourth/fifth)
  try {
    return !!localStorage.getItem("admin_token");
  } catch {
    return false;
  }
}

function getUserOrThrow() {
  const u = auth.currentUser;
  if (!u) throw new Error("no_user");
  return u;
}

function walletRef(uid) {
  return doc(db, "wallets", uid);
}

// ==== BOOT / LETTURA UTENTE CORRENTE ==== //

/**
 * bootCredits()
 * - crea il doc se non esiste
 * - se è cambiato il giorno → resetta usedToday = 0 (ma lascia dailyLimit)
 * - se dailyLimit è nullo/0 → lo porta a DEFAULT_DAILY_LIMIT
 */
export async function bootCredits() {
  if (isAdminMode()) {
    // in modalità admin non ci serve toccare nulla (fourth/fifth usano ∞)
    return;
  }

  const user = getUserOrThrow();
  const ref = walletRef(user.uid);
  const today = todayISO();

  const snap = await getDoc(ref);

  if (!snap.exists()) {
    // Primo accesso: wallet FREE di default
    await setDoc(ref, {
      day: today,
      dailyLimit: DEFAULT_DAILY_LIMIT,
      usedToday: 0,
      totalUsed: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return;
  }

  const data = snap.data() || {};
  const prevDay = typeof data.day === "string" ? data.day : today;

  let dailyLimit = Number.isFinite(+data.dailyLimit)
    ? +data.dailyLimit
    : DEFAULT_DAILY_LIMIT;
  // 🛠 se qualcuno ha scritto 0 o valore non valido, torna al default
  if (dailyLimit <= 0) dailyLimit = DEFAULT_DAILY_LIMIT;

  let usedToday = Number.isFinite(+data.usedToday) ? +data.usedToday : 0;

  const isNewDay = prevDay !== today;
  if (isNewDay) {
    usedToday = 0;
  }

  // Aggiorna solo se serve
  await setDoc(
    ref,
    {
      ...data,
      day: today,
      dailyLimit,
      usedToday,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * getBalance()
 * - se admin_token → ∞
 * - altrimenti: dailyLimit - usedToday (mai < 0)
 *   se il doc non esiste o è rotto → lo inizializza come FREE (3 crediti)
 */
export async function getBalance() {
  if (isAdminMode()) {
    return Infinity;
  }

  let user;
  try {
    user = getUserOrThrow();
  } catch {
    return 0;
  }

  const ref = walletRef(user.uid);
  const today = todayISO();

  try {
    let snap = await getDoc(ref);

    if (!snap.exists()) {
      // se non esiste, inizializza il wallet e ritorna il default
      await setDoc(ref, {
        day: today,
        dailyLimit: DEFAULT_DAILY_LIMIT,
        usedToday: 0,
        totalUsed: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return DEFAULT_DAILY_LIMIT;
    }

    const data = snap.data() || {};
    let day = typeof data.day === "string" ? data.day : today;

    let dailyLimit = Number.isFinite(+data.dailyLimit)
      ? +data.dailyLimit
      : DEFAULT_DAILY_LIMIT;
    if (dailyLimit <= 0) dailyLimit = DEFAULT_DAILY_LIMIT;

    let usedToday = Number.isFinite(+data.usedToday) ? +data.usedToday : 0;
    if (day !== today) {
      usedToday = 0;
      day = today;
      // piccolo fix: sincronizza anche su Firestore
      await setDoc(
        ref,
        { day, usedToday, dailyLimit, updatedAt: serverTimestamp() },
        { merge: true },
      );
    }

    const balance = Math.max(0, dailyLimit - usedToday);
    return balance;
  } catch (e) {
    console.error("getBalance error:", e);
    return 0;
  }
}

/**
 * consumeCredit()
 * - se admin_token → TRUE e non tocca Firestore
 * - altrimenti scala 1 da usedToday, se c'è saldo
 */
export async function consumeCredit() {
  if (isAdminMode()) {
    // Admin: non consumiamo niente, ritorna sempre ok
    return true;
  }

  let user;
  try {
    user = getUserOrThrow();
  } catch {
    return false;
  }

  const ref = walletRef(user.uid);
  const today = todayISO();

  try {
    const result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);

      if (!snap.exists()) {
        // se non esiste, parte dal default FREE e consuma il primo credito
        const base = {
          day: today,
          dailyLimit: DEFAULT_DAILY_LIMIT,
          usedToday: 1,
          totalUsed: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        tx.set(ref, base);
        return true;
      }

      const data = snap.data() || {};
      const prevDay = typeof data.day === "string" ? data.day : today;

      let dailyLimit = Number.isFinite(+data.dailyLimit)
        ? +data.dailyLimit
        : DEFAULT_DAILY_LIMIT;
      if (dailyLimit <= 0) dailyLimit = DEFAULT_DAILY_LIMIT;

      let usedToday = Number.isFinite(+data.usedToday) ? +data.usedToday : 0;

      if (prevDay !== today) {
        usedToday = 0;
      }

      const balance = dailyLimit - usedToday;
      if (balance <= 0) {
        return false;
      }

      usedToday += 1;
      const totalUsed = Number.isFinite(+data.totalUsed)
        ? +data.totalUsed + 1
        : 1;

      tx.set(
        ref,
        {
          ...data,
          day: today,
          dailyLimit,
          usedToday,
          totalUsed,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      return true;
    });

    return result === true;
  } catch (err) {
    console.error("consumeCredit Firestore error:", err);
    return false;
  }
}

// ==== FUNZIONI ADMIN (per admin.html) ==== //

export async function getWalletRaw() {
  const user = getUserOrThrow();
  const ref = walletRef(user.uid);
  let snap = await getDoc(ref);

  if (!snap.exists()) {
    await bootCredits();
    snap = await getDoc(ref);
    if (!snap.exists()) return null;
  }

  return {
    uid: user.uid,
    email: user.email || null,
    ...snap.data(),
  };
}

export async function adminSetDailyLimit(limit) {
  const user = getUserOrThrow();
  const ref = walletRef(user.uid);
  const today = todayISO();
  const lim = Math.max(0, +limit || 0);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      tx.set(ref, {
        day: today,
        dailyLimit: lim,
        usedToday: 0,
        totalUsed: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return;
    }
    const data = snap.data() || {};
    let usedToday = Number.isFinite(+data.usedToday) ? +data.usedToday : 0;
    if (usedToday > lim) usedToday = lim;
    tx.set(
      ref,
      {
        ...data,
        day: today,
        dailyLimit: lim,
        usedToday,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export async function adminAddCredits(delta) {
  const user = getUserOrThrow();
  const ref = walletRef(user.uid);
  const today = todayISO();
  const d = Math.max(0, +delta || 0);
  if (!d) return;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      tx.set(ref, {
        day: today,
        dailyLimit: d,
        usedToday: 0,
        totalUsed: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return;
    }
    const data = snap.data() || {};
    const oldLimit = Number.isFinite(+data.dailyLimit)
      ? +data.dailyLimit
      : DEFAULT_DAILY_LIMIT;
    const newLimit = Math.max(0, oldLimit + d);
    tx.set(
      ref,
      {
        ...data,
        day: today,
        dailyLimit: newLimit,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export async function adminResetToday() {
  const user = getUserOrThrow();
  const ref = walletRef(user.uid);
  const today = todayISO();
  await updateDoc(ref, {
    day: today,
    usedToday: 0,
    updatedAt: serverTimestamp(),
  }).catch(async (e) => {
    if (e.code === "not-found") {
      await setDoc(ref, {
        day: today,
        dailyLimit: DEFAULT_DAILY_LIMIT,
        usedToday: 0,
        totalUsed: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      throw e;
    }
  });
}

export async function adminWipeWallet() {
  const user = getUserOrThrow();
  const ref = walletRef(user.uid);
  const today = todayISO();
  await setDoc(ref, {
    day: today,
    dailyLimit: DEFAULT_DAILY_LIMIT,
    usedToday: 0,
    totalUsed: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
