// /api/ask.js — What?f Engine (2025 FULL, persona-aware + registri reali)
// Stili: whatif (realistico/poetico/analitico) · wtf (sarcasmo demenziale affettuoso, “grit” narrato)
// IT/EN — paragrafo singolo, niente liste/domande/emoji
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA testo domanda (solo metadati + hash non reversibile)

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
    .split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter(Boolean);
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

/* ---------- GRIT PACK (WTF, “bestemmie” narrate, mai letterali) ---------- */
// Niente termini religiosi espliciti. È sempre l’ATTO narrato e iperbolico.
const GRIT_PACK = {
  it: {
    light: [
      "sospiro d’officina",
      "colpo di tosse da veterano",
      "rutto mondiale in sordina",
      "occhiata che impreca senza audio",
      "mugugno da spogliatoio",
      "fischio che smonta un neon",
    ],
    medium: [
      "rutto mondiale in surround",
      "imprecazione di frontiera a mezza voce",
      "sfuriata sacra non trascritta",
      "bestemmia teatrale (censurata)",
      "scarica di borbottii da manuale",
      "sbraitata da capocantiere col freno tirato",
    ],
    heavy: [
      "bestemmia epica non trascritta",
      "imprecazione da epopea marinaresca",
      "ruggito di stanchezza che piega i bicchieri",
      "sacramentata storica (fuori campo)",
      "invettiva con copyright del destino",
      "rantolo lirico che stacca il poster",
    ],
  },
};
const LAST_GRIT_SIZE = 3;
function nextGrit(state, { locale = "it-IT", heat = "medium" } = {}) {
  const lang = locale.startsWith("it") ? "it" : "it";
  const pool = GRIT_PACK[lang][heat] || GRIT_PACK.it.medium;
  const used = state.__lastGrit || [];
  const options = pool.filter((w) => !used.includes(w));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const phrase = options.length ? pick(options) : pick(pool);
  state.__lastGrit = [...used, phrase].slice(-LAST_GRIT_SIZE);
  return { phrase, state };
}
function injectGritOnce(answer, { mood="" } = {}) {
  // calcola heat
  const heat = /irrequiet|restless|charged|presa|socket/i.test(String(mood)) ? "heavy" : "medium";
  const { phrase } = nextGrit({}, { locale: "it-IT", heat });
  // posiziona: preferisci dopo la prima frase
  const sents = String(answer).split(/(?<=[.!?…])\s+/).filter(Boolean);
  let out;
  if (sents.length > 1) {
    sents.splice(1, 0, `(${phrase})`);
    out = sents.join(" ");
  } else {
    out = `${phrase.toUpperCase()} — ${answer}`;
  }
  // consenti UNA sola grit (prima resta, altre rimosse)
  const all = Object.values(GRIT_PACK.it).flat();
  const esc = (s)=> s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const rx = new RegExp(all.map(esc).join('|'), 'gi');
  let seen = false;
  out = out.replace(rx, (m)=> (seen ? "" : (seen = true, m.toUpperCase())));
  // ripulisci caps random
  out = out.replace(/\b([A-ZÀ-ÖØ-Þ]{3,})\b/g, (m)=> /BESTEMMIA|RUTTO|IMPREC|SACRAM|RUGGITO/i.test(m) ? m : m.toLowerCase());
  return out.replace(/\s{2,}/g,' ').replace(/\s+([,.;:!?…])/g,'$1');
}

