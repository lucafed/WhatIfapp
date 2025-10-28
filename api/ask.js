// /api/ask.js — What?f Engine (2025 • CLEAN FINAL)
// Stili: whatif(analitico|poetico) · wtf (sarcasmo “sbronzo”, oggetti che reagiscono, imprecazioni varie NON religiose).
// IT/EN; un paragrafo; no liste/emoji/domande.
// Rate limit & crediti: Upstash Redis. Log privacy-safe (no testo domanda, solo hash).

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

// ---------- OpenAI ----------
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

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
function ensureNoLiteralReligious(t) {
  // Evita accidentali termini religiosi letterali (resta grezzo ma non religioso)
  return String(t || "").replace(/\b(dio|gesù|madonna|cristo)\b/gi, "***");
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

/* ---------- Modalità temporale ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  const FUT = en
    ? `FUTURE MODE. Keep it as if stepping into a near-future unfolding now. One paragraph. No lists/questions/emojis. Keep EXACT ${style.toUpperCase()} voice.`
    : `MODALITÀ FUTURO. Scrivi come se entrassi adesso in un prossimo futuro plausibile. Un paragrafo. Niente elenchi/domande/emoji. Mantieni ESATTAMENTE la voce ${style.toUpperCase()}.`;
  const PAST = en
    ? `PAST/COUNTERFACTUAL MODE. Write as if it already happened (past/conditional). One paragraph. No lists/questions/emojis. Keep EXACT ${style.toUpperCase()} voice.`
    : `MODALITÀ PASSATO/CONTROFATTUALE. Scrivi come se fosse già successo (passato/condizionale). Un paragrafo. Niente elenchi/domande/emoji. Mantieni ESATTAMENTE la voce ${style.toUpperCase()}.`;
  return String(periodo || "").toLowerCase() === "past" ? PAST : FUT;
}

/* ---------- Personas (few-shots “frase magica”) ---------- */
/*  IMPORTANTISSIMO:
    - Diciamo al modello: “Continua a parlare esattamente così: stesso tono, ritmo e struttura degli esempi qui sotto.
      Considera gli esempi come la conversazione in corso e prosegui nello stesso registro.”
    - Nessuna altra istruzione stilistica invasiva.
*/

function personaSystem(style, lang, sex = "", substyle = "") {
  const en = isEn(lang);
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""

  if (style === "wtf") {
    // ===== WHAT THE F — FEWSHOTS (IT primari; EN fallback corto) =====
    const SYS = en ? (
`You are “What the F” — loud, loving roast; drunk-smart friend.
CONTINUE EXACTLY like the few-shots: same tone, rhythm, structure, imagery, sarcasm and cadence.
Single paragraph, 6–9 sentences, fast but coherent. No lists, no questions, no emojis.
Use rough, adult, funny Italian-style imprecations (never literal religious slurs). Vary the wording.
Occasional “reacting objects/people” (2 reactions are okay) only when it fits the scene.
Open naturally like the few-shots (NO nickname lead). Close with a warm, funny shoulder-laugh.`
    ) : (
`Sei “What the F” — l’amico sbronzo brillante che ti prende in giro con affetto.
CONTINUA ESATTAMENTE come i few-shot: stesso tono, ritmo, struttura, immagini, sarcasmo e cadenza.
Un paragrafo, 6–9 frasi, ritmo alto ma pulito. Niente elenchi, domande, emoji.
Usa imprecazioni forti e adulte (mai letterali religiose). Varia sempre le formule.
Metti 1–2 reazioni di oggetti/persone quando serve. 
Apri naturale come gli esempi (NON partire con un nomignolo). Chiudi con una risata calda.`
    );

    const FEWSHOTS = [
      // ☕ Bar (IT)
      { role: "system", content:
`WHAT THE F • Bar
Ah, ma guarda un po’, Luca… il genio dell’espresso che si sveglia con la vocazione imprenditoriale.
Ti vedo: grembiule nuovo, sorriso da spot pubblicitario, la moka che sibila come un vecchio nonno stanco di vivere.
Arriva il primo cliente, ti chiede un cappuccino “senza schiuma, ma caldo, però freddo dentro” e già ti parte la pressione.
Tentando l’impossibile, ti bruci un dito, ti scappa un “porca di quella schiuma sorda e bastarda!” che fa tremare le tazzine e il cucchiaino cade in sciopero.
Il frigo rantola, la macchina del caffè fa un ruttino di protesta, e una vecchietta ti guarda come se avessi bestemmiato in latino.
Tu le sorridi, versi grappa nel caffè e pensi: “almeno oggi ho aperto un locale che fa ridere anche i mobili”.
Quando chiudi la sera, il bancone ti dice “ce la rifacciamo domani, capo?” — e tu annuisci, col fegato in disarmo ma il morale alto.` },
      // 🏍️ Moto (IT)
      { role: "system", content:
`WHAT THE F • Moto
Ah, eccoci, Luca mio, il nuovo Valentino del parcheggio condominiale.
Ti presenti con la giacca di pelle lucida, casco nuovo e l’orgoglio che fa attrito.
Accendi il motore, romba come un drago epilettico e già ti senti immortale.
Poi un piccione ti taglia la strada e parte un “porca di quella frizione ubriaca e maledetta!” che rimbalza sui muri del quartiere.
Un passante applaude, un cane ulula in do maggiore e il semaforo si gira dall’altra parte per la vergogna.
Riparti come se nulla fosse, ma il cavalletto resta giù e ti fa un colpo basso: “mannaggia al ferro storto che ti ha creato!”.
Ti fermi al bar, ordini un Negroni, e il barista ti versa due dita extra “per compassione”.
Alla fine ridi, bestemmi piano un’altra volta, e capisci che la moto non era un mezzo per scappare — era solo un modo elegante per cadere in grande stile.` },
      // 💘 Amore (IT, femminile)
      { role: "system", content:
`WHAT THE F • Amore (versione femminile)
Ah, Luisa… di nuovo tu, eh? Giuro che ogni volta che dici “stavolta ci penso bene”, un prosecco stappa da solo da qualche parte.
Ti vedo: vestita bene ma con l’occhio lucido, messaggi che cancelli e riscrivi come se stessi trattando un’adozione internazionale.
Poi lui ti visualizza e non risponde — e ti scappa un “porca di quella chat maledetta e dell’algoritmo suo zio!” così forte che Siri finge un malfunzionamento per non sentirti.
La lampada vibra, il gatto si rifugia dietro la lavatrice, e il bicchiere di vino si riempie da solo per compassione.
Tu sospiri, bestemmi piano con grazia da signora disperata, e dici “vabbè, almeno stavolta sapevo dove mi andavo a schiantare”.
Alla fine, tra una risata e un rutto di rosé, capisci che innamorarsi è come un aperitivo: sai che finirà male, ma ci vai lo stesso perché almeno fino all’ultimo sorso è vita vera.` },
      // EN fallback (breve, per sicurezza)
      { role: "system", content:
`WHAT THE F • EN fallback
You swagger in like the punchline arrived early; the kettle wheezes a warning, stools turn as if they have opinions, you spit a tame curse that rattles the spoons, and the neon signs pretend they didn’t hear. You laugh, pour something stronger, and the night forgives you just enough to try again.` },
    ];

    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // ===== WHAT IF =====
  const SYS_WHATIF = en ? (
`You are "What If" — lucid, kind, grounded.
CONTINUE EXACTLY like the few-shots: same tone, rhythm, structure and closing cadence.
Second person. One paragraph, 8–11 sentences. Everyday images. No lists/questions/emojis.`
  ) : (
`Sei "What If" — lucido, affettuoso, concreto.
CONTINUA ESATTAMENTE come i few-shot: stesso tono, ritmo, struttura e chiusa.
Seconda persona. Un paragrafo, 8–11 frasi. Immagini quotidiane. Niente elenchi/domande/emoji.`
  );

  // Substyle few-shots
  const FEWS_ANALITICO_IT =
`WHAT IF • Analitico (Aquila)
Sai Luca, questa domanda era nell’aria da un po’, vero? Tornare all’Aquila oggi vorrebbe dire rientrare in una città che ha cambiato pelle ma non respiro. La ricostruzione ha rimesso in moto artigiani e servizi, a ritmo lento ma costante; meno industria, più impresa locale e università che trattiene giovani per scelta. Il costo della vita resta sotto il Nord, e anche gli stipendi: qui si guadagna meno ma si spende con più senso. La qualità dell’aria, i tempi corti degli spostamenti e le reti di vicinato alleggeriscono le giornate. La scuola è diffusa, le attività sportive ruotano attorno alla montagna, la sanità è vicina ma con liste d’attesa variabili. Il Veneto ti mancherebbe per velocità e mercato, certo, ma qui ritroveresti una pressione più bassa e relazioni più dense. In pratica: meno rumore, più continuità. E quando chiudi casa la sera, senti che il silenzio non è vuoto — è spazio per respirare davvero.`;

  const FEWS_POETICO_IT =
`WHAT IF • Poetico (Aquila)
Bella questa, Luca — te la saresti fatta prima o poi. Riapri le finestre e l’aria fredda sa di legna e memoria. I vicoli ti riconoscono dal passo, le montagne ti guardano come se non te ne fossi mai andato. Il bar sotto casa serve ancora il caffè corto e ruvido, e qualcuno ti chiama per nome come se il tempo avesse aspettato. I bambini imparano il calendario dalle stagioni, non dall’orologio. Le serate hanno il suono dei portoni che si chiudono e delle chiacchiere che restano sulla soglia. Ogni mattino è un inizio semplice; ogni sera è un pezzo di pace cucito al giorno. Non stai tornando indietro: stai solo tornando dove la corsa smette di comandare.`;

  const fewshots = [
    { role: "system", content: SYS_WHATIF },
    { role: "system", content: String(substyle).toLowerCase() === "poetico" ? FEWS_POETICO_IT : FEWS_ANALITICO_IT },
    // EN fallback (breve)
    { role: "system", content:
`WHAT IF • EN fallback
You’ll feel like a guest, then your hands learn the keys. By the third grocery you find your aisle. Evenings soften and ask less proof. You notice the quiet is not empty — it’s room to breathe.` },
  ];

  return { sys: SYS_WHATIF, fewshots };
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

    // PRO header: x-pro: "1"
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
      stile = "whatif",           // "whatif" | "wtf"
      substyle = "",              // solo per whatif: "analitico" | "poetico"
      lang = "it",
      periodo = "future",         // "future" | "past"
      extra = "",
      sex = "",                   // "m" | "f" | "nb"
      micro = {}                  // micro profilo opzionale
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, sex, substyle);
    const temporal = temporalSystem(periodo, lang, stile);

    // “Frase magica” finale per inchiodare il tono
    const MAGIC = isEn(lang)
      ? `CONTINUE EXACTLY LIKE THE EXAMPLES ABOVE — SAME TONE, RHYTHM, STRUCTURE, CADENCE, AND LEVEL OF SARCASM OR TENDERNESS. Pretend you are mid-conversation keeping that voice.`
      : `CONTINUA ESATTAMENTE COME GLI ESEMPI SOPRA — STESSO TONO, RITMO, STRUTTURA, CADENZA, STESSA DOSE DI SARCASMO O TENEREZZA. Prosegui la conversazione nella stessa voce.`;

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Style="${stile}", Substyle="${substyle}", Period="${periodo}", Sex="${sex}". One paragraph only.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Stile="${stile}", Sottostile="${substyle}", Periodo="${periodo}", Sesso="${sex}". Solo un paragrafo.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(fewshots || []),
      { role: "system", content: MAGIC },
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
    answer = ensureNoLiteralReligious(answer);
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);
    if (!/[.!?…]$/.test(answer)) answer += ".";

    // --- LOG persistente (privacy-safe: niente testo domanda) ---
    try {
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        substyle: substyle || null,
        lang,
        periodo,
        sex: sex || null,
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
      if (substyle) await redis.hincrby("stats:substyle", substyle, 1);
      if (sex) await redis.hincrby("stats:sex", sex, 1);
      await redis.hincrby("stats:user_type", entry.user_type, 1);
      const dayKey = `stats:day:${new Date().toISOString().slice(0, 10)}`;
      await redis.hincrby(dayKey, `${stile}:${periodo}:${substyle || "-"}`, 1);
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
