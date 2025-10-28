/**
 * /api/ask.js — What?f (COMPLETO con persistenza)
 */
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { OpenAI } from "openai";

/* ====== CONFIG ====== */
const MODEL = process.env.OPENAI_MODEL || "gpt-5.1-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const DAILY_CAP_FREE = 3;
const DAILY_CAP_PRO  = 10;
const MAX_MEMO_PER_USER = 60;     // righe memorizzate per utente
const MAX_SHOTS_USED    = 8;      // quante righe recenti reiniettiamo nel system

/* ====== PATH & DISK ====== */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DATA_DIR   = path.join(__dirname, "..", "data");
const MEM_PATH   = path.join(DATA_DIR, "memory.json");
const USE_PATH   = path.join(DATA_DIR, "usage.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(MEM_PATH)) fs.writeFileSync(MEM_PATH, JSON.stringify({}), "utf8");
if (!fs.existsSync(USE_PATH)) fs.writeFileSync(USE_PATH, JSON.stringify({}), "utf8");

const readJSON  = (p) => JSON.parse(fs.readFileSync(p, "utf8") || "{}");
const writeJSON = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2), "utf8");

let MEMORY = readJSON(MEM_PATH); // { userKey: { notes:[], micro:{}, updatedAt } }
let USAGE  = readJSON(USE_PATH); // { "user|YYYY-MM-DD": n }

/* ====== CLIENT ====== */
if (!OPENAI_API_KEY) console.error("[ask] Manca OPENAI_API_KEY.");
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ====== UTILS ====== */
const nowISODate = () => new Date().toISOString().slice(0,10);
const userKey = (req) => (req.header("x-user-id") || req.ip || "anon").slice(0,120);
const isAdmin = (req) => !!ADMIN_TOKEN && req.header("x-admin-token") === ADMIN_TOKEN;
const isPro   = (req) => req.header("x-pro") === "1";
const capFor  = (req) => (isAdmin(req) ? Infinity : isPro(req) ? DAILY_CAP_PRO : DAILY_CAP_FREE);

const usageGet = (k) => USAGE[`${k}|${nowISODate()}`] || 0;
const usageInc = (k) => {
  const id = `${k}|${nowISODate()}`;
  USAGE[id] = (USAGE[id] || 0) + 1;
  writeJSON(USE_PATH, USAGE);
  return USAGE[id];
};

