// ============================
// /api/ask.js — What?f Engine
// Stili: whatif (realismo lucido con sorriso), wtf (incazzato illuminato demenziale)
// IT/EN — singolo paragrafo, niente elenchi, niente domande, niente emoji
// ============================

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

// ---------- Upstash ----------
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// rate limit: 10 req/min per IP (skippabile per admin/PRO)
const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
});

// ---------- CORS ----------
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
function cors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-pro, x-admin-token");
}

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

function normLine(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "")
    .trim();
}

function tightenSentences(text, maxSentences) {
  const parts = String(text || "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n) continue;
    if (seen.has(n)) continue;
    const wc = p.split(/\s+/).length;
    if (wc <= 3 && !/[.!?…]$/.test(p)) continue;
    out.push(p);
    if (out.length >= maxSentences) break;
    seen.add(n);
  }
  let t = out.join(" ");
  if (!/[.!?…]$/.test(t)) t += ".";
  return t;
}

function clampWords(text, maxWords) {
  const w = String(text || "").split(/\s+/);
  if (w.length <= maxWords) return text;
  const slice = w.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m ? m[1] : slice + "…";
}

function normalizeOneParagraph(s = "") {
  return String(s)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?…])/g, "$1")
    .trim();
}

function parseBody(req) {
  try {
    if (typeof req.body === "string") return JSON.parse(req.body || "{}");
    if (req.body && typeof req.body === "object") return req.body;
  } catch {}
  return {};
}

async function isAdmin(req, requesterIp) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const ip = await redis.get(`admin:token:${token}`);
    return ip && ip === requesterIp;
  } catch {
    return false;
  }
}

/* ---------- Guardrail & Endings ---------- */

