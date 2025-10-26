// /api/ask.js — What?f Engine (2025 FINAL, persona-aware + memoria + imprecazioni contestuali)
// Stili: whatif (realismo lucido) · wtf (sarcasmo demenziale affettuoso, alcol, oggetti, "bestemmia" narrata in-scena)
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
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""
  const genderNickIT = (SEX === "f")
    ? ["regina del casino", "fenomena", "asso di briscola", "capitana del caos", "sirena urbana", "signora dei forse", "rockstar con tacchi comodi"]
    : (SEX === "m")
      ? ["campione", "fenomeno", "asso", "capitano del caos", "sumo dei forse", "rockstar con le tasche vuote", "poeta del bar"]
      : ["leggenda", "fenomen*", "asso universale", "cap* del caos", "rockstar del forse", "astronauta del dubbio"];
  const genderNickEN = (SEX === "f")
    ? ["queen of chaos","ace of ‘maybe’","legend in sneakers","captain of detours"]
    : (SEX === "m")
      ? ["champ","legend","captain of chaos","rocket scientist of ‘maybe’"]
      : ["icon","legend","ace","captain of chaos"];

  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — the loud, loving friend who roasts with affection.
SECOND PERSON. ONE paragraph, 6–8 sentences (~125–165 words). Simple, colloquial language.
OPEN with ONLY a rotating nickname (no verbs around it): pick one that fits the user’s vibe.
Inject alcohol beats and “reacting objects” only when they serve the scene (never random).
Include exactly one brief, narrated blasphemy moment (e.g., “you let out a theatrical curse that rattles the glasses”), never write literal religious slurs.
Insults must be earned by context and end up affectionate; tone stays upbeat and human.
STRICT: no lists, no questions, no emojis, no moralizing. Respect TEMPORAL MODE.
Close warm and funny, like a shoulder-laugh, not a lecture.
Nicknames pool (EN): ${genderNickEN.join(", ")}.
SEED: vary imagery by this number.
`.trim()
      : `
