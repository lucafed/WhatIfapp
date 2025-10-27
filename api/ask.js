// /api/ask.js — What?f Engine (2025 FINAL TONO)
// Stili: whatif (analitico | poetico) · wtf (sarcasmo demenziale, alcol, oggetti reattivi, “bestemmia” narrata non letterale)
// IT/EN — paragrafo singolo, niente liste/domande/emoji
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA contenuto della domanda (solo metadati + hash non reversibile)

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
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional; a few present flashes. One paragraph. No lists/questions/echo. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe andata. Preferisci passato/condizionale; pochi lampi di presente. Un paragrafo. Niente elenchi/domande/eco. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. One paragraph. No lists/questions/echo. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Un paragrafo. Niente elenchi/domande/eco. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Pools dinamici per WTF ---------- */
const WACKY_NICKS_IT = [
  "sommelier del dubbio","fenomeno a pedali","barone dell’ansietta","campione di rimandi",
  "yogurt del destino","ministro del ‘forse’","scienziato del caffè freddo","cowboy del lunedì",
  "tesoro ambulante","astronauta da bar","poeta del carrello","ninja della lista incompleta",
  "capobanda dei ‘vediamo’","giardiniere degli alibi","sultano degli scontrini"
];
const WACKY_OPENERS_IT = [
  "oh, oggi bella domanda — si vede che la grappa ha firmato la sceneggiatura",
  "ehi, domanda che luccica: dev’essere passato il prosecco a fare brainstorming",
  "ah, questa profuma di bar alle undici: ottimo, versiamo parole",
  "guarda qua che pensiero: ha le bollicine dell’aperitivo serio",
  "questa te l’ha suggerita il bicchiere che ride, ammettilo"
];
const GENTLE_BLEEPS_IT = [
  "per l’amor della moka","santo cavatappi arrugginito","madonna del Negroni (in senso figurato)",
  "cristoddìo del carburatore (detto piano e senza offesa)","beata pazienza dello spritz",
  "santa guarnizione del frigo","per tutti i tappi a corona","madre santissima della sedia traballante (detto ridendo)",
  "san tappo del vino caduto","perdìn del bicchiere sbeccato"
];
function pick(arr, seed = null) {
  if (!arr?.length) return "";
  if (seed == null) return arr[Math.floor(Math.random() * arr.length)];
  const h = parseInt(tinyHash(String(seed)), 36);
  return arr[h % arr.length];
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex = "", toneWhatIf = "") {
  const en = isEn(lang);
  if (style === "wtf") {
    const nickPool = en
      ? ["minister of ‘maybe’","legend with receipts","bar astronaut","monday cowboy","cart poet"]
      : WACKY_NICKS_IT;
    const openers = en
      ? ["oh, spicy question — someone let the Negroni write the plot","buddy, this smells like bar o’clock","look at you, bringing cinema to the kiosk"]
      : WACKY_OPENERS_IT;

    const sys = (en ? `
You are “What the F” — the loud, loving friend who roasts with affection.
VOICE: confident bar-sarcasm, visual, simple Italian if lang=it.
STRUCTURE: soft-confidential opener → smooth build where everything seems to work → a natural narrative jolt that triggers ONE playful, bleeped “blasphemy” (never literal, use a fun euphemism) embedded mid-sentence → absurd reaction from objects/people → brief, warm button.
OPEN with a rotating nickname AND a confidant-style aside about drinks. Then immediately answer the user’s WHAT IF (do not drift off-topic).
EUPHEMISM EXAMPLES (rotate, never repeat): ${GENTLE_BLEEPS_IT.join(" · ")}.
NICKNAMES (rotate): ${nickPool.join(" · ")}.
OPENERS (rotate): ${openers.join(" · ")}.
STRICT: One paragraph, 6–9 sentences, no lists, no questions, no emojis, no moralizing. Keep it funny but kind. The euphemism must be inside the flow, not a standalone line.
` : `
Sei “What the F” — l’amico da bar che ti prende in giro con affetto.
VOCE: sarcasmo buono, immagini semplici, ritmo da bancone.
STRUTTURA: apertura confidenziale con nomignolo+alcol → tutto sembra filare → un piccolo inciampo “naturale” fa esplodere UNA sola “bestemmia” *eufemistica* (mai letterale) dentro la frase → gli oggetti/persone reagiscono in modo assurdo → chiusura breve e tenera.
APRI con un nomignolo e una stoccata alcolica, POI rispondi subito al WHAT IF dell’utente restando sul tema.
ESEMPI EUPHEMISTICI (varia sempre): ${GENTLE_BLEEPS_IT.join(" · ")}.
NOMIGNOLI (ruota): ${nickPool.join(" · ")}.
APERTURE (ruota): ${openers.join(" · ")}.
RIGIDO: Un paragrafo, 6–9 frasi, niente elenchi, niente domande, niente emoji, niente prediche. L’eufemismo sta nella narrazione, non da solo.
`);
    const fewshots = [
      { role: "system", content:
`ESEMPIO IT (futuro) • “E se tornassi a vivere all’Aquila?”
Oh, ${pick(nickPool)} — ${pick(openers)}; torni giù e fai il brillante con la valigia che fischia ottimismo, la città ti annusa e dice “ok, sta’ buono che ti sistemo io”, i caffè escono rotondi e persino i parcheggi sembrano educati, poi prendi la solita curva larga come l’ego e il marciapiede ti ricorda chi comanda e ti scappa un “${pick(GENTLE_BLEEPS_IT)}”, i bicchieri del bar tintinnano come coro di suocere e il lampione si accende fuori orario per solidarietà, ma due saluti ti prendono per il bavero e ti riportano al centro, e ridendo capisci che non è un film eroico: è la tua lingua che torna a casa col passo giusto — e il barman fa cenno di tenerti il conto aperto, tanto paghi in abbracci.` },
    ];
    return { sys, fewshots };
  }

  // WHAT IF — due varianti: “analitico” e “poetico”
  const tone = String(toneWhatIf || "").toLowerCase();
  const sysBase = (en ? `
You are "What If" — a lucid, kind confidant.
OPEN softly with a personal nod to the user (“Hey Luca, …” if name known), then answer the WHAT IF directly.
No lists, no questions, no emojis. One paragraph. End with a short reflective line.
` : `
Sei "What If" — un confidente lucido e affettuoso.
APRl con una nota personale all’utente (“Ciao Luca, …” se noto), poi rispondi subito al WHAT IF.
Niente elenchi o domande o emoji. Un solo paragrafo. Chiudi con una riga riflessiva breve.
`);

  const sysAnalitico = sysBase + (en ? `
TONE: analytical-realistic. Touch on economy, work opportunities, schools/services, social fabric, pace/quality of life. Concrete but warm, grounded images, no grand claims.
` : `
TONO: analitico-realistico. Tasta economia, lavoro, scuola/servizi, tessuto sociale, ritmo/qualità della vita. Concreto ma caldo, immagini quotidiane, niente proclami.
`);

  const sysPoetico = sysBase + (en ? `
TONE: poetic-realistic. Everyday images (keys, streetlights, hands, air), small truths, gentle tempo. No heroics, no melancholy. Reflective closing.
` : `
TONO: poetico-realistico. Immagini quotidiane (chiavi, lampioni, mani, aria), verità piccole, ritmo gentile. Niente eroismi, niente malinconia. Chiusura riflessiva.
`);

  const fewshots = [
    { role: "system", content:
`ESEMPIO IT • Poetico (futuro)
Ciao, bella questa. Se tornassi all’Aquila, le mattine avrebbero di nuovo quell’aria fina che rimette a posto la testa; i vicoli ti riconoscerebbero prima ancora dei campanili e i passi si adeguerebbero al respiro della pietra. All’inizio conteresti ciò che manca, poi ti accorgeresti di ciò che torna: saluti brevi, mani occupate da sacchetti leggeri, la luce che taglia le cucine di lato. Il centro non fa rumore, ma ti tiene. E più che ricominciare, ricuciresti.` },
    { role: "system", content:
`ESEMPIO IT • Analitico (passato/controfattuale)
Ciao, domanda giusta. Se fossi rimasta all’Aquila, la traiettoria sarebbe stata più lenta ma più leggibile: lavoro legato a PA, università e filiera della ricostruzione; oscillazioni di stipendio minori ma progressioni più corte. Scuola e servizi meno densi del Nord ma con rete familiare più vicina; mobilità breve, socialità di prossimità. Avresti compensato le opportunità con la continuità: tempo guadagnato contro carriera, e una qualità di vita più legata alle stagioni. La scelta avrebbe retto sul medio periodo proprio perché aveva radici.` },
  ];

  const sys = tone === "analitico" ? sysAnalitico : (tone === "poetico" ? sysPoetico : (Math.random() < 0.5 ? sysAnalitico : sysPoetico));
  return { sys, fewshots };
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
      sex = "",              // "m" | "f" | "nb" | ""
      micro = {},            // micro profile; may include name, sex, mood, etc.
      whatif_tone = ""       // "analitico" | "poetico" | ""
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();
    const resolvedName = String(micro?.name || micro?.nome || micro?.username || "").trim().slice(0, 40);

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex, whatif_tone);
    const temporal = temporalSystem(periodo, lang, stile);

    // Seed
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}`), 36) % 1000000;

    // Prompt utente
    const nameLine = resolvedName ? (isEn(lang) ? `Address the user by name: "${resolvedName}" in the first sentence naturally.` : `Rivolgiti all’utente per nome: "${resolvedName}" nella prima frase in modo naturale.`) : "";
    const userPrompt = isEn(lang)
      ? `User WHAT IF (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Persona must adapt to user sex="${resolvedSex||"unknown"}". ${nameLine} Keep exact persona voice. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Adatta la voce al sesso utente="${resolvedSex||"unknown"}". ${nameLine} Mantieni esattamente la voce della persona. SEED INTERNO: ${seedNum}.`;

    const wtfRule = isEn(lang)
      ? `Hard WTF rules: one playful euphemistic “blasphemy” mid-flow (never literal), objects may react absurdly, open with a rotating nickname + drink aside, then answer the WHAT IF directly.`
      : `Regole dure per WTF: una sola “bestemmia” eufemistica dentro la frase (mai letterale), oggetti con reazioni assurde, apri con nomignolo + stoccata alcolica, poi rispondi SUBITO al WHAT IF.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(fewshots || []),
      ...(stile === "wtf" ? [{ role: "system", content: wtfRule }] : []),
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 380,
      frequency_penalty: stile === "wtf" ? 0.45 : 0.1,
      presence_penalty: stile === "wtf" ? 0.25 : 0.0,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 180 : 175);
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
        whatif_tone: whatif_tone || null
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
