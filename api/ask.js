// /api/ask.js — What?f Engine (2025 FINAL, patched)
// Stili: whatif (realismo lucido) · wtf (sarcasmo demenziale affettuoso, alcol, oggetti, “scoppio” comico narrato)
// IT/EN — paragrafo singolo, niente liste/domande/emoji
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA testo della domanda (solo metadati + hash non reversibile)

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
  // Garantisce chiusura sentita + evita output vuoto (il modello già evita la parola "bestemmia")
  let out = String(t || "").trim();
  if (!/[.!?…]$/.test(out)) out += ".";
  return out;
}
function tinyHash(s = "") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/* ---------- Clause & opener helpers ---------- */
function toClause(domanda = "") {
  // Trasforma "E se tornassi a vivere all’Aquila?" -> "se tornassi a vivere all’Aquila"
  const d = String(domanda).trim()
    .replace(/[“”"']/g, "")
    .replace(/^\s*e\s+se\s+/i, "se ")
    .replace(/^\s*what\s*if\s+/i, "if ")
    .replace(/[?!.…\s]+$/,"")
    .trim();
  return d || (isEn("en") ? "if it really happened" : "se succedesse davvero");
}

/* ---------- Nicknames (riutilizzati ovunque) ---------- */
const NICKS_IT = {
  f: ["contessa del forse","zebra dello slalom mentale","barista dei ripensamenti","sirena del ‘ma anche no’","capitana dei piani B","duchessa del procrastino"],
  m: ["barone dell’idea mezza cotta","sommelier del disastro buono","cavaliere del forse","sultano delle decisioni a metà","capitano delle scuse creative","duca del rinvio elegante"],
  nb:["leggenda carburata a caffè","emiro del ‘vediamo’","astronauta del ni","regnante delle diagonali","folletto dei piani B","regista dell’improvviso"]
};
const NICKS_EN = {
  f: ["duchess of maybe","barista of second thoughts","captain of plan B","siren of ‘not today’","queen of detours"],
  m: ["baron of half-ideas","sommelier of good disasters","captain of ‘we’ll see’","sultan of elegant delays","duke of plan B"],
  nb:["legend on espresso","emperor of ‘meh’","astronaut of maybe","director of detours","icon of sideways plans"]
};
function pickNick(lang, sex, seedNum=0){
  const s = String(sex||"nb").toLowerCase();
  const bank = isEn(lang) ? (NICKS_EN[s]||NICKS_EN.nb) : (NICKS_IT[s]||NICKS_IT.nb);
  return bank[(seedNum % bank.length + bank.length) % bank.length];
}
function buildContextOpener(lang, nick, domanda, periodo, stile){
  const clause = toClause(domanda);
  if (isEn(lang)) {
    if (stile==="wtf") return `Hey, ${nick} — ${clause}, it would roll like this:`;
    return `Alright ${nick}, ${clause}, here’s how it would likely feel.`;
  }
  if (stile==="wtf") return `Ehi, ${nick} — ${clause}, andrebbe così:`;
  return `Va bene ${nick}, ${clause}, probabilmente suonerebbe così.`;
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
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional, with quick present flashes. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale con lampi di presente. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex = "") {
  const SEX = String(sex || "nb").toLowerCase(); // "m" | "f" | "nb"
  const genderNickIT = (SEX === "f") ? NICKS_IT.f : (SEX === "m" ? NICKS_IT.m : NICKS_IT.nb);
  const genderNickEN = (SEX === "f") ? NICKS_EN.f : (SEX === "m" ? NICKS_EN.m : NICKS_EN.nb);

  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — loud, loving, tipsy-smart friend who roasts with affection.
SECOND PERSON. ONE paragraph, 7–9 sentences (125–170 words). Colloquial, visual, simple.
OPEN this way: a friendly hook + a nickname, then IMMEDIATELY anchor to the user’s question via a contextual clause (an opener string will be provided).
HUMOR: playful jabs, drinks, and “reacting objects” ONLY when relevant; sound like a friend who knows them.
Exactly ONE comic outburst (a *colorful exclamation*, never a literal religious slur). Choose a synonym such as: “bar-counter oath”, “saint-free squawk”, “under-breath curse”, “garage-grade yelp”, “kitchen-sink yowl”. It must explode *inside the narrative* because of a mishap (parking, bill, door, inbox…) and nearby people/objects react absurdly.
NEVER write the word “blasphemy”.
STRICT: no lists, no questions, no emojis, no moralizing. Respect TEMPORAL MODE.
Close warm and funny.`
      : `
Sei “What the F” — amico affettuoso, un po’ brillo e molto sveglio.
SECONDA PERSONA. UN paragrafo, 7–9 frasi (125–170 parole). Colloquiale, per immagini, semplice.
APERTURA: aggancio confidenziale + nomignolo, poi AGGANCIO IMMEDIATO alla domanda tramite una clausola contestuale (ti verrà fornita).
UMORISMO: prese in giro buone, sbronze e “oggetti che reagiscono” SOLO se servono; suoni come chi conosce davvero l’utente.
Un solo scoppio comico (una *imprecazione colorita*, mai letterale). Scegli sinonimi come: “giuramento da bancone”, “squittio senza santi”, “maledizione sotto voce”, “urletto da officina”, “strillo da vecchia moka”. Deve detonare *dentro la scena* per un imprevisto (parcheggio, scontrino, porta, bolletta…) e attorno oggetti/persone reagiscono in modo assurdo.
NON scrivere mai la parola “bestemmia”.
RIGIDO: niente elenchi, niente domande, niente emoji, niente prediche. Rispetta la MODALITÀ TEMPORALE.
Chiudi caldo e divertente.`).trim();

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila (futuro)
Ehi, barone dell’idea mezza cotta — se tornassi a vivere all’Aquila, andrebbe così: atterri convinto e la città ti riconosce dal rumore delle chiavi; i vicoli fanno finta di niente ma rallentano per venirti incontro, e tu ti atteggi come se il cuore non fosse in tasca. Il primo mese prendi caffè promettendo di restare e i tavolini ridacchiano “vediamo”, poi cerchi parcheggio con la fiducia di un santo di gesso, strusci il marciapiede e dal cruscotto esplode un giuramento da bancone così sincero che il semaforo arrossisce e il cestino fischia. Passata la scena, le facce tornano, i bambini imparano i nomi delle pietre: non torni indietro, torni intero.` },
      { role: "system", content:
`ESEMPIO IT • Mettersi in proprio (futuro)
Sommelier del disastro buono — se aprissi il tuo studio, succederebbe che il registratore di cassa tossisce ma tre clienti tornano, stappi “la buona” ed è aceto: brucia onesto, benedice l’errore, ti scappa un urletto da officina e il bancone commenta “oggi imprenditore davvero”; la sera conti spicci e sorrisi e capisci che non vinci il mondo, stai reggendo te.` },
      { role: "system", content:
`EXAMPLE EN • Moving city (future)
Hey, baron of half-ideas — if you moved to the new city, it would go like this: you land with rented courage, the buzzer rolls its eyes, the fridge hums “good luck”; at the third grocery you find your aisle, then a parking sensor screams and a saint-free squawk bursts out of you so hard the streetlight applauds; after the circus, your pace fits the map.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS, nickPoolIT: genderNickIT, nickPoolEN: genderNickEN };
  }

  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind, slightly ironic friend.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words).
Warm, grounded, simple; ordinary images (keys, streetlights, notebooks, hands, air).
Small truths; no heroics, no melancholy. No lists, no questions, no emojis.
End with a short reflective line (not advice).
`.trim()
    : `
Sei "What If" — un amico lucido e affettuoso, col sorriso pratico.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole).
Immagini quotidiane (chiavi, lampioni, taccuini, mani, aria).
Verità piccole e vere; niente eroismi, niente malinconia.
Niente elenchi o domande o emoji. Chiudi con una riga riflessiva breve (non un consiglio).
`.trim());

  const FEWSHOTS = [
    { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila
Se tornassi, non sarebbe un passo indietro ma un passo fatto meglio. Le strade tengono il ritmo anche quando tu lo perdi. All’inizio la lentezza graffia, poi ti rimette in orario. Le chiavi tornano sul piattino giusto e la spesa nel negozio che sa il tuo nome. La nostalgia, se non la insegui, si siede accanto e tace. Non serve ricominciare da zero: basta ricominciare da te.` },
    { role: "system", content:
`EXAMPLE EN • Move city
You’ll feel like a guest, then your hands learn the new keys. You walk to tire the noise. By the third grocery you know your aisle. Evenings soften and ask less proof. You miss some things, not all at once. The rest finds its place. And beneath the noise something of yours was already there.` },
  ];

  return { sys: SYS_WHATIF, fewshots: FEWSHOTS, nickPoolIT: genderNickIT, nickPoolEN: genderNickEN };
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
      sex = "",          // "m" | "f" | "nb"
      micro = {}         // optional micro-profile
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "nb").toLowerCase();

    // Personas + Temporal mode
    const { sys, fewshots, nickPoolIT, nickPoolEN } = personaSystem(stile, lang, resolvedSex);
    const temporal = temporalSystem(periodo, lang, stile);

    // Deterministic seed
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}`), 36) % 1000000;

    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in past or conditional, as if it already happened, keeping the upbeat roasting tone."
          : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono allegro e pungente.")
        : "";

    // Nickname deterministico e opener contestuale
    const nick = isEn(lang)
      ? (nickPoolEN ? nickPoolEN[seedNum % nickPoolEN.length] : pickNick(lang, resolvedSex, seedNum))
      : (nickPoolIT ? nickPoolIT[seedNum % nickPoolIT.length] : pickNick(lang, resolvedSex, seedNum));
    const opener = buildContextOpener(lang, nick, domanda, periodo, stile);

    const userPrompt = isEn(lang)
      ? `Question: "${domanda}". Context: "${String(extra||"").trim()}". Micro: ${JSON.stringify(micro||{})}. Use the provided opener EXACTLY once: "${opener}" and continue naturally from it; keep the roast playful and kind. INTERNAL SEED: ${seedNum}.`
      : `Domanda: "${domanda}". Contesto: "${String(extra||"").trim()}". Micro: ${JSON.stringify(micro||{})}. Usa l'incipit fornito UNA sola volta: "${opener}" e prosegui naturale; presa in giro affettuosa. SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role:"system", content: sys },
      { role:"system", content: temporal },
      ...(extraTemporalHint ? [{ role:"system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      { role:"system", content: isEn(lang)
          ? `WTF hard rules: one narrative outburst (synonym, not literal), triggered by a mishap; reacting objects/people; friendly roast.`
          : `Regole dure WTF: un solo scoppio narrativo (sinonimo, non letterale) innescato da un imprevisto; oggetti/persone reagiscono; presa in giro affettuosa.` },
      { role:"user", content: userPrompt },
      { role:"system", content: isEn(lang)
          ? `After writing, silently revise verb tenses to match TEMPORAL MODE, fix agreements and commas; keep voice and length; do not add ideas.`
          : `Dopo la stesura, rivedi in silenzio i tempi per rispettare la MODALITÀ TEMPORALE, sistema concordanze e virgole; mantieni voce e lunghezza; non aggiungere idee.` }
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
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 170 : 160);
    answer = normalizeOneParagraph(answer);

    // Assicura che inizi davvero con l’opener
    if (answer && opener && !answer.toLowerCase().startsWith(opener.toLowerCase().slice(0, Math.min(opener.length, 18)))) {
      answer = opener + " " + answer;
    }

    if (stile === "wtf") {
      // Non pronunciare mai la parola “bestemmia” (ulteriore salvaguardia)
      answer = answer.replace(/\bbestemmia\b/gi, isEn(lang) ? "colorful outburst" : "imprecazione colorita");
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
