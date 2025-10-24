// /api/ask.js — What?f Engine (2025)
// Stili: whatif (realismo lucido) · wtf (sarcasmo demenziale, sbronza poetica, doppia punchline)
// IT/EN — paragrafo singolo, niente emoji/liste/domande
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA contenuto della domanda (solo metadati + hash non reversibile)

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

// rate limit: 10 req/min per IP (bypass SOLO per admin)
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
// Doppia punchline per WTF: garantisce “— … — …” in chiusura
function ensureDoublePunchline(answer, lang) {
  let t = String(answer || "").trim();
  const ems = (t.match(/—/g) || []).length;
  if (ems >= 2) return t;
  const tail = isEn(lang)
    ? "holy chaos — keep going."
    : "madonna del caos — continua così.";
  if (!/[.!?…]$/.test(t)) t += ".";
  return `${t} — ${tail}`;
}

/* ---------- Admin check ---------- */
async function isAdmin(req, requesterIp) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const data = await redis.hgetall(`admin:token:${token}`); // { ip, ua }
    if (!data) return false;
    const LOCK_IP = String(process.env.ADMIN_LOCK_IP || "false").toLowerCase() === "true";
    if (LOCK_IP) {
      if (!data.ip) return false;
      return data.ip === requesterIp;
    }
    return true;
  } catch {
    return false;
  }
}

