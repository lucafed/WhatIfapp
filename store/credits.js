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

// 🔢 crediti FREE giornalieri
const DEFAULT_DAILY_LIMIT = 3;

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

/**
 * Normalizza il wallet al nuovo schema:
 * - creditsFree: crediti FREE (max 3) che ogni giorno tornano a 3 (non si cumulano)
 * - creditsPaid: crediti acquistati/aggiunti (persistenti, non si resetta ogni giorno)
 * - day / usedToday: contatore giornaliero (solo statistica/compatibilità)
 * - lastFreeReset: YYYY-MM-DD dell’ultimo reset dei free
 *
 * Migrazione automatica (senza rompere nulla):
 * se troviamo il vecchio schema (dailyLimit/usedToday) e mancano creditsFree/creditsPaid,
 * convertiamo il saldo residuo di oggi in (free + paid) mantenendo i crediti rimasti.
 */
function normalizeWalletData(data = {}, today) {
  const out = { ...(data || {}) };

  // Vecchi campi (se presenti)
  const oldDailyLimit = Number.isFinite(+out.dailyLimit) ? +out.dailyLimit : DEFAULT_DAILY_LIMIT;
  const oldUsedToday = Number.isFinite(+out.usedToday) ? +out.usedToday : 0;

  // Nuovi campi (se presenti)
  const hasNew =
    typeof out.creditsFree !== "undefined" ||
    typeof out.creditsPaid !== "undefined" ||
    typeof out.lastFreeReset !== "undefined";

  // Se è il vecchio schema → migra mantenendo il saldo residuo di oggi
  if (!hasNew) {
    const oldBalance = Math.max(0, oldDailyLimit - oldUsedToday);

    // free massimo 3, il resto diventa paid (così non si perde niente)
    const creditsFree = Math.max(0, Math.min(DEFAULT_DAILY_LIMIT, oldBalance));
    const creditsPaid = Math.max(0, oldBalance - creditsFree);

    out.creditsFree = creditsFree;
    out.creditsPaid = creditsPaid;
    out.lastFreeReset = today;

    // Manteniamo day/usedToday per compatibilità UI/statistiche
    out.day = typeof out.day === "string" ? out.day : today;
    out.usedToday = oldUsedToday;
  }

  // Normalizza i nuovi campi
  let creditsFree = Number.isFinite(+out.creditsFree) ? +out.creditsFree : DEFAULT_DAILY_LIMIT;
  let creditsPaid = Number.isFinite(+out.creditsPaid) ? +out.creditsPaid : 0;
  if (creditsPaid < 0) creditsPaid = 0;
  if (creditsFree < 0) creditsFree = 0;
  if (creditsFree > DEFAULT_DAILY_LIMIT) creditsFree = DEFAULT_DAILY_LIMIT;

  let day = typeof out.day === "string" ? out.day : today;
  let usedToday = Number.isFinite(+out.usedToday) ? +out.usedToday : 0;
  if (usedToday < 0) usedToday = 0;

  let lastFreeReset = typeof out.lastFreeReset === "string" ? out.lastFreeReset : today;

  // Cambio giorno: reset statistica + reset FREE a 3 (non cumulano)
  if (day !== today) {
    day = today;
    usedToday = 0;
  }
  if (lastFreeReset !== today) {
    creditsFree = DEFAULT_DAILY_LIMIT;
    lastFreeReset = today;
  }

  out.day = day;
  out.usedToday = usedToday;
  out.creditsFree = creditsFree;
  out.creditsPaid = creditsPaid;
  out.lastFreeReset = lastFreeReset;

  // totalUsed (se esiste) normalizza
  let totalUsed = Number.isFinite(+out.totalUsed) ? +out.totalUsed : 0;
  if (totalUsed < 0) totalUsed = 0;
  out.totalUsed = totalUsed;

  return out;
}

// ==== BOOT / LETTURA UTENTE CORRENTE ==== //

/**
 * bootCredits()
 * - crea il doc se non esiste
 * - migra dal vecchio schema se necessario
 * - ogni nuovo giorno: usedToday = 0
 * - ogni nuovo giorno: creditsFree torna a 3 (non si cumulano)
 * - creditsPaid resta invariato
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
    // Primo accesso: FREE di default + paid 0
    await setDoc(ref, {
      day: today,
      usedToday: 0,
      totalUsed: 0,

      creditsFree: DEFAULT_DAILY_LIMIT,
      creditsPaid: 0,
      lastFreeReset: today,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return;
  }

  const data = snap.data() || {};
  const normalized = normalizeWalletData(data, today);

  // Scrive solo merge (così non rompiamo eventuali campi extra)
  await setDoc(
    ref,
    {
      ...normalized,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * getBalance()
 * - se admin_token → ∞
 * - altrimenti: creditsFree + creditsPaid
 *   (creditsFree si resetta ogni giorno a 3, creditsPaid resta)
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
      await setDoc(ref, {
        day: today,
        usedToday: 0,
        totalUsed: 0,

        creditsFree: DEFAULT_DAILY_LIMIT,
        creditsPaid: 0,
        lastFreeReset: today,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return DEFAULT_DAILY_LIMIT;
    }

    const data = snap.data() || {};
    const normalized = normalizeWalletData(data, today);

    // Se normalizzazione ha fatto cambi (giorno/free reset/migrazione), sincronizza
    await setDoc(
      ref,
      {
        ...normalized,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    const balance = Math.max(0, (normalized.creditsFree || 0) + (normalized.creditsPaid || 0));
    return balance;
  } catch (e) {
    console.error("getBalance error:", e);
    return 0;
  }
}

/**
 * consumeCredit()
 * - se admin_token → TRUE e non tocca Firestore
 * - altrimenti consuma:
 *   1) prima i FREE (creditsFree)
 *   2) poi i PAID (creditsPaid)
 * - usedToday e totalUsed aumentano (solo statistica)
 */
