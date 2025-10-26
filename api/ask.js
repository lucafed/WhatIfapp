// /api/ask.js — What?f Engine (2025 FINAL, refined)
// Stili: whatif (realismo lucido) · wtf (roast affettuoso con imprecazione narrata)
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
    .split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter(Boolean);
  const out = []; const seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n || seen.has(n)) continue;
    const wc = p.split(/\s+/).length;
    if (wc <= 3 && !/[.!?…]$/.test(p)) continue;
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
  const m = slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m ? m[1] : slice + "…";
}
function normalizeOneParagraph(s = "") {
  return String(s).replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?…])/g, "$1").trim();
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
function tinyHash(s = "") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// ---------- Italian micro-fix & sentence utils ----------
function microFixIt(text){
  return String(text||"")
    .replace(/\bLe la\b/gi, "La")
    .replace(/\bIl la\b/gi, "La")
    .replace(/\bLo la\b/gi, "La")
    .replace(/\bLe il\b/gi, "Il")
    .replace(/\bUn uno\b/gi, "Un")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?…])/g, "$1")
    .trim();
}
function splitSentences(t){
  return String(t||"").replace(/\n+/g," ")
    .split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(Boolean);
}
function joinSentences(arr){
  let t = arr.join(" ");
  if(!/[.!?…]$/.test(t)) t += ".";
  return t;
}

// ---------- Lexicon shake (WhatIf, leggero) ----------
function varyLexiconWhatIf(t, lang="it"){
  let out = String(t||"");
  const swapsIt = [
    [/chiavi\b/gi, () => ["chiavi","chiavini","mazzo di chiavi","metallo che suona"].at(seedPick(4))],
    [/strade\b/gi, () => ["strade","vie","vicoli","asfalti"].at(seedPick(4))],
    [/silenzio\b/gi, () => ["silenzio","quieto","quiete","aria che tace"].at(seedPick(4))],
  ];
  const swapsEn = [
    [/keys\b/gi, () => ["keys","keyring","metal jingles","house keys"].at(seedPick(4))],
    [/streets\b/gi, () => ["streets","lanes","side roads","alleys"].at(seedPick(4))],
    [/quiet\b/gi, () => ["quiet","stillness","soft hush","air that listens"].at(seedPick(4))],
  ];
  const apply = (lang.startsWith("en")? swapsEn : swapsIt);
  for(const [rx,fn] of apply){ out = out.replace(rx, fn); }
  return out;
}
function seedPick(n){ return Math.floor(Math.random()*n); }