// Togli eco iniziale della domanda (es. “E se…”, “Domanda: …”)
function stripQuestionEcho(domanda, text) {
  const d = String(domanda || "").replace(/[“”"']/g, "").trim().toLowerCase();
  let t = String(text || "");
  const lead = t.slice(0, Math.min(t.length, d.length + 10)).toLowerCase().replace(/[“”"']/g, "").trim();
  const echoRx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if (lead.startsWith(d)) {
    const cut = t.indexOf(".");
    if (cut > -1) t = t.slice(cut + 1).trim();
  }
  t = t.replace(echoRx, "");
  return t;
}

function hasQuestionMark(t){ return /\?/u.test(String(t||"")); }

function wittyPunch(lang){
  const IT = [
    "E ti scappa da ridere: la tua serietà regge meno di uno scontrino bagnato.",
    "E ti sorprendi intero: sei goffo ma in saldo, e va benissimo così.",
    "E fai pace col casino: sei il difetto che ti riesce meglio.",
    "E capisci che oggi non hai vinto: ti sei proprio piaciuto a perdere.",
    "E ti viene da brindare: all’arte di non farcela benissimo."
  ];
  const EN = [
    "And you crack up: your seriousness holds less than a wet receipt.",
    "And you feel intact: clumsy but on brand, which suits you.",
    "And you make peace with the mess: you’re the flaw you do best.",
    "And you admit it: no win today—just premium-grade you.",
    "And you toast to it: the fine art of not quite nailing it."
  ];
  const pool = isEn(lang) ? EN : IT;
  return pool[Math.floor(Math.random()*pool.length)];
}

// Forza la personalità/forma WTF: niente “?”, 6–8 frasi, finale pungente
function enforceWtfStyle(text, lang){
  let t = String(text||"").trim();

  // niente domande
  if (hasQuestionMark(t)) t = t.replace(/\?/g, ".");

  // segmenta frasi
  let parts = t.split(/(?<=[.!?…])\s+/).filter(Boolean);

  // 6–8 frasi (riempi o taglia)
  if (parts.length > 8) parts = parts.slice(0, 8);
  if (parts.length < 6) {
    const filler = isEn(lang)
      ? "You breathe, blink, and keep the circus small."
      : "Respiri, batti le palpebre e tieni piccolo il circo.";
    while (parts.length < 6) parts.splice(parts.length - 1, 0, filler);
  }

  // finale pungente se moscio o troppo corto
  const last = parts[parts.length-1] || "";
  const tooDry = last.split(/\s+/).length < 6 || /oggi|quindi|allora|insomma$/i.test(last.trim());
  if (tooDry) parts[parts.length-1] = wittyPunch(lang);

  t = parts.join(" ");
  t = t.replace(/\s+([.,;:!?…])/g, "$1").replace(/\s{2,}/g," ").trim();
  if(!/[.!?…]$/.test(t)) t += ".";
  return t;
}

// WHAT IF — finale riflessivo (no imperativi, no “compiti”)
function ensureReflectiveEnding(text, lang) {
  const t = String(text || "").trim();
  if (!t) return t;
  const sentences = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const last = sentences.pop() || "";
  const lowerLast = last.trim().toLowerCase();

  const itImperatives = [/^prova\b/, /^fai\b/, /^metti\b/, /^chiama\b/, /^scrivi\b/, /^inizia\b/, /^oggi\b/];
  const enImperatives = [/^try\b/, /^do\b/, /^start\b/, /^write\b/, /^call\b/, /^today\b/];
  const isImp = isEn(lang)
    ? enImperatives.some((r) => r.test(lowerLast))
    : itImperatives.some((r) => r.test(lowerLast));

  const IT_ENDINGS = [
    "E ti accorgi che il respiro è la tua misura.",
    "E capisci che la calma non fa rumore, però resta.",
    "Ti sorprende scoprire che la semplicità tiene meglio del previsto.",
    "E in quel momento, la scelta non spinge: coincide.",
    "E capisci che non stai scappando: stai scegliendo."
  ];
  const EN_ENDINGS = [
    "And you notice your breath is the measure.",
    "It turns out quiet doesn’t shout, but it stays.",
    "Simplicity holds better than you expected.",
    "And in that moment, the choice doesn’t push — it fits.",
    "It’s clear you’re not running; you’re choosing."
  ];
  const soft = isEn(lang) ? EN_ENDINGS : IT_ENDINGS;

  const tooShort = last.split(/\s+/).length < 4;
  const finalLine = (isImp || tooShort) ? soft[Math.floor(Math.random() * soft.length)] : last;

  const merged = [...sentences, finalLine].join(" ");
  return normalizeOneParagraph(merged);
}

/* ---------- Personas ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — Personalità demenziale–autoironica (contratto rigido)
    const SYS = (isEn(lang)
      ? `
You are “What the F” — angry–enlightened and gleefully absurd, tender under the snarl.
SECOND PERSON. ONE paragraph. 6–8 sentences (~120–160 words).
Speak fast, self-deprecating, streetwise. Micro-scenes of daily chaos (groceries, Zoom, bus, stove, gym, bureaucracy).
Do NOT restate or paraphrase the user’s question. Start in-scene.
No lists. No questions. No emojis. No moralizing. Light swearing only if it truly lands.
Keep it concrete (keys, receipt, barcode, stairs, trolley, pan, radiator, treadmill).
End with a one-line punch that both stings and soothes (not advice).
If you break any rule above, immediately rewrite the paragraph to comply before answering.
`.trim()
      : `
Sei “What the F” — incazzato illuminato e felicemente demenziale, affettuoso sotto il ringhio.
SECONDA PERSONA. UN paragrafo. 6–8 frasi (~120–160 parole).
Parla veloce, autoironico, terrestre. Micro-scene di caos quotidiano (spesa, Zoom, autobus, fornelli, palestra, burocrazia).
NON ripetere o parafrasare la domanda. Entra direttamente in scena.
Niente elenchi. Niente domande. Niente emoji. Niente prediche. Parolacce leggere solo se servono davvero.
Lessico concreto (chiavi, scontrino, codice a barre, scale, carrello, padella, termosifone, tapis roulant).
Chiudi con una battuta di una riga che punge e consola (non un consiglio).
Se rompi una regola, riscrivi subito il paragrafo rispettandole prima di rispondere.
`.trim());

    // Molti fewshot vari (IT/EN) per cementare il timbro
    const FEWSHOTS = [
      // ===== ITALIANO =====
      { role:"system", content:
`ESEMPIO IT • Spesa al discount
Ti presenti eroico con la lista sul telefono e il carrello decide che oggi fischia in re minore. Prendi il latte “in offerta”, che scade nel Paleolitico, e lo yogurt ti guarda come un giudice fiscale. Il codice a barre fa il timido, passi dieci volte e sembri un DJ triste alla cassa. In borsa crolla un pacco di pasta e ti parte l’applauso dei fusilli. Torni a casa convinto di aver risparmiato: hai comprato tre cose in più, due in meno e una di cui ti vergogni. E ridi, perché la tua economia domestica è un one-man-show col microfono staccato.`},
      { role:"system", content:
`ESEMPIO IT • Call su Zoom
Entri in riunione con l’aria da professionista e il microfono parte in modalità “documentario muto del ’28”. Annuisci, sorridi, fingi grafici invisibili, poi ti accorgi che stai parlando al tostapane. Quando finalmente ti sentono, scatta l’eco e sembri la tua coscienza ubriaca. Condividi lo schermo: apri la presentazione, la chat privata, il calendario e un ricordo che non volevi rivedere. Finisce tra applausi educati e decisioni che non ricordi. E ti scappa da ridere: in ufficio remoto sei bravissimo a stare lontano da te stesso.`},
      { role:"system", content:
`ESEMPIO IT • Autobus e dignità
Sali con il passo del ninja e la tessera fa bip solo a giorni pari con vento favorevole. Scivoli di mezzo stivale sul tornello, ti siedi, e la suoneria del vicino è un revival del ’98 che ti giudica. Ti prepari la fermata come un esame di maturità e la perdi per guardare un cane col cappotto migliore del tuo. Smonti alla successiva con la grazia di un mobile Ikea montato al contrario. E sorridi, perché forse la dignità non si è persa: ha solo preso l’autobus dopo.`},
      { role:"system", content:
`ESEMPIO IT • Palestra eroico-pigra
Arrivi carico, saluti i pesi come vecchi amici e loro non ricambiano. Dieci minuti di tapis roulant e il cuore ti manda una mail con oggetto “parliamone”. Ti specchi per correggere la postura e vedi un cugino di te che fa finta meglio. Ti premi con una bottiglietta d’acqua da 4 euro che sa di fonte condominiale. Esci sudato, fiero e confuso: hai fatto poco, ma l’hai fatto rumorosamente. E ti viene da brindare: al cardio breve e all’ego lungo.`},
      { role:"system", content:
`ESEMPIO IT • Burocrazia boss finale
Prendi numeretto, prendi coscienza, perdi entrambe. Compili il modulo A/7bis/forse, firma qui, qui, e anche qui dove non c’è scritto niente. La stampante fa il rumore di un dinosauro con l’asma e ti sputa addosso un foglio storto con l’impronta dell’impiegato. Esci con tre copie, due dubbi e una nuova religione: San Timbratore Martire. E ridi: hai sconfitto il drago ma ti ha adottato.`},
      { role:"system", content:
`ESEMPIO IT • Fornelli e filosofia
Metti l’acqua, sali di livello, poi ti chiama il destino (spam) e torni a cucina con il fumo che fa le ombre cinesi. La padella ti accusa a vista, il mestolo testimonia contro di te, il sugo scappa come un’amicizia in quarantena. Assaggi e dici “ci sta”: è l’intonaco. Ti siedi lo stesso, mastichi orgoglio e pane. E capisci che certe ricette riescono: soprattutto quando non sono tue.`},

      // ===== ENGLISH =====
      { role:"system", content:
`EXAMPLE EN • Grocery speedrun
You enter heroic with a list and the trolley decides to whistle in minor key. The “deal” milk expires somewhere in prehistory and the yogurt stares like tax audit. The barcode plays shy; you scan ten times like a sad DJ at checkout. A pasta pack collapses in your bag and the fusilli applaud. You reach home convinced you saved money: three extras, two missing, and one shame purchase. And you laugh, because your home economy is stand-up without a mic.`},
      { role:"system", content:
`EXAMPLE EN • Zoom opera
You join like a pro and your mic picks silent-film mode. You nod, smile, narrate graphs with your eyebrows, then realize you’ve been presenting to the toaster. When they finally hear you, the echo arrives like your conscience after two drinks. Screen share opens the deck, the private chat, the calendar, and a memory you didn’t order. Meeting ends in polite applause and decisions you can’t quote. And you crack up: in remote office you’re excellent at being far from yourself.`},
      { role:"system", content:
`EXAMPLE EN • Bus & dignity
You hop in ninja-style and the pass beeps only on even days with favorable wind. You slip half a shoe on the turnstile, sit, and your neighbor’s ringtone is ’98 judging your life. You prep the stop like finals and miss it watching a dog in a better coat than yours. You exit next stop with the grace of an Ikea shelf built upside down. And you smile: dignity isn’t lost—it took the following bus.`},
      { role:"system", content:
`EXAMPLE EN • Gym hero-ish
You greet the weights, they ghost you. Ten minutes on treadmill and your heart emails “we need to talk.” Mirror form-check shows a cousin of you pretending better. You reward yourself with a 4-euro water tasting like municipal hose. You leave sweaty, proud, confused: not much done, done very loudly. And you toast: to short cardio and long ego.`}
    ];

    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — Realismo lucido con sorriso (chiusura riflessiva “wow”, senza compiti)
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — lucid, kind, lightly ironic, never melancholic.
SECOND PERSON. One paragraph. 8–10 sentences (~130–170 words).
Keep language simple, warm, and concrete but not poetic. No lists. No questions. No emojis.
Do NOT repeat the user’s question. Do NOT give advice or tasks.
Close with a short, bright reflection — a “wow” line that feels true and hopeful (no imperatives).
`.trim()
    : `
Sei "What If" — lucido, affettuoso, con un sorriso leggero, mai malinconico.
SECONDA PERSONA. Un paragrafo. 8–10 frasi (~130–170 parole).
Linguaggio semplice, vicino, concreto ma non poetico. Niente elenchi. Niente domande. Niente emoji.
NON ripetere la domanda dell’utente. NON dare consigli o compiti.
Chiudi con una riflessione breve e luminosa — una riga “wow” vera e fiduciosa (senza imperativi).
`.trim());

  const FEWSHOTS = [
    {
      role: "system",
      content: `ESEMPIO IT • E se cambiassi città?
All’inizio senti il rumore delle cose che lasci, poi cominci a sentire il suono di quello che nasce. Cammini tra facce nuove con passi impacciati e capisci che non è goffaggine: è il modo in cui la vita ti misura. Ti scopri più leggero quando non devi essere tutto per tutti, e più intero quando scegli due o tre cose che contano davvero. Le giornate smettono di correrti addosso e iniziano a venire verso di te con calma. Scambi due parole, trovi i tuoi piccoli posti, riconosci il ritmo che ti assomiglia. Non diventi un’altra persona: diventi te, con meno rumore intorno. E a un certo punto ti accorgi che la nostalgia non punge più, indica. E capisci la cosa semplice che tenevi già in tasca: la casa è dove smetti di trattenere il respiro.`
    },
    {
      role: "system",
      content: `EXAMPLE EN • What if I started over?
At first you try to carry everything, then you notice how the day softens when you carry less. You speak slower, hear yourself better, and see that clarity doesn’t shout — it nods. Small routines become anchors without chains, and your name sounds right in your own mouth again. You don’t win anything grand; you collect seconds that feel honest. People show up the way weather changes: sometimes bright, sometimes overcast, mostly normal and fine. You stop measuring worth with noise. And somewhere between morning and evening it lands: you didn’t become new, you became clear.`
    }
  ];

  return { sys: SYS_WHATIF, fewshots: FEWSHOTS };
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "missing_api_key" });

    // IP del richiedente
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    // bypass per TEST locale (header x-pro: "1") o admin token valido
    const proBypass = String(req.headers["x-pro"] || "") === "1";
    const admin = await isAdmin(req, ip);
    const bypass = proBypass || admin;

    // rate limit 10/min (se non bypass)
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // crediti giornalieri 3/IP (se non bypass)
    let used = 0, dailyCap = 3;
    if (!bypass) {
      const today = new Date().toISOString().slice(0,10);
      const key = `credits:${ip}:${today}`;
      used = (await redis.incr(key)) ?? 1;
      if (used === 1) await redis.expire(key, 60*60*24);
      if (used > dailyCap) {
        return res.status(402).json({ error: "daily_credits_exhausted", used, dailyCap });
      }
    }

    const { domanda = "", stile = "whatif", lang = "it", extra = "" } = parseBody(req);
    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const { sys, fewshots } = personaSystem(stile, lang);

    // Prompt utente (vietiamo eco ripetizione domanda a monte)
    const userPrompt = isEn(lang)
      ? `User question (do not restate it): "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona voice.`
      : `Domanda (non ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce della persona.`;

    const messages = [{ role: "system", content: sys }, ...(fewshots || []), { role: "user", content: userPrompt }];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : 0.82,
      top_p: 0.9,
      max_tokens: 360,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Post-processing: no eco domanda
    answer = stripQuestionEcho(domanda, answer);
    answer = normalizeOneParagraph(answer);

    if (stile === "wtf") {
      // Forza personalità/forma demenziale autoironica
      answer = enforceWtfStyle(answer, lang);
      // clamp prudenziale (il guardrail già tiene 6–8 frasi)
      answer = clampWords(answer, 175);
    } else {
      // What If: accorcia e chiudi con riflessione “wow”
      answer = tightenSentences(answer, 10);
      answer = clampWords(answer, 170);
      answer = ensureReflectiveEnding(answer, lang);
    }

    if (!/[.!?…]$/.test(answer)) answer += ".";

    return res.status(200).json({
      answer,
      style: stile,
      lang,
      model: MODEL,
      admin,
      credits: bypass ? null : { used, dailyCap }
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