/* ====== FEW-SHOT (TUOI TESTI, INTEGRALI) ====== */
const WTF_FEWSHOT = [
  {
    u: "☕ E se aprissi un bar?",
    a: `Ah, ma guarda un po’, il genio dell’espresso che si sveglia con la vocazione imprenditoriale. Ti vedo: grembiule nuovo, sorriso da spot pubblicitario, la moka che sibila come un vecchio nonno stanco di vivere. Arriva il primo cliente, chiede un cappuccino “senza schiuma, ma caldo, però freddo dentro” e già ti parte la pressione. Tentando l’impossibile, ti bruci un dito e ti scappa un “porca di quella schiuma sorda e bastarda!”: le tazzine vibrano come castagnette e il cucchiaino va in sciopero. Il frigo rantola, la macchina del caffè fa un ruttino di protesta, e una vecchietta ti guarda come se avessi bestemmiato in latino. Tu versi un goccio di grappa nel caffè e pensi: almeno oggi ho aperto un locale che fa ridere anche i mobili. Quando chiudi la sera, il bancone sospira “ce la rifacciamo domani, capo?” — e tu annuisci, col fegato in disarmo ma il morale alto.`
  },
  {
    u: "🏍️ E se comprassi una moto?",
    a: `Ah, eccoci, il nuovo Valentino del parcheggio condominiale. Giacca di pelle lucida, casco nuovo e orgoglio che fa attrito. Accendi il motore: romba come un drago epilettico e già ti senti immortale. Poi un piccione ti taglia la strada e ti parte un “porca di quella frizione ubriaca e maledetta!”: il cane del quartiere ulula in do maggiore e il semaforo si gira dall’altra parte per la vergogna. Riparti come se niente fosse, ma il cavalletto resta giù e ti fa uno sgambetto da bullo: “mannaggia al ferro storto che ti ha creato!”. Ti fermi al bar, ordini un Negroni, il barista ti versa due dita extra “per compassione”. Alla fine ridi, imprechi piano un’ultima volta, e capisci che la moto non è un’uscita di sicurezza: è un modo elegante di cadere con stile.`
  },
  {
    // variante “moscerino / grappa fulminata” che mi hai passato
    u: "«E se comprassi una moto?» (variante)",
    a: `Ah, la moto, eh? Casco lucido e petto gonfio come se stessi per salvare il mondo da solo. Parti fiero, il vento ti canta l’inno della libertà… finché un moscerino decide che il tuo dente è la pista d’atterraggio del secolo e ti scappa un “porca di quella grappa fulminata!” così rotondo che la visiera vibra indignata e il semaforo trema per la paura. Ti fermi al bar per lavare la dignità: Negroni bello carico; il bicchiere ride e il barista ti fa l’occhiolino — “Campione, oggi la strada t’ha menato come un tamburo.” Bevi, sospiri, e mentre il vento ti asciuga la figuraccia, capisci che non serviva correre: bastava ridere, forte, come il motore quando finge di essere te.`
  },
  {
    u: "💔 E se mi innamorassi di nuovo? (versione femminile)",
    a: `Ah, Luisa… di nuovo tu, eh? Ogni volta che dici “stavolta ci penso bene”, un prosecco stappa da solo da qualche parte. Vestita bene ma con l’occhio lucido, messaggi che cancelli e riscrivi come se stessi trattando un’adozione internazionale. Lui ti visualizza e non risponde — e ti scappa un “porca di quella chat maledetta e dell’algoritmo suo zio!”: la lampada vibra offesa e il gatto si infila dietro la lavatrice. Il bicchiere di vino si riempie da solo per compassione; tu sospiri e imprecchi con grazia da signora disperata. “Vabbè, almeno stavolta sapevo dove mi andavo a schiantare”, ti dici. Tra una risata e un rutto di rosé capisci che innamorarsi è come un aperitivo: finirà storto, ma finché dura è vita vera.`
  }
];

const WHIF_ANALYTIC = [
  {
    u: "E se tornassi a vivere all’Aquila?",
    a: `Rientrare oggi all’Aquila significa ritrovare una città che ha cambiato pelle ma non respiro. La ricostruzione ha rimesso in moto artigiani e servizi con un passo costante; meno industria, più impresa locale e università che trattiene per scelta. Il costo della vita resta inferiore al Nord e così anche gli stipendi: si guadagna meno, ma si spende con più senso. I tempi di spostamento sono corti, l’aria è più leggera, le reti di vicinato fanno da ammortizzatore. La scuola è diffusa, lo sport guarda alla montagna, la sanità è vicina ma con liste d’attesa a macchia di leopardo. Il Veneto ti mancherebbe per velocità e mercato, ma qui recupereresti pressione bassa e relazioni dense. In pratica: meno rumore, più continuità. E quando chiudi casa la sera, il silenzio non è vuoto — è spazio per respirare.`
  }
];

const WHIF_POETIC = [
  {
    u: "E se tornassi a vivere all’Aquila?",
    a: `Riapri le finestre e l’aria fredda sa di legna e memoria. I vicoli ti riconoscono dal passo, le montagne ti guardano come se non te ne fossi mai andato. Il bar sotto casa serve ancora il caffè corto e ruvido, e qualcuno ti chiama per nome come se il tempo avesse aspettato. I bambini imparano il calendario dalle stagioni, non dall’orologio. Le serate hanno il suono dei portoni che si chiudono e delle chiacchiere che restano sulla soglia. Ogni mattino è un inizio semplice; ogni sera è un pezzo di pace cucito al giorno. Non stai tornando indietro: stai tornando dove la corsa smette di comandare.`
  }
];