// ---------- Event-driven narrated imprecation ----------
const IMPRECATION_BANK = {
  it: {
    parcheggio: [
      "ti scappa una bestemmia teatrale che mette in riga pure i cerchioni",
      "spari una bestemmia d’arte che fa vibrare gli specchietti",
      "ti parte un’imprecazione epica e il sensore parcheggio si zittisce",
    ],
    cucina: [
      "sbotti con una bestemmia d’operetta e la moka fa finta di niente",
      "ti esce una bestemmia corale: il cucchiaino si mette sull’attenti",
      "sganci una bestemmia in stereo e il caffè decide di perdonarti",
    ],
    burocrazia: [
      "ti scappa una bestemmia con timbro in rilievo e lo sportello sospira",
      "esplode una bestemmia da ufficio e la penna smette di incepparsi",
      "butti lì una bestemmia scenica e il numerino avanza di tre",
    ],
    trasporti: [
      "ti scappa una bestemmia di stazione e il semaforo prende paura",
      "parti con una bestemmia da capolinea: l’autobus si vergogna del ritardo",
      "spari una bestemmia con eco e la palina si rabbuia",
    ],
    cantiere: [
      "ti esce una bestemmia da cantiere e la betoniera abbassa il volume",
      "scatta una bestemmia panoramica e la rete arancione applaude",
      "lanci una bestemmia storica e il cartello 'fine lavori' arrossisce",
    ],
    strada: [
      "ti scappa una bestemmia barocca che mette sull’attenti i lampioni",
      "ti parte una bestemmia lirica e i piccioni cambiano corsia",
      "sbotti con una bestemmia d’annata e il vento porta via il fumo",
    ],
  },
  en: {
    parking: [
      "you let out a theatrical curse that straightens the hubcaps",
      "a museum-grade curse bursts out and the sensors go quiet",
      "you drop an operatic curse and the curb pretends it didn’t see",
    ],
    kitchen: [
      "you fire off a kitchen-table curse and the moka plays dead",
      "a stereo curse escapes you and the spoon salutes",
      "you unload an epic curse and the coffee decides to forgive you",
    ],
    paperwork: [
      "a stamped, office-grade curse escapes you and the counter sighs",
      "you drop a scenic curse and the queue jumps two numbers",
      "you let out a bureaucratic curse and the pen finally writes",
    ],
    transit: [
      "you launch a terminal-level curse and the light turns shy",
      "a platform curse erupts and the bus feels guilty",
      "you bark an echoing curse and the stop sign looks away",
    ],
    site: [
      "you release a hard-hat curse and the mixer lowers the volume",
      "a panoramic curse pops out and the orange net applauds",
      "you throw a historic curse and the 'end of works' sign blushes",
    ],
    street: [
      "you burst out with a baroque curse and the streetlights stand still",
      "a lyrical curse slips out and the pigeons switch lanes",
      "you spill a vintage curse and the wind takes the smoke away",
    ],
  }
};
function detectTrigger(domanda, text, lang="it"){
  const t = (domanda + " " + text).toLowerCase();
  const mapIt = [
    ["parcheggio", /(parchegg|posteggi|striscia|retromarcia)/],
    ["cucina", /(moka|caff[eè]|cucchiain|fornello|cucina)/],
    ["burocrazia", /(burocrazi|sportello|modulo|timbro|ufficio|anagrafe)/],
    ["trasporti", /(autobus|bus|palina|semaforo|tram|ritardo)/],
    ["cantiere", /(cantiere|betoniera|reti arancioni|fine lavori)/],
    ["strada", /(strada|marciapiede|lampioni|vento|piccioni)/],
  ];
  const mapEn = [
    ["parking", /(park|parking|curb|spot|reverse)/],
    ["kitchen", /(moka|coffee|kitchen|spoon|stove)/],
    ["paperwork", /(bureaucr|paper|office|stamp|counter|form)/],
    ["transit", /(bus|tram|traffic|light|stop)/],
    ["site", /(site|construction|mixer|fence)/],
    ["street", /(street|sidewalk|lamp|wind|pigeon)/],
  ];
  const bank = lang.startsWith("en") ? mapEn : mapIt;
  for(const [k,rx] of bank){ if(rx.test(t)) return k; }
  return lang.startsWith("en") ? "street" : "strada";
}
function pickFrom(arr, seed=0){ return arr[(seed + Math.floor(Math.random()*arr.length)) % arr.length]; }

function ensureSpicyButSafeWTF(t, lang, seed=0, domanda="") {
  let out = String(t || "").trim();
  if (!out) return out;
  const already = /(bestemmi|curse|maledizion)/i.test(out);
  if (already) return microFixIt(out);

  const trigger = detectTrigger(domanda, out, (lang||"it").toLowerCase());
  const localeKey = (String(lang).toLowerCase().startsWith("en")) ? "en" : "it";
  const bank = IMPRECATION_BANK[localeKey][trigger] || IMPRECATION_BANK[localeKey].street;
  const line = pickFrom(bank, seed % 991);
  if (!line) return microFixIt(out);

  const sents = splitSentences(out);
  const keyRx = localeKey === "en"
    ? (trigger==="parking"?/park|spot|curb|reverse/i:
       trigger==="kitchen"?/moka|coffee|kitchen|spoon|stove/i:
       trigger==="paperwork"?/paper|bureaucr|office|stamp|counter|form/i:
       trigger==="transit"?/bus|tram|traffic|light|stop/i:
       trigger==="site"?/site|construction|mixer|fence/i:
       /street|lane|lamp|wind|pigeon/i)
    : (trigger==="parcheggio"?/parchegg|posteggi|striscia|retromarcia/i:
       trigger==="cucina"?/moka|cucchiain|caff[èe]|fornello|cucina/i:
       trigger==="burocrazia"?/burocrazi|sportello|modulo|timbro|ufficio|anagrafe/i:
       trigger==="trasporti"?/autobus|bus|palina|semaforo|tram|ritardo/i:
       trigger==="cantiere"?/cantiere|betoniera|reti arancioni|fine lavori/i:
       /strada|marciapiede|lampion|vento|piccion/i);

  let injected = false;
  for (let i=0;i<sents.length;i++){
    if (keyRx.test(sents[i])){
      sents.splice(i+1, 0, line.charAt(0).toUpperCase() + line.slice(1));
      injected = true; break;
    }
  }
  if (!injected) sents.splice(1,0, line.charAt(0).toUpperCase() + line.slice(1));
  return microFixIt(joinSentences(sents));
}

