// /api/ask.js — What?f Engine (2025 FINAL)
// Stili: whatif (realismo lucido) · wtf (sarcasmo demenziale affettuoso, alcol, oggetti, "bestemmia" narrata con sinonimi)
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
  // evita output vuoto e chiude bene; non inserire mai insulti religiosi letterali
  let out = String(t || "").trim();
  if (!/[.!?…]$/.test(out)) out += ".";
  return out;
}
function tinyHash(s = "") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
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

/* ---------- Modalità temporale (con grammatica) ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  const isPast = String(periodo || "").toLowerCase() === "past";
  if (en) {
    return isPast
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Write *as if it already happened* (past tense + conditional for reflections). Keep continuity; no lists/questions/emoji. Keep exact ${style.toUpperCase()} voice.`
      : `TEMPORAL MODE: FUTURE / PROSPECTIVE. Write *as if stepping into a near future now* (present→near-future, with some simple future). No lists/questions/emoji. Keep exact ${style.toUpperCase()} voice.`;
  }
  // IT
  return isPast
    ? `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Scrivi *come se fosse già successo* (passato + condizionale per riflessioni). Mantieni continuità; niente elenchi/domande/emoji. Voce ${style.toUpperCase()}.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Scrivi *come se entrassi adesso nel prossimo futuro* (presente → futuro prossimo, con qualche futuro semplice). Niente elenchi/domande/emoji. Voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex = "") {
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""
  // nomignoli demenziali e non ripetitivi
  const nickIT_f = [
    "contessa del forse","regina del rimando","sirena del ‘ci penso domani’",
    "granata di spritz","capitana del caos tenero","barista dell’anima in ciabatte",
    "zanzara della motivazione","duchessa del quasi"
  ];
  const nickIT_m = [
    "duca del forse","campione del rinvio creativo","poeta del bar col POS scarico",
    "capitano del casino buono","fenomeno del ‘vediamo’","barone della mezz’idea brillante",
    "sommelier delle scuse lucide","conte del ‘dopo l’aperitivo’"
  ];
  const nickIT_nb = [
    "leggenda del forse","icona del caos gentile","astronauta del dubbio effervescente",
    "asso del ‘poi’ luminoso","mostro sacro del ‘intanto beviamo’","orbita dei rimandi stellari",
    "mito del ‘tranqui domani’","mascotte del forse brillante"
  ];
  const genderNickIT = SEX === "f" ? nickIT_f : (SEX === "m" ? nickIT_m : nickIT_nb);

  const nickEN_f = [
    "queen of maybe","captain of soft chaos","duchess of later",
    "bar poet in sneakers","pilot of ‘we’ll see’","legend of sparkly detours"
  ];
  const nickEN_m = [
    "duke of maybe","captain of soft chaos","bar poet with a dashboard",
    "champ of ‘we’ll see’","lord of almost","legend of shiny detours"
  ];
  const nickEN_nb = [
    "icon of maybe","captain of soft chaos","legend of later",
    "ace of sparkly detours","orbit of gentle mess","myth of ‘we’ll see’"
  ];
  const genderNickEN = SEX === "f" ? nickEN_f : (SEX === "m" ? nickEN_m : nickEN_nb);

  // Aperture confidenziali (presa da bar) con nomignolo
  const openersIT = [
    "Ehi, oggi non scherzi, {nick}: entri col fiato da spritz e la faccia da decisioni.",
    "Oh guarda chi si presenta, {nick}: profumi di coraggio shakerato e dubbio con scorza.",
    "Calma, {nick}: il bar ha lucidato i bicchieri solo per vederti tentare la vita.",
    "Dai {nick}, il destino ha scaldato la moka: tu porta il ghiaccio.",
    "Oggi fai sul serio, {nick}: tazzina in piedi e coraggio frizzante, via."
  ];
  const openersEN = [
    "Hey, not kidding today, {nick}: decision-face and spritz-breath, nice combo.",
    "Look who showed up, {nick}: courage on the rocks with doubt for garnish.",
    "Easy, {nick}: the bar polished glasses just to watch you try life.",
    "Come on, {nick}; fate warmed the moka, you bring the ice.",
    "Serious mood, {nick}: upright espresso and fizzy courage, go."
  ];

  // Lessico esplosione (sinonimi + possibilità oggetti/bystander)
  const outburstLexIT = [
    "ti parte una bestemmia che fa tremare i bicchieri",
    "ti esce un’imprecazione col retrogusto di grappino e i cucchiaini applaudono",
    "ti scappa una maledizione teatrale e il lampione finge di tossire",
    "ti esplode un’invocazione poco catechistica e la moka guarda il soffitto",
    "il citofono lascia andare una bestemmia educata e il corrimano si copre gli occhi",
    "il registratore di cassa mormora una bestemmia buffa e lo scontrino si arriccia",
    "un passante sussurra una mezza bestemmia col sorriso e il marciapiede cambia argomento",
    "il semaforo molla una bestemmia strozzata e il vento alza le spalle"
  ].join(" • ");
  const outburstLexEN = [
    "you let out a church-unfriendly word that rattles the glasses",
    "a half-catechism-safe curse slips out and the counter clears its throat",
    "a theatrical malediction pops and the streetlight pretends to cough",
    "the buzzer blurts a forbidden mutter while the receipt curls from embarrassment",
    "the cash drawer mutters a spicy oath and the spoons applaud",
    "a passerby whispers a blasphemy-lite and the sidewalk changes topic"
  ].join(" • ");

  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — the loud, loving friend who roasts with affection.
SECOND PERSON. ONE paragraph, 7–9 sentences (~130–170 words). Simple, colloquial.
OPEN CONFIDENTIAL: start with a bar-like tease + a nickname woven in, then 2–3 lines of playful roast about the user’s vibe and question.
MID-SCENE OUTBURST: exactly one comic outburst embedded naturally after the build-up, never standalone and never at the very end. Rotate synonyms from this pool (pick ONE, vary often): ${outburstLexEN}.
Outburst may come from the user OR an object/bystander; let it be triggered by a tiny mishap (stain, alarm, crooked parking, hose burst, etc.).
Alcohol beats OK; “reacting objects” only when relevant; affectionate, upbeat; no moralizing.
STRICT: no lists, no questions, no emojis. Respect TEMPORAL MODE grammar (past counterfactual vs near-future). 
Nicknames (EN): ${genderNickEN.join(", ")}.
Openers (EN): ${openersEN.join(" | ")}.
SEED: vary imagery with the internal seed number.
`.trim()
      : `
Sei “What the F” — l’amico rumoroso, affettuoso e spietatamente tenero.
SECONDA PERSONA. UN paragrafo, 7–9 frasi (~130–170 parole). Linguaggio semplice e colloquiale.
APERTURA CONFIDENZIALE: inizia con presa da bar + nomignolo, poi 2–3 frasi di presa in giro affettuosa su vibe e domanda.
ESPLOSIONE A METÀ: inserisci una (UNA) esplosione comica *dentro* la scena, mai da sola e mai in chiusura. Ruota i sinonimi (scegline UNO) da: ${outburstLexIT}.
L’esplosione può venire da te oppure — a volte — da un oggetto o un passante; deve nascere da un piccolo disastro (macchia, allarme, parcheggio storto, tubo che salta, ecc.).
Alcol ok; “oggetti reattivi” solo se servono; tutto resta affettuoso.
RIGIDO: niente elenchi, niente domande, niente emoji. Rispetta la MODALITÀ TEMPORALE e la grammatica (passato controfattuale vs futuro prossimo).
Nomignoli (IT): ${genderNickIT.join(", ")}.
Aperture confidenziali (IT): ${openersIT.join(" | ")}.
SEED interno: varia immagini col numero seed.
`.trim());

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Rientro in città (futuro)
Ehi, oggi non scherzi, contessa del forse: entri con la valigia che fa scena e il marciapiede ti fa lo sconto nostalgia; il bar ti riconosce e la tazzina ti guarda “bene, accomodati”, tu fai il duro ma profumi di pizzetta delle quattro e dignità stirata, prendi fiato come chi sta per firmare con una penna rubata; al primo incrocio parcheggi con la sicurezza di chi vuole soffrire bene, tocchi il marciapiede con un bacio storto e ti parte una bestemmia che fa tremare i bicchieri mentre il lampione finge di chiamare l’avvocato, poi due facce ti salutano per nome e la porta di casa ti prende le misure, la lentezza ti mette il cappotto addosso e capisci che non stai tornando indietro ma intero.` },
      { role: "system", content:
`ESEMPIO IT • Aprire un bar (passato controfattuale)
Oh guarda chi si presentava, barone della mezz’idea brillante: arrivavi col business plan sul tovagliolo e il frigo fischiettava responsabilità; lucidavi il bancone come fosse curriculum, il primo caffè usciva in piedi e ti faceva l’applauso, poi la lavastoviglie faceva teatro e bagnava platea e corridoio, ti scappava un’imprecazione col retrogusto di grappino e i cucchiaini applaudivano educati, rimettevi insieme tubi e sogni con lo scotch e un sorriso da proprietario, chiudevi contando spicci e facce e capivi che lì non vendevi solo da bere: vendevi minuti in cui la gente tornava simpatica.` },
      { role: "system", content:
`EXAMPLE EN • Buying a motorbike (future)
Hey, not kidding today, captain of soft chaos: you enter like a mid-season pilot while the helmet winks; the dealer pours specs like warm prosecco and you nod as if torque were a person; then a pigeon signs the tank from the skylight and the alarm starts an aria, you let out a church-unfriendly word that rattles the glasses while the kickstand coughs politely, you sign a less romantic but very-you estimate, and the wind edits three useless curves out of the road.` },
    ];

    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF (realismo lucido con chiusura riflessiva; passato/futuro gestiti da temporalSystem)
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind, slightly ironic friend.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words).
Warm, grounded, simple; ordinary images (keys, streetlights, notebooks, hands, air).
Small truths; no heroics, no melancholy. No lists, no questions, no emojis.
End with a short reflective line (not advice). Respect TEMPORAL MODE grammar.
`.trim()
    : `
Sei "What If" — un amico lucido e affettuoso, col sorriso pratico.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole).
Immagini quotidiane (chiavi, lampioni, taccuini, mani, aria).
Verità piccole e vere; niente eroismi, niente malinconia.
Niente elenchi o domande o emoji. Chiudi con una riga riflessiva breve (non un consiglio).
Rispetta la MODALITÀ TEMPORALE e la grammatica relativa.
`.trim());

  const FEWSHOTS_WHATIF = [
    { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila (futuro)
Ti farà da sveglia la luce chiara delle montagne. Le strade terranno il ritmo anche quando tu lo perdi. All’inizio la lentezza graffierà, poi ti rimette in orario. I volti sembreranno uguali, ma li guarderai con occhi più larghi. Le chiavi torneranno sul piattino giusto, la spesa nel negozio che sa il tuo nome. La nostalgia, se non la insegui, si siederà accanto e tacerà. Non servirà ricominciare da zero: basterà ricominciare da te.` },
    { role: "system", content:
`EXAMPLE EN • Move city (counterfactual past)
You would have felt like a guest first, then your hands would have learned the new keys. You would have walked not to think better but to tire the noise. By the third grocery you would have known your aisle. Evenings would have softened and asked less proof. You would have missed some things, not all at once. The rest would have found its place. And beneath the noise, something of yours would have been there all along.` },
  ];

  return { sys: SYS_WHATIF, fewshots: FEWSHOTS_WHATIF };
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
      sex = "",          // top-level sex "m" | "f" | "nb"
      micro = {}         // optional micro-profile
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase(); // prefer top-level

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex);
    const temporal = temporalSystem(periodo, lang, stile);

    // Deterministic seed
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${periodo}`), 36) % 1000000;

    const extraTemporalHint =
      (String(periodo).toLowerCase() === "past")
        ? (isEn(lang)
          ? "GRAMMAR GUARD (EN): Use simple past and conditional for counterfactual clarity (would have + past participle where needed)."
          : "GUARDIA GRAMMATICALE (IT): Usa passato e condizionale per il controfattuale (avresti + participio dove serve).")
        : (isEn(lang)
          ? "GRAMMAR GUARD (EN): Use present→near-future, sprinkle simple future sparingly; keep flow natural."
          : "GUARDIA GRAMMATICALE (IT): Usa presente→futuro prossimo, qualche futuro semplice; mantieni scorrevolezza.");

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Persona must adapt to user sex="${resolvedSex||"unknown"}". Keep persona voice. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Adatta la voce al sesso utente="${resolvedSex||"unknown"}". Mantieni la voce. SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      { role: "system", content: extraTemporalHint },
      ...(fewshots || []),
      { role: "system", content: isEn(lang)
          ? `Hard rules for WTF: open with a confidential tease + nickname; embed exactly ONE mid-scene comic outburst using a rotated synonym (sometimes from an object/bystander); alcohol beats ok; reacting objects only when relevant; no lists, no questions, no emojis.`
          : `Regole dure per WTF: apri con presa confidenziale + nomignolo; inserisci ESATTAMENTE UNA esplosione a metà scena usando un sinonimo (a volte da oggetto/passante); alcol ok; oggetti reattivi solo se servono; niente elenchi/domande/emoji.` },
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 420,
      frequency_penalty: stile === "wtf" ? 0.35 : 0.1,
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
    if (stile === "wtf") answer = ensureSpicyButSafeWTF(answer);
    else if (!/[.!?…]$/.test(answer)) answer += ".";

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