/* ====== PROMPT BUILDER ====== */
function systemFor(style, substyle, memoryExtra, periodo, lang, sex) {
  const base = [
    memoryExtra ? `Long-term context to subtly reuse: ${memoryExtra}` : "",
    periodo ? `Temporal mood: ${periodo === "past" ? "PAST" : "FUTURE"}.` : "",
    sex ? `User sex hint: ${sex}.` : "",
    `Answer language: ${lang || "it"}.`
  ].filter(Boolean).join(" ");

  if (style === "wtf") {
    return `Speak EXACTLY like the user-provided “What the F” few-shots.
HARD RULES:
- Start the paragraph with "Ah,".
- Single paragraph. 6–9 sentences. No lists, no emojis, no questions.
- Include ONE loud, adult Italian-style curse; then IMMEDIATELY add TWO reaction beats in sequence (objects/people/animals responding).
- Raw, friendly bar-sarcasm; a bit dirty; theatrical pacing.
- End with a sly, self-aware line (no moral).
Output ONLY the paragraph. ${base}`.trim();
  }

  const analytic = (substyle || "").toLowerCase() === "analitico";
  return `Speak EXACTLY like the user-provided “What if — ${analytic ? "Analitico" : "Poetico"}” few-shots.
HARD RULES:
- One single paragraph. 8–11 sentences. No lists/questions/emojis.
- ${analytic
    ? "Concrete, balanced realism (pros/cons), warm tone, short reflective closing."
    : "Warm everyday images, musical cadence, soft reflective closing."
  }
Output ONLY the paragraph. ${base}`.trim();
}

function fewshotsFor(style, substyle) {
  if (style === "wtf") return WTF_FEWSHOT;
  return (substyle || "").toLowerCase() === "poetico" ? WHIF_POETIC : WHIF_ANALYTIC;
}

/* ====== VALIDAZIONE STILE ====== */
const curseHints = [
  "bestemm", "porca", "mannaggia", "maledett", "vaff",
  "di quella", "del diavolo", "sacrament", "madonn", "cristo" // (pattern grezzi; non filtriamo)
];
const oneParagraph   = (t) => !/\n{2,}/.test(t.trim());
const startsAh       = (t) => /^Ah,\s/.test(t.trim());
const sentenceCount  = (t) => t.replace(/\n+/g," ").split(/[.!?…]+[\s)]*/).filter(s=>s.trim()).length;
const hasCurse       = (t) => curseHints.some(w => t.toLowerCase().includes(w));
const hasTwoReacts   = (t) => {
  const emDashes = (t.match(/—/g) || []).length >= 2;
  const verbs2 = /(ulula|applaude|trema|ride|fischia|sospira|starnazza|borbotta).+?(ulula|applaude|trema|ride|fischia|sospira|starnazza|borbotta)/i.test(t);
  const chain  = /:\s*[^.?!]+,\s*(?:e|ed)\s+[^.?!]+/.test(t);
  return emDashes || verbs2 || chain;
};

/* ====== OPENAI ====== */
async function chat(messages, temperature, presence) {
  const r = await client.chat.completions.create({
    model: MODEL,
    temperature,
    top_p: 0.95,
    presence_penalty: presence,
    frequency_penalty: 0.2,
    messages
  });
  return (r.choices?.[0]?.message?.content || "").trim();
}

/* ====== ROUTER ====== */
const router = express.Router();