// ---------- Copy-edit pass (IT/EN) ----------
async function polishPass(rawText, { lang="it", stile="whatif" } = {}){
  const sys = (String(lang).toLowerCase().startsWith("en"))
    ? `You are a professional copy editor. Perfect grammar, syntax and cohesion. Keep meaning, tone and length. Single paragraph. Do NOT add or remove the narrated curse if present.`
    : `Sei un correttore di bozze professionista. Sistema grammatica, sintassi e coesione. Mantieni senso, tono e lunghezza. Un solo paragrafo. Non aggiungere né togliere l’imprecazione narrata se presente.`;
  const user = (String(lang).toLowerCase().startsWith("en"))
    ? `Polish this ${stile.toUpperCase()} paragraph without changing style: ${rawText}`
    : `Rifinisci questo paragrafo ${stile.toUpperCase()} senza cambiare stile: ${rawText}`;

  try{
    const resp = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.1,
      max_tokens: 420,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user }
      ]
    });
    const txt = resp?.choices?.[0]?.message?.content?.trim() || rawText;
    return microFixIt(normalizeOneParagraph(txt));
  }catch{
    return microFixIt(normalizeOneParagraph(rawText));
  }
}

/* ---------- Modalità temporale ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if (String(periodo || "").toLowerCase() === "past") {
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional, with quick present flashes. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale con lampi di presente. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex = "") {
  const SEX = String(sex || "").toLowerCase();
  const genderNickIT = (SEX === "f")
    ? ["regina del casino","fenomena","asso di briscola","capitana del caos","sirena urbana","signora dei forse","rockstar con tacchi comodi"]
    : (SEX === "m")
      ? ["campione","fenomeno","asso","capitano del caos","rockstar con le tasche vuote","poeta del bar"]
      : ["leggenda","fenomen*","asso universale","cap* del caos","rockstar del forse","astronauta del dubbio"];
  const genderNickEN = (SEX === "f")
    ? ["queen of chaos","ace of ‘maybe’","legend in sneakers","captain of detours"]
    : (SEX === "m")
      ? ["champ","legend","captain of chaos","rocket scientist of ‘maybe’"]
      : ["icon","legend","ace","captain of chaos"];

  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — loud, loving, a bit annoyed but on my side.
SECOND PERSON. ONE paragraph, 6–8 sentences (125–165 words). Colloquial, tight rhythm.
OPEN with ONLY a rotating nickname (no verbs).
Keep earned jabs; “reacting objects” only if they support the gag.
Exactly ONE narrated curse must burst from a concrete event (parking, moka, paperwork, bus, site, street). Never literal slurs; action line, no brackets.
No lists, no questions, no emojis. Respect TEMPORAL MODE. Close warm and funny.
Nicknames (EN): ${genderNickEN.join(", ")}.
`.trim()
      : `
Sei “What the F” — rumoroso, affettuoso, un filo scocciato ma dalla sua parte.
SECONDA PERSONA. UN paragrafo, 6–8 frasi (125–165 parole). Colloquiale, ritmo serrato.
Apertura SOLO con un nomignolo (senza verbi). Stoccate motivate; oggetti che reagiscono solo se servono.
Una sola bestemmia narrata deve scoppiare da un evento (parcheggio, moka, burocrazia, autobus, cantiere, strada). Mai letterale, riga d’azione, senza parentesi.
Niente liste, domande o emoji. Rispetta la MODALITÀ TEMPORALE. Chiudi caldo e divertente.
Nomignoli (IT): ${genderNickIT.join(", ")}.
`.trim());

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila (futuro)
Pellegrino del ritorno, scendi con la valigia che scricchiola dignità e il vento ti sistema i pensieri come sedie al bar; il marciapiede riconosce il tuo passo e ti fa lo sconto sul dubbio, al bancone la tazzina ti guarda “di nuovo?” e tu, che fai il duro da metropoli, ti addolcisci come grappino alle undici, sbagli parcheggio con la sicurezza di uno che vuole soffrire bene, ti scappa una bestemmia teatrale che fa tremare i bicchieri e il lampione finge di non sentire, poi due facce ti chiamano per nome e scopri che non stai tornando indietro ma tornando intero, con le crepe lucidate a festa, e ridi perché la città punge solo per controllare se sei vivo.` },
      { role: "system", content:
`ESEMPIO IT • Mettersi in proprio (futuro)
Capitano del caos, arrivi col piano che sembra un tovagliolo firmato e l’Excel ti guarda come un cameriere stanco; il registratore di cassa tossisce come scooter in salita ma tre facce tornano e la vetrina si raddrizza da sola, stappi la bottiglia “buona” ed è aceto balsamico: brucia onesto, benedice l’errore, ti scappa una bestemmia che scuote i bicchieri e il bancone risponde “anche oggi imprenditore”, alla sera conti spicci e sorrisi e capisci che non stai vincendo il mondo, stai reggendo te — che è molto più redditizio del previsto.` },
      { role: "system", content:
`EXAMPLE EN • Moving city (future)
Champ, you arrive like a limited series pilot and the buzzer rolls its eyes; the fridge hums “good luck” while the streetlights do wardrobe tests, you walk too far just to tire the nerves and a tiny beer forgives your accent, you clip the curb and you let out a theatrical curse that rattles the glasses, the mailbox pretends it didn’t hear, by grocery three you find your aisle and your pace — you’re not conquering a city, you’re landing your life.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind friend.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words).
Warm, grounded, everyday images (keys, streetlights, notebooks, hands).
Small truthful lines; no heroics, no melancholy. No lists, no questions, no emojis.
End with a short reflective line (not advice).
`.trim()
    : `
Sei "What If" — un amico lucido e affettuoso.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole).
Immagini quotidiane (chiavi, lampioni, taccuini, mani).
Verità piccole e vere; niente eroismi, niente malinconia.
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
    const {
      domanda = "",
      stile = "whatif",
      lang = "it",
      extra = "",
      periodo = "future",
      sex = "",
      micro = {}
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex);
    const temporal = temporalSystem(periodo, lang, stile);

    // Deterministic seed
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}`), 36) % 1000000;

    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in past or conditional, as if it already happened, keeping the upbeat roasting tone."
          : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono allegro e pungente.")
        : "";

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Persona must adapt to user sex="${resolvedSex||"unknown"}". Keep the exact persona voice. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Adatta la voce al sesso utente="${resolvedSex||"unknown"}". Mantieni esattamente la voce della persona. SEED INTERNO: ${seedNum}.`;

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
      max_tokens: 360,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: stile === "wtf" ? 0.2 : 0.0,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);

    if (stile === "wtf") {
      answer = ensureSpicyButSafeWTF(answer, lang, seedNum, domanda);
    } else {
      answer = varyLexiconWhatIf(answer, lang.toLowerCase());
      if (!/[.!?…]$/.test(answer)) answer += ".";
    }

    // Copy-edit pass (pulizia grammaticale/sintattica)
    answer = await polishPass(answer, { lang, stile });

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
