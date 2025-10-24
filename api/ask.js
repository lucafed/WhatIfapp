// /api/ask.js — What?f Engine (2025 • seed-variability, WTF turbo, metaphorical curses only)
// Stili: whatif (realismo lucido) · wtf (sarcasmo demenziale, oggetti viventi, doppia punchline)
// IT/EN — paragrafo singolo, niente emoji/liste/domande
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis: soli metadati + hash non reversibile della domanda (no contenuti in chiaro)

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

// tiny hash + seeded RNG (deterministico su domanda+stile+lang+periodo)
function tinyHash(s = "") { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) >>> 0; }
function seededRng(seedStr) {
  let s = tinyHash(seedStr) || 1;
  return () => { // xorshift32
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return (s % 1e9) / 1e9;
  };
}
function pickSeeded(arr, rnd) { return arr[Math.floor(rnd() * arr.length) % arr.length]; }

// WTF seeds (IT/EN): opener nickname, vibe, metaphoric-curse lines, closers
const SEEDS = {
  it: {
    nick: ["campione", "fenomeno", "capitano del caos", "astronauta del dubbio", "rockstar", "genio", "filosofo col casco", "tifoso del destino", "capo dei forse"],
    openerBeat: [
      "pacca sulla spalla e si parte",
      "ti raddrizzo il colletto e via",
      "ti aggancio come un carrello al supermercato e andiamo",
      "ti aspetto all’angolo col sorriso storto, poi gas",
      "ti illumino come un lampione stanco e ripartiamo"
    ],
    hangover: [
      "la testa fruscia come un neon difettoso ma tiene botta",
      "lo stomaco firma tregue con il caffè e fa finta di niente",
      "i pensieri camminano in infradito, rumorosi, ma arrivano",
      "il fegato batte il cinque all’acqua frizzante e si volta offeso"
    ],
    livingObjects: [
      "il citofono giudica in 8-bit",
      "la sedia applaude piano per non farsi notare",
      "il frigo ti fa il contratto a progetto: solo speranze",
      "il lampione ti promuove protagonista del marciapiede",
      "il portone alza un sopracciglio professionale",
      "il trolley ti fa causa per mobbing emotivo"
    ],
    metaCurses: [ // imprecazioni solo metaforiche (mai esplicite)
      "il destino inciampa e mormora in dialetto stretto",
      "la sorte sbatte il mignolo e impreca in burocratese",
      "l’universo fa spallucce e bestemmina in metafora agricola",
      "il caso starnutisce e manda tutti a quel paese in latino maccheronico",
      "il fato sussurra un’imprecazione d’archivio e timbra l’uscita"
    ],
    closersLeft: [
      "Sei oltre il rumore",
      "Stai in piedi anche da seduto",
      "Ti viene bene sembrare pronto",
      "Hai fatto pace col forse",
      "Hai imparato a ridere in corsivo"
    ],
    closersRight: [
      "resta così",
      "non strafare",
      "continua piano",
      "non spiegarlo",
      "portati avanti"
    ],
  },
  en: {
    nick: ["champ", "legend", "captain of chaos", "rocket scientist", "genius", "philosopher in a helmet", "boss of maybes"],
    openerBeat: [
      "shoulder-smack and go",
      "I straighten your collar and we roll",
      "I hook you like a wobbly cart and push",
      "I meet you at the corner with a crooked grin",
      "I light you up like a tired streetlight and we move"
    ],
    hangover: [
      "your head buzzes like a faulty neon but holds",
      "your stomach signs a truce with coffee and pretends",
      "thoughts walk in flip-flops, loud but arriving",
      "your liver high-fives sparkling water and looks offended"
    ],
    livingObjects: [
      "the buzzer judges in 8-bit",
      "the chair claps softly not to get caught",
      "the fridge drafts a freelance hope contract",
      "the streetlight casts you as lead of the block",
      "the door raises one professional eyebrow",
      "the trolley sues you for emotional bullying"
    ],
    metaCurses: [
      "fate trips and mutters in regional subtitles",
      "luck jams a pinky toe and swears in paperwork",
      "the universe shrugs and curses in agricultural metaphor",
      "chance sneezes and sends everyone to Latin detention",
      "destiny whispers an archival expletive and clocks out"
    ],
    closersLeft: [
      "You’re past the noise",
      "You can stand even sitting",
      "You make readiness look casual",
      "You made peace with maybe",
      "You learned to laugh in italics"
    ],
    closersRight: [
      "keep it that way",
      "don’t overdo it",
      "keep it slow",
      "don’t explain it",
      "get ahead of it"
    ],
  }
};

