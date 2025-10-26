// /api/ask.js — What?f Engine (2025 FINAL, persona-aware + memoria + imprecazioni contestuali)
// Stili: whatif (reale/poetico/analitico) · wtf (sarcasmo demenziale affettuoso, “bestemmia” narrata in-scena)
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

const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

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
function tinyHash(s = "") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

async function isAdmin(req, requesterIp) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const data = await redis.hgetall(`admin:token:${token}`);
    if (!data) return false;
    const LOCK_IP = String(process.env.ADMIN_LOCK_IP || "false").toLowerCase() === "true";
    if (LOCK_IP) return data.ip && data.ip === requesterIp;
    return true;
  } catch { return false; }
}

/* ---------- Modalità temporale ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if (String(periodo || "").toLowerCase() === "past") {
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional, quick present flashes. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe andata. Preferisci passato/condizionale con lampi di presente. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding now. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex = "", tono = "") {
  const SEX = String(sex || "").toLowerCase();
  const genderNickIT = (SEX === "f")
    ? ["regina del casino","fenomena","asso di briscola","capitana del caos","sirena urbana","signora dei forse","rockstar con tacchi comodi"]
    : (SEX === "m")
      ? ["campione","fenomeno","asso","capitano del caos","sumo dei forse","rockstar con le tasche vuote","poeta del bar"]
      : ["leggenda","fenomen*","asso universale","cap* del caos","rockstar del forse","astronauta del dubbio"];
  const genderNickEN = (SEX === "f")
    ? ["queen of chaos","ace of ‘maybe’","legend in sneakers","captain of detours"]
    : (SEX === "m")
      ? ["champ","legend","captain of chaos","rocket scientist of ‘maybe’"]
      : ["icon","legend","ace","captain of chaos"];

  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — the loud, loving friend who roasts with affection.
SECOND PERSON. ONE paragraph, 6–8 sentences (~125–165 words). Colloquial.
OPEN with ONLY a rotating nickname (no verbs).
Keep quips flowing (3–5 short jabs) but earned by the scene; use “reacting objects” only when relevant.
Include exactly one brief, narrated blasphemy tied to a concrete event (parking, moka, paperwork, bus, site, street). Never literal religious slurs.
STRICT: no lists, no questions, no emojis, no preaching. Respect TEMPORAL MODE. Close warm + funny.
Nicknames (EN): ${genderNickEN.join(", ")}.
`.trim()
      : `
Sei “What the F” — amico rumoroso, affettuoso e pungente.
SECONDA PERSONA. UN paragrafo, 6–8 frasi (~125–165 parole). Colloquiale.
Apertura SOLO con un nomignolo (senza verbi).
BATTUTE continue ma motivate (3–5 stoccate brevi); “oggetti che reagiscono” solo se servono alla scena.
Una sola bestemmia narrata, legata a un evento preciso (parcheggio, moka, sportello, autobus, cantiere, strada). Mai letterale.
RIGIDO: niente elenchi, niente domande, niente emoji, niente prediche. Rispetta la MODALITÀ TEMPORALE. Chiudi caldo e divertente.
Nomignoli (IT): ${genderNickIT.join(", ")}.
`.trim());

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Rientro in città (futuro)
Pellegrino del ritorno, scendi con la valigia che scricchiola dignità, il marciapiede ti riconosce e ti fa lo sconto sul dubbio; al bar la tazzina fa spallucce “di nuovo?”, il parcheggio è una coreografia sbagliata e quando centri il marciapiede per la terza volta ti scappa una bestemmia teatrale che mette in riga i piccioni, la saracinesca finge di non aver sentito e due facce ti chiamano per nome: non stai tornando indietro, stai tornando intero.` },
      { role: "system", content:
`EXAMPLE EN • New flat (future)
Champ, the intercom rolls its eyes, the fridge hums “good luck”, the box cutter opens like a small miracle; you take a victory lap with the trash, miss the recycling chute twice, you drop a theatrical curse that rattles the glasses and even the hallway coughs politely, then the lamp finds the angle and the room decides you’re allowed.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — tre toni
  const tone = String(tono || "").toLowerCase(); // "reale" | "poetico" | "analitico"
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind, slightly ironic friend. SECOND PERSON.
One paragraph, 8–11 sentences (~115–160 words). No lists, no questions, no emojis.
TONE=${tone||'reale'}:
- reale: grounded, ordinary details (keys, streetlights, notebooks, hands, air), warm, concrete, close with a short reflective line.
- poetico: light imagery, soft cadence, no purple prose, end with a delicate noticing.
- analitico: compact causal links, criteria/impact language inline (no bullets), still human, brief reflective close.
`.trim()
    : `
Sei "What If" — un amico lucido e affettuoso. SECONDA PERSONA.
Un paragrafo, 8–11 frasi (~115–160 parole). Niente elenchi, niente domande, niente emoji.
TONO=${tone||'reale'}:
- reale: dettagli quotidiani (chiavi, lampioni, taccuini, mani, aria), caldo e concreto, chiusa riflessiva breve.
- poetico: immagini leggere, ritmo morbido, zero zucchero, chiusa come constatazione quieta.
- analitico: nessi causa-effetto, lessico da criteri/impatti dentro al flusso (no bullet), umano, chiusa breve.
`.trim());

  const FEWSHOTS = [
    { role: "system", content:
`ESEMPIO IT • Reale
Metti le chiavi sul piattino e ti sembra di rimettere a posto una parte tua. La strada conosce ancora i tuoi passi, anche se i negozi hanno cambiato tende. All’inizio la lentezza punge, poi si mette a lavorare per te: toglie rumore, lascia ritmo. I volti sono simili, lo sguardo no: sai cosa ti pesa e cosa tiene in piedi le giornate. Torni a comprare il pane dove ti chiamano per nome e non è nostalgia, è manutenzione. La sera l’aria è più netta: senti quello che conta senza doverlo spiegare. Non serve ripartire da zero: basta ripartire da dove sei rimasto.` },
    { role: "system", content:
`ESEMPIO IT • Poetico
La città ti aspetta senza fretta, come un tavolo sparecchiato che conserva il calore. I lampioni si accendono uno alla volta, come se provassero a ricordarti il percorso. Le mani imparano di nuovo le chiavi, il quaderno di cucina recupera appunti che non sapevi di avere. Le montagne tengono il posto al silenzio, tu ci entri piano e il respiro prende misura. Il resto scivola in fondo alla stanza: rimane ciò che serve, con un nome semplice.` },
    { role: "system", content:
`ESEMPIO IT • Analitico
Restare qui avrebbe ottimizzato supporto familiare e tempo logistico, ma ridotto occasioni forti di crescita. Tu conosci già strade e abitudini: la curva di adattamento sarebbe stata corta, il costo mentale più basso. I bambini avrebbero guadagnato prossimità coi nonni, tu margini di calma. In cambio, meno stimoli e reti nuove. Avresti compensato con scelte precise: orari, routine, due luoghi stabili. Alla sera la città ti avrebbe restituito chiarezza: non migliore in assoluto, migliore per quello che volevi tenere.` },
  ];

  return { sys: SYS_WHATIF, fewshots: FEWSHOTS };
}

/* ---------- IMPRECATION ENGINE (WTF) ---------- */
const IMPRECATION_BANK = {
  it: {
    parcheggio: [
      "ti scappa una bestemmia teatrale che mette in riga i piccioni",
      "sbotti con una bestemmia d’arte che fa vibrare i vetri del bar",
      "lasci andare una maledizione poetica che si incastra tra i sampietrini",
      "spari una bestemmia con dignità e il lampione fa finta di non sentire",
      "ti vien giù una bestemmia corale e il marciapiede si scansa di mezzo passo"
    ],
    cucina: [
      "ti scappa una bestemmia d’arte che rimbalza tra i pensili",
      "parte una maledizione domestica e la moka arrossisce",
      "ti esce una bestemmia teatrale che sveglia la calamita del frigo",
      "tiri fuori una bestemmia elegante e il cucchiaino si mette in posa",
      "butti lì una bestemmia con la schiuma del caffè ancora viva"
    ],
    burocrazia: [
      "sputi una bestemmia amministrativa e il timbro fa straordinari",
      "ti scappa un’imprecazione con ricevuta e il modulo smette di ridere",
      "parte una bestemmia protocollata e il numerino finge di avanzare",
      "esce una bestemmia sindacale e la penna firma da sola",
      "molli una bestemmia in triplice copia e il faldone ti saluta"
    ],
    trasporti: [
      "ti scappa un urlo sacro e l’autobus fa finta di arrivare prima",
      "molli una bestemmia a tutto petto e la palina arrossisce",
      "esplode una maledizione feriale e i piccioni applaudono",
      "ti esce una bestemmia da capolinea e il parabrezza scricchiola",
      "sospiri un’imprecazione e il semaforo diventa timido"
    ],
    cantiere: [
      "srotoli una bestemmia geologica e la rete arancione applaude",
      "lanci una bestemmia di cantiere e il casco ti fa l’inchino",
      "ti scappa un’imprecazione in muratura e la betoniera si impunta",
      "molli una bestemmia a norma UNI e il cartello 'fine lavori' prende ferie",
      "tiri fuori una maledizione con i guanti e la cazzuola fa ciao"
    ],
    strada: [
      "ti scappa una bestemmia teatrale e il vento fa finta di non sentire",
      "lanci una maledizione poetica e il marciapiede si sposta",
      "ti esce una bestemmia con educazione e la città alza le spalle",
      "borbotti una bestemmia antica e l’eco te la rimanda firmata",
      "parte una bestemmia di quartiere e il cestino fischia"
    ],
  },
  en: {
    parking: [
      "you drop a theatrical curse that makes the pigeons line up",
      "you fire a crafted curse and the café windows hum",
      "a poetic malediction gets stuck between cobblestones and laughs",
      "a full-chested oath lands and the streetlight pretends not to hear",
      "you unload a chorus-level curse and the curb shifts aside"
    ],
    kitchen: [
      "a craftsman’s curse ricochets off the cabinets",
      "a domestic malediction pops and the moka blushes",
      "a stage-blasphemy wakes the fridge magnet",
      "a literary curse drops and the spoon takes a bow",
      "you let out a bark of a curse and the coffee stands at attention"
    ],
    paperwork: [
      "you spit a bureaucratic curse and the stamp does overtime",
      "a receipt-level curse and the form stops smirking",
      "a protocol malediction erupts and the ticket number pretends to move",
      "a union-grade curse signs the page for you",
      "you launch a three-copy curse and the folder salutes"
    ],
    transit: [
      "you let out a sacred bark and the bus pretends to come early",
      "an artisan curse pops and the stop pole glows with shame",
      "a weekday malediction flutters the pigeons like applause",
      "a chesty curse makes the windshield creak",
      "you sigh a curse and the light goes pink with guilt"
    ],
    site: [
      "you unroll a geologic curse that shakes dust from three contracts",
      "a masonry oath drops and the hard hat tips back",
      "a cast-concrete curse rumbles and the mixer stalls",
      "a standards-compliant blasphemy lands and the sign reschedules",
      "a glove-ready curse and the trowel waves"
    ],
    street: [
      "a theatrical curse slips out and the wind pretends not to hear",
      "you toss a poetic malediction and the curb shifts a half step",
      "a dignified oath leaves your mouth and the lamp plays secular priest",
      "a postcard blasphemy echoes back with your name on it",
      "an ancient grumble-curse and the city answers with a shrug"
    ],
  }
};
function pickFrom(arr, seed=0){ if(!arr?.length) return ""; const idx=Math.abs(seed)%arr.length; return arr[idx]; }
function detectTrigger(domanda, outText, lang){
  const t=(domanda+" "+outText).toLowerCase();
  if (lang.startsWith("en")) {
    if (/(parking|parallel|car park|spot)/.test(t)) return "parking";
    if (/(coffee|moka|kitchen|spoon|cup)/.test(t)) return "kitchen";
    if (/(paperwork|bureaucracy|office|stamp|counter)/.test(t)) return "paperwork";
    if (/(bus|tram|stop|traffic light|red light)/.test(t)) return "transit";
    if (/(site|works|construction|fence)/.test(t)) return "site";
    return "street";
  } else {
    if (/(parchegg|striscia|posteggi|retromarcia)/.test(t)) return "parcheggio";
    if (/(moka|cucchiaino|cucina|caff[èe]|pentola|fornello)/.test(t)) return "cucina";
    if (/(burocrazi|sportello|modulo|timbro|ufficio|anagrafe)/.test(t)) return "burocrazia";
    if (/(autobus|palina|semaforo|corse|ritardo|tram)/.test(t)) return "trasporti";
    if (/(cantiere|betoniera|reti arancioni|fine lavori)/.test(t)) return "cantiere";
    return "strada";
  }
}
function injectImprecationInline(text, imp){
  const rx = /([.!?…—,])\s/;
  const m = rx.exec(text);
  if(!m) return `${text} ${imp}.`;
  const idx = m.index + m[0].length;
  const before = text.slice(0, idx);
  const after  = text.slice(idx);
  return `${before}${imp.charAt(0).toUpperCase()}${imp.slice(1)}. ${after}`;
}
function ensureSpicyButSafeWTF(t, lang, seed=0, domanda="") {
  // Fallback SOLO se il modello non ha già prodotto la bestemmia narrata
  let out = String(t || "").trim();
  if (!out) return out;
  const already = /(bestemmi|maledizion|sacro|curse|oath|maledict)/i.test(out);
  if (!already) {
    const trigger = detectTrigger(domanda, out, (lang||"it").toLowerCase());
    const localeKey = (String(lang).toLowerCase().startsWith("en")) ? "en" : "it";
    const bank = IMPRECATION_BANK[localeKey][trigger] || IMPRECATION_BANK[localeKey].street;
    const imp = pickFrom(bank, seed % 999);
    out = injectImprecationInline(out, imp);
  }
  if (!/[.!?…]$/.test(out)) out += ".";
  return out;
}