export async function consumeCredit() {
  if (isAdminMode()) {
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
        // wallet nuovo: consuma 1 free
        const base = {
          day: today,
          usedToday: 1,
          totalUsed: 1,

          creditsFree: Math.max(0, DEFAULT_DAILY_LIMIT - 1),
          creditsPaid: 0,
          lastFreeReset: today,

          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        tx.set(ref, base);
        return true;
      }

      const data = snap.data() || {};
      const normalized = normalizeWalletData(data, today);

      const creditsFree = Number.isFinite(+normalized.creditsFree) ? +normalized.creditsFree : 0;
      const creditsPaid = Number.isFinite(+normalized.creditsPaid) ? +normalized.creditsPaid : 0;

      const balance = creditsFree + creditsPaid;
      if (balance <= 0) return false;

      let newFree = creditsFree;
      let newPaid = creditsPaid;

      if (newFree > 0) {
        newFree -= 1;
      } else {
        newPaid -= 1;
      }

      let usedToday = Number.isFinite(+normalized.usedToday) ? +normalized.usedToday : 0;
      let totalUsed = Number.isFinite(+normalized.totalUsed) ? +normalized.totalUsed : 0;
      usedToday += 1;
      totalUsed += 1;

      tx.set(
        ref,
        {
          ...normalized,
          day: today,
          usedToday,
          totalUsed,

          creditsFree: newFree,
          creditsPaid: newPaid,

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

  // Normalizza per mostrare valori corretti anche da admin
  const today = todayISO();
  const data = snap.data() || {};
  const normalized = normalizeWalletData(data, today);

  // sincronizza se serve
  await setDoc(ref, { ...normalized, updatedAt: serverTimestamp() }, { merge: true });

  return {
    uid: user.uid,
    email: user.email || null,
    ...normalized,
  };
}

/**
 * adminSetDailyLimit(limit)
 * Manteniamo il nome funzione per NON rompere admin.html.
 * Nuovo significato:
 * - imposta il TOTALE disponibile (FREE + PAID) a "limit" (oggi)
 * - FREE resta max 3, il resto diventa PAID
 * - Non crea “ricariche infinite”: domani FREE torna a 3, PAID resta quello impostato
 */
export async function adminSetDailyLimit(limit) {
  const user = getUserOrThrow();
  const ref = walletRef(user.uid);
  const today = todayISO();
  const lim = Math.max(0, +limit || 0);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists() ? (snap.data() || {}) : {};

    const normalized = normalizeWalletData(data, today);

    const free = Math.min(DEFAULT_DAILY_LIMIT, lim);
    const paid = Math.max(0, lim - free);

    // usedToday resta statistica; se è > lim la clampiamo (solo per coerenza UI)
    let usedToday = Number.isFinite(+normalized.usedToday) ? +normalized.usedToday : 0;
    if (usedToday > lim) usedToday = lim;

    tx.set(
      ref,
      {
        ...normalized,
        day: today,
        usedToday,

        creditsFree: free,
        creditsPaid: paid,
        lastFreeReset: today,

        updatedAt: serverTimestamp(),
        createdAt: normalized.createdAt || serverTimestamp(),
      },
      { merge: true },
    );
  });
}

/**
 * adminAddCredits(delta)
 * Manteniamo il nome funzione per NON rompere admin.html.
 * Nuovo significato:
 * - aggiunge crediti PAID (persistenti)
 */
export async function adminAddCredits(delta) {
  const user = getUserOrThrow();
  const ref = walletRef(user.uid);
  const today = todayISO();
  const d = Math.max(0, +delta || 0);
  if (!d) return;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists() ? (snap.data() || {}) : {};

    const normalized = normalizeWalletData(data, today);

    const oldPaid = Number.isFinite(+normalized.creditsPaid) ? +normalized.creditsPaid : 0;
    const newPaid = Math.max(0, oldPaid + d);

    tx.set(
      ref,
      {
        ...normalized,
        day: today,
        creditsPaid: newPaid,
        updatedAt: serverTimestamp(),
        createdAt: normalized.createdAt || serverTimestamp(),
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

    creditsFree: DEFAULT_DAILY_LIMIT,
    lastFreeReset: today,

    updatedAt: serverTimestamp(),
  }).catch(async (e) => {
    if (e.code === "not-found") {
      await setDoc(ref, {
        day: today,
        usedToday: 0,
        totalUsed: 0,

        creditsFree: DEFAULT_DAILY_LIMIT,
        creditsPaid: 0,
        lastFreeReset: today,

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
    usedToday: 0,
    totalUsed: 0,

    creditsFree: DEFAULT_DAILY_LIMIT,
    creditsPaid: 0,
    lastFreeReset: today,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  }
