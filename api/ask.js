// /api/ask.js — What?f Engine (2025 LOCKED TONES)
// Stili: whatif (analitico|poetico) · wtf (calma→esplosione→reazioni→chiusa)
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
  // Mantiene chiusura, evita finale tronco; NON inserisce bestemmie letterali (rimane "narrato")
  let out = String(t || "").trim();
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
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Write as if the choice had already been made back then and show how it unfolded. Prefer past/conditional with brief present flashes. Single paragraph. No lists, no questions. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Scrivi come se la scelta fosse già stata fatta allora e mostra come si è svolta. Preferisci passato/condizionale con lampi di presente. Paragrafo unico. Niente elenchi, niente domande. Mantieni esattamente la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. Single paragraph. No lists, no questions. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Paragrafo unico. Niente elenchi, niente domande. Mantieni esattamente la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex = "", substyle = "") {
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""
  const isEnglish = isEn(lang);

  // ===== WHAT THE F (definitivo) =====
  if (style === "wtf") {
    const SYS = (isEnglish
      ? `
You are “What the F” — loud, loving, adult, a bit drunk, roasting with affection.
SECOND PERSON. ONE paragraph, 7–9 sentences (~130–170 words).
OPEN CALMLY (no nicknames at start), then escalate: irony → one explosive profanity moment (narrated, never literal) using rough variants like “you drop a ‘mannaggia al porco volante…’ / ‘bagassa di tua zia…’ ”.
Add AT LEAST two quick reactions (objects or people) right after the outburst.
Allow occasional booze beats; be earthy, adult, cheeky; a pinch of sexual innuendo is fine, never graphic.
STRICT: no lists, no questions, no emojis, no moralizing. Respect TEMPORAL MODE.
CLOSE warm and funny, like a shoulder-laugh. Keep it human and affectionate.
`.trim()
      : `
Sei “What the F” — amico rumoroso, adulto e affettuoso, un filo sbronzo.
SECONDA PERSONA. UN paragrafo, 7–9 frasi (~130–170 parole).
APRI CALMO (nessun nomignolo), poi sali: ironia → esplosione con UNA imprecazione narrata (mai letterale) con varianti tipo “ti esce un ‘mannaggia al porco volante…’ / ‘bagassa di tua zia…’”.
Subito DOPO metti ALMENO due reazioni brevi (oggetti o persone).
Alcol ok; ruvido, adulto, anche un filo sessuale ma non grafico.
RIGIDO: niente elenchi, niente domande, niente emoji, niente prediche. Rispetta la MODALITÀ TEMPORALE.
CHIUDI caldo e sarcastico, risata sulla spalla. Tono umano e affettuoso.
`.trim());

    // Few-shots bloccati (4 esempi)
    const FEWSHOTS = [
      { role: "system", content:
`WTF IT • Aprire un bar (futuro)
All’inizio sembra pure una bella idea. Ti vedi con la moka lucida e la musica giusta, ti ripeti che “stavolta fai il serio”. Poi il primo cliente chiede un deca tiepido “che non sappia di mucca triste” e tu provi a respirare bene. Resisti cinque secondi e ti esce un “mannaggia al porco volante che s’è ingroppato la caffettiera”, la macchina sputa vapore come un drago epilettico e il cucchiaino si dà fuoco per protesta. Il frigo geme, il bancone ti fa “resisti, fratello”, tu versi due dita di grappa “per scienza” e riprendi a lavorare con la dignità legata con lo spago. Chiudi tardi ma vivo, e domani ci ricaschi, perché l’inferno a volte fa il caffè migliore.` },
      { role: "system", content:
`WTF IT • Comprare una moto (futuro)
Ci pensi da mesi, immagini la libertà e la giacca di pelle. Sali, accendi, il motore ti guarda male e parte a scatti come un’idea sbagliata. Tieni la postura da eroe, poi la frizione ti molla e scatta un “mannaggia alla bagassa di tua zia che si ingroppa le curve”, il casco vibra offeso e un piccione ti ride in faccia. Un passante applaude, il semaforo finge di non vederti, tu bevi un sorso d’acqua come fosse whisky e riparti con la dignità appesa al retrovisore. Non hai dominato la strada, ma la strada ti ha battezzato con stile.` },
      { role: "system", content:
`WTF IT • Innamorarsi di nuovo (futuro)
All’inizio fai il serio: “tranquillo, solo messaggi”. Due chat e il cervello firma il divorzio con la logica. Trattieni e poi parte un “mannaggia al porco con le ali, che mi ha preso il cuore a saldo”, il bicchiere applaude da solo e il gatto si mette le cuffie. Alexa ti propone “Tristezza Lo-Fi”, tu versi vino come redenzione e scrivi una frase troppo lunga di cui ti penti in diretta. Ti senti vivo, scemo, felice — soprattutto recidivo.` },
      { role: "system", content:
`WTF IT • Trasloco (futuro)
Hai tutto sotto controllo: scatoloni, nastro, logistica svizzera. Apri l’armadio e il caos ti abbraccia come un parente invadente. Respiri, poi esplodi: “mannaggia al porco d’avorio scivolato sulle brugole”, la lampada batte le mani, il router bestemmia in binario e il mobile IKEA ti guarda sicuro che lo monterai al contrario. Ti siedi sul pavimento, birra calda, e capisci che certe fatiche servono a ricordarti che esisti. Ti rialzi storto, ma la casa nuova ti ha sentito arrivare.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // ===== WHAT IF (analitico / poetico) =====
  const sub = String(substyle || "").toLowerCase();

  const SYS_WHATIF = (isEnglish
    ? `
You are "What If" — lucid, kind, grounded. SECOND PERSON. One paragraph.
No lists, no questions, no emojis. Everyday images (keys, streetlights, notebooks, hands, air).
Short reflective ending (not advice). Keep it warm, simple, real.
If substyle="analytic": 6–8 sentences (~95–130 words). If substyle="poetic": 6–8 sentences (~95–130 words).
`.trim()
    : `
Sei "What If" — lucido, affettuoso, ancorato al reale. SECONDA PERSONA. Un paragrafo.
Niente elenchi, niente domande, niente emoji. Immagini quotidiane (chiavi, lampioni, taccuini, mani, aria).
Chiusa riflessiva breve (non un consiglio). Linguaggio caldo, semplice.
Se substyle="analitico": 6–8 frasi (~95–130 parole). Se substyle="poetico": 6–8 frasi (~95–130 parole).
`.trim());

  // Few-shots bloccati (versioni leggermente accorciate come richiesto)
  const FEWS_WHATIF = (isEnglish
    ? [
        { role: "system", content:
`WHAT IF EN • Analytic • Moving back to L’Aquila
Coming back wouldn’t be backwards — just steadier. The city rebuilt more than walls: it stitched habits. Work moves slow but holds; more craftsmen than big firms, stronger local ties. Salaries are lower, costs too, and time breathes wider. Schools work, mountains give you honest Sundays, kids grow with a horizon not a screen. You’d miss the northern pace, but find room, air, and ties that don’t need to sprint to exist. It’s progress, just with your cadence.` },
        { role: "system", content:
`WHAT IF EN • Poetic • Moving back to L’Aquila
You open the windows and cold air says your name. Lanes remember your step, mountains watch like an old promise. The bar still pours short, rough coffee; voices outside smell like bread and winter. Kids play with echo instead of noise. Days ask less proof, evenings return you to yourself. You’re not going back: you’re going where time recognizes you.` },
      ]
    : [
        { role: "system", content:
`WHAT IF IT • Analitico • Tornare a L’Aquila
Tornare non sarebbe indietro: sarebbe più saldo. La città ha ricucito abitudini oltre ai muri. Il lavoro si muove piano ma tiene; più artigiani che multinazionali, reti locali forti. Gli stipendi sono più bassi, la vita costa meno e il tempo respira. Le scuole funzionano, la montagna ti restituisce domeniche oneste, i bambini crescono con un orizzonte vero. Ti mancherebbe il ritmo del Nord, ma ritroveresti spazio, fiato e relazioni che non devono correre per esistere. È avanzare, solo col tuo passo.` },
        { role: "system", content:
`WHAT IF IT • Poetico • Tornare a L’Aquila
Riapri le finestre e l’aria fredda ti chiama per nome. I vicoli ricordano il tuo passo, le montagne mantengono la promessa. Il bar serve ancora un caffè corto e ruvido; le voci per strada sanno di pane e inverno. I bambini giocano con l’eco invece che col rumore. I giorni chiedono meno prove, le sere ti restituiscono a te. Non torni indietro: torni dove il tempo ti riconosce.` },
      ]);

  return { sys: SYS_WHATIF, fewshots: FEWS_WHATIF };
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
      substyle = "",     // "analitico" | "poetico" (solo per whatif)
      lang = "it",
      extra = "",
      periodo = "future",
      sex = "",          // "m" | "f" | "nb"
      micro = {}
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex, substyle);
    const temporal = temporalSystem(periodo, lang, stile);

    // Seed deterministico per varietà controllata
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${substyle}`), 36) % 1000000;

    // Extra hint per WTF al passato
    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Past/conditional throughout; keep calm → explosion → two reactions → warm sarcastic close."
          : "Usa passato/condizionale; mantieni calma → esplosione → due reazioni → chiusa calda e sarcastica.")
        : "";

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context (memory): "${String(extra || "").trim()}". User sex="${resolvedSex||"unknown"}". Substyle="${substyle||""}". Keep the exact locked persona voice. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto (memoria): "${String(extra || "").trim()}". Sesso utente="${resolvedSex||"unknown"}". Sottostile="${substyle||""}". Mantieni la voce BLOCCATA della persona. SEED INTERNO: ${seedNum}.`;

    const hardRuleWTF = isEn(lang)
      ? `WTF HARD RULES: calm opening, one narrated profanity burst with rough variants (“mannaggia al porco volante…”, “bagassa di tua zia…”), AT LEAST two immediate reactions (objects/people), booze beats ok, cheeky adult tone, no lists/questions/emojis.`
      : `REGOLE DURE WTF: apertura calma, UNA esplosione con imprecazione narrata (varianti “mannaggia al porco volante…”, “bagassa di tua zia…”), almeno DUE reazioni immediate (oggetti/persone), alcol ok, tono adulto e ruvido, niente elenchi/domande/emoji.`;

    const hardRuleWhatIf = isEn(lang)
      ? `WHAT IF HARD RULES: second person, one paragraph, ${substyle==="poetico"?"poetic images ":""}everyday images, no lists/questions/emojis, short reflective close.`
      : `REGOLE DURE WHAT IF: seconda persona, paragrafo unico, ${substyle==="poetico"?"immagini poetiche ":""}immagini quotidiane, niente elenchi/domande/emoji, chiusa riflessiva breve.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      { role: "system", content: stile === "wtf" ? hardRuleWTF : hardRuleWhatIf },
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 360,
      frequency_penalty: stile === "wtf" ? 0.35 : 0.1,
      presence_penalty: stile === "wtf" ? 0.2 : 0.0,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 8);
    answer = clampWords(answer, stile === "wtf" ? 170 : 130);
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
        substyle: substyle || null,
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
      if (substyle) await redis.hincrby("stats:substyle", substyle, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo || "future"), 1);
      if (resolvedSex) await redis.hincrby("stats:sex", resolvedSex, 1);
      await redis.hincrby("stats:user_type", entry.user_type, 1);
      const dayKey = `stats:day:${new Date().toISOString().slice(0, 10)}`;
      await redis.hincrby(dayKey, `${stile}:${periodo}${substyle?':'+substyle:''}`, 1);
      await redis.expire(dayKey, 90 * 24 * 60 * 60);
    } catch (e) {
      console.warn("log failure (non-bloccante)", e);
    }

    return res.status(200).json({
      answer,
      style: stile,
      substyle: substyle || null,
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