/* ---------- Lessico (What If) ---------- */
function varyLexiconWhatIf(text, lang="it"){
  let t = String(text||"");
  const swaps_it = [
    [/chiavi\b/gi, ()=>["chiavi","il mazzo","metallo freddo","il mazzo in tasca","la chiave grande"][Math.floor(Math.random()*5)]],
    [/lampioni\b/gi, ()=>["lampioni","pali della luce","luci di strada","lampade in fila"][Math.floor(Math.random()*4)]],
    [/taccuini?\b/gi, ()=>["taccuino","quaderno","notes","foglio piegato"][Math.floor(Math.random()*4)]],
    [/aria\b/gi, ()=>["aria","respiro","fiato","odore di casa"][Math.floor(Math.random()*4)]],
  ];
  const swaps_en = [
    [/keys\b/gi, ()=>["keys","keyring","cold metal","that ring in your palm"][Math.floor(Math.random()*4)]],
    [/streetlights\b/gi, ()=>["streetlights","lamps","poles","evening lights"][Math.floor(Math.random()*4)]],
    [/notebooks?\b/gi, ()=>["notebook","journal","pad","folded page"][Math.floor(Math.random()*4)]],
    [/air\b/gi, ()=>["air","breath","quiet","home-smell"][Math.floor(Math.random()*4)]],
  ];
  for(const [rx,fn] of (lang.startsWith("en")?swaps_en:swaps_it)) t = t.replace(rx, fn());
  return t;
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
      tono = ""  // <-- NEW: "reale" | "poetico" | "analitico" (solo per whatif)
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();
    const resolvedTono = String(tono || micro?.tono || "").toLowerCase();

    // Personas + Temporal + Tone
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex, resolvedTono);
    const temporal = temporalSystem(periodo, lang, stile);

    // Jung (influenza invisibile)
    const jung = String(micro?.jung || "").toUpperCase();
    const jungHint = (!jung) ? "" : (isEn(lang) ? ({
      S:"Favor concrete sensory details, routines, here-and-now precision.",
      N:"Favor light imagery and possibilities.",
      T:"Favor crisp causal links and criteria.",
      F:"Favor warm atmosphere, values, people cues."
    }[jung]) : {
      S:"Preferisci dettagli concreti, routine e precisione dell’adesso.",
      N:"Preferisci immagini leggere e possibilità.",
      T:"Preferisci nessi chiari e criteri essenziali.",
      F:"Preferisci atmosfera calda, valori e segnali delle persone."
    }[jung]);

    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${jung||""}|${resolvedTono||""}`), 36) % 1000000;

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Persona must adapt to user sex="${resolvedSex||"unknown"}" and tone="${resolvedTono||"reale"}". INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Adatta la voce al sesso utente="${resolvedSex||"unknown"}" e tono="${resolvedTono||"reale"}". SEED INTERNO: ${seedNum}.`;

    // Memoria lunga (hint non visibile)
    let memObj = {};
    try {
      const raw = await redis.get(`mem:${ip}:v2`);
      memObj = raw ? JSON.parse(raw) : {};
    } catch {}

    const memoryHint = (() => {
      if (!memObj || typeof memObj !== "object") return "";
      const items = [];
      if (memObj.lastStyle) items.push(isEn(lang) ? `prev style: ${memObj.lastStyle}` : `stile precedente: ${memObj.lastStyle}`);
      if (memObj.lastLang) items.push(isEn(lang) ? `prev lang: ${memObj.lastLang}` : `lingua precedente: ${memObj.lastLang}`);
      if (memObj.lastPeriodo) items.push(isEn(lang) ? `prev temporal: ${memObj.lastPeriodo}` : `modalità precedente: ${memObj.lastPeriodo}`);
      if (memObj.lastTono) items.push(isEn(lang) ? `prev tone: ${memObj.lastTono}` : `tono precedente: ${memObj.lastTono}`);
      if (memObj.lastSex) items.push(isEn(lang) ? `sex hint: ${memObj.lastSex}` : `sesso: ${memObj.lastSex}`);
      if (memObj.lastJung) items.push(isEn(lang) ? `Jung: ${memObj.lastJung}` : `Jung: ${memObj.lastJung}`);
      return items.length ? (isEn(lang) ? `Memory: ${items.join(" · ")}.` : `Memoria: ${items.join(" · ")}.`) : "";
    })();

    const messages = [
      ...(jungHint ? [{ role:"system", content: jungHint }] : []),
      ...(memoryHint ? [{ role:"system", content: memoryHint }] : []),
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(fewshots || []),
      { role: "system", content: isEn(lang)
          ? `WTF rules: one narrated blasphemy tied to an event; quips 3–5; reacting objects only if helpful; opening ONLY a nickname.`
          : `Regole WTF: una bestemmia narrata legata a un evento; 3–5 stoccate; oggetti reattivi solo se servono; apertura SOLO un nomignolo.` },
      { role: "user", content: userPrompt },
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : (resolvedTono==="analitico" ? 0.70 : 0.82),
      top_p: 0.92,
      max_tokens: 380,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.12,
      presence_penalty: stile === "wtf" ? 0.25 : 0.05,
      messages,
    });

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

    try {
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
        tono: resolvedTono || null,
        sex: resolvedSex || null,
        domanda_len: String(domanda || "").length,
        domanda_hash: tinyHash(domanda || ""),
        answer_chars: (answer || "").length,
        user_type: bypass ? "admin" : (isPro ? "pro" : "free"),
      };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", 0, 9999);
      await redis.incr("stats:total");
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo || "future"), 1);
      if (resolvedSex)  await redis.hincrby("stats:sex", resolvedSex, 1);
      if (resolvedTono) await redis.hincrby("stats:tono", resolvedTono, 1);
      const dayKey = `stats:day:${new Date().toISOString().slice(0, 10)}`;
      await redis.hincrby(dayKey, `${stile}:${periodo}`, 1);
      await redis.expire(dayKey, 90 * 24 * 60 * 60);
    } catch {}

    // Memoria v2 (30 giorni)
    try {
      const snap = {
        lastStyle: stile,
        lastLang: lang,
        lastPeriodo: periodo,
        lastTono: resolvedTono || null,
        lastSex: resolvedSex || null,
        lastJung: jung || null,
        lastSeed: seedNum
      };
      await redis.set(`mem:${ip}:v2`, JSON.stringify(snap), { ex: 60 * 60 * 24 * 30 });
    } catch {}

    return res.status(200).json({
      answer, style: stile, lang, periodo, tono: resolvedTono || null,
      model: MODEL,
      admin: bypass,
      pro: isPro,
      credits: bypass ? null : { used, dailyCap },
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
