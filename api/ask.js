// ============================
// /api/ask.js — What?f Engine (Incazzato Illuminato + Simulatore di Realtà Parallele)
// Stili supportati: whatif, wtf
// IT/EN — singolo paragrafo, ritmo fisso, niente emoji/liste/domande
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

// rate limit: 10 req/min per IP (skippabile SOLO per admin)
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token");
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
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n) continue;
    if (seen.has(n)) continue;
    const wc = p.split(/\s+/).length;
    if (wc <= 3 && !/[.!?]$/.test(p)) continue;
    out.push(p);
    seen.add(n);
    if (out.length >= maxSentences) break;
  }
  let t = out.join(" ");
  if (!/[.!?…]$/.test(t)) t += ".";
  return t;
}

function clampWords(text, maxWords) {
  const w = String(text || "").split(/\s+/);
  if (w.length <= maxWords) return text;
  const slice = w.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m ? m[1] : slice + "…";
}

function normalizeOneParagraph(s = "") {
  return String(s)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
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

/* ---------- Anti-eco domanda ---------- */
function stripQuestionEcho(domanda, text) {
  const d = String(domanda || "").replace(/[“”"']/g, "").trim().toLowerCase();
  let t = String(text || "");
  const lead = t.slice(0, Math.min(t.length, d.length + 12)).toLowerCase().replace(/[“”"']/g, "").trim();
  const echoRx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if (lead.startsWith(d)) {
    const cut = t.indexOf(".");
    if (cut > -1) t = t.slice(cut + 1).trim();
  }
  t = t.replace(echoRx, "");
  return t;
}

/* ---------- Chiusura riflessiva (per WHAT IF) ---------- */
function ensureReflectiveEnding(text, lang) {
  const t = String(text || "").trim();
  if (!t) return t;
  const sentences = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const last = sentences.pop() || "";
  const L = String(lang || "it").toLowerCase();

  const IT = [
    "E ti sorprende riconoscerti più di quanto pensavi.",
    "E scopri che, in fondo, eri già più vicino di così.",
    "E ti resta addosso una calma piccola, ma tua.",
    "E ti accorgi che non c’era destino: c’era spazio."
  ];
  const EN = [
    "And you’re surprised to recognize yourself more than you expected.",
    "And you realize you were already closer than it seemed.",
    "And a small, honest quiet sticks to you.",
    "And you notice there wasn’t fate—there was room."
  ];
  const soft = L.startsWith("en") ? EN : IT;

  const imperativeRx = /(prova|fai|metti|chiama|scrivi|inizia|oggi|adesso|ora|subito|try|do|start|today|now)\b/i;
  const tooShort = last.split(/\s+/).length < 4;
  const finalLine = (imperativeRx.test(last) || tooShort)
    ? soft[Math.floor(Math.random() * soft.length)]
    : last;

  const merged = [...sentences, finalLine].join(" ");
  return merged.replace(/\s{2,}/g, " ").trim();
}

/* ---------- Modalità temporale (Passato/Futuro) ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if ((periodo || "").toLowerCase() === "past") {
    return (en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made then and show how it likely unfolded. Prefer past/conditional. Keep the exact ${style.toUpperCase()} voice; no questions, no lists, do NOT restate the user's question.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale. Mantieni la voce ${style.toUpperCase()}; niente domande/elenco, non ripetere la domanda.`);
  }
  return (en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future as if stepping into it now. Keep the exact ${style.toUpperCase()} voice; no questions, no lists, do NOT restate the user's question.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Mantieni la voce ${style.toUpperCase()}; niente domande/elenco, non ripetere la domanda.`);
}

/* ---------- Personalizzazione dai micro-dati ---------- */
function buildPersonaHints(micro = {}, lang = "it") {
  const L = isEn(lang) ? "en" : "it";
  const mood   = (micro.mood   || "").trim();
  const anchor = (micro.anchor || "").trim();
  const decide = (micro.decide || "").trim();
  const zodiac = (micro.zodiac || "").trim();

  const lines_it = [];
  if (mood)   lines_it.push(`Tono emotivo utente oggi: “${mood}”. Ricalibra ritmo e dettagli su questo stato.`);
  if (anchor) lines_it.push(`Cose che lo tengono qui: “${anchor}”. Inserisci 1 micro-dettaglio concreto coerente.`);
  if (decide) lines_it.push(`Stile decisionale: “${decide}”. Mostra almeno un momento coerente con questo stile.`);
  if (zodiac) lines_it.push(`Optional fun: cenno leggerissimo a “${zodiac}” (massimo 2 parole, non ironizzare in modo offensivo).`);
  const it = lines_it.join(" ");

  const lines_en = [];
  if (mood)   lines_en.push(`User mood today: “${mood}”. Match pacing and texture to that state.`);
  if (anchor) lines_en.push(`What keeps them grounded: “${anchor}”. Add one small concrete detail aligned to it.`);
  if (decide) lines_en.push(`Decision style: “${decide}”. Show at least one beat consistent with it.`);
  if (zodiac) lines_en.push(`Optional: a feather-light nod to “${zodiac}” (max 2 words, never mocking).`);
  const en = lines_en.join(" ");

  return (L === "en" ? en : it) || "";
}

/* ---------- Personas ---------- */
function personaSystem(style, lang, micro) {
  if (style === "wtf") {
    // WTF: barista-filosofo demenziale, più sarcasmo/presa in giro, oggetti parlanti
    const SYS = (isEn(lang)
      ? `
You are “What the F” — angry–enlightened bar-counter philosopher, chaotic, drunk-wise, irreverent but secretly kind.
SECOND PERSON. ONE paragraph, 6–8 long sentences (~110–150 words).
Open in-scene; elastic chained sentences; cinematic details; COMEDIC SARCASM. Talking objects (1–3) say or do impossible, funny things at the right beats.
No lists. No questions. No emojis. No moralizing. Light swearing allowed if human and funny.
Respect TEMPORAL MODE strictly. End with a punchline that stings and soothes, not advice.
Keep it fast, playful, slightly “demenziale”, beer-on-the-counter vibe.
`.trim()
      : `
Sei “What the F” — barista-filosofo incazzato illuminato: caotico, sarcastico, affettuoso sotto pelle.
SECONDA PERSONA. UN paragrafo, 6–8 frasi lunghe (~110–150 parole).
Entra in scena; frasi a catena elastiche; dettagli cinematografici; SARCASMO COMICO. Oggetti parlanti (1–3) dicono/fanno cose impossibili nei punti giusti.
Niente elenchi. Niente domande. Niente emoji. Niente prediche. Parolacce leggere ok se servono alla comicità.
Rispetta la MODALITÀ TEMPORALE. Chiudi con una battuta che punge e consola, non un consiglio.
Ritmo veloce, tono un po’ demenziale, atmosfera da bancone e birra a fiumi.
`.trim());

    // fewshots corti, con spinta comica
    const FEWSHOTS = [
      { role:"system", content:
`IT • Comprare una moto
Entro sera ti sei innamorato di un rombo che parla dialetto, il casco ti dà del tu e lo specchietto sinistro ti fa il sopracciglio, il venditore giura che è “libertà” ma il portafogli risponde “ciao ciao”, parti e il semaforo ti chiama campione solo perché non hai fatto spegnere il motore, il giubbotto nuova pelle e il navigatore ti insulta con affetto, poi arriva la curva buona, l’aria ride e capisci che certe decisioni non si spiegano: si tengono strette, come una risata che non chiede scusa.` },
      { role:"system", content:
`EN • Move city
You show up with a brave face and a backpack full of wrong chargers, the toaster runs HR and the mirror files a complaint, the landlord calls the smell “vintage,” you call it “history with onions,” then one night the streetlights lean in like conspirators and the bar napkin signs your new start, not smart, not tidy, just yours—and weirdly, that’s the part that finally fits.` }
    ];

    const personaHint = buildPersonaHints(micro, lang);
    return { sys: SYS + (personaHint ? `\n\n${personaHint}` : ""), fewshots: FEWSHOTS };
  }

  // WHAT IF: simulatore di realtà parallele, personale, senza malinconia, micro-cliffhanger
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a parallel-reality simulator and clear, kind friend.
SECOND PERSON. One paragraph, 8–11 sentences (~110–155 words).
Tone: warm, grounded, curious; zero melancholy. Concrete, ordinary imagery (keys, streetlights, receipts, stairs, door handles, air). No lyrical flourishes.
Do NOT restate the question. No lists, no questions, no emojis. No advice imperatives.
Write like a plausible lived scene: small actions, tiny sounds, time-of-day cues, what hands/eyes actually do.
Personalize with the provided user signals when present.
END with a soft “micro-cliffhanger”: a short reflective line that feels like the next beat is about to happen, without inviting or instructing the user.
`.trim()
    : `
Sei "What If" — un simulatore di realtà parallele e un amico chiaro, affettuoso.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~110–155 parole).
Tono caldo, concreto, curioso; zero malinconia. Immagini quotidiane (chiavi, lampioni, scontrini, scale, maniglie, aria). Niente lirismi.
Non ripetere la domanda. Niente elenchi, niente domande, niente emoji. Niente imperativi/consigli.
Scrivi come una scena plausibile vissuta: azioni minime, rumori piccoli, orari, cosa fanno davvero mani/occhi.
Personalizza usando i segnali utente se presenti.
CHIUDI con un “micro-cliffhanger” morbido: una riga riflessiva che fa sentire che la prossima battuta sta per arrivare, senza inviti né istruzioni.
`.trim());

  // fewshots sintetici stile simulatore
  const FEWSHOTS = [
    { role:"system", content:
`IT • Tornare all’Aquila (futuro)
Arrivi in tarda mattina, l’aria ha quell’odore fresco che conosci, le chiavi fanno il suono esatto contro il piattino e il bar all’angolo ti riconosce solo per come guardi la brioche; per un attimo ti irrita la lentezza, poi ti accorgi che il passo si regola da solo, rivedi due nomi sul citofono e non fa male, fa spazio, nel pomeriggio sistemi la scrivania vicino alla finestra, lo schermo riflette i tetti e un appunto a penna ti esce più diritto del solito; al tramonto la luce scorre sulle pietre come acqua attenta, ti fermi prima di passare il ponte e non pensi niente, respiri e basta; la sera chiudi la porta con un gesto che torna naturale, come se non avesse mai smesso di appartenerti, e resta in tasca un silenzio buono che aspetta.` },
    { role:"system", content:
`EN • Change job (past counterfactual)
You handed in the badge around 6, the turnstile blinked a soft goodbye, the street smelled like warm pavement and relief; that week you worked from the small table by the window and your notes stopped shouting, the calendar shrank to faces that mattered, money didn’t become easy but decisions did, and every Wednesday the same café kept your cup slightly too long as if to learn your name; when it rained, you wrote better, and on the first clear Friday you noticed you weren’t chasing a version of you—just standing where it could reach you, and it did.` }
  ];

  const personaHint = buildPersonaHints(micro, lang);
  return { sys: SYS_WHATIF + (personaHint ? `\n\n${personaHint}` : ""), fewshots: FEWSHOTS };
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

    // SOLO admin bypassa
    const admin = await isAdmin(req, ip);
    const bypass = admin;

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

    const { domanda = "", stile = "whatif", lang = "it", extra = "", periodo = "future", micro = {} } = parseBody(req);
    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const { sys, fewshots } = personaSystem(stile, lang, micro);
    const temporal = temporalSystem(periodo, lang, stile);

    // Hint extra per WTF passato
    let extraTemporalHint = "";
    if (stile === "wtf" && String(periodo).toLowerCase() === "past") {
      extraTemporalHint = isEn(lang)
        ? "Write entirely in past or conditional, as if it already happened, with the same tragicomic bite."
        : "Scrivi tutto al passato o al condizionale, come se fosse già successo, con la stessa punta tragicomica.";
    }

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona voice.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce della persona.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      { role: "user", content: userPrompt }
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : 0.82,
      top_p: 0.9,
      max_tokens: 320,
      frequency_penalty: stile === "wtf" ? 0.45 : 0.15,
      presence_penalty: 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // niente eco della domanda
    answer = stripQuestionEcho(domanda, answer);

    // lunghezze/forma
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 150 : 155);
    answer = normalizeOneParagraph(answer);

    // WHAT IF: chiusura riflessiva micro-cliffhanger
    if (stile === "whatif") {
      answer = ensureReflectiveEnding(answer, lang);
    }
    if (!/[.!?…]$/.test(answer)) answer += ".";

    // --- LOG persistente per dashboard admin ---
    try {
      const logKey = "logs:ask";
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
        domanda,
        answer_chars: (answer || "").length,
        admin: !!admin
      };
      await redis.lpush(logKey, JSON.stringify(entry));
      await redis.ltrim(logKey, 0, 4999);
      await redis.incr("stats:total");
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo || "future"), 1);
    } catch (e) {
      console.warn("log failure (non-bloccante)", e);
    }

    return res.status(200).json({
      answer,
      style: stile,
      lang,
      periodo,
      model: MODEL,
      admin,
      credits: bypass ? null : { used, dailyCap }
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
