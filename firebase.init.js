// FILE: firebase.init.js
// Inizializzazione unica di Firebase (Auth + Firestore + Messaging) via CDN modular v12

// 🔹 IMPORT SDK (tutti v12.6.0)
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

import {
  getMessaging,
  getToken,
  onMessage,
  isSupported as isMessagingSupported,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-messaging.js";

// ✅ Analytics (aggiunto)
import {
  getAnalytics,
  logEvent,
  isSupported as isAnalyticsSupported,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-analytics.js";


// ⚡ CONFIG (la tua, identica)
const firebaseConfig = {
  apiKey: "AIzaSyAeWhmo9BtwWUVVeBxwJKUgLODMDQNUZTE",
  authDomain: "whatif-oracolo-bc15d.firebaseapp.com",
  projectId: "whatif-oracolo-bc15d",
  storageBucket: "whatif-oracolo-bc15d.firebasestorage.app",
  messagingSenderId: "857481137283",
  appId: "1:857481137283:web:ff8f766d14392835cf5fb6",
};

// 🚀 Inizializza app
const app = initializeApp(firebaseConfig);

// 🔐 AUTH con persistenza locale
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("[firebase.init] Persistenza auth non settata:", err);
});

// 🔥 FIRESTORE
const db = getFirestore(app);

// 🔔 MESSAGING (protetto: solo se supportato)
let messaging = null;

try {
  // isMessagingSupported è async in v12
  const supportedPromise = isMessagingSupported();
  supportedPromise
    .then((supported) => {
      if (!supported) {
        console.warn("[firebase.init] Messaging non supportato in questo browser.");
        return null;
      }
      messaging = getMessaging(app);
      console.log("[firebase.init] Messaging inizializzato.");
      return null;
    })
    .catch((err) => {
      console.warn("[firebase.init] Errore supporto Messaging:", err);
    });
} catch (err) {
  console.warn("[firebase.init] Messaging init error:", err);
}

// ✅ ANALYTICS (protetto: solo se supportato)
let analytics = null;

try {
  // isAnalyticsSupported è async in v12
  const aSupportedPromise = isAnalyticsSupported();
  aSupportedPromise
    .then((supported) => {
      if (!supported) {
        console.warn("[firebase.init] Analytics non supportato in questo ambiente.");
        return null;
      }
      analytics = getAnalytics(app);
      console.log("[firebase.init] Analytics inizializzato.");
      return null;
    })
    .catch((err) => {
      console.warn("[firebase.init] Errore supporto Analytics:", err);
    });
} catch (err) {
  console.warn("[firebase.init] Analytics init error:", err);
}

// 👉 EXPORT per tutto il resto del sito
export {
  app,
  auth,
  db,
  // firestore helpers
  doc,
  getDoc,
  setDoc,
  runTransaction,
  serverTimestamp,
  updateDoc,
  // messaging (attenzione: può essere null finché non è pronto)
  messaging,
  getToken,
  onMessage,
  // analytics (attenzione: può essere null finché non è pronto)
  analytics,
  logEvent,
};
