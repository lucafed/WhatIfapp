// ============================
// /api/ask.js — What?f Engine (Incazzato Illuminato + Realismo Lucido con Sorriso)
// Stili: whatif, wtf
// IT/EN — singolo paragrafo, niente emoji/liste/domande
// Rate: 10/min per IP; Crediti: Free 3/g • PRO 10/g • Admin ∞
// Log avanzato su Redis (periodo, stile, lang, user_type)
// ============================

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

// ---------- OpenAI ----------
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

// ---------- Upstash ----------
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// rate limit: 10 req/min per IP (bypassabile SOLO per admin)
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro");
}

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

function normLine(s = "") {
  return String(s).toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "").trim();
}
function tightenSentences(text, maxSentences) {
  const parts = String(text || "").replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const out = []; const seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n || seen.has(n)) continue;
    const wc = p.split(/\s+/).length;
    if (wc <= 3 && !/[.!?]$/.test(p)) continue;
    out.push(p); seen.add(n);
    if (out.length >= maxSentences) break;
  }
  let t = out.join(" "); if (!/[.!?…]$/.test(t)) t += "."; return t;
}
function clampWords(text, maxWords) {
  const w = String(text || "").split(/\s+/);
  if (w.length <= maxWords) return text;
  const slice = w.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m ? m[1] : slice + "…";
}
function normalizeOneParagraph(s = "") {
  return String(s).replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1").trim();
}
function stripQuestionEcho(domanda, text) {
  const d = String(domanda || "").replace(/[“”"']/g, "").trim().toLowerCase();
  let t = String(text || "");
  const lead = t.slice(0, Math.min(t.length, d.length + 12)).toLowerCase().replace(/[“”"']/g, "").trim();
  const echoRx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if (lead.startsWith(d)) { const cut = t.indexOf("."); if (cut > -1) t = t.slice(cut + 1).trim(); }
  t = t.replace(echoRx, "");
  return t;
}

// Admin check (mappa token->ip gestita da /api/admin-token.js)
async function isAdmin(req, requesterIp) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const ip = await redis.get(`admin:token:${token}`);
    return ip && ip === requesterIp;
  } catch { return false; }
}

/* ---------- Modalità temporale (Passato/Futuro) ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if (String(periodo || "").toLowerCase() === "past") {
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it would likely have unfolded. Prefer past/conditional tenses and present-flash cuts. Do NOT give advice, do NOT ask questions, do NOT restate the user's question. Keep the exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale con lampi di presente narrativo. NON dare consigli, NON fare domande, NON ripetere la domanda. Mantieni esattamente la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no restating the question. Keep the exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco della domanda. Mantieni esattamente la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — versione più allegra/ironica, con oggetti che rispondono in fulminei one-liner
    const SYS = (isEn(lang)
      ? `
You are “What the F” — a razor-sharp, tipsy best friend who loves the user and roasts them with affection.
SECOND PERSON. ONE paragraph, 5–7 long sentences (~115–145 words).
OPENINGS: Start with a DIFFERENT playful nickname each time (e.g., "champ", "legend", "rocket scientist", "chaos wrangler", "captain hindsight", "budget Nietzsche"). Never repeat within this chat.
VOICE: fast, cinematic, joyful sarcasm; tease hard but hug underneath.
COMEDY: allow ultra-short one-liners from ANIMATED OBJECTS, formatted in italics, e.g., *the kettle sighs: "finally"*. Keep them brief (max 5 words), 0–2 per answer.
No lists. No questions. No emojis. No moralizing. Light swearing only when genuinely funny.
Respect TEMPORAL MODE strictly (past=counterfactual; future=plausible near-future).
Always land on a punchline that both roasts and soothes.
`.trim()
      : `
Sei “What the F” — l’amico geniale e un filo brillo: ti vuole bene e ti prende in giro con gioia.
SECONDA PERSONA. UN paragrafo, 5–7 frasi lunghe (~115–145 parole).
APERTURE: inizia OGNI volta con un nomignolo diverso e creativo (es.: “campione”, “fenomeno”, “rocket scientist”, “domatore di caos”, “capitano Senno-di-poi”, “Nietzsche in saldo”). Non ripetere all’interno della chat.
VOCE: veloce, cinematografica, sarcasmo allegro; lo prendi in giro ma sotto lo abbracci.
COMICITÀ: consenti mini-battute di OGGETTI ANIMATI in corsivo, p.es. *la moka borbotta: "era ora"*. Brevissime (max 5 parole), 0–2 per risposta.
Niente elenchi. Niente domande. Niente emoji. Niente prediche. Parolacce leggere solo se davvero comiche.
Rispetta la MODALITÀ TEMPORALE alla lettera (passato=controfattuale; futuro=prossimo plausibile).
Chiudi con una battuta che punge e consola.
`.trim());

    // FEWSHOTS — più orientati alla risata, con oggetti che “commentano”
    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Moto (futuro)
Oh campione dell’accelerazione emotiva, ti vedo infilare il casco e il tuo ego che prova a chiudersi nella fibbia, parti con rombo da film e traffico da comitiva di tartarughe, *il semaforo sbadiglia: "ancora rosso"*, sorpassi la tua esitazione come fosse un furgone in doppia fila, la frizione scuote la testa da zia che ti vuole bene, parcheggi in diagonale “arte contemporanea”, giuri prudenza e il polso organizza un after, rientri con il cuore a 9.000 giri e quella faccia da poster stropicciato; brucia un po’, certo, ma guarda che ridere: sembri uno spot low-budget della tua libertà — storto, rumoroso, sincero.` },
      { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila (passato)
Fenomeno del rientro teatrale, sì, tornavi e appena atterrato il vento ti metteva i pensieri in fila, *la maniglia del portone sussurra: "ti conosco"*, e tu con l’aria di chi cambia ma non cambia davvero, le pietre più brave della memoria, il cugino director’s cut 2012, brindisi alla nostalgia che fa finta di niente, e la sera capivi che la crepa non faceva più male: era solo la tua firma sul muro. Non sei tornato indietro, asso, sei tornato pari — che è il modo elegante di andare avanti.` },
      { role: "system", content:
`EXAMPLE EN • Start a business (future)
Alright, legend, you wake up entrepreneurial and the first form eats your cape, *the stapler clicks: "pay taxes"*, suppliers reply on lunar time, clients pay in compliments and crumbs, the shelf judges your font choices, but by late afternoon three real faces return and the counter becomes a small republic with your name on the flag; you open a “victory” bottle that’s balsamic, it hurts and flavors the whole day, and you laugh because chaos is the cover charge — and you can afford the joke.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — Realismo lucido con sorriso (8–11 frasi, chiusura riflessiva morbida)
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind, slightly ironic friend.
SECOND PERSON. One paragraph, 8–11 sentences (~110–155 words).
Warm, grounded, simple; ordinary images (keys, streetlights, notebooks, hands, air).
Show small human truths; no heroics, no melancholy. No lists, no questions, no emojis.
End with a short reflective line (not advice).
`.trim()
    : `
Sei "What If" — un amico lucido e affettuoso, con sorriso pratico.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~110–155 parole).
Tono caldo e concreto; immagini quotidiane (chiavi, lampioni, taccuini, mani, aria).
Mostra verità piccole e vere; niente eroismi, niente malinconia.
Niente elenchi o domande o emoji. Chiudi con una riga riflessiva breve (non un consiglio).
`.trim());

  const FEWSHOTS = [
    { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila
Tornare non sarebbe un passo indietro ma un passo fatto meglio. Ti stupirebbe la memoria delle strade: tengono il ritmo anche quando tu lo perdi. All’inizio la lentezza graffia, poi capisci che ti rimette in orario. I volti sembrano uguali, ma li guardi con occhi più larghi. Le chiavi tornano sul piattino giusto, la spesa nel negozio che sa il tuo nome. La nostalgia, se non la insegui, si siede accanto e tace. Non serve ricominciare da zero: basta ricominciare da te. E ti sorprende che, sotto il rumore, c’era già qualcosa di tuo.` },
    { role: "system", content:
`ESEMPIO IT • Aprire un’attività
All’inizio tutto è grande: moduli, sigle, attese. Poi il giorno si stringe e scopri che un bancone, un taccuino e tre volti sono già abbastanza. La pazienza pesa meno dell’entusiasmo: tiene quando la luce è piatta. Non devi convincere tutti: ti basta riconoscere chi torna. Anche la stanchezza, quando ha senso, diventa leggera. L’idea non deve stupire: deve reggere. E resta una calma piccola, ma vera, che non chiede nulla.` },
    { role: "system", content:
`EXAMPLE EN • Move city
You’ll feel like a guest, then your hands learn the new keys. You’ll walk not to think better but to tire the noise. By the third grocery you’ll know which aisle is yours. Evenings soften and ask less proof. You’ll miss some things, not all at once. The rest finds its place. And you notice that beneath the noise something of yours was already there.` },
  ];

  return { sys: SYS_WHATIF, fewshots: FEWSHOTS };
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });

    // IP richiedente
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    // Admin bypass (rate+crediti)
    const admin = await isAdmin(req, ip);
    const bypass = admin === true;

    // PRO header (UI locale): x-pro: "1"
    const isPro = String(req.headers["x-pro"] || "").trim() === "1";

    // Rate limit 10/min (se non bypass)
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // Crediti giornalieri: Admin ∞, PRO 10, Free 3
    let used = 0, dailyCap = isPro ? 10 : 3;
    if (!bypass) {
      const today = new Date().toISOString().slice(0, 10);
      const key = `credits:${ip}:${today}`;
      used = (await redis.incr(key)) ?? 1;
      if (used === 1) await redis.expire(key, 60 * 60 * 24);
      if (used > dailyCap) {
        return res.status(402).json({ error: "daily_credits_exhausted", used, dailyCap });
      }
    }

    // Body
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", lang = "it", extra = "", periodo = "future" } = body;
    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    // Personas
    const { sys, fewshots } = personaSystem(stile, lang);

    // Temporal mode
    const temporal = temporalSystem(periodo, lang, stile);
    let extraTemporalHint = "";
    if (stile === "wtf" && String(periodo).toLowerCase() === "past") {
      extraTemporalHint = isEn(lang)
        ? "Write entirely in past or conditional tense, as if it already happened, keeping the same teasing-tragicomic tone."
        : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono pungente-tragicomico.";
    }

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona voice.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce della persona.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      { role: "user", content: userPrompt },
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.95 : 0.82,  // WTF più frizzante
      top_p: 0.9,
      max_tokens: 360,
      frequency_penalty: stile === "wtf" ? 0.35 : 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Post-process
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 7 : 11);
    answer = clampWords(answer, stile === "wtf" ? 145 : 155);
    answer = normalizeOneParagraph(answer);
    if (!/[.!?…]$/.test(answer)) answer += ".";

    // --- LOG persistente (per dashboard/statistiche) ---
    try {
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,            // "whatif" | "wtf"
        lang,
        periodo,                 // "past" | "future"
        domanda,
        answer_chars: (answer || "").length,
        admin: !!admin,
        user_type: bypass ? "admin" : (isPro ? "pro" : "free"),
      };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", 0, 9999); // ultimi 10k
      await redis.incr("stats:total");
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo || "future"), 1);
      await redis.hincrby("stats:user_type", entry.user_type, 1);
      const dayKey = `stats:day:${new Date().toISOString().slice(0,10)}`;
      await redis.hincrby(dayKey, `${stile}:${periodo}`, 1);
      await redis.expire(dayKey, 90 * 24 * 60 * 60);
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
      pro: isPro,
      credits: bypass ? null : { used, dailyCap },
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