// costruisce prompt additivo per WTF con semi coerenti
function buildWtfAdditive(lang, domanda, periodo) {
  const L = isEn(lang) ? "en" : "it";
  const rnd = seededRng(`[whatif.wtf]|${domanda}|${lang}|${periodo}|v2`);
  const s = SEEDS[L];

  const nick = pickSeeded(s.nick, rnd);
  const beat = pickSeeded(s.openerBeat, rnd);
  const hang = pickSeeded(s.hangover, rnd);
  const obj1 = pickSeeded(s.livingObjects, rnd);
  const obj2 = pickSeeded(s.livingObjects, rnd);
  const meta = pickSeeded(s.metaCurses, rnd);
  const closerL = pickSeeded(s.closersLeft, rnd);
  const closerR = pickSeeded(s.closersRight, rnd);

  if (L === "it") {
    return `
USA QUESTI GANCHI (senza elenchi, fondili nel paragrafo):
- Apertura: pacca + nomignolo: “Oh ${nick}, ${beat}”.
- Micro-sbornia evocata: ${hang}.
- Oggetti viventi obbligatori: ${obj1}; ${obj2}.
- “Bestemmia” solo metaforica (no parolacce): ${meta}.
- CHIUSURA: doppia punchline con trattino lungo — “${closerL} — ${closerR}.”`.trim();
  }
  return `
MUST-WEAVE HOOKS (no lists, blend into prose):
- Opening: shoulder-smack + nickname: “Hey ${nick}, ${beat}.”
- Hangover hint: ${hang}.
- Living objects (mandatory): ${obj1}; ${obj2}.
- Metaphorical curse only (no explicit profanity): ${meta}.
- CLOSING: double punchline with em dash — “${closerL} — ${closerR}.”`.trim();
}

// ---------- Admin check ----------
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
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it would likely have unfolded. Prefer past/conditional tenses and present-flash cuts. Do NOT give advice, do NOT ask questions, do NOT restate the user's question. Keep the exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale con lampi di presente narrativo. NON dare consigli, NON fare domande, NON ripetere la domanda. Mantieni esattamente la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no restating the question. Keep the exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco della domanda. Mantieni esattamente la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, domanda, periodo) {
  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — a razor-tongued best friend who roasts with love.
SECOND PERSON. ONE paragraph, 6–8 long sentences (~120–165 words).
Open with a shoulder-smack + rotating nickname (“champ”, “genius”, “captain of chaos”, “legend”…).
Style: fast, cinematic, irreverent; playful “thinking objects” reacting to the user; no dialogue.
Use goofy, affectionate sarcasm; keep it human and warm under the joke.
Metaphorical curses ONLY (no explicit profanity), e.g., “fate trips and mutters in regional subtitles.”
STRICT: no lists, no questions, no emojis, no moralizing. Respect TEMPORAL MODE.
END with two ultra-short punchlines separated by an em dash (—), e.g., “You’re fine — you’re dangerous.”
`.trim()
      : `
