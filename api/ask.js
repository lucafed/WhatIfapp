// /api/ask.js — What?f Engine (2025 FINAL – tonality fix)
// Stili: whatif (reale | analitico) · wtf (saggio ubriaco affettuoso, “bestemmia” narrata, evento naturale)
// IT/EN — paragrafo singolo, niente liste/domande/emoji
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA contenuto della domanda (solo metadati + hash non reversibile)

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
});

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
  // Chiudi pulito; NON inserire mai contenuti blasfemi letterali
  let out = String(t || "").trim();
  if (!/[.!?…]$/.test(out)) out += ".";
  // Evita trattini/en-dash ripetuti: sostituisci " — " con ", "
  out = out.replace(/\s—\s/g, ", ");
  return out;
}
function tinyHash(s = "") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

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
function personaSystem(style, lang, sex = "", tone = "") {
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""
  const genderNickIT = (SEX === "f")
    ? ["regina del casino","fenomena","capitana del caos","signora dei forse","rockstar con tacchi comodi"]
    : (SEX === "m")
      ? ["campione","fenomeno","capitano del caos","poeta del bar","rockstar con le tasche vuote"]
      : ["leggenda","fenomen*","cap* del caos","astronauta del dubbio","asso universale"];
  const genderNickEN = (SEX === "f")
    ? ["queen of chaos","ace of maybe","legend in sneakers","captain of detours"]
    : (SEX === "m")
      ? ["champ","legend","captain of chaos","bar poet"]
      : ["icon","legend","ace","captain of chaos"];

  /* ===== WHAT THE F ===== */
  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — a wise, tipsy friend who roasts with love.
SECOND PERSON. One paragraph, 6–8 sentences (125–165 words). Colloquial, vivid, concrete.
Open with ONLY a short rotating nickname (no verbs). Keep it human and warm.
The blasphemy is NARRATED ONCE, never literal, and arises naturally from a plausible stumble already happening in the scene (parking ticket, coffee spilling, missed bus, stubbed toe). Example phrasing to vary: 
- “you let out a blasphemy that rattles the glasses”
- “a theatrical blasphemy slips out and the mugs vibrate”
- “a scenic blasphemy bursts out and the chairs pretend not to hear”
Never write any religious slur. Do not force the event; let it appear as part of the flow.
Allow affectionate teasing; stay supportive underneath. Avoid long em-dashes; use commas/short pauses.
No lists, no questions, no emojis, no moralizing. Respect TEMPORAL MODE.
Nicknames (EN): ${genderNickEN.join(", ")}.
`.trim()
      : `
Sei “What the F” — l’amico saggio e sbronzo che prende in giro con affetto.
SECONDA PERSONA. Un paragrafo, 6–8 frasi (125–165 parole). Linguaggio colloquiale, concreto, visivo.
Apri SOLO con un nomignolo breve (senza verbi). Rimani umano e caldo.
La bestemmia è NARRATA UNA VOLTA, mai letterale, e nasce da un intoppo plausibile già in corso nella scena (multa per il parcheggio, caffè rovesciato, bus perso, mignolo contro lo spigolo). Frasi variabili consentite:
- “ti esce una bestemmia che fa tremare i bicchieri”
- “ti scappa una bestemmia teatrale e le tazze vibrano”
- “parte una bestemmia scenica e le sedie fanno finta di niente”
Mai scrivere insulti religiosi letterali. Non creare l’intoppo apposta: deve capitare come parte naturale della narrazione.
Prendi in giro con affetto; sotto resta dalla sua parte. Evita trattini lunghi; preferisci virgole e pause brevi.
Niente elenchi, niente domande, niente emoji, niente prediche. Rispetta la MODALITÀ TEMPORALE.
Nomignoli (IT): ${genderNickIT.join(", ")}.
`.trim());

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Tornare nella città d’origine (futuro, voce sbronza affettuosa)
Capitano del caos, scendi dal treno convinto di fare il turista ma il bar all’angolo ti riconosce il passo, la tazzina ride e tu fai finta di niente; cerchi parcheggio con la sicurezza dell’eroe tragico, strisci il cerchione come fosse un violino e ti scappa una bestemmia teatrale e le tazze vibrano, il lampione fa finta di non sentire, due facce ti chiamano per nome e ti riportano dentro come una vecchia canzone, il futuro qui si muove piano ma ti lascia spazio per respirare e per sbagliare, e mentre sistemi il cappotto capisci che non stai tornando indietro: stai tornando intero, e il marciapiede ti fa credito di fiducia senza interessi.` },
      { role: "system", content:
`EXAMPLE EN • New job leap (future, drunk-wise friend)
Champ, you swagger in with a plan written on a napkin and the printer coughs like a bus; you spill coffee on the onboarding badge, you let out a blasphemy that rattles the glasses and the kettle whistles “noted”, three small wins line up like bar nuts, the map of your day stops asking for ID, and by Friday you’re not conquering anything, you’re just landing yourself without breaking the barstool.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  /* ===== WHAT IF ===== */
  const TONE = String(tone || "").toLowerCase(); // "reale" | "analitico" | "poetico"(se mai)
  // Regole comuni: niente nomignoli, niente parolacce, no liste/emoji, una sola chiusa riflessiva breve.
  const BASE_IT = `
Sei "What If" — voce lucida e affettuosa, pratica.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (115–160 parole).
Niente nomignoli, niente parolacce. Niente elenchi, niente domande, niente emoji.
Chiudi con una riga riflessiva breve (non un consiglio).
`.trim();
  const BASE_EN = `
You are "What If" — lucid, kind, practical voice.
SECOND PERSON. One paragraph, 8–11 sentences (115–160 words).
No nicknames, no profanity. No lists, no questions, no emojis.
End with one short reflective line (not advice).
`.trim();

  // Sottostile "reale": replica il tuo esempio (narrazione umana, concreta).
  const REAL_IT = `
STILE: REALE. Narra come nel tuo esempio: concreto, umano, sobrio.
Usa immagini quotidiane solo se servono (niente parole chiave forzate). Zero enfasi melodrammatica.
Mostra cosa resta uguale e cosa cambia, con ritmo calmo e chiusura che fa pace con la scelta.
`.trim();
  const REAL_EN = `
TONE: REAL. Narrate like the given example: concrete, human, grounded.
Use ordinary details only when they serve; no forced imagery. Calm cadence and a reconciliatory closure.
`.trim();

  // Sottostile "analitico": ingloba economia, scuola, sociale, qualità della vita.
  const ANALYTIC_IT = `
STILE: ANALITICO. Un paragrafo unico, ma integra chiaramente: economia/lavoro, scuola/servizi educativi, vita sociale/reti, qualità della vita (tempi, costi, ambiente).
Niente elenchi: collega i temi in narrazione sobria e realistica, come una “lettura di contesto” che atterra sulla persona.
`.trim();
  const ANALYTIC_EN = `
TONE: ANALYTICAL. One single paragraph, but weave in: economy/work, schools/education, social life/networks, quality of life (time, costs, environment).
No bulleting: connect themes in a sober narrative that lands on the person.
`.trim();

  const SYS = (isEn(lang)
    ? [BASE_EN, (TONE === "analitico" ? ANALYTIC_EN : REAL_EN)].join("\n")
    : [BASE_IT, (TONE === "analitico" ? ANALYTIC_IT : REAL_IT)].join("\n"));

  const FEWSHOTS = isEn(lang)
    ? [
        { role: "system", content:
`EXAMPLE EN • REAL
You wake to the kind of light you used to know. Streets remember your pace even when you don’t. Work would sometimes feel slower, sometimes kinder; what you trade in speed you get back in air. Kids grow around familiar names, and grandparents are not a trip but a door across the hall. You miss some noise, but you hear yourself better. At night, when the house settles, you feel you didn’t go back: you arrived where a part of you had waited.` },
        { role: "system", content:
`EXAMPLE EN • ANALYTICAL
Staying would likely mean steadier schedules and tighter budgets: salaries move slower but rent and commuting shrink. Schools are closer, teachers know faces longer, and support flows through family and neighbors more than through services. Social life feels narrower yet thicker; opportunities come fewer but more personal. Quality of life tilts toward time and air rather than choice and pace. In exchange, your days hold fewer leaps and more ground, which is sometimes exactly what you needed.` },
      ]
    : [
        { role: "system", content:
`ESEMPIO IT • REALE
Ti svegli con una luce che conosci. Le strade ti tengono il passo anche quando lo perdi. Il lavoro a volte più lento, a volte più gentile: quello che togli alla velocità lo ritrovi in aria. I figli crescono tra nomi familiari, e i nonni non sono una trasferta ma una porta di fronte. Ti manca un po’ di rumore, ma ti senti meglio. La sera, quando la casa si assesta, capisci che non sei tornat*: sei arrivat* dove una parte di te aspettava.` },
        { role: "system", content:
`ESEMPIO IT • ANALITICO
Restare significherebbe orari più stabili e conti più stretti: gli stipendi si muovono piano ma affitto e spostamenti calano. La scuola è vicina, i docenti restano, l’aiuto passa più dai legami che dai servizi. La vita sociale è meno larga ma più densa; le occasioni sono meno numerose ma più personali. La qualità della vita sposta il peso su tempo e aria, non su scelta e ritmo. In cambio i giorni fanno meno salti e più terra, che a volte è proprio ciò che serve.` },
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

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    const admin = await isAdmin(req, ip);
    const bypass = admin === true;

    const isPro = String(req.headers["x-pro"] || "").trim() === "1";

    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

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

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",
      lang = "it",
      extra = "",
      periodo = "future",
      sex = "",
      micro = {},
      tone = ""           // <— NUOVO: “reale” | “analitico” (solo whatif)
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // Personas + Temporal mode (passo anche tone)
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex, tone);
    const temporal = temporalSystem(periodo, lang, stile);

    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${tone}`), 36) % 1000000;

    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in past or conditional as if it already happened, with upbeat roasting tone."
          : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono pungente ma affettuoso.")
        : "";

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". User sex="${resolvedSex||"unknown"}". TONE="${tone||""}". Keep the exact persona voice. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Sesso utente="${resolvedSex||"unknown"}". TONO="${tone||""}". Mantieni esattamente la voce della persona. SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      { role: "system", content: isEn(lang)
          ? `HARD RULES:
- WHAT IF: no nicknames, no profanity, one short reflective closing line.
- WTF: one narrated blasphemy from a natural stumble; never literal; affectionate teasing; avoid long em-dashes.`
          : `REGOLE FERREE:
- WHAT IF: niente nomignoli, niente parolacce, chiusura riflessiva breve.
- WTF: una sola bestemmia narrata da un intoppo naturale; mai letterale; presa in giro affettuosa; evita trattini lunghi.` },
      { role: "user", content: userPrompt },
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 360,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: stile === "wtf" ? 0.2 : 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 165 : 160);
    answer = normalizeOneParagraph(answer);
    if (stile === "wtf") {
      answer = ensureSpicyButSafeWTF(answer);
    } else {
      if (!/[.!?…]$/.test(answer)) answer += ".";
    }

    try {
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
        sex: resolvedSex || null,
        tone: tone || null,
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
      if (tone) await redis.hincrby("stats:tone", tone, 1);
      await redis.hincrby("stats:user_type", entry.user_type, 1);
      const dayKey = `stats:day:${new Date().toISOString().slice(0, 10)}`;
      await redis.hincrby(dayKey, `${stile}:${periodo}`, 1);
      await redis.expire(dayKey, 90 * 24 * 60 * 60);
    } catch {}

    return res.status(200).json({
      answer,
      style: stile,
      lang,
      periodo,
      tone: tone || "",
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
