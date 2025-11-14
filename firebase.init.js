// FILE: firebase.init.js
// Inizializzazione unica di Firebase (Auth + Firestore) via CDN

// Import SDK modulari
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

// ⚡ CONFIG COPIATA ESATTAMENTE DAL TUO TAB CDN
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

// 🔥 FIRESTORE DB (unica istanza)
const db = getFirestore(app);

// Esporta TUTTO da qui, così gli altri file non importano più Firestore direttamente
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
};