/* ---------- What If — Lexicon Variety (solo sinonimi sobri) ---------- */
function _pickFrom(arr, seed, salt="0"){
  if(!arr?.length) return "";
  const n = Math.abs(Math.imul((seed||1), 2654435761) ^ (salt.charCodeAt(0)||17));
  return arr[n % arr.length];
}
function _boundedReplace(text, rx, variants, max=2, seed=1, salt="x"){
  let count = 0;
  return text.replace(rx, (m)=>{
    if(count >= max) return m;
    count++;
    return _pickFrom(variants, seed+count, salt);
  });
}
const VARIANTS_IT = [
  { rx: /\bchiave\b/gi,      v: ["centrale","cardine","fulcro","nocciolo","perno"] },
  { rx: /\bmodo\b/gi,        v: ["maniera","verso","taglio","passo"] },
  { rx: /\britmo\b/gi,       v: ["passo","cadenza","tempo","battito"] },
  { rx: /\bstrada\b/gi,      v: ["strada","traiettoria","corsia","linea","traccia"] },
  { rx: /\babitudine\b/gi,   v: ["abitudine","rito","gesto","ciclo"] },
  { rx: /\bordine\b/gi,      v: ["ordine","assetto","quadratura","messa a posto"] },
  { rx: /\bcalma\b/gi,       v: ["calma","tranquillità","fiato","spazio"] },
  { rx: /\brumore\b/gi,      v: ["rumore","baccano","frastuono","fondo"] },
  { rx: /\bverità\b/gi,      v: ["verità","nocciolo","punto vero","dato nudo"] },
  { rx: /\bfuturo\b/gi,      v: ["futuro","prossimo tratto","pezzo avanti"] },
  { rx: /\bsemplice\b/gi,    v: ["semplice","lineare","pulita","dritta"] },
];
const VARIANTS_EN = [
  { rx: /\brhythm\b/gi,      v: ["pace","cadence","beat"] },
  { rx: /\bnoise\b/gi,       v: ["noise","clutter","static","hum"] },
  { rx: /\btruth\b/gi,       v: ["truth","the point","the gist"] },
  { rx: /\bhabit\b/gi,       v: ["habit","ritual","loop","routine"] },
];
function tweakCadenceOneDash(t, seed){
  if (!/, /.test(t)) return t;
  const idx = Math.abs(seed)%2;
  if (idx===0) return t;
  let done = false;
  return t.replace(/, /g, (m)=> done ? m : (done=true, " — "));
}
function lexicalVarietyWhatIf(text, seed=1, lang="it"){
  let out = String(text||"");
  const bank = (String(lang).toLowerCase().startsWith("en")) ? VARIANTS_EN : VARIANTS_IT;
  bank.forEach((rule, i)=>{
    out = _boundedReplace(out, rule.rx, rule.v, 2, seed, String(i));
  });
  out = tweakCadenceOneDash(out, seed);
  return out;
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
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional. No lists, no questions, no echo. Keep ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse già stata fatta e mostra come sarebbe andata. Preferisci passato/condizionale. Niente liste o domande. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no echo. Keep ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste o domande. Mantieni la voce ${style.toUpperCase()}.`;
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
SECOND PERSON. ONE paragraph, 6–8 sentences (~125–165 words).
OPEN with ONLY a rotating nickname (just the nickname).
Use **one** hyperbolic, narrated “grit” interjection (e.g., “EPIC CURSE NOT TRANSCRIBED”, “WORLD-CLASS BURP in surround”), never a literal slur.
Reacting objects allowed when relevant. Tone: goofy but warm, never hateful.
STRICT: no lists, no questions, no emojis. Respect TEMPORAL MODE.
Close with a warm, funny beat (not a lecture).
`.trim()
      : `
Sei “What the F” — l’amico rumoroso ma affettuoso che punzecchia con bene.
SECONDA PERSONA. UN paragrafo, 6–8 frasi (~125–165 parole).
APERTURA SOLO con un nomignolo (solo la parola/frase).
Usa **una** interiezione “gritty” iperbolica e narrata (es. “BESTEMMIA EPICA NON TRASCRITTA”, “RUTTO MONDIALE in surround”), mai letterale.
Oggetti che “reagiscono” quando serve; tono demenziale ma caldo.
RIGIDO: niente elenchi, niente domande, niente emoji. Rispetta la MODALITÀ TEMPORALE.
Chiudi caldo e divertente, non una predica.
`.trim());

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Mettersi in proprio (futuro)
Capitano del caos, arrivi col piano che sembra un tovagliolo firmato e l’Excel ti guarda come un cameriere stanco; il registratore di cassa tossisce come scooter in salita (BESTEMMIA EPICA NON TRASCRITTA) e vai avanti, perché certe cose si aggiustano col cacciavite e col fiato; la sera conti spicci e sorrisi e capisci che non stai vincendo il mondo, stai reggendo te.` },
      { role: "system", content:
`EXAMPLE EN • Moving city (future)
Champ, you land like a limited series pilot and the buzzer rolls its eyes; the fridge hums “good luck”, WORLD-CLASS BURP in surround, and you keep walking until the map stops asking for proof.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS, nicks: isEn(lang) ? genderNickEN : genderNickIT };
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
Tornare non sarebbe un passo indietro ma un passo fatto meglio. Ti stupirebbe la memoria delle strade: tengono il ritmo anche quando tu lo perdi. All’inizio la lentezza graffia, poi capisci che ti rimette in orario. I volti sembrano uguali, ma li guardi con occhi più larghi. Le chiavi tornano sul piattino giusto, la spesa nel negozio che sa il tuo nome. La nostalgia, se non la insegui, si siede accanto e tace. Non serve ricominciare da zero: basta ricominciare da te.` },
    { role: "system", content:
`EXAMPLE EN • Move city
You’ll feel like a guest, then your hands learn the new keys. You’ll walk not to think better but to tire the noise. By the third grocery you’ll know which aisle is yours. Evenings soften and ask less proof. You’ll miss some things, not all at once. The rest finds its place. And you notice that beneath the noise something of yours was already there.` },
  ];

  return { sys: SYS_WHATIF, fewshots: FEWSHOTS, nicks: isEn(lang) ? genderNickEN : genderNickIT };
}

/* ---------- Registro What If ---------- */
function pickWhatIfRegisterFromMicro(micro = {}) {
  const mood = String(micro?.mood || "").toLowerCase();
  const decide = String(micro?.decide || "").toLowerCase();
  const anchor = String(micro?.anchor || "").toLowerCase();
  if (/(lista|lists|pro|contro|deadline|scadenza|coin|moneta)/.test(decide)) return "analitico";
  if (/(legger|chatty|calm|quiet|nostal|curios|persone|people)/.test(mood+anchor)) return "poetico";
  return "realistico";
}
function buildRegisterDirectives(reg="realistico", lang="it") {
  const en = String(lang).toLowerCase().startsWith("en");
  if (reg === "analitico" || reg === "analytical") {
    return en
      ? "REGISTER: ANALYTICAL. No metaphors. Plain language. One paragraph, 8–11 sentences. Use signposts like “In practice,” “Why,” “So,”. No lists, no questions, no emojis. End with a short reflective line."
      : "REGISTRO: ANALITICO. Niente metafore. Linguaggio piano. Un paragrafo, 8–11 frasi. Usa connettori tipo “In pratica,” “Perché,” “Quindi,”. Niente elenchi/domande/emoji. Chiudi con una riga riflessiva.";
  }
  if (reg === "poetico" || reg === "poetic") {
    return en
      ? "REGISTER: POETIC. Soft, concrete daily imagery (keys, streetlights, notebooks, hands, air). Keep it grounded. One paragraph, 8–11 sentences. Short reflective ending."
      : "REGISTRO: POETICO. Immagini leggere e concrete del quotidiano (chiavi, lampioni, taccuini, mani, aria). Resta a terra. Un paragrafo, 8–11 frasi. Chiusura riflessiva breve.";
  }
  return en
    ? "REGISTER: REALISTIC. Minimal metaphors. Concrete verbs/objects. One paragraph, 8–11 sentences. Short reflective ending."
    : "REGISTRO: REALISTICO. Metafore minime. Verbi/oggetti concreti. Un paragrafo, 8–11 frasi. Chiusura riflessiva breve.";
}
function fewshotsForRegister(reg="realistico", lang="it") {
  const en = String(lang).toLowerCase().startsWith("en");
  if (reg === "analitico" || reg === "analytical") {
    return [
      { role:"system", content: en
        ? `WHAT IF • Analytical sample