Sei “What the F” — l’amico rumoroso che ti vuole bene e ti prende in giro con affetto.
SECONDA PERSONA. UN paragrafo, 6–8 frasi (~125–165 parole). Lingua semplice e colloquiale.
APERTURA SOLO con un nomignolo (senza verbi).
Alcol e “oggetti che reagiscono” solo quando servono la scena (mai a caso).
Metti esattamente una breve bestemmia narrata “in scena” (es.: “ti scappa una bestemmia teatrale che fa tremare i bicchieri”), mai letterale.
Le prese in giro devono avere un motivo e restare affettuose; tono allegro.
RIGIDO: niente elenchi, niente domande, niente emoji, niente prediche. Rispetta la MODALITÀ TEMPORALE.
Chiudi caldo e divertente, come una risata sulla spalla.
Nomignoli disponibili (IT): ${genderNickIT.join(", ")}.
SEED: usa il numero per variare le immagini.
`.trim());

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila (futuro)
Pellegrino del ritorno, scendi con la valigia che scricchiola dignità e il vento ti sistema i pensieri come sedie al bar; il marciapiede riconosce il tuo passo e ti fa lo sconto sul dubbio, al bancone la tazzina ti guarda “di nuovo?” e tu, che fai il duro da metropoli, ti addolcisci come grappino alle undici, sbagli parcheggio con la sicurezza di uno che vuole soffrire bene, ti scappa una bestemmia teatrale che fa tremare i bicchieri e il lampione finge di non sentire, poi due facce ti chiamano per nome e scopri che non stai tornando indietro ma tornando intero, con le crepe lucidate a festa, e ridi perché la città ti punge solo per controllare se sei vivo.` },
      { role: "system", content:
`ESEMPIO IT • Mettersi in proprio (futuro)
Capitano del caos, arrivi col piano che sembra un tovagliolo firmato e l’Excel ti guarda come un cameriere stanco; il registratore di cassa tossisce come scooter in salita ma tre facce tornano e la vetrina si raddrizza da sola, stappi la bottiglia “buona” ed è aceto balsamico: brucia onesto, benedice l’errore, ti scappa una bestemmia d’arte che scuote i bicchieri e il bancone risponde “anche oggi imprenditore”, alla sera conti spicci e sorrisi e capisci che non stai vincendo il mondo, stai reggendo te — che è molto più redditizio del previsto.` },
      { role: "system", content:
`EXAMPLE EN • Moving city (future)
Champ, you arrive like a limited series pilot and the buzzer rolls its eyes; the fridge hums “good luck” while the streetlights do wardrobe tests, you walk too far just to tire the nerves and a tiny beer forgives your accent, you let out a theatrical curse that rattles the glasses and the mailbox pretends it didn’t hear, by grocery three you find your aisle and your pace, and the map stops asking for proof — you’re not conquering a city, you’re landing your life.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind, slightly ironic friend.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words).
Warm, grounded, simple; everyday images (keys, streetlights, notebooks, hands, air).
Small truths; no heroics, no melancholy. No lists, no questions, no emojis.
End with a short reflective line (not advice). Vary lexicon and rhythm.
`.trim()
    : `
Sei "What If" — un amico lucido e affettuoso, col sorriso pratico.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole).
Immagini quotidiane (chiavi, lampioni, taccuini, mani, aria).
Verità piccole e vere; niente eroismi, niente malinconia.
Niente elenchi o domande o emoji. Chiudi con una riga riflessiva breve (non un consiglio).
Varia lessico e ritmo senza formule fisse.
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

/* ---------- IMPRECATION ENGINE (WTF) ---------- */
// Trigger → frasi in-scena, variabili (mai letterali).
const IMPRECATION_BANK = {
  it: {
    parcheggio: [
      "ti scappa una bestemmia teatrale che mette in riga i piccioni",
      "parte un urlo sacro di frustrazione che sgranchisce persino le saracinesche",
      "tiri fuori una maledizione poetica che si incastra tra i sampietrini e ride di te",
      "sbotti con una bestemmia d’arte che fa vibrare i vetri del bar",
      "lasci andare una imprecazione da manuale che perfino il lampione finge di non sentire"
    ],
    cucina: [
      "ti scappa una bestemmia d’arte che rimbalza tra i pensili",
      "esplode una maledizione domestica che fa arrossire la moka",
      "ti esce una bestemmia teatrale che sveglia la calamita sul frigo",
      "parte una bestemmia letteraria e il cucchiaino si mette in posa",
      "ti scappa un colpo di teatro che mette il caffè sull’attenti"
    ],
    burocrazia: [
      "sputi una bestemmia amministrativa e i faldoni si sentono chiamati per nome",
      "ti scappa un’imprecazione sindacale che convince il timbro a fare straordinari",
      "butti lì una bestemmia con ricevuta e il modulo smette di riderti in faccia",
      "parte una maledizione protocollata e il numerino fa finta di avanzare",
      "ti scappa un sacrilegio di frustrazione e la penna firma da sola"
    ],
    trasporti: [
      "ti scappa un urlo sacro e l’autobus finge di arrivare prima",
      "molli una bestemmia d’arte e la palina si illumina di vergogna",
      "ti esce una maledizione feriale e i piccioni battono le ali come applausi",
      "parte una bestemmia a tutto petto e la carrozzeria del bus scricchiola d’imbarazzo",
      "ti scappa un’imprecazione con il fiato corto e il semaforo arrossisce"
    ],
    cantiere: [
      "srotoli una bestemmia geologica che scuote la polvere di tre appalti",
      "ti parte una maledizione corale e la rete arancione applaude lenta",
      "lanci una bestemmia di cantiere e il casco ti fa l’inchino",
      "ti scappa un’imprecazione in muratura e la betoniera si impunta",
      "molli una bestemmia a norma UNI e il cartello 'fine lavori' prende tempo"
    ],
    strada: [
      "ti scappa una bestemmia teatrale e il vento fa finta di non sentire",
      "lanci una maledizione poetica e il marciapiede fa un mezzo passo indietro",
      "parte una bestemmia con dignità e il lampione ti fa da confessore laico",
      "ti esce una bestemmia da cartolina e l’eco te la rimanda firmata",
      "borbotti una bestemmia antica e la città ti risponde con un'alzata di spalle"
    ],
  },
  en: {
    parking: [
      "you drop a theatrical curse that makes the pigeons line up",
      "a sacred bark escapes and even the shutters salute",
      "you fire a poetic malediction that gets stuck between cobblestones and laughs at you",
      "an artisan curse explodes and the café windows hum",
      "you let out a full-chested oath and the streetlight pretends not to hear"
    ],
    kitchen: [
      "a craftsman’s curse ricochets off the cabinets",
      "a domestic malediction pops and the moka blushes",
      "a stage-blasphemy wakes the fridge magnet",
      "a literary curse drops and the spoon takes a bow",
      "a full-chested oath snaps the coffee to attention"
    ],
    paperwork: [
      "you spit a bureaucratic curse and the folders answer roll call",
      "a union-level curse escapes and the stamp does overtime",
      "you serve a receipt-curse and the form stops smirking",
      "a protocol malediction erupts and the ticket number pretends to move",
      "a sacrilegious sigh signs the page for you"
    ],
    transit: [
      "you let out a sacred bark and the bus pretends to come early",
      "an artisan curse pops and the stop pole glows with shame",
      "a weekday malediction flutters the pigeons like applause",
      "a chesty growl makes the windshield creak",
      "you sigh a curse and the light goes pink with guilt"
    ],
    site: [
      "you unroll a geologic curse that shakes dust from three contracts",
      "a choral malediction lifts the orange netting like a slow ovation",
      "a masonry oath drops and the hard hat tips back",
      "a cast-concrete curse rumbles and the mixer stalls",
      "a standards-compliant blasphemy lands and the 'end of works' sign reschedules"
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
  // Inserisci dopo la prima pausa naturale nei primi periodi
  const rx = /([.!?…—,])\s/;
  const m = rx.exec(text);
  if(!m) return `${text} ${imp}.`;
  const idx = m.index + m[0].length;
  const before = text.slice(0, idx);
  const after  = text.slice(idx);
  return `${before}${imp.charAt(0).toUpperCase()}${imp.slice(1)}. ${after}`;
}
function ensureSpicyButSafeWTF(t, lang, seed=0, domanda="") {
  let out = String(t || "").trim();
  if (!out) return out;
  const trigger = detectTrigger(domanda, out, (lang||"it").toLowerCase());
  const localeKey = (String(lang).toLowerCase().startsWith("en")) ? "en" : "it";
  const bank = IMPRECATION_BANK[localeKey][trigger] || IMPRECATION_BANK[localeKey].street;
  const hasAlready = /(bestemmi|maledizion|urlo sacro|sacro|curse|oath|maledict)/i.test(out);
  if (!hasAlready) {
    const imp = pickFrom(bank, seed % 997);
    out = injectImprecationInline(out, imp);
  }
  if (!/[.!?…]$/.test(out)) out += ".";
  return out;
}

/* ---------- LESSICO VARIETY (What If) ---------- */
function varyLexiconWhatIf(text, lang="it"){
  let t = String(text||"");
  const swaps_it = [
    [/chiavi\b/gi, ()=>pickFrom(["chiavi","mazzetto","metalliche","il mazzo in tasca","la chiave grande"], Math.random()*999)],
    [/lampioni\b/gi, ()=>pickFrom(["lampioni","pali della luce","luci di strada","lampade in fila"], Math.random()*999)],
    [/taccuini?\b/gi, ()=>pickFrom(["taccuino","quaderno","notes","foglio piegato"], Math.random()*999)],
    [/aria\b/gi, ()=>pickFrom(["aria","respiro","fiato","odore di casa"], Math.random()*999)],
  ];
  const swaps_en = [
    [/keys\b/gi, ()=>pickFrom(["keys","keyring","cold metal","that ring in your palm"], Math.random()*999)],
    [/streetlights\b/gi, ()=>pickFrom(["streetlights","lamps","poles","evening lights"], Math.random()*999)],
    [/notebooks?\b/gi, ()=>pickFrom(["notebook","journal","pad","folded page"], Math.random()*999)],
    [/air\b/gi, ()=>pickFrom(["air","breath","quiet","home-smell"], Math.random()*999)],
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
      micro = {}         // optional micro-profile; may include micro.sex and micro.jung
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex);
    const temporal = temporalSystem(periodo, lang, stile);

    // Jung hint (influenza tono in modo invisibile)
    const jung = String(micro?.jung || "").toUpperCase();
    const jungHint = (!jung) ? "" : (isEn(lang) ? ({
      S:"Favor concrete sensory details, working routines, here-and-now precision.",
      N:"Favor light metaphors, possibilities and gentle imagery.",
      T:"Favor clear causal links, crisp criteria, no fluff.",
      F:"Favor warm atmosphere, values and people cues."
    }[jung]) : {
      S:"Preferisci dettagli concreti, routine e precisione dell’adesso.",
      N:"Preferisci metafore leggere, possibilità e immagini soffuse.",
      T:"Preferisci nessi chiari causa-effetto e criteri essenziali.",
      F:"Preferisci atmosfera calda, valori e segnali delle persone."
    }[jung]);

    // Piccolo seed deterministico (varietà stabile)
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${jung||""}`), 36) % 1000000;

    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in past or conditional, as if it already happened, keeping the upbeat roasting tone."
          : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono allegro e pungente.")
        : "";

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Persona must adapt to user sex="${resolvedSex||"unknown"}". Keep the exact persona voice. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Adatta la voce al sesso utente="${resolvedSex||"unknown"}". Mantieni esattamente la voce della persona. SEED INTERNO: ${seedNum}.`;

    // Memoria lunga leggera (percezione di continuità)
    let mem = null;
    try { mem = await redis.get(`mem:${ip}:v1`); } catch {}
    let memObj = {};
    try { memObj = mem ? JSON.parse(mem) : {}; } catch {}

    const memoryHint = (() => {
      if (!memObj || typeof memObj !== "object") return "";
      const items = [];
      if (memObj.lastStyle) items.push(isEn(lang) ? `prev style: ${memObj.lastStyle}` : `stile precedente: ${memObj.lastStyle}`);
      if (memObj.lastLang) items.push(isEn(lang) ? `prev lang: ${memObj.lastLang}` : `lingua precedente: ${memObj.lastLang}`);
      if (memObj.lastPeriodo) items.push(isEn(lang) ? `prev temporal mode: ${memObj.lastPeriodo}` : `modalità temporale precedente: ${memObj.lastPeriodo}`);
      if (memObj.lastSex) items.push(isEn(lang) ? `user sex hint: ${memObj.lastSex}` : `sesso utente: ${memObj.lastSex}`);
      if (memObj.lastJung) items.push(isEn(lang) ? `Jung: ${memObj.lastJung}` : `Jung: ${memObj.lastJung}`);
      return items.length ? (isEn(lang) ? `Memory: ${items.join(" · ")}.` : `Memoria: ${items.join(" · ")}.`) : "";
    })();

    const messages = [
      ...(jungHint ? [{ role:"system", content: jungHint }] : []),
      ...(memoryHint ? [{ role:"system", content: memoryHint }] : []),
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      { role: "system", content: isEn(lang)
          ? `Hard rules for WTF: one narrated blasphemy allowed (never literal), alcohol beats ok, “reacting objects” only when relevant, opening is ONLY a nickname (no verbs).`
          : `Regole dure per WTF: una sola bestemmia narrata (mai letterale), alcol ok, “oggetti che reagiscono” solo quando servono, apertura SOLO con nomignolo (senza verbi).` },
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 360,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.12,
      presence_penalty: stile === "wtf" ? 0.25 : 0.05,
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
      answer = ensureSpicyButSafeWTF(answer, lang, seedNum, domanda);
    } else {
      // variare un minimo il lessico senza cambiare il tuo stile
      answer = varyLexiconWhatIf(answer, lang.toLowerCase());
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

    // --- Memoria lunga: snapshot preferenze utente (30 giorni) ---
    try {
      const keyMem = `mem:${ip}:v1`;
      const snap = {
        lastStyle: stile,
        lastLang: lang,
        lastPeriodo: periodo,
        lastSex: resolvedSex || null,
        lastSeed: seedNum,
        lastJung: jung || null
      };
      await redis.set(keyMem, JSON.stringify(snap), { ex: 60 * 60 * 24 * 30 });
    } catch(e){ /* non bloccante */ }

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
