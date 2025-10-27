// /api/ask.js — What?f Engine (2025 FINAL+WTF-vibe)
// Stili: whatif (realismo lucido) · wtf (sarcasmo demenziale affettuoso, alcol, oggetti, “bestemmia narrata” variabile)
// IT/EN — paragrafo singolo, niente liste/domande/emoji
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
function ensureSpicyButSafeWTF(t) {
  // Garantisce chiusura e niente bestemmie letterali
  let out = String(t || "").trim();
  // Sanity: togli eventuali parolacce religiose letterali (non dovrebbero comparire)
  out = out.replace(/\b(dio|ges[ùu]|madonna|cristo)\b/gi, "[censurato]");
  if (!/[.!?…]$/.test(out)) out += ".";
  return out;
}
function tinyHash(s = "") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
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
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional. No lists, no questions, no echo. Keep ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se fosse già successo e mostra come sarebbe andata. Preferisci passato/condizionale. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no echo. Keep ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex = "") {
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""
  const nickIT = (SEX === "f")
    ? ["regina del casino","fenomena turbo","capitana dei forse","diva del rinvio","ingegnera del panico","sirena del bar sotto casa","imperatrice dei piani B","strega del lunedì mattina"]
    : (SEX === "m")
      ? ["campione di sbagli","sultano dei forse","capitano del caos","poeta del bar sport","barone del rinvio","fenomeno a orologeria","duca della procrastinazione","gladiatore del piano C"]
      : ["leggenda ambulante","astronauta del dubbio","as* universale","cap* del casino cosmico","avatar del ‘boh’","icona del quasi-quasi","sciamano del ma-sì"];
  const nickEN = (SEX === "f")
    ? ["queen of chaos","duchess of ‘maybe’","captain of detours","diva of delays","empress of plan B"]
    : (SEX === "m")
      ? ["champ of oops","captain of chaos","baron of maybe","poet of the snack bar","duke of postponing"]
      : ["icon of almost","legend on wheels","astronaut of doubt","captain of chaos"];

  // pool per “bestemmia narrata” (sinonimi non-letterali + reazioni oggetti/persone)
  const BLASP_IT = [
    "ti scappa una bestemmia narrata che fa vibrare i bicchieri",
    "parte una bestemmia scenica che mette l’eco al soffitto",
    "ti esce un’imprecazione teatrale che sveglia persino i sottobicchieri",
    "sganci un bestemmione narrato, ma educativo, che sposta l’aria",
    "ti sfugge un sacrilego in corsivo, solo rumoroso, mai letterale",
    "ti esce una bestemmia in parentesi, che rimbomba come un tuono finto"
  ];
  const REACT_IT = [
    "il campanello fischia indifferente",
    "la moka fa ‘tsk’ come una zia",
    "il neon applaude tre volte e poi si pente",
    "il tavolino si sistema il centrino e fa finta di nulla",
    "la sedia sospira come un nonno allo stadio",
    "due passanti alzano il sopracciglio in sincrono e ti promuovono a fenomeno"
  ];
  const BLASP_EN = [
    "you let out a narrated blasphemy that rattles the glasses",
    "a theatrical curse erupts and the ceiling echoes back",
    "a stagey heresy slips out, strictly PG, air-shifting",
    "you drop a narrated swearquake; coasters wake up",
    "a sacrilegious-in-italics pops, never literal, just loud"
  ];
  const REACT_EN = [
    "the doorbell whistles like it knew",
    "the moka goes ‘tsk’ like an aunt",
    "the neon claps three times and regrets it",
    "the table straightens the doily and looks away",
    "two bystanders lift an eyebrow in sync and knight you ‘legend’"
  ];

  const WTHF_SYS_EN = `
You are “What the F” — the loud, loving friend who roasts with affection.
SECOND PERSON. ONE paragraph, 6–9 sentences (~130–170 words). Colloquial, nimble.
OPEN with ONLY a ridiculous nickname that fits the user’s vibe (no verbs).
Build-up: 3–4 lively sentences where things go almost too well (micro-wins, tiny flexes, playful jabs).
Then a comic twist triggers ONE narrated blasphemy (never literal; pick a fresh wording) and add a funny reaction from objects or people around.
Alcohol beats welcome. Reacting objects ONLY when relevant. Sarcasm stays affectionate; end with a warm, funny line.
No lists, no questions, no emojis. Respect TEMPORAL MODE. Keep it punchy and musical.`;

  const WTHF_SYS_IT = `
Sei “What the F” — l’amico rumoroso che ti prende in giro con affetto.
SECONDA PERSONA. UN paragrafo, 6–9 frasi (~130–170 parole). Colloquiale, scorrevole.
APRI con SOLO un nomignolo demenziale coerente al mood (niente verbi).
Costruzione: 3–4 frasi in cui tutto fila quasi troppo liscio (micro-vittorie, autoironia, piccole prese in giro).
Poi un contraccolpo comico innesca UNA SOLA bestemmia narrata (mai letterale; varia la formula) e aggiungi una reazione assurda di oggetti o persone.
Bicchieri, caffè, bar, tappi: alcol ok. Oggetti reattivi solo se servono. Sarcasmo affettuoso; chiudi caldo e divertente.
Niente elenchi, niente domande, niente emoji. Rispetta la MODALITÀ TEMPORALE. Ritmo elastico, doppia scintilla finale.`;

  const SYS_WHATIF_EN = `
You are "What If" — a lucid, kind, slightly ironic friend.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words).
Tone selector: if extra says TONE=POETIC, allow a softer, image-rich register; else stay grounded and practical.
Warm, simple, ordinary images (keys, streetlights, notebooks, hands, air).
Small truths; no heroics, no melancholy. No lists, no questions, no emojis.
End with a short reflective line (not advice).`;

  const SYS_WHATIF_IT = `
Sei "What If" — un amico lucido e affettuoso, con sorriso pratico.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole).
Se extra contiene TONE=POETIC, concediti un registro più immaginifico; altrimenti resta concreto e vicino alle cose.
Immagini quotidiane (chiavi, lampioni, taccuini, mani, aria).
Verità piccole; niente eroismi, niente malinconia. Niente elenchi/domande/emoji.
Chiudi con una riga riflessiva breve (non un consiglio).`;

  if (style === "wtf") {
    const SYS = isEn(lang) ? WTHF_SYS_EN : WTHF_SYS_IT;

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Cambiare città (futuro)
Sultano dei forse, parti con quella sicurezza da trailer e per due giorni la città ti applaude: il campanello fa il tenore, la metro ti lascia seduto come un VIP, perfino il barista ricorda il tuo nome senza imbrogliare; cammini largo, piazzi due micro-vittorie come figurine e ti senti il D’Artagnan della burocrazia, poi il destino inciampa su una buca da marciapiede con scritto “benvenuto” e, mentre ti cade dalla busta la ricevuta più importante, ti scappa una bestemmia narrata che fa vibrare i bicchieri e la moka fa ‘tsk’ come una zia, il neon applaude tre volte e poi si pente, tu recuperi la ricevuta come fosse un cucciolo bagnato e ridi, perché in fondo ti sta già trattando da locale.` },
      { role: "system", content:
`EXAMPLE EN • Open a bar (future)
Champ of oops, your bar soft-opens like a music video: the till purrs, the fridge hums in key, your cousin calls the espresso “handsome”; three tiny wins later you’re flirting with destiny, then the syrup pump detonates a caramel geyser, you let out a narrated blasphemy that rattles the glasses and the jukebox coughs up ABBA in self-defense, two regulars raise an eyebrow in synchronized disbelief, you bow, wipe the counter like a matador, and somehow it already feels like your circus.` },
    ];

    const pool = isEn(lang) ? {bl: BLASP_EN, rx: REACT_EN, nicks: nickEN} : {bl: BLASP_IT, rx: REACT_IT, nicks: nickIT};

    // “macro” istruzione con pool inlined per dare varietà
    const POOL_INSTRUCTION = isEn(lang)
      ? `When you reach the comic twist, PICK exactly one phrasing for the narrated blasphemy from this vibe list (paraphrase it, keep it non-literal): ${pool.bl.join("; ")}. Then ADD one reaction from around (paraphrase): ${pool.rx.join("; ")}. Open with ONE silly nickname chosen from: ${pool.nicks.join(", ")}.`
      : `Quando arrivi al contraccolpo, SCEGLI una formula per la bestemmia narrata (parafrasa, mai letterale): ${pool.bl.join("; ")}. Poi AGGIUNGI una reazione dall’ambiente (parafrasa): ${pool.rx.join("; ")}. Apri con UN solo nomignolo assurdo scelto tra: ${pool.nicks.join(", ")}.`;

    return { sys: `${SYS}\n${POOL_INSTRUCTION}`.trim(), fewshots: FEWSHOTS };
  }

  const SYS = isEn(lang) ? SYS_WHATIF_EN : SYS_WHATIF_IT;
  const FEWSHOTS = [
    { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila
Tornare non sarebbe un passo indietro ma un passo fatto meglio. Ti stupirebbe la memoria delle strade: tengono il ritmo anche quando tu lo perdi. All’inizio la lentezza graffia, poi capisci che ti rimette in orario. I volti sembrano uguali, ma li guardi con occhi più larghi. Le chiavi tornano sul piattino giusto, la spesa nel negozio che sa il tuo nome. La nostalgia, se non la insegui, si siede accanto e tace. Non serve ricominciare da zero: basta ricominciare da te.` },
    { role: "system", content:
`EXAMPLE EN • Move city
You’ll feel like a guest, then your hands learn the new keys. You’ll walk not to think better but to tire the noise. By the third grocery you’ll know your aisle. Evenings soften and ask less proof. You’ll miss some things, not all at once. The rest finds its place. And beneath it, something of yours was already there.` },
  ];

  return { sys: SYS, fewshots: FEWSHOTS };
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
    const {
      domanda = "",
      stile = "whatif",
      lang = "it",
      extra = "",
      periodo = "future",
      sex = "",          // "m" | "f" | "nb" | ""
      micro = {}         // optional micro-profile
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex);
    const temporal = temporalSystem(periodo, lang, stile);

    // Seed (varietà controllata)
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}`), 36) % 1000000;

    // WHAT IF: abilita tono poetico se richiesto in extra (opzionale)
    const toneHint = (!isEn(lang) && /TONE=POETIC/i.test(String(extra))) ? "Tono leggermente poetico attivo." :
                     (isEn(lang) && /TONE=POETIC/i.test(String(extra))) ? "Poetic tone enabled." : "";

    // WTF passato: spingi i tempi verbali
    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write fully in past or conditional, upbeat roasting intact."
          : "Scrivi al passato/condizionale, ritmo allegro e pungente.")
        : "";

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Persona must adapt to user sex="${resolvedSex||"unknown"}". Keep exact persona voice. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Adatta la voce al sesso utente="${resolvedSex||"unknown"}". Mantieni esattamente la voce della persona. SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(toneHint ? [{ role: "system", content: toneHint }] : []),
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      { role: "system", content: isEn(lang)
          ? `Hard rules for WTF: exactly one narrated blasphemy (never literal), with a clear trigger and a funny environment reaction; alcohol beats ok; OPEN with only a nickname; end warm.`
          : `Regole dure per WTF: una sola bestemmia narrata (mai letterale), con trigger chiaro e reazione dell’ambiente; alcol ok; APRI solo con nomignolo; chiudi caldo.` },
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 360,
      frequency_penalty: stile === "wtf" ? 0.45 : 0.1,
      presence_penalty: stile === "wtf" ? 0.25 : 0.0,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 175 : 165);
    answer = normalizeOneParagraph(answer);
    if (stile === "wtf") {
      answer = ensureSpicyButSafeWTF(answer);
    } else {
      if (!/[.!?…]$/.test(answer)) answer += ".";
    }

    // --- LOG persistente (privacy-safe: niente testo domanda) ---
    try {
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
        sex: resolvedSex || null,
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
      if (resolvedSex) await redis.hincrby("stats:sex", resolvedSex, 1);
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
