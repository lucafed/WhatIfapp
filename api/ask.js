// /api/ask.js — What?f Engine (2025 FINAL+MEM)
// Stili: whatif (realismo lucido) · wtf (sarcasmo demenziale affettuoso, alcol, oggetti, “bestemmia” narrata)
// IT/EN — paragrafo singolo, niente liste / domande / emoji
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log e Memoria su Redis (memoria utente senza testo integrale della domanda)

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro, x-user-id");
}

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const today = () => new Date().toISOString().slice(0, 10);

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
  // Mantiene chiusura e presenza “bestemmia narrata” già prodotta dal modello; non aggiunge nulla.
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

/* ---------- Memoria a lungo termine (Redis) ---------- */
// Chiave: memory:user:<userId>
// { updatedAt, micro: {...}, notes: [ "Q#<hash>", ... ] }
const MEM_MAX_NOTES = 60;
async function readMemory(userId) {
  if (!userId) return null;
  try {
    const raw = await redis.get(`memory:user:${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
async function writeMemory(userId, data) {
  if (!userId) return;
  try {
    await redis.set(`memory:user:${userId}`, JSON.stringify(data), { ex: 60 * 60 * 24 * 180 }); // 6 mesi
  } catch {}
}

/* ---------- Modalità temporale ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if (String(periodo || "").toLowerCase() === "past") {
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional, with quick present flashes. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe andata. Preferisci passato/condizionale con lampi di presente. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) + FEW-SHOTS esatti ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — the loud, loving friend who roasts with affection.
SECOND PERSON. ONE paragraph, 6–8 sentences (~125–165 words).
HARD RULES:
- OPEN exactly with "Ah," (no nickname, no verbs before it).
- Include ONE brief, adult narrated blasphemy (never literal), then TWO immediate reaction beats (objects/people/animals reacting in sequence).
- Use alcohol beats and “reacting objects” only when relevant (not random).
- No lists. No questions. No emojis. No moralizing. Keep bar-sarcasm, warm and human.
Return ONLY the paragraph.
`.trim()
      : `
Sei “What the F” — l’amico rumoroso che ti vuole bene e ti prende in giro con affetto.
SECONDA PERSONA. UN paragrafo, 6–8 frasi (~125–165 parole).
REGOLE DURE:
- APRI esattamente con "Ah," (senza nomignoli, senza verbi prima).
- Inserisci UNA sola “bestemmia narrata” (mai letterale), poi DUE reazioni a catena (oggetti/persone/animali che reagiscono subito).
- Battute con alcol e “oggetti che reagiscono” solo quando servono.
- Niente elenchi, niente domande, niente emoji, niente prediche. Tono sarcastico ma affettuoso.
Restituisci SOLO il paragrafo.
`.trim());

    // Few-shots: i TUOI testuali, identici
    const FEWSHOTS = [
      { role: "system", content:
`WTF • ☕ E se aprissi un bar?
Ah, ma guarda un po’, il genio dell’espresso che si sveglia con la vocazione imprenditoriale. Ti vedo: grembiule nuovo, sorriso da spot pubblicitario, la moka che sibila come un vecchio nonno stanco di vivere. Arriva il primo cliente, chiede un cappuccino “senza schiuma, ma caldo, però freddo dentro” e già ti parte la pressione. Tentando l’impossibile, ti bruci un dito e ti scappa un “porca di quella schiuma sorda e bastarda!”: le tazzine vibrano come castagnette e il cucchiaino va in sciopero. Il frigo rantola, la macchina del caffè fa un ruttino di protesta, e una vecchietta ti guarda come se avessi bestemmiato in latino. Tu versi un goccio di grappa nel caffè e pensi: almeno oggi ho aperto un locale che fa ridere anche i mobili. Quando chiudi la sera, il bancone sospira “ce la rifacciamo domani, capo?” — e tu annuisci, col fegato in disarmo ma il morale alto.` },
      { role: "system", content:
`WTF • 🏍️ E se comprassi una moto?
Ah, eccoci, il nuovo Valentino del parcheggio condominiale. Giacca di pelle lucida, casco nuovo e orgoglio che fa attrito. Accendi il motore: romba come un drago epilettico e già ti senti immortale. Poi un piccione ti taglia la strada e ti parte un “porca di quella frizione ubriaca e maledetta!”: il cane del quartiere ulula in do maggiore e il semaforo si gira dall’altra parte per la vergogna. Riparti come se niente fosse, ma il cavalletto resta giù e ti fa uno sgambetto da bullo: “mannaggia al ferro storto che ti ha creato!”. Ti fermi al bar, ordini un Negroni, il barista ti versa due dita extra “per compassione”. Alla fine ridi, imprechi piano un’ultima volta, e capisci che la moto non è un’uscita di sicurezza: è un modo elegante di cadere con stile.` },
      { role: "system", content:
`WTF • 🏍️ Variante moscerino / “grappa fulminata”
Ah, la moto, eh? Casco lucido e petto gonfio come se stessi per salvare il mondo da solo. Parti fiero, il vento ti canta l’inno della libertà… finché un moscerino decide che il tuo dente è la pista d’atterraggio del secolo e ti scappa un “porca di quella grappa fulminata!” così rotondo che la visiera vibra indignata e il semaforo trema per la paura. Ti fermi al bar per lavare la dignità: Negroni bello carico; il bicchiere ride e il barista ti fa l’occhiolino — “Campione, oggi la strada t’ha menato come un tamburo.” Bevi, sospiri, e mentre il vento ti asciuga la figuraccia, capisci che non serviva correre: bastava ridere, forte, come il motore quando finge di essere te.` },
      { role: "system", content:
`WTF • 💔 E se mi innamorassi di nuovo? (versione femminile)
Ah, Luisa… di nuovo tu, eh? Ogni volta che dici “stavolta ci penso bene”, un prosecco stappa da solo da qualche parte. Vestita bene ma con l’occhio lucido, messaggi che cancelli e riscrivi come se stessi trattando un’adozione internazionale. Lui ti visualizza e non risponde — e ti scappa un “porca di quella chat maledetta e dell’algoritmo suo zio!”: la lampada vibra offesa e il gatto si infila dietro la lavatrice. Il bicchiere di vino si riempie da solo per compassione; tu sospiri e imprecchi con grazia da signora disperata. “Vabbè, almeno stavolta sapevo dove mi andavo a schiantare”, ti dici. Tra una risata e un rutto di rosé capisci che innamorarsi è come un aperitivo: finirà storto, ma finché dura è vita vera.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF (analitico/poetico) — i few-shot “Aquila” esatti
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind, slightly ironic friend.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words).
Warm, grounded, simple; ordinary images. Small truths; no heroics.
No lists, no questions, no emojis. Short reflective closing.
`.trim()
    : `
Sei "What If" — amico lucido e affettuoso, col sorriso pratico.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole).
Immagini quotidiane, verità piccole e vere. Nessun eroismo.
Niente elenchi, niente domande, niente emoji. Chiusura riflessiva breve.
`.trim());

  const FEWSHOTS = [
    { role: "system", content:
`WHAT IF • Analitico (Aquila)
Rientrare oggi all’Aquila significa ritrovare una città che ha cambiato pelle ma non respiro. La ricostruzione ha rimesso in moto artigiani e servizi con un passo costante; meno industria, più impresa locale e università che trattiene per scelta. Il costo della vita resta inferiore al Nord e così anche gli stipendi: si guadagna meno, ma si spende con più senso. I tempi di spostamento sono corti, l’aria è più leggera, le reti di vicinato fanno da ammortizzatore. La scuola è diffusa, lo sport guarda alla montagna, la sanità è vicina ma con liste d’attesa a macchia di leopardo. Il Veneto ti mancherebbe per velocità e mercato, ma qui recupereresti pressione bassa e relazioni dense. In pratica: meno rumore, più continuità. E quando chiudi casa la sera, il silenzio non è vuoto — è spazio per respirare.` },
    { role: "system", content:
`WHAT IF • Poetico (Aquila)
Riapri le finestre e l’aria fredda sa di legna e memoria. I vicoli ti riconoscono dal passo, le montagne ti guardano come se non te ne fossi mai andato. Il bar sotto casa serve ancora il caffè corto e ruvido, e qualcuno ti chiama per nome come se il tempo avesse aspettato. I bambini imparano il calendario dalle stagioni, non dall’orologio. Le serate hanno il suono dei portoni che si chiudono e delle chiacchiere che restano sulla soglia. Ogni mattino è un inizio semplice; ogni sera è un pezzo di pace cucito al giorno. Non stai tornando indietro: stai tornando dove la corsa smette di comandare.` },
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
    const isProUser = String(req.headers["x-pro"] || "").trim() === "1";

    // Rate limit 10/min (se non bypass)
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // Crediti giornalieri: Admin ∞, PRO 10, Free 3
    let used = 0, dailyCap = isProUser ? 10 : 3;
    if (!bypass) {
      const key = `credits:${ip}:${today()}`;
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
      stile = "whatif",          // "whatif" | "wtf"
      lang = "it",
      extra = "",
      periodo = "future",        // "future" | "past"
      sex = "",                  // "m" | "f" | "nb"
      micro = {},                // micro-profile (incl. jung/jang, mood, ecc.)
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    // UserID per memoria (se non c’è, fallback IP)
    const userId = String(req.headers["x-user-id"] || ip || "anon").slice(0, 160);
    const memPrev = (await readMemory(userId)) || { updatedAt: 0, micro: {}, notes: [] };

    // Merge micro + nota domanda
    const domandaHash = tinyHash(domanda);
    const notes = Array.isArray(memPrev.notes) ? memPrev.notes.slice(-MEM_MAX_NOTES) : [];
    notes.push(`Q#${domandaHash}`);
    const memNow = {
      updatedAt: Date.now(),
      micro: { ...(memPrev.micro || {}), ...(micro || {}) },
      notes,
    };
    await writeMemory(userId, memNow);

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang);
    const temporal = temporalSystem(periodo, lang, stile);

    // System con memoria (sobrio e non identificabile)
    const memSnippet = (() => {
      const chunks = [];
      if (memNow.micro && Object.keys(memNow.micro).length)
        chunks.push(`Micro:${JSON.stringify(memNow.micro)}`);
      if (memNow.notes?.length) chunks.push(`Recent:${memNow.notes.slice(-12).join(",")}`);
      return chunks.length ? `Long-term context to subtly reuse: ${chunks.join(" | ")}.` : "";
    })();

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona voice.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce della persona.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(memSnippet ? [{ role: "system", content: memSnippet }] : []),
      // Few-shots come system (immutabili, zero istruzioni vecchie)
      ...(fewshots || []),
      // Regole di chiusura rigidissime
      { role: "system", content: isEn(lang)
          ? `STRICT OUTPUT: one single paragraph. ${stile === "wtf" ? "6–8 sentences." : "8–11 sentences."} No lists. No questions. No emojis. No restating the question.`
          : `OUTPUT RIGIDO: un solo paragrafo. ${stile === "wtf" ? "6–8 frasi." : "8–11 frasi."} Niente elenchi. Niente domande. Niente emoji. Non ripetere la domanda.` },
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
    answer = clampWords(answer, stile === "wtf" ? 165 : 160);
    answer = normalizeOneParagraph(answer);
    if (stile === "wtf") {
      // Deve iniziare con "Ah," e contenere la doppia reazione
      if (!/^Ah,\s/.test(answer)) answer = "Ah, " + answer.replace(/^[-–—\s]+/, "");
      answer = ensureSpicyButSafeWTF(answer);
    } else {
      if (!/[.!?…]$/.test(answer)) answer += ".";
    }

    // --- LOG persistente (privacy-safe: niente testo domanda) ---
    try {
      const entry = {
        ts: Date.now(),
        ip,
        userId,
        style: stile,
        lang,
        periodo,
        domanda_len: String(domanda || "").length,
        domanda_hash: domandaHash,
        answer_chars: (answer || "").length,
        admin: !!admin,
        user_type: bypass ? "admin" : (isProUser ? "pro" : "free"),
      };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", 0, 9999);
      await redis.incr("stats:total");
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo || "future"), 1);
      await redis.hincrby("stats:user_type", entry.user_type, 1);
      const dayKey = `stats:day:${today()}`;
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
      pro: isProUser,
      credits: bypass ? null : { used, dailyCap },
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
