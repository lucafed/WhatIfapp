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

/* ========= copy notifiche (ROTANTI) ========= */
const PUSH_TITLES = [
  "What?f · frase del giorno",
  "What?f · due righe per te",
  "What?f · oggi si gira così",
  "What?f · apri un secondo",
  "What?f · micro-oracolo",
  "What?f · messaggio rapido",
];

const WHATIF_MORNING = [
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

const WHATIF_EVENING = [
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

const WTF_EVENING = [
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

const WTF_POST_SBRONZA_MORNING = [
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
const WTF_SUNDAY_EVENING = [
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

/* ========= handler ========= */
export default async function handler(req, res) {
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

    const signalPath =
      `/fifth.html?signal=${safeSlot}&phase=${safePhase}` +
      (safeMood ? `&mood=${encodeURIComponent(safeMood)}` : "");

    const CLICK_LINK = `${APP_ORIGIN}${signalPath}`;

    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();

    if (snap.empty) {
      return res.status(200).json({ ok: false, error: "no_tokens" });
    }

    const tokens = snap.docs.map((d) => d.id);

    // 🔁 Seed giornaliero (Roma) + slot + phase → rotazione 1/giorno per mattina e 1/giorno per sera
    const day = ymdRome(new Date());
    const seedBase = `${day}|${safeSlot}|${safePhase}|${safeMood}`;

    const title =
      pickDaily(PUSH_TITLES, `${seedBase}|title`) ||
      "What?f · frase del giorno";

    let body = "La tua frase di oggi è pronta 🔔";

    if (safePhase === "1") {
      // WHAT IF
      body =
        safeSlot === "evening"
          ? pickDaily(WHATIF_EVENING, seedBase)
          : pickDaily(WHATIF_MORNING, seedBase);
    } else {
      // WTF
      if (isSundayNightCattiva) {
        body = pickDaily(WTF_SUNDAY_EVENING, seedBase);
      } else if (isSaturdayPostSbronza) {
        body = pickDaily(WTF_POST_SBRONZA_MORNING, seedBase);
      } else {
        body = pickDaily(WTF_EVENING, seedBase);
      }
    }

    const message = {
      data: {
        title,
        body,
        src: "signal",
        slot: safeSlot,
        phase: safePhase,
        mood: safeMood,
        url: signalPath,
        click_action: CLICK_LINK,
      },
      tokens,
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    return res.status(200).json({
      ok: true,
      day,
      slot: safeSlot,
      phase: safePhase,
      title,
      body,
      sent: resp.successCount,
      failed: resp.failureCount,
    });
  } catch (err) {
    console.error("push error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