Sei “What the F” — l’amico lingua-affilata che ti prende in giro ma ti vuole bene.
SECONDA PERSONA. UN paragrafo, 6–8 frasi lunghe (~120–165 parole).
Apri con pacca sulla spalla + nomignolo (“campione”, “genio”, “capitano del caos”, “leggenda”…).
Stile: veloce, cinematografico, irriverente; oggetti che “reagiscono” al tuo passaggio; niente dialoghi.
Sarcasmo demenziale ma affettuoso; sotto resta umano e caldo.
Imprecazioni SOLO metaforiche, mai esplicite (es.: “il destino inciampa e mormora in dialetto stretto”).
RIGIDO: niente elenchi, niente domande, niente emoji, niente prediche. Rispetta la MODALITÀ TEMPORALE.
CHIUDI con doppia punchline separata da — (trattino lungo).
`.trim());

    // Aggiunta seed-variability come istruzione di sistema
    const add = buildWtfAdditive(lang, domanda, periodo);

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Cambiare città (futuro)
Oh campione delle mappe emotive, entri nella città nuova come trailer di una serie senza titolo, il citofono ti giudica in 8-bit e la porta sbadiglia “vediamo”, cammini troppo per stancare il rumore e la mente ti segue come un carrello storto, il frigo firma una tregua con la speranza e il lampione ti mette in scena, la sera abbassa i bassi e i vicini imparano il tuo passo, il destino inciampa e mormora in dialetto stretto, e quando appoggi le chiavi capisci che non devi vincere niente: devi solo arrivare in orario alla tua vita — niente fretta — niente scuse.` },
      { role: "system", content:
`EXAMPLE EN • Start a business (future)
Alright, legend, you clock in bulletproof and the first form eats your cape, spreadsheets side-eye your optimism, the receipt printer coughs like a scooter, the chair claps softly at closing time, fate jams a pinky toe and swears in paperwork, three real faces return and the counter becomes a republic of names, midnight uncorks a suspiciously balsamic “victory” and you laugh honest — still standing — still you.` },
    ];

    return { sys: SYS + "\n\n" + add, fewshots: FEWSHOTS };
  }

  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind, slightly ironic friend.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words).
Warm, grounded, simple; ordinary images (keys, streetlights, notebooks, hands, air).
Show small human truths; no heroics, no melancholy. No lists, no questions, no emojis.
End with a short reflective line (not advice).
`.trim()
    : `
Sei "What If" — un amico lucido e affettuoso, col sorriso pratico.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole).
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
    const { domanda = "", stile = "whatif", lang = "it", extra = "", micro = {}, periodo = "future" } = body;
    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, domanda, periodo);
    const temporal = temporalSystem(periodo, lang, stile);
    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in past or conditional tense, as if it already happened, keeping the teasing tragicomic tone."
          : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono pungente-tragicomico.")
        : "";

    // micro-profile (se presente) in una riga poetica, senza renderlo elenco
    const microLine = (() => {
      const mood = micro?.mood ? String(micro.mood) : "";
      const anchor = micro?.anchor ? String(micro.anchor) : "";
      const decide = micro?.decide ? String(micro.decide) : "";
      const zodiac = micro?.zodiac ? String(micro.zodiac) : "";
      const L = isEn(lang);
      const bits = [mood, anchor, decide, zodiac].filter(Boolean).join(L ? "; " : "; ");
      if (!bits) return "";
      return L
        ? `Subtext for tone only (do NOT enumerate): today the user feels: ${bits}.`
        : `Sottotesto per il tono (NON farne elenco): oggi l’utente è: ${bits}.`;
    })();

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona voice.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce della persona.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(microLine ? [{ role: "system", content: microLine }] : []),
      ...(fewshots || []),
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.84,
      top_p: 0.92,
      max_tokens: 380,
      frequency_penalty: stile === "wtf" ? 0.55 : 0.1,
      presence_penalty: 0.0,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 165 : 160);
    answer = normalizeOneParagraph(answer);

    // Forza doppia punchline per WTF, con fallback em-dash se il modello manca
    function ensureDoublePunchline(answerText) {
      const t = String(answerText || "").trim();
      const ems = (t.match(/—/g) || []).length;
      if (ems >= 1 && /—[^—]{1,60}$/.test(t)) return t; // già chiuso a doppia idea
      // aggiunge chiusura seed-based coerente con lingua
      const L = isEn(lang) ? "en" : "it";
      const rnd = seededRng(`[closer]|${domanda}|${lang}|${stile}|${periodo}`);
      const s = SEEDS[L];
      const left = pickSeeded(s.closersLeft, rnd);
      const right = pickSeeded(s.closersRight, rnd);
      const base = /[.!?…]$/.test(t) ? t : t + ".";
      return `${base} — ${left} — ${right}.`;
    }
    if (stile === "wtf") answer = ensureDoublePunchline(answer);
    else if (!/[.!?…]$/.test(answer)) answer += ".";

    // --- LOG persistente (privacy-safe: niente testo domanda) ---
    try {
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
        domanda_len: String(domanda || "").length,
        domanda_hash: tinyHash(domanda || "").toString(36),
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