/* ---------- Modalità temporale ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if (String(periodo || "").toLowerCase() === "past") {
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional tenses and present-flash cuts. Do NOT give advice, do NOT ask questions, do NOT restate the user's question. Keep the exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale con lampi di presente narrativo. NON dare consigli, NON fare domande, NON ripetere la domanda. Mantieni esattamente la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no restating the question. Keep the exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco della domanda. Mantieni esattamente la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — a bar-warm, razor-tongued best friend who roasts with love.
SECOND PERSON. ONE paragraph, 6–8 long sentences (~110–140 words).
Open with a shoulder-smack + rotating nickname (“champ”, “genius”, “captain of chaos”, “rocket scientist”, “legend”, “philosopher in a helmet”).
Style: fast, cinematic, irreverent; everyday “thinking objects”; no dialogue.
Include 0–2 euphemistic, non-offensive “bar expletives” (e.g., “holy chaos”, “for crying out loud”, “good grief”), never slurs, never real blasphemy.
High variation: switch metaphors, nicknames, and images; avoid repeating openings or closers across outputs.
STRICT: no lists, no questions, no emojis, no moralizing. Respect TEMPORAL MODE.
END with **two ultra-short punchlines** separated by an em dash (—), e.g., “You’re chaos-proof — you’re home.”
`.trim()
      : `
Sei “What the F” — l’amico da bar, lingua affilata ma cuore caldo: ti prende in giro e ti vuole bene.
SECONDA PERSONA. UN paragrafo, 6–8 frasi lunghe (~110–140 parole).
Apri con pacca sulla spalla + nomignolo variabile (“campione”, “genio”, “capitano del caos”, “astronauta del dubbio”, “leggenda”, “filosofo col casco”…).
Stile: veloce, cinematografico, irriverente; oggetti che “pensano”; niente dialoghi.
Inserisci 0–2 imprecazioni teatrali/eufemistiche non offensive (es.: “porca miseria”, “mannaggia al coraggio”, “madonna santa del caos”), mai insulti, mai bestemmie reali.
Variazione alta: cambia metafore, soprannomi e immagini; evita di ripetere incipit o chiusure tra risposte.
RIGIDO: niente elenchi, niente domande, niente emoji, niente prediche. Rispetta la MODALITÀ TEMPORALE.
CHIUDI con **due battute telegrafiche** separate da un trattino lungo (—), es.: “Bruci piano — vinci meglio.”
`.trim());

    const FEWSHOTS = [
      // IT — futuro
      { role: "system", content:
`ESEMPIO IT • Cambiare città (futuro)
Oh campione delle mappe emotive, entri nella città nuova come trailer senza titolo, il citofono ti giudica in 8-bit e la porta sbadiglia “vediamo”, cammini troppo per stancare il rumore e la mente ti segue come un carrello storto, immagini il frigo firmare un patto di non aggressione mentre il lampione ti fa il provino da protagonista del quartiere, la sera abbassa i bassi e i vicini imparano il tuo passo, e quando appoggi le chiavi senti salire quel “porca miseria che pace storta” che profuma di inizio vero — niente fretta — niente scuse.` },
      // IT — passato
      { role: "system", content:
`ESEMPIO IT • Lasciare una relazione (passato)
Oh romanticone da discount, hai buttato il cuore nel differenziato e non sapevi se fosse umido o vetro, camminavi dentro una playlist curata da un frigorifero triste e il silenzio faceva stretching, ti mancavano le abitudini più della persona e le hai rimpiazzate con una pianta disonesta e una genziana che ti dava del tu, gli amici “tempo al tempo” ma il tempo era in ferie, e un giorno hai riso da solo al semaforo, madonna santa del caos, perché stavi meglio senza permesso — meno peso — più te.` },
      // EN — futuro
      { role: "system", content:
`EXAMPLE EN • Start a business (future)
Alright, captain of chaos, you show up bulletproof and the first form eats your cape, spreadsheets side-eye your optimism while the receipt printer coughs like a scooter, three real faces return and suddenly the idea holds where you hold, midnight uncorks a “victory” bottle suspiciously balsamic and honest — good grief, you laugh, re-price, breathe — still standing — still you.` },
      // IT — viaggio in furgone
      { role: "system", content:
`ESEMPIO IT • Mollare tutto e partire in furgone (futuro)
Oh navigatore dell’ansia allegra, carichi la moka come fosse un talismano e la radio bestemmia in fa minore perché perde la frequenza, l’asfalto ti toglie le bugie a 90 all’ora, il sole fa il barista e ti versa silenzi lunghi due dita, e quando ti fermi la notte ti abbraccia senza chiedere scontrini — mannaggia al coraggio, che bella trovata — vai così.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF (immutato)
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind, slightly ironic friend.
SECOND PERSON. One paragraph, 8–11 sentences (~110–155 words).
Warm, grounded, simple; ordinary images (keys, streetlights, notebooks, hands, air).
Show small human truths; no heroics, no melancholy. No lists, no questions, no emojis.
End with a short reflective line (not advice).
`.trim()
    : `
Sei "What If" — un amico lucido e affettuoso, col sorriso pratico.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~110–155 parole).
Tono caldo e concreto; immagini quotidiane (chiavi, lampioni, taccuini, mani, aria).
Mostra verità piccole e vere; niente eroismi, niente malinconia.
Niente elenchi o domande o emoji. Chiudi con una riga riflessiva breve (non un consiglio).
`.trim());

  const FEWSHOTS = [
    { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila
Tornare non sarebbe un passo indietro ma un passo fatto meglio. Ti stupirebbe la memoria delle strade: tengono il ritmo anche quando tu lo perdi. All’inizio la lentezza graffia, poi capisci che ti rimette in orario. I volti sembrano uguali, ma li guardi con occhi più larghi. Le chiavi tornano sul piattino giusto, la spesa nel negozio che sa il tuo nome. La nostalgia, se non la insegui, si siede accanto e tace. Non serve ricominciare da zero: basta ricominciare da te.` },
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

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang);
    const temporal = temporalSystem(periodo, lang, stile);
    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in past or conditional tense, as if it already happened, keeping the teasing tragicomic tone."
          : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono pungente-tragicomico.")
        : "";

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

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 320,
      frequency_penalty: stile === "wtf" ? 0.6 : 0.1,
      presence_penalty: 0.0,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 140 : 155);
    answer = normalizeOneParagraph(answer);
    if (stile === "wtf") {
      answer = ensureDoublePunchline(answer, lang);
    } else {
      if (!/[.!?…]$/.test(answer)) answer += ".";
    }

    // --- LOG persistente (privacy-safe: niente testo domanda) ---
    try {
      function tinyHash(s = "") {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        return (h >>> 0).toString(36);
      }
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
        domanda_len: String(domanda || "").length,
        domanda_hash: tinyHash(domanda || ""),
        answer_chars: (answer || "").length,
        admin: !!admin,
        user_type: bypass ? "admin" : (isPro ? "pro" : "free"),
      };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", 0, 9999);
      await redis.incr("stats:total");
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo || "future"), 1);
      await redis.hincrby("stats:user_type", entry.user_type, 1);
      const dayKey = `stats:day:${new Date().toISOString().slice(0, 10)}`;
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
