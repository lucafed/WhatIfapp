// FILE: firebase.init.js
// Inizializzazione unica di Firebase (Auth + Firestore)

// IMPORT SDK MODULARI
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

// ⚠️ CONFIGURAZIONE DEL TUO PROGETTO (copiata dal tuo screenshot)
const firebaseConfig = {
  apiKey: "AIzaSyAeWhmo9BtwUWVVeB8xwJKUgLODMQDNUZTE",
  authDomain: "whatif-oracolo-bc15d.firebaseapp.com",
  projectId: "whatif-oracolo-bc15d",
  storageBucket: "whatif-oracolo-bc15d.appspot.com",
  messagingSenderId: "857481137283",
  appId: "1:857481137283:web:ff8f766d14392835cff5b6"
};

// 🔥 INITIALIZE FIREBASE UNA SOLA VOLTA
const app = initializeApp(firebaseConfig);

// 🔥 AUTH + PERSISTENZA LOCALE (rimane loggato tra i refresh)
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

// 🔥 FIRESTORE DB
const db = getFirestore(app);

// 🔥 ESPORTA PER TUTTO IL PROGETTO
export { app, auth, db };