You go back and routines get clear. In practice, mornings are short and repeatable. Why it helps: less energy wasted on logistics. So the rest goes to work and people. The city asks for steadiness, not heroics. Keep expenses visible and calls short. When doubt rises, pick the next small action. Evenings are tired, not scattered. The point is you’re in charge.` 
        : `WHAT IF • Esempio Analitico
Ritorni e le routine si chiariscono. In pratica, mattine brevi e ripetibili. Perché aiuta: meno energia buttata nella logistica. Quindi il resto va su lavoro e persone. La città chiede costanza, non eroismi. Tieni le spese in vista e le chiamate corte. Quando sale il dubbio, scegli il prossimo passo piccolo. La sera sei stanco ma non disperso. Il punto è che tieni tu il ritmo.` }
    ];
  }
  if (reg === "poetico" || reg === "poetic") {
    return [
      { role:"system", content: en
        ? `WHAT IF • Poetic sample
Set the keys down and the room learns your name again. Streetlights take attendance and the air tidies your thoughts. The city speaks in small chores and familiar steps. You miss some things, but not all at once. You move slower and arrive better. Work is not louder, just closer. Evenings make room for your voice. You’re not going back; you’re going right.` 
        : `WHAT IF • Esempio Poetico
Appoggi le chiavi e la stanza reimpara il tuo nome. I lampioni fanno l’appello e l’aria mette in ordine i pensieri. La città parla in piccole faccende e passi familiari. Ti manca qualcosa, ma non tutto insieme. Ti muovi più lento e arrivi meglio. Il lavoro non è più rumoroso, è più vicino. La sera fa spazio alla tua voce. Non stai tornando indietro, stai tornando diritto.` }
    ];
  }
  return [
    { role:"system", content: en
      ? `WHAT IF • Realistic sample