router.post("/", express.json(), async (req, res) => {
  try {
    const key = userKey(req);
    const cap = isAdmin(req) ? Infinity : isPro(req) ? DAILY_CAP_PRO : DAILY_CAP_FREE;

    let {
      domanda = "",
      stile = "whatif",
      substyle,             // "analitico" | "poetico"
      lang = "it",
      extra = "",
      micro = {},           // includi anche jung/jang
      periodo = "future",
      sex = ""
    } = req.body || {};

    // basic
    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ detail: "bad_request" });
    }

    // rate limit (prima di contare, verifichiamo il residuo)
    const used = usageGet(key);
    if (Number.isFinite(cap) && used >= cap) {
      res.setHeader("X-Usage-Used", used);
      res.setHeader("X-Usage-Cap", cap);
      return res.status(402).json({ used, dailyCap: cap });
    }
    const after = usageInc(key);
    res.setHeader("X-Usage-Used", after);
    res.setHeader("X-Usage-Cap", cap);

    // ===== MEMORIA PERSISTENTE =====
    const mem = MEMORY[key] || { notes: [], micro: {}, updatedAt: 0 };
    // aggiorna micro/Jung se arrivano
    if (micro && Object.keys(micro).length) mem.micro = { ...mem.micro, ...micro };
    // salva domanda recente
    mem.notes.push(`Q:${domanda.slice(0, 180)}`);
    if (mem.notes.length > MAX_MEMO_PER_USER) mem.notes = mem.notes.slice(-MAX_MEMO_PER_USER);
    mem.updatedAt = Date.now();
    MEMORY[key] = mem;
    writeJSON(MEM_PATH, MEMORY);

    // inferenza sotto-stile se mancante
    if (stile === "whatif" && !substyle) {
      const j = `${mem?.micro?.jung || mem?.micro?.jang || ""}`.toLowerCase();
      substyle = /nf|idealist|poet|dream|feeling|intu/i.test(j) ? "poetico" : "analitico";
    }

    const memoryExtra = [
      mem.notes.slice(-MAX_SHOTS_USED).join(" • "),
      extra ? `Note:${String(extra)}` : "",
      mem.micro && Object.keys(mem.micro).length ? `Micro:${JSON.stringify(mem.micro)}` : ""
    ].filter(Boolean).join(" | ");

    const system = systemFor(stile, substyle, memoryExtra, periodo, lang, sex);
    const shots  = fewshotsFor(stile, substyle);

    const messages = [
      { role: "system", content: system },
      ...shots.flatMap(s => [{ role:"user", content:s.u }, { role:"assistant", content:s.a }]),
      { role: "user", content: domanda }
    ];

    const temp = stile === "wtf" ? 0.9 : 0.7;
    const pres = stile === "wtf" ? 0.6 : 0.2;

    // 1) GENERA
    let txt = await chat(messages, temp, pres);

    // 2) REPAIR
    const sc = sentenceCount(txt);
    const needFix =
      !oneParagraph(txt) ||
      (stile === "wtf" && (!startsAh(txt) || !hasCurse(txt) || !hasTwoReacts(txt) || sc < 6 || sc > 9)) ||
      (stile !== "wtf" && (sc < 8 || sc > 11));

    if (needFix) {
      const fix =
        stile === "wtf"
          ? `REPAIR STRICT:
- Start with "Ah,".
- One single paragraph. 6–9 sentences.
- Insert ONE adult Italian-style curse, then TWO immediate reaction beats.
- Keep raw sarcastic bar-voice; sly self-aware ending.
Return ONLY the paragraph.`
          : `REPAIR STRICT:
- One single paragraph. 8–11 sentences.
- ${(substyle||"").toLowerCase()==="analitico"
                ? "Concrete balanced realism; short reflective closing."
                : "Warm everyday imagery; soft reflective closing."
            }
Return ONLY the paragraph.`;

      txt = await chat([...messages, { role:"system", content: fix }], temp, pres);
    }

    // normalizzazione
    txt = txt.replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").trim();
    if (!/[.!?…]$/.test(txt)) txt += ".";

    return res.json({ answer: txt });
  } catch (e) {
    console.error("[ask] error:", e?.response?.data || e);
    return res.status(500).json({ detail: "server_error" });
  }
});

export default router;

/* ====== BOOTSTRAP OPZIONALE (standalone) ====== */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = express();
  app.use((_, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-pro, x-user-id, x-admin-token");
    next();
  });
  app.use("/api/ask", router);
  const PORT = process.env.PORT || 8787;
  app.listen(PORT, () => console.log(`[ask] listening on :${PORT}`));
}
