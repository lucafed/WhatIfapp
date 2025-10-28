// /api/ask.js — What?f Engine (2025 REFRESH) // Stili: whatif:analitico · whatif:reale · wtf // IT/EN — paragrafo singolo, niente liste/domande/emoji // Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞ // Log su Redis SENZA contenuto della domanda (solo metadati + hash non reversibile)

import OpenAI from "openai"; import { Redis } from "@upstash/redis"; import { Ratelimit } from "@upstash/ratelimit";

/* ========================== OpenAI ========================== */ const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========================== Upstash Redis ========================== */ const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, });

// Rate limit: 10 req/min per IP (bypass SOLO per admin) const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m"), });

/* ========================== CORS ========================== */ const ALLOWED_ORIGINS = [ "https://what-ifapp.vercel.app", "http://localhost:3000", "http://127.0.0.1:5500", ]; function cors(req, res) { const origin = String(req.headers.origin || ""); if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro"); }

/* ========================== Utils ========================== */ const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

function normLine(s = "") { return String(s).toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ") .replace(/[.,;:!?()-—]+$/g, "").trim(); } function tightenSentences(text, maxSentences) { const parts = String(text || "").replace(/\n+/g, " ") .split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean); const out = []; const seen = new Set(); for (const p of parts) { const n = normLine(p); if (!n || seen.has(n)) continue; const wc = p.split(/\s+/).length; if (wc <= 3 && !/[.!?]$/.test(p)) continue; out.push(p); seen.add(n); if (out.length >= maxSentences) break; } let t = out.join(" "); if (!/[.!?…]$/.test(t)) t += "."; return t; } function clampWords(text, maxWords) { const w = String(text || "").split(/\s+/); if (w.length <= maxWords) return text; const slice = w.slice(0, maxWords).join(" "); const m = slice.match(/([\s\S]?[.!?])(?![\s\S][.!?])/); return m ? m[1] : slice + "…"; } function normalizeOneParagraph(s = "") { return String(s).replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ") .replace(/\s+([.,;:!?])/g, "$1").trim(); } function stripQuestionEcho(domanda, text) { const d = String(domanda || "").replace(/[“”"']/g, "").trim().toLowerCase(); let t = String(text || ""); const lead = t.slice(0, Math.min(t.length, d.length + 12)).toLowerCase().replace(/[“”"']/g, "").trim(); const echoRx = /^(?:e\sse|what\sif|domanda:|q:)[^.?!…]*[.?!…]\s+/i; if (lead.startsWith(d)) { const cut = t.indexOf("."); if (cut > -1) t = t.slice(cut + 1).trim(); } t = t.replace(echoRx, ""); return t; } function ensureSpicyButSafeWTF(t) { let out = String(t || "").trim(); if (!/[.!?…]$/.test(out)) out += "."; return out; } function tinyHash(s = "") { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

/* ========================== Admin check ========================== */ async function isAdmin(req, requesterIp) { const token = String(req.headers["x-admin-token"] || "").trim(); if (!token) return false; try { const data = await redis.hgetall(admin:token:${token}); // { ip, ua } if (!data) return false; const LOCK_IP = String(process.env.ADMIN_LOCK_IP || "false").toLowerCase() === "true"; if (LOCK_IP) { if (!data.ip) return false; return data.ip === requesterIp; } return true; } catch { return false; } }

/* ========================== Temporal mode ========================== */ function temporalSystem(periodo = "future", lang = "it", style = "whatif") { const en = isEn(lang); if (String(periodo || "").toLowerCase() === "past") { return en ? TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional, with quick present flashes. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice. : MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale con lampi di presente. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.; } return en ? TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice. : MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.; }

/* ========================== Jung micro-questions + memory (Redis) ========================== */ const MICRO_QUESTIONS = [ { id: "Q1", axis: "EI", text: "Quando hai energia: stare tra persone ti carica o preferisci ricaricare da solo?" }, { id: "Q2", axis: "EI", text: "In una serata libera: festa con amici o serata tranquilla con un libro?" }, { id: "Q3", axis: "SN", text: "Decidi meglio con fatti concreti o con intuizioni e possibilità?" }, { id: "Q4", axis: "SN", text: "Quando impari: esempi reali o concetti e pattern generali?" }, { id: "Q5", axis: "TF", text: "Nelle scelte difficili: priorità alla logica o all’impatto sulle persone?" }, { id: "Q6", axis: "TF", text: "Feedback: preferisci diretto e oggettivo o sensibile e contestualizzato?" }, { id: "Q7", axis: "JP", text: "Ti rassicura un piano definito o lasciare margine all’improvvisazione?" }, { id: "Q8", axis: "JP", text: "Scadenze: organizzi prima o spingi nel rush finale?" }, { id: "Q9", axis: "SN", text: "Ti orienti meglio con check-list pratiche o mappe concettuali?" }, { id: "Q10", axis: "TF", text: "In conflitto: ragioni sui fatti o sui valori in gioco?" }, { id: "Q11", axis: "EI", text: "Nuove persone: ti butti nella conversazione o osservi prima?" }, { id: "Q12", axis: "JP", text: "Viaggi: itinerario preciso o esplorazione libera?" }, ];

async function loadMemory(userId) { try { const raw = await redis.get(usermem:${userId}); return raw ? JSON.parse(raw) : { jung: { EI:0, SN:0, TF:0, JP:0, answersCount:0, snapshot: "----" }, microQAHistory: [], facts: [], lastUpdated: null, }; } catch { return { jung: { EI:0, SN:0, TF:0, JP:0, answersCount:0, snapshot: "----" }, microQAHistory: [], facts: [], lastUpdated: null }; } } async function saveMemory(userId, memory) { await redis.set(usermem:${userId}, JSON.stringify(memory), { ex: 606024*180 }); // 180 giorni } function updateJung(model, axis, answerScore) { model.jung[axis] = (model.jung[axis] || 0) + answerScore; model.jung.answersCount = (model.jung.answersCount || 0) + 1; const letter = (ax) => { const v = model.jung[ax] || 0; if (ax === "EI") return v >= 0 ? "E" : "I"; if (ax === "SN") return v >= 0 ? "S" : "N"; if (ax === "TF") return v >= 0 ? "T" : "F"; if (ax === "JP") return v >= 0 ? "J" : "P"; }; model.jung.snapshot = ${letter("EI")}${letter("SN")}${letter("TF")}${letter("JP")}; model.lastUpdated = new Date().toISOString(); return model; } function pickTodayQuestion(memory) { const answered = new Set(memory.microQAHistory.filter(x=>x.answer).map(x => x.id)); const candidates = MICRO_QUESTIONS.filter(q => !answered.has(q.id)); if (candidates.length) return candidates[0]; // se finite, ruota sul calendario const idx = (new Date().getDate() - 1) % MICRO_QUESTIONS.length; return MICRO_QUESTIONS[idx]; } function scoreFromAnswer(axis, answerText) { const t = String(answerText || "").toLowerCase(); if (axis === "EI") return /persone|festa|parlare|social/.test(t) ? +1 : /solo|tranquilla|da solo|silenzio/.test(t) ? -1 : 0; if (axis === "SN") return /fatti|concreto|pratico|checklist|dati/.test(t) ? +1 : /intuizion|vision|pattern|possibilit/.test(t) ? -1 : 0; if (axis === "TF") return /logica|criteri|oggettiv/.test(t) ? +1 : /persone|valori|empati|impatto/.test(t) ? -1 : 0; if (axis === "JP") return /piano|organizz|scadenze|programma/.test(t) ? +1 : /improvvis|flessibil|esplor/.test(t) ? -1 : 0; return 0; } function extractFacts(text) { return (String(text || "").match(/(?:preferisco|non voglio|sto cercando|mi serve|di solito)\s[^.]{3,80}./gi) || []) .map(s => s.trim()); } async function handleMicroQA({ userId, userInput, memory, forceAsk = false }) { const lastQ = memory.microQAHistory[memory.microQAHistory.length - 1]; if (lastQ && !lastQ.answer && userInput) { const scored = scoreFromAnswer(lastQ.axis, userInput); lastQ.answer = userInput; lastQ.score = scored; updateJung(memory, lastQ.axis, scored); await saveMemory(userId, memory); } const today = new Date().toISOString().slice(0,10); const already = memory.microQAHistory.some(x => x.date?.startsWith(today)); if (already && !forceAsk) return null; const q = pickTodayQuestion(memory); memory.microQAHistory.push({ id: q.id, axis: q.axis, question: q.text, date: new Date().toISOString(), answer: "", score: 0 }); await saveMemory(userId, memory); return q.text; }

/* ========================== Personas (voci) + Few-shots (dati utente) ========================== / function personaSystem(style, lang, sex = "", mode = "reale") { const SEX = String(sex || "").toLowerCase(); const genderNickIT = (SEX === "f") ? ["regina del casino", "fenomena", "asso di briscola", "capitana del caos", "sirena urbana", "signora dei forse", "rockstar con tacchi comodi"] : (SEX === "m") ? ["campione", "fenomeno", "asso", "capitano del caos", "sumo dei forse", "rockstar con le tasche vuote", "poeta del bar"] : ["leggenda", "fenomen", "asso universale", "cap* del caos", "rockstar del forse", "astronauta del dubbio"]; const genderNickEN = (SEX === "f") ? ["queen of chaos","ace of ‘maybe’","legend in sneakers","captain of detours"] : (SEX === "m") ? ["champ","legend","captain of chaos","rocket scientist of ‘maybe’"] : ["icon","legend","ace","captain of chaos"];

// WTF persona (con few-shot forniti da Luca) if (style === "wtf") { const SYS = (isEn(lang) ? You are “What the F” — the loud, loving friend who roasts with affection. SECOND PERSON. ONE paragraph, 6–8 sentences (~125–165 words). Simple, colloquial language. OPEN ONLY with a rotating nickname (no verbs). Include exactly one brief narrated blasphemy (“you let out a blasphemy that rattles the glasses”), never literal religious slurs. Alcohol beats and reacting-objects only when relevant. No lists, no questions, no emojis, no moralizing. Close warm and funny. : Sei “What the F” — l’amico rumoroso che ti prende in giro con affetto. SECONDA PERSONA. UN paragrafo, 6–8 frasi (~125–165 parole). Linguaggio semplice e colloquiale. APRI SOLO con un nomignolo (senza verbi). Inserisci esattamente una bestemmia narrata (“ti esce una bestemmia che fa tremare i bicchieri”), mai letterale. Alcol e oggetti che reagiscono solo quando serve. Niente elenchi, niente domande, niente emoji, niente prediche. Chiudi caldo e divertente.);

const FEWSHOTS = [
  // ☕ Bar
  { role: "system", content: `ESEMPIO IT • WHAT THE F — E se aprissi un bar?\nAh ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora: “questo al confessionale lo tengono in riserva”. Ti versi un goccio di liquore per calmare i santi e giuri che domani apri un bar solo per matti. Alla chiusura, il bancone ti guarda e tu, esausto, sussurri: “oggi ho bestemmiato più del prete quando finisce il vino — ma almeno ho servito verità calde”.` },
  // 🏍️ Moto
  { role: "system", content: `ESEMPIO IT • WHAT THE F — E se comprassi una moto?\nOh, eccoci, centauro dell’inferno! Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” talmente sonoro che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo, ma stavolta con affetto, tipo rito purificatore. Un vecchio ti dice “bella linea” e tu pensi che parlasse del nervo saltato. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio, con un sorrisetto da complice. Quando torni a casa senti ancora l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie bene calibrate.` },
  // 💘 Innamorarsi
  { role: "system", content: `ESEMPIO IT • WHAT THE F — E se mi innamorassi di nuovo?\nAh, Luisa… ci risiamo, eh? Ti butti nel cuore come in un pozzo vuoto, e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e tu senti salire la pressione sanguigna come se ti stesse caricando un peccato. Ti parte un “madonna della miseria impestata!” così sincero che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento di sistema, e tu bestemmi a mezza voce come se fosse una preghiera sbagliata. Poi sorridi, bevi un sorso di rosso e dici: “ogni mia storia finisce con una bestemmia e un brindisi — ma almeno bevo meglio di come amo.” La luna fuori ti guarda e, giuro, sembra che annuisca pure lei.` },
  // EN example (from your base)
  { role: "system", content: `EXAMPLE EN • WHAT THE F — Moving city (future)\nChamp, you arrive like a limited series pilot and the buzzer rolls its eyes; the fridge hums “good luck” while the streetlights do wardrobe tests, you walk too far just to tire the nerves and a tiny beer forgives your accent, you let out a blasphemy that rattles the glasses and the mailbox pretends it didn’t hear, by grocery three you find your aisle and your pace, and the map stops asking for proof — you’re not conquering a city, you’re landing your life.` },
];
return { sys: SYS, fewshots: FEWSHOTS, nickIT: genderNickIT, nickEN: genderNickEN };

}

// WHAT IF persona — modalità: analitico o reale (poetico) const baseSys = (isEn(lang) ? You are "What If" — lucid, kind, slightly ironic. SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words). Small truths; ordinary images (keys, streetlights, notebooks, hands, air). No lists, no questions, no emojis. End with a brief reflective line (not advice). : Sei "What If" — lucido e affettuoso. SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole). Verità piccole; immagini quotidiane (chiavi, lampioni, taccuini, mani, aria). Niente elenchi, domande o emoji. Chiudi con una riga riflessiva breve (non un consiglio).);

const FEWSHOTS_ANALITICO = [ { role: "system", content: ESEMPIO IT • WHAT IF — Analitico (Tornare all’Aquila)\nSai Luca, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo. }, { role: "system", content: EXAMPLE EN • WHAT IF — Analytic (Move city)\nYou’ll feel like a guest, then your hands learn the new keys. You’ll walk not to think better but to tire the noise. By the third grocery you’ll know which aisle is yours. Evenings soften and ask less proof. You’ll miss some things, not all at once. The rest finds its place. And you notice that beneath the noise something of yours was already there. }, ]; const FEWSHOTS_REALE = [ { role: "system", content: ESEMPIO IT • WHAT IF — Poetico/Reale (Tornare all’Aquila)\nBella questa, Luca — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome. }, ];

const FEWSHOTS = mode === "analitico" ? FEWSHOTS_ANALITICO : FEWSHOTS_REALE; return { sys: baseSys, fewshots: FEWSHOTS, nickIT: genderNickIT, nickEN: genderNickEN }; }

/* ========================== API Handler ========================== */ export default async function handler(req, res) { cors(req, res); if (req.method === "OPTIONS") return res.status(200).end(); if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

try { if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });

// IP richiedente
const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();

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
  stile = "whatif", // "whatif" | "wtf"
  lang = "it",
  extra = "",
  periodo = "future",
  sex = "",        // "m" | "f" | "nb" | ""
  mode = "reale",  // per whatif: "analitico" | "reale"
  userId = "",     // opzionale; fallback a IP
  wantMicro = false,// se true forza proposta micro-domanda del giorno
  micro = {},       // compat legacy
} = body;

if (!domanda || typeof domanda !== "string")
  return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

const resolvedSex = String(sex || micro?.sex || "").toLowerCase();
const uid = String(userId || ip);

// ===== Memoria =====
const memory = await loadMemory(uid);

// Salva facts dall'input utente (euristica breve)
const newFacts = extractFacts(domanda);
if (newFacts.length) {
  const set = new Set([...(memory.facts || []), ...newFacts]);
  memory.facts = Array.from(set).slice(-100);
  await saveMemory(uid, memory);
}

// Micro Q&A (salva eventuale risposta precedente nel campo extra, poi propone domanda del giorno se richiesto)
let microQuestion = null;
try {
  const maybeAnswer = String(extra || "").trim();
  microQuestion = await handleMicroQA({ userId: uid, userInput: maybeAnswer, memory, forceAsk: !!wantMicro });
} catch {}

// Personas + Temporal mode
const { sys, fewshots } = personaSystem(stile, lang, resolvedSex, mode);
const temporal = temporalSystem(periodo, lang, stile);

// Seed
const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${mode}`), 36) % 1000000;

const userFactsStr = (memory.facts || []).slice(-8).map(f => `- ${f}`).join("\n");
const jung = memory.jung || { snapshot: "----", EI:0, SN:0, TF:0, JP:0 };

// Prompt imitativo con memoria + Jung (sottile, non esplicitare)
const stylePrompt = isEn(lang)
  ? `You generate one response EXACTLY like the official demos for the selected voice.\nCONTEXT FACTS (recent):\n${userFactsStr || "- (none)"}\nJUNG SNAPSHOT: ${jung.snapshot} (tune only structure/lexicon subtly; do not mention it). Rules: no lists, no questions, no emojis, no meta. Close exactly like demos.`
  : `Genera UNA risposta ESATTAMENTE come nei demo della voce selezionata.\nCONTESTO (fatti recenti):\n${userFactsStr || "- (nessuno)"}\nJUNG SNAPSHOT: ${jung.snapshot} (modula solo lessico/struttura in modo sottile; non citarlo). Regole: niente elenchi, niente domande, niente emoji, niente meta. Chiudi come nei demo.`;

const extraWtfHardRule = (stile === "wtf") ? (isEn(lang)
  ? `Hard rules for WTF: one narrated blasphemy allowed (never literal), alcohol beats ok, “reacting objects” only when relevant, opening is ONLY a nickname (no verbs).`
  : `Regole dure per WTF: una sola bestemmia narrata (mai letterale), alcol ok, “oggetti che reagiscono” solo quando servono, apertura SOLO con nomignolo (senza verbi).`) : null;

const userPrompt = isEn(lang)
  ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Persona must adapt to user sex="${resolvedSex||"unknown"}" and mode="${mode}". INTERNAL SEED: ${seedNum}.`
  : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Adatta la voce al sesso utente="${resolvedSex||"unknown"}" e modalità="${mode}". SEED INTERNO: ${seedNum}.`;

const messages = [
  { role: "system", content: sys },
  { role: "system", content: temporal },
  { role: "system", content: stylePrompt },
  ...(fewshots || []),
  ...(extraWtfHardRule ? [{ role: "system", content: extraWtfHardRule }] : []),
  { role: "user", content: userPrompt },
];

// ===== OpenAI =====
const completion = await client.chat.completions.create({
  model: MODEL,
  temperature: stile === "wtf" ? 0.98 : 0.82,
  top_p: 0.92,
  max_tokens: 360,
  frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
  presence_penalty: stile === "wtf" ? 0.2 : 0.0,
  messages,
});

// ===== Post-process =====
let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
if (!answer) throw new Error("empty_model_response");
answer = stripQuestionEcho(domanda, answer);
answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
answer = clampWords(answer, stile === "wtf" ? 165 : 160);
answer = normalizeOneParagraph(answer);
if (stile === "wtf") answer = ensureSpicyButSafeWTF(answer);
else if (!/[.!?…]$/.test(answer)) answer += ".";

// ===== LOG (privacy-safe) =====
try {
  const entry = {
    ts: Date.now(), ip, style: stile, lang, periodo,
    sex: resolvedSex || null,
    domanda_len: String(domanda || "").length,
    domanda_hash: tinyHash(domanda || ""),
    answer_chars: (answer || "").length,
    admin: !!admin,
    user_type: bypass ? "admin" : (isPro ? "pro" : "free"),
    jung: (memory?.jung?.snapshot || "----"),
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
} catch (e) { console.warn("log failure (non-bloccante)", e); }

return res.status(200).json({
  answer,
  style: stile,
  mode,
  lang,
  periodo,
  model: MODEL,
  admin,
  pro: isPro,
  credits: bypass ? null : { used, dailyCap },
  microQuestion: microQuestion || null,
  jungSnapshot: memory?.jung?.snapshot || "----",
});

} catch (err) { console.error("❌ [/api/ask] error:", err); return res.status(500).json({ error: "server_error", detail: String(err?.message || err) }); } }