You move back and the fridge hum is first to settle. Bills, keys, groceries, names. The pace slows and becomes yours. You don’t fix everything: you fix what matters. Work gets clearer when noise goes down. Keep what helps, cut what drags. At night the street is honest about the day. That honesty is the point.` 
      : `WHAT IF • Esempio Realistico
Ritorni e il ronzio del frigo è il primo a mettersi in riga. Bollette, chiavi, spesa, nomi. Il passo rallenta e diventa tuo. Non aggiusti tutto: aggiusti ciò che serve. Il lavoro si chiarisce quando cala il rumore. Tieni ciò che aiuta, tagli ciò che pesa. La sera la strada è onesta su com’è andata. È quell’onestà che cerchi.` }
  ];
}
function postProcessByRegister(ans, reg="realistico", lang="it") {
  let a = String(ans||"").trim();
  // chiusura riflessiva breve se manca
  if (!/[.!?…]$/.test(a)) a += ".";
  const sents = a.split(/(?<=[.!?…])\s+/).filter(Boolean);
  if (sents.length < 8) {
    const bump = (reg==="analitico"||reg==="analytical")
      ? (isEn(lang)?"So you keep one simple habit and move.":"Quindi tieni un’abitudine semplice e ti muovi.")
      : (reg==="poetico"||reg==="poetic")
        ? (isEn(lang)?"Evenings learn your name back.":"La sera reimpara il tuo nome.")
        : (isEn(lang)?"You cut noise, keep what helps.":"Tagli il rumore e tieni ciò che aiuta.");
    sents.push(bump);
    if (sents.length < 8) sents.push(isEn(lang)?"You notice it’s enough.":"Ti accorgi che basta.");
    a = sents.join(" ");
  } else if (sents.length > 11) {
    a = sents.slice(0,11).join(" ");
  }
  return a;
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
      micro = {},        // micro-profile; e.g., { mood, anchor, decide, zodiac }
      registro = ""      // opzionale: "realistico" | "poetico" | "analitico"
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // Personas + Temporal mode
    const { sys, fewshots, nicks } = personaSystem(stile, lang, resolvedSex);
    const temporal = temporalSystem(periodo, lang, stile);

    // Registro (What if) — priorità: param → extra → micro
    let reg = String(registro || "").toLowerCase();
    if (!reg) {
      const lowExtra = String(extra||"").toLowerCase();
      if (lowExtra.includes("registro=poetico")||lowExtra.includes("register=poetic")) reg="poetico";
      else if (lowExtra.includes("registro=analitico")||lowExtra.includes("register=analytical")) reg="analitico";
      else if (lowExtra.includes("registro=realistico")||lowExtra.includes("register=realistic")) reg="realistico";
      else reg = pickWhatIfRegisterFromMicro(micro);
    }

    // Nickname di apertura per WTF
    const nickname = (stile === "wtf" && Array.isArray(nicks) && nicks.length)
      ? (nicks[Math.floor(Math.random() * nicks.length)])
      : "";

    // Seed deterministico (varietà stabile)
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${reg}`), 36) % 1000000;

    // Hints
    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in past/conditional, upbeat roasting."
          : "Scrivi tutto al passato/condizionale, tono allegro e pungente.")
        : "";
    const toneHint = (() => {
      const md = String(micro?.mood || "").toLowerCase();
      if (stile === "wtf" && /irrequiet|restless|charged|presa|socket/.test(md))
        return isEn(lang) ? "Let the banter punch a bit harder (still affectionate)." : "Stoccate un filo più decise (sempre affettuose).";
      return "";
    })();

    const regDirectives = (stile === "whatif") ? buildRegisterDirectives(reg, lang) : "";
    const regFewshots   = (stile === "whatif") ? fewshotsForRegister(reg, lang) : [];

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Persona must adapt to user sex="${resolvedSex||"unknown"}". If style is "whatif", use register="${reg}". MICRO: ${JSON.stringify(micro)}. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Adatta la voce al sesso utente="${resolvedSex||"unknown"}". Se stile "whatif", usa registro="${reg}". MICRO: ${JSON.stringify(micro)}. SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(regDirectives ? [{ role:"system", content: regDirectives }] : []),
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(toneHint ? [{ role: "system", content: toneHint }] : []),
      ...(fewshots || []),
      ...(regFewshots || []),
      ...(stile === "wtf"
        ? [{ role: "system", content: isEn(lang)
            ? "Hard rules: 1 paragraph, 6–8 sentences. Open with ONLY a nickname. Exactly ONE narrated ‘grit’ interjection (never literal). No lists, no questions, no emojis. No sugary imagery. Vary cadence, keep it human and warm."
            : "Regole dure: 1 paragrafo, 6–8 frasi. Apertura SOLO con nomignolo. Esattamente UNA interiezione ‘gritty’ narrata (mai letterale). Niente elenchi/domande/emoji. No immagini zuccherose. Varia cadenza, resta umano e caldo." }]
        : []),
      { role: "user", content: userPrompt },
    ];

    // Temperature diverse per registro
    const tempByReg =
      (stile === "whatif")
        ? (reg === "analitico" ? 0.58
          : reg === "poetico" ? 0.86
          : 0.72)
        : 0.98;

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: tempByReg,
      top_p: 0.92,
      max_tokens: 360,
      frequency_penalty: (stile === "wtf") ? 0.45 : (reg==="analitico"?0.2:0.12),
      presence_penalty: (stile === "wtf") ? 0.25 : 0.0,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Nickname head per WTF
    if (stile === "wtf" && nickname) {
      const trimmed = answer.replace(/^\s*[\w’' ]{2,20}\s*,?\s*/i, "");
      answer = `${nickname}, ${trimmed}`;
    }

    // Anti-eco, tightening, clamp, normalize
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 165 : 160);
    answer = normalizeOneParagraph(answer);
    if (!/[.!?…]$/.test(answer)) answer += ".";

    // GRIT una sola volta (WTF)
    if (stile === "wtf") {
      answer = injectGritOnce(answer, { mood: micro?.mood || "" });
    }

    // Varietà lessicale + registro (What If)
    if (stile === "whatif") {
      answer = lexicalVarietyWhatIf(answer, seedNum, lang);
      answer = postProcessByRegister(answer, reg, lang);
    }

    // --- LOG persistente (privacy-safe) ---
    try {
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
        sex: resolvedSex || null,
        registro: (stile==="whatif"?reg:null),
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
      registro: (stile==="whatif"?reg:null),
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
