// FILE: /api/push.js
import admin from "../firebase-admin-server.js";

const db = admin.firestore();
const APP_ORIGIN = "https://what-ifapp.vercel.app";

/* ========= helpers deterministici (rotazione giornaliera) ========= */
function ymdRome(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function weekdayRome(d = new Date()) {
  // 0=Sun ... 6=Sat
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Rome",
    weekday: "short",
  }).format(d);
  return ({ Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }[wd] ?? 0);
}

function hashStr(str = "") {
  let h = 2166136261 >>> 0;
  for (const ch of String(str)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function pickDaily(arr, seedStr) {
  if (!arr || !arr.length) return "";
  const seed = hashStr(seedStr);
  return arr[seed % arr.length];
}

/* ✅ CHUNK TOKENS (FCM max 500) */
function chunk(arr, size = 500) {
  const out = [];
  for (let i = 0; i < (arr?.length || 0); i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* ========= lingua ========= */
const SUP_LANGS = ["it","en","es","fr","de"];
function normLang(l = "it") {
  const s = String(l || "it").toLowerCase().slice(0,2);
  return SUP_LANGS.includes(s) ? s : "it";
}

/* ========= copy notifiche (ROTANTI) ========= */
/* ✅ IT: le tue originali (NON TOCCATE) */
const PUSH_TITLES_IT = [
  "What?f · frase del giorno",
  "What?f · due righe per te",
  "What?f · oggi si gira così",
  "What?f · apri un secondo",
  "What?f · micro-oracolo",
  "What?f · messaggio rapido",
];

const WHATIF_MORNING_IT = [
  "Stamattina c’è una frase che ti rimette in asse: aprila.",
  "Ti ho lasciato una cosa piccola ma potente per oggi: apri qua.",
  "Una frase breve, ma ti cambia l’angolo: aprila.",
  "Oggi parte meglio se leggi questa: apri un secondo.",
  "C’è una frase che ti fa venire voglia di muoverti: apri.",
  "Se apri questa adesso, il resto della mattina scorre meglio: fidati e apri.",
  "Una frase per iniziare senza rincorrere tutto: apri qua.",
  "Prima di buttarti nel casino: apri questa e parti più pulito.",
  "Una frase che ti fa scegliere meglio oggi: apri.",
  "Non serve essere motivati: serve leggere questa e partire. Apri qua.",
  "Oggi hai un punto in più a favore, se la apri: vai.",
  "Apri questa e ti risparmi un giro a vuoto stamattina.",
  "Una frase che ti toglie un peso leggero dalle spalle: apri.",
  "Se ti senti già in ritardo: apri qua, ti rimetti in carreggiata.",
  "Due righe, zero prediche: apri e vedi.",
  "Apri: c’è un dettaglio che oggi ti sfugge, ma ti serve.",
  "Ti lascio una frase che fa ordine senza urlare: apri.",
  "Apri adesso: la giornata ti ringrazia più tardi.",
  "Un piccolo “click” mentale per oggi: apri qua.",
  "Apri questa: ti fa partire con un filo di coraggio in più.",
];

const WHATIF_EVENING_IT = [
  "Chiudi la giornata con una frase che ti rimette in pace: aprila.",
  "Prima di spegnere il cervello, leggi questa: ti fa bene.",
  "Due righe per sfilarti la giornata di dosso: apri qua.",
  "Una frase per chiudere senza processo: aprila.",
  "Apri questa e vai a dormire con meno rumore in testa.",
  "Non serve sistemare tutto stasera: apri questa e lasci andare meglio.",
  "Apri: c’è una frase che ti fa finire la giornata più leggero.",
  "Se ti porti la giornata nel letto, apri qua prima.",
  "Due righe per mettere un punto, non tre puntini: apri.",
  "Apri: ti do un modo gentile per chiudere oggi.",
  "Una frase per non ripeterti domani lo stesso peso: apri.",
  "Apri: ti serve un finale più onesto, non più perfetto.",
  "Apri questa, poi chiudi tutto e basta: te lo meriti.",
  "Apri: c’è un “ok” che puoi concederti stasera.",
  "Una frase piccola, ma ti cambia il sonno: apri.",
];

const WTF_EVENING_IT = [
  "We, ancora sveglio stai? Leggiti questa e vai a letto che domani ti alzi, ecchecazz!!!",
  "Hai visto che ore sono? Apri qua, poi nanna… che domani non ti salva nessuno, ecchecazz!!!",
  "Domani manco un elefante col tamburo ti sveglia: apri questa e poi sparisci a dormì, ecchecazz!!!",
  "Dai su, basta film mentali: apri qua e chiudiamo ‘sta giornata col sorriso storto, ecchecazz!!!",
  "Se stasera ti giudichi ancora, giuro che ti tiro una sveglia morale: apri qua, ecchecazz!!!",
  "Apri questa, poi spegni tutto: che pure il cervello ha bisogno di manutenzione, ecchecazz!!!",
  "Se continui a scrollare ti cresce la notte addosso: apri qua e chiudiamo, ecchecazz!!!",
  "Due righe e poi basta drammi: apri qua e vai a dormì, ecchecazz!!!",
  "Apri qua prima che domani ti presenti come un frigorifero vuoto: triste e rumoroso, ecchecazz!!!",
  "Ok, ultima cosa della giornata: apri questa e poi sparisci sotto le coperte, ecchecazz!!!",
  "Apri qua: ti do la versione onesta della giornata, senza zucchero, ecchecazz!!!",
  "Se domani vuoi essere vivo, stasera chiudi bene: apri qua e poi letto, ecchecazz!!!",
  "Apri questa e poi chiudi la serata come si chiude un bar: luci giù e pensieri fuori, ecchecazz!!!",
  "Hai fatto abbastanza casino per oggi: apri qua e poi stop, ecchecazz!!!",
  "Apri qua e fammi vedere se almeno una cosa la chiudi bene oggi, ecchecazz!!!",
  "Se ti senti uno straccio, è perché lo sei: apri qua e poi dormi, ecchecazz!!!",
  "Apri qua: ti do due schiaffetti affettuosi e poi ti mando a letto, ecchecazz!!!",
  "Ok campione, fine giornata: apri questa e poi a nanna, ecchecazz!!!",
];

const WTF_POST_SBRONZA_MORNING_IT = [
  "Post-sbronza mode: apri qua, così almeno la dignità la recuperi a rate, ecchecazz!!!",
  "Sabato mattina e faccia da “mai più”: apri questa e rimetti in moto il cervello, ecchecazz!!!",
  "Se hai la bocca impastata e la memoria a buchi, apri qua: ti sistemo il karma da bar, ecchecazz!!!",
  "Occhi a fessura e anima in hangover: apri qua prima di fare danni, ecchecazz!!!",
  "Se oggi ti senti un mobile: apri qua, che almeno il pensiero torna in piedi, ecchecazz!!!",
  "Apri questa prima di promettere “mai più” per la cinquantesima volta, ecchecazz!!!",
  "Post-sbronza e cuore fragile: apri qua, ti rimetto dritto senza fare poesia, ecchecazz!!!",
  "Apri qua: ti do una frase e un sorso di lucidità immaginaria, ecchecazz!!!",
  "Se il cervello sta ancora in modalità discoteca: apri qua e torna umano, ecchecazz!!!",
  "Apri questa e poi acqua, caffè e dignità: in quest’ordine, ecchecazz!!!",
];

// ✅ DOMENICA SERA: cattiva, “weekend finito / lunedì in arrivo”
const WTF_SUNDAY_EVENING_IT = [
  "Domenica sera: il weekend è morto e lunedì sta già bussando. Apri qua e fai pace col disastro, ecchecazz!!!",
  "È domenica sera: domani ricomincia la giostra e tu manco hai ricaricato l’anima. Apri qua, ecchecazz!!!",
  "Domenica sera: hai sprecato pure il “riposo”. Apri questa e almeno chiudiamo dignitosi, ecchecazz!!!",
  "Domani è lunedì: se ti deprimi adesso fai doppio danno. Apri qua e stringi i denti con stile, ecchecazz!!!",
  "Domenica sera: quel vuoto nello stomaco? È il lunedì che si avvicina. Apri qua, ecchecazz!!!",
  "È finita: domani si torna a fingere di essere adulti. Apri questa e metti il casco, ecchecazz!!!",
  "Domenica sera: se ti parte l’ansia, almeno falla utile. Apri qua e chiudiamo ‘sta farsa, ecchecazz!!!",
  "Domani si riparte e tu sei ancora in pigiama mentale. Apri qua e rimettiti in strada, ecchecazz!!!",
  "Domenica sera: la tristezza gratis non la vogliamo. Apri questa e poi letto, ecchecazz!!!",
  "Il lunedì è dietro l’angolo come un creditore: apri qua e preparati senza piangere, ecchecazz!!!",
];

/* ✅ Titoli per lingua (se mancano, fallback IT) */
const PUSH_TITLES = {
  it: PUSH_TITLES_IT,
  en: [
    "What?f · phrase of the day",
    "What?f · two lines for you",
    "What?f · today’s vibe",
    "What?f · open for a sec",
    "What?f · micro-oracle",
    "What?f · quick message",
  ],
  es: [
    "What?f · frase del día",
    "What?f · dos líneas para ti",
    "What?f · hoy va así",
    "What?f · abre un segundo",
    "What?f · micro-oráculo",
    "What?f · mensaje rápido",
  ],
  fr: [
    "What?f · phrase du jour",
    "What?f · deux lignes pour toi",
    "What?f · aujourd’hui, c’est comme ça",
    "What?f · ouvre une seconde",
    "What?f · micro-oracle",
    "What?f · message rapide",
  ],
  de: [
    "What?f · Satz des Tages",
    "What?f · zwei Zeilen für dich",
    "What?f · heute so",
    "What?f · kurz öffnen",
    "What?f · Mikro-Orakel",
    "What?f · kurze Nachricht",
  ],
};

/* ✅ Copy per lingua (IT = completa; altre lingue = set minimo ma funziona) */
const COPY = {
  it: {
    WHATIF_MORNING: WHATIF_MORNING_IT,
    WHATIF_EVENING: WHATIF_EVENING_IT,
    WTF_EVENING: WTF_EVENING_IT,
    WTF_POST_SBRONZA_MORNING: WTF_POST_SBRONZA_MORNING_IT,
    WTF_SUNDAY_EVENING: WTF_SUNDAY_EVENING_IT,
  },
  en: {
    WHATIF_MORNING: [
      "A short line to align your morning—open it.",
      "I left you something small but sharp for today—open this.",
      "Quick phrase, different angle—open it.",
      "Today starts better if you read this—open for a second.",
      "There’s a line that makes you want to move—open it.",
    ],
    WHATIF_EVENING: [
      "Close the day with one line that settles your mind—open it.",
      "Two lines to take the day off your shoulders—open this.",
      "Open this and go to sleep with less noise in your head.",
      "Tonight doesn’t need perfection—open this and let go better.",
      "Before you shut the brain off, read this—open it.",
    ],
    WTF_EVENING: [
      "Still awake? Open this and go to bed—tomorrow won’t spare you, what the f.",
      "Look at the time. Open this, then sleep—what the f.",
      "Stop the mental movies. Open this and we close the day crooked but honest, what the f.",
      "Open this, then switch everything off—your brain needs maintenance too, what the f.",
      "Last thing tonight: open this, then disappear under the blankets, what the f.",
    ],
    WTF_POST_SBRONZA_MORNING: [
      "Post-hangover mode: open this—let’s recover your dignity in installments, what the f.",
      "Saturday morning, face like “never again”: open this and reboot the brain, what the f.",
      "Eyes half-shut, soul in hangover: open this before you do damage, what the f.",
      "Open this, then water, coffee, dignity—in that order, what the f.",
      "If your mouth is cement and your memory has holes, open this—bar karma repair, what the f.",
    ],
    WTF_SUNDAY_EVENING: [
      "Sunday night: weekend’s dead and Monday is already knocking. Open this, what the f.",
      "Monday is around the corner like a creditor. Open this and brace, what the f.",
      "Sunday night emptiness? That’s Monday approaching. Open this, what the f.",
      "Tomorrow we go back to pretending to be adults. Open this, what the f.",
      "It’s Sunday night: tomorrow the carousel restarts. Open this, what the f.",
    ],
  },
  es: {
    WHATIF_MORNING: [
      "Una frase corta para alinearte esta mañana: ábrela.",
      "Te dejé algo pequeño pero potente para hoy: abre aquí.",
      "Frase breve, ángulo distinto: ábrela.",
      "Hoy empieza mejor si lees esto: abre un segundo.",
      "Hay una frase que te da ganas de moverte: ábrela.",
    ],
    WHATIF_EVENING: [
      "Cierra el día con una frase que te deja en paz: ábrela.",
      "Dos líneas para quitarte el día de encima: abre aquí.",
      "Abre esto y duerme con menos ruido en la cabeza.",
      "Esta noche no hace falta arreglarlo todo: abre esto y suelta mejor.",
      "Antes de apagar el cerebro, lee esto: te hace bien.",
    ],
    WTF_EVENING: [
      "¿Sigues despierto? Abre esto y a la cama, qué carajo.",
      "¿Viste la hora? Abre aquí y luego duerme, qué carajo.",
      "Basta de películas mentales: abre aquí y cerramos el día, qué carajo.",
      "Abre esto y apaga todo: hasta el cerebro necesita mantenimiento, qué carajo.",
      "Última cosa: abre esto y desaparece bajo las mantas, qué carajo.",
    ],
    WTF_POST_SBRONZA_MORNING: [
      "Modo resaca: abre aquí, qué carajo.",
      "Sábado por la mañana y cara de “nunca más”: abre esto, qué carajo.",
      "Ojos a medias y alma en resaca: abre esto, qué carajo.",
      "Abre esto y luego agua, café y dignidad: en ese orden, qué carajo.",
      "Si tienes la boca pastosa y la memoria con agujeros: abre aquí, qué carajo.",
    ],
    WTF_SUNDAY_EVENING: [
      "Domingo por la noche: el finde murió y el lunes ya llama. Abre aquí, qué carajo.",
      "El lunes está a la vuelta como un cobrador: abre aquí, qué carajo.",
      "¿Vacío de domingo? Es el lunes acercándose. Abre esto, qué carajo.",
      "Mañana toca fingir ser adulto otra vez: abre esto, qué carajo.",
      "Es domingo por la noche: mañana vuelve la rueda. Abre esto, qué carajo.",
    ],
  },
  fr: {
    WHATIF_MORNING: [
      "Une courte phrase pour te remettre d’équerre ce matin : ouvre-la.",
      "Je t’ai laissé un petit truc puissant pour aujourd’hui : ouvre ici.",
      "Phrase brève, angle différent : ouvre-la.",
      "Ta journée démarre mieux si tu lis ça : ouvre une seconde.",
      "Il y a une phrase qui te donne envie de bouger : ouvre-la.",
    ],
    WHATIF_EVENING: [
      "Ferme ta journée avec une phrase qui apaise : ouvre-la.",
      "Deux lignes pour enlever la journée des épaules : ouvre ici.",
      "Ouvre ça et dors avec moins de bruit dans la tête.",
      "Ce soir, pas besoin de tout réparer : ouvre ça et lâche mieux.",
      "Avant d’éteindre le cerveau, lis ça : ouvre.",
    ],
    WTF_EVENING: [
      "Encore debout ? Ouvre ça et au lit, bordel.",
      "T’as vu l’heure ? Ouvre ici et dors, bordel.",
      "Stop les films mentaux : ouvre ici, bordel.",
      "Ouvre ça puis éteins tout : ton cerveau aussi a besoin de maintenance, bordel.",
      "Dernière chose : ouvre ça et disparais sous la couette, bordel.",
    ],
    WTF_POST_SBRONZA_MORNING: [
      "Mode gueule de bois : ouvre ici, bordel.",
      "Samedi matin, tête de “plus jamais” : ouvre ça, bordel.",
      "Yeux mi-clos, âme en hangover : ouvre ça, bordel.",
      "Ouvre ça, puis eau, café, dignité : dans cet ordre, bordel.",
      "Bouche pâteuse, mémoire trouée : ouvre ici, bordel.",
    ],
    WTF_SUNDAY_EVENING: [
      "Dimanche soir : le week-end est mort et lundi frappe déjà. Ouvre ça, bordel.",
      "Lundi est au coin comme un créancier : ouvre ici, bordel.",
      "Le vide du dimanche ? C’est lundi qui approche. Ouvre ça, bordel.",
      "Demain on rejoue aux adultes : ouvre ça, bordel.",
      "C’est dimanche soir : demain ça recommence. Ouvre ça, bordel.",
    ],
  },
  de: {
    WHATIF_MORNING: [
      "Ein kurzer Satz, um dich heute Morgen auszurichten: öffne ihn.",
      "Klein, aber stark für heute: hier öffnen.",
      "Kurz, anderer Blickwinkel: öffne es.",
      "Der Tag startet besser, wenn du das liest: kurz öffnen.",
      "Da ist ein Satz, der dich in Bewegung bringt: öffne ihn.",
    ],
    WHATIF_EVENING: [
      "Schließe den Tag mit einem Satz, der dich beruhigt: öffne ihn.",
      "Zwei Zeilen, um den Tag abzulegen: hier öffnen.",
      "Öffne das und schlaf mit weniger Lärm im Kopf.",
      "Heute Abend musst du nicht alles fixen: öffne das und lass besser los.",
      "Bevor du den Kopf ausschaltest: lies das, öffne es.",
    ],
    WTF_EVENING: [
      "Noch wach? Öffne das und ab ins Bett—verdammt nochmal.",
      "Hast du die Uhr gesehen? Öffnen, dann schlafen—verdammt nochmal.",
      "Schluss mit Kopfkino: öffnen—verdammt nochmal.",
      "Öffne das, dann alles aus—auch dein Gehirn braucht Wartung, verdammt nochmal.",
      "Letztes Ding: öffnen und unter die Decke verschwinden—verdammt nochmal.",
    ],
    WTF_POST_SBRONZA_MORNING: [
      "Kater-Modus: öffnen—verdammt nochmal.",
      "Samstagmorgen, Gesicht wie „nie wieder“: öffnen—verdammt nochmal.",
      "Halbe Augen, Seele im Hangover: öffnen—verdammt nochmal.",
      "Öffnen, dann Wasser, Kaffee, Würde—in der Reihenfolge, verdammt nochmal.",
      "Mund wie Zement, Gedächtnis mit Löchern: öffnen—verdammt nochmal.",
    ],
    WTF_SUNDAY_EVENING: [
      "Sonntagabend: Wochenende tot, Montag klopft schon. Öffne das—verdammt nochmal.",
      "Montag steht um die Ecke wie ein Gläubiger: öffnen—verdammt nochmal.",
      "Sonntagabend-Leere? Das ist Montag im Anmarsch. Öffne das—verdammt nochmal.",
      "Morgen tun wir wieder so, als wären wir Erwachsene: öffnen—verdammt nochmal.",
      "Es ist Sonntagabend: morgen geht’s wieder los. Öffne das—verdammt nochmal.",
    ],
  },
};

/* ========= handler ========= */
export default async function handler(req, res) {
  // ✅ evita cache/304 (Vercel + browser + edge)
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const { slot = "morning", phase = "1", mood = "" } = req.query || {};

    const safeSlot = ["morning", "afternoon", "evening"].includes(String(slot))
      ? String(slot)
      : "morning";

    let safePhase = String(phase) === "2" ? "2" : "1";
    const safeMood = String(mood || "");

    const wd = weekdayRome(new Date()); // 0=Sun..6=Sat
    const isSunday = wd === 0;
    const isSaturday = wd === 6;

    const isMorning = safeSlot === "morning";
    const isEvening = safeSlot === "evening";

    // ✅ SABATO MATTINA = WTF post-sbronza
    const isSaturdayPostSbronza = isSaturday && isMorning;
    if (isSaturdayPostSbronza) safePhase = "2";

    // ✅ DOMENICA SERA = WTF cattiva
    const isSundayNightCattiva = isSunday && isEvening;
    if (isSundayNightCattiva) safePhase = "2";

    const day = ymdRome(new Date());
    const seedBase = `${day}|${safeSlot}|${safePhase}|${safeMood}`;

    // ✅ prende TUTTI i token (non solo 200)
    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .get();

    if (snap.empty) {
      return res.status(200).json({ ok: false, error: "no_tokens" });
    }

    // ✅ token + lingua dal doc
    const users = snap.docs.map((d) => {
      const data = d.data() || {};
      return {
        token: d.id,
        lang: normLang(data.lang || "it"),
      };
    });

    // ✅ raggruppa per lingua
    const byLang = {};
    for (const u of users) {
      if (!byLang[u.lang]) byLang[u.lang] = [];
      byLang[u.lang].push(u.token);
    }

    let totalSent = 0;
    let totalFailed = 0;

    // ✅ per ogni lingua → crea copy giusta + manda a chunk 500
    for (const langKey of Object.keys(byLang)) {
      const lang = normLang(langKey);
      const tokens = byLang[lang] || [];
      if (!tokens.length) continue;

      const signalPath =
        `/fifth.html?signal=${safeSlot}&phase=${safePhase}` +
        (safeMood ? `&mood=${encodeURIComponent(safeMood)}` : "") +
        `&lang=${encodeURIComponent(lang)}`;

      const CLICK_LINK = `${APP_ORIGIN}${signalPath}`;

      const title =
        pickDaily(PUSH_TITLES[lang] || PUSH_TITLES.it, `${seedBase}|${lang}|title`) ||
        "What?f · frase del giorno";

      let body = ({
        it: "La tua frase di oggi è pronta 🔔",
        en: "Your daily message is ready 🔔",
        es: "Tu frase de hoy está lista 🔔",
        fr: "Ta phrase du jour est prête 🔔",
        de: "Deine tägliche Nachricht ist bereit 🔔",
      }[lang] || "La tua frase di oggi è pronta 🔔");

      const lib = COPY[lang] || COPY.it;

      if (safePhase === "1") {
        body =
          safeSlot === "evening"
            ? pickDaily(lib.WHATIF_EVENING, `${seedBase}|${lang}`)
            : pickDaily(lib.WHATIF_MORNING, `${seedBase}|${lang}`);
      } else {
        if (isSundayNightCattiva) {
          body = pickDaily(lib.WTF_SUNDAY_EVENING, `${seedBase}|${lang}`);
        } else if (isSaturdayPostSbronza) {
          body = pickDaily(lib.WTF_POST_SBRONZA_MORNING, `${seedBase}|${lang}`);
        } else {
          body = pickDaily(lib.WTF_EVENING, `${seedBase}|${lang}`);
        }
      }

      // ✅ MODIFICA CHIAVE: non solo data-message
      //    (così la notifica è “visibile” su web/android)
      const baseMessage = {
        notification: { title, body },
        data: {
          title,
          body,
          src: "signal",
          slot: safeSlot,
          phase: safePhase,
          mood: safeMood,
          lang,
          url: signalPath,
          click_action: CLICK_LINK,
        },
        webpush: {
          headers: { Urgency: "high" },
          notification: {
            title,
            body,
            data: { url: CLICK_LINK },
          },
          fcmOptions: { link: CLICK_LINK },
        },
        android: { priority: "high" },
      };

      const chunks = chunk(tokens, 500);
      for (const c of chunks) {
        const resp = await admin.messaging().sendEachForMulticast({
          ...baseMessage,
          tokens: c,
        });
        totalSent += resp.successCount || 0;
        totalFailed += resp.failureCount || 0;
      }
    }

    return res.status(200).json({
      ok: true,
      day,
      slot: safeSlot,
      phase: safePhase,
      sent: totalSent,
      failed: totalFailed,
      totalTokens: users.length,
      langs: Object.fromEntries(Object.entries(byLang).map(([k, v]) => [k, v.length])),
    });
  } catch (err) {
    console.error("push error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
