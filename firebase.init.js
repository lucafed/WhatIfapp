// FILE: firebase.init.js
// Inizializzazione unica di Firebase (Auth + Firestore + Messaging)

// Import SDK modulari (stessa versione ovunque!)
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

// 🔔 FIREBASE MESSAGING (NOTIFICHE PUSH)
import {
  getMessaging,
  getToken,
  onMessage,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-messaging.js";

// ⚡ CONFIG (la tua, identica a prima)
const firebaseConfig = {
  apiKey: "AIzaSyAeWhmo9BtwWUVVeBxwJKUgLODMDQNUZTE",
  authDomain: "whatif-oracolo-bc15d.firebaseapp.com",
  projectId: "whatif-oracolo-bc15d",
  storageBucket: "whatif-oracolo-bc15d.firebasestorage.app",
  messagingSenderId: "857481137283",
  appId: "1:857481137283:web:ff8f766d14392835cf5fb6",
};

// 🚀 Inizializza Firebase UNA VOLTA
const app = initializeApp(firebaseConfig);

// 🔐 AUTH con persistenza locale
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("Persistenza non settata:", err);
});

// 🔥 FIRESTORE DB
const db = getFirestore(app);

// 🔔 MESSAGING (notifiche)
const messaging = getMessaging(app);

/**
 * Inizializza le push notification:
 * - registra /firebase-messaging-sw.js
 * - chiede il permesso
 * - ottiene il token FCM usando quel service worker
 */
export async function initPushNotifications() {
  if (!("serviceWorker" in navigator)) {
    console.warn("[push] Service worker non supportato");
    return null;
  }

  try {
    // ✅ REGISTRA SOLO QUESTO SW per l’app
    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    console.log("[push] SW registrato:", registration.scope);

    // Richiesta permesso notifiche
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      console.warn("[push] Permesso notifiche negato:", perm);
      return null;
    }

    // ⚠️ Usa la STESSA VAPID KEY che avevi prima nelle notifiche
    const vapidKey = "METTI_QUI_LA_TUA_VAPID_KEY";

    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      console.warn("[push] Nessun token ottenuto");
      return null;
    }

    console.log("[push] FCM token:", token);
    return token;
  } catch (err) {
    console.error("[push] Errore initPushNotifications:", err);
    return null;
  }
}

// Messaggi ricevuti a PAGINA APERTA (foreground)
// ⚠️ QUI NON CREIAMO notifiche: ci pensa il service worker in background
onMessage(messaging, (payload) => {
  console.log("[push] Messaggio in foreground:", payload);
  // Se vuoi, puoi aggiornare l'UI (banner, toast interno, ecc.),
  // ma NON fare new Notification(...).
});

// 👉 Esporto TUTTO ciò che usano fourth / fifth / admin / credits
export {
  app,
  auth,
  db,
  doc,
  getDoc,
  setDoc,
  runTransaction,
  serverTimestamp,
  updateDoc,
  // notifiche
  messaging,
  getToken,
  onMessage,
};
