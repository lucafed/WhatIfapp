// /api/ask.js
import express from "express";
import { OpenAI } from "openai";

// ====== CONFIG ======
const MODEL = process.env.OPENAI_MODEL || "gpt-5.1-mini";
const DAILY_CAP_FREE = 3;
const DAILY_CAP_PRO = 10;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ""; // opzionale

// ====== STATE (semplice, volatile) ======
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const router = express.Router();

// memorie per utente (LRU molto semplice)
const MEMORY = new Map();          // key -> { notes: string[], updatedAt }
const USAGE = new Map();           // key|YYYY-MM-DD -> count

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function userKey(req) {
  // a scelta: header x-user-id dal client; fallback su ip
  return (req.header("x-user-id") || req.ip || "anon").slice(0, 120);
}
function isAdmin(req) {
  return !!(req.header("x-admin-token") && req.header("x-admin-token") === ADMIN_TOKEN);
}
function isPro(req) {
  return req.header("x-pro") === "1";
}
function incUsage(key, cap) {
  const k = `${key}|${todayStr()}`;
  const u = (USAGE.get(k) || 0) + 1;
  USAGE.set(k, u);
  if (Number.isFinite(cap) && u > cap) return { blocked: true, used: u, dailyCap: cap };
  return { blocked: false, used: u, dailyCap: cap };
}
function getUsage(key) {
  const k = `${key}|${todayStr()}`;
  return USAGE.get(k) || 0;
}
function capFor(req) {
  if (isAdmin(req)) return Infinity;
  return isPro(req) ? DAILY_CAP_PRO : DAILY_CAP_FREE;
}

// ====== FEW-SHOT (TUOI TESTI) ======
const WTF_FEWSHOT = [
  {
    u: "☕ E se aprissi un bar?",
    a: `Ah, ma guarda un po’, il genio dell’espresso che si sveglia con la vocazione imprenditoriale. Ti vedo: grembiule nuovo, sorriso da spot pubblicitario, la moka che sibila come un vecchio nonno stanco di vivere. Arriva il primo cliente, chiede un cappuccino “senza schiuma, ma caldo, però freddo dentro” e già ti parte la pressione. Tentando l’impossibile, ti bruci un dito e ti scappa un “porca di quella schiuma sorda e bastarda!”: le tazzine vibrano come castagnette e il cucchiaino va in sciopero. Il frigo rantola, la macchina del caffè fa un ruttino di protesta, e una vecchietta ti guarda come se avessi bestemmiato in latino. Tu versi un goccio di grappa nel caffè e pensi: almeno oggi ho aperto un locale che fa ridere anche i mobili. Quando chiudi la sera, il bancone sospira “ce la rifacciamo domani, capo?” — e tu annuisci, col fegato in disarmo ma il morale alto.`
  },
  {
    u: "🏍️ E se comprassi una moto?",
    a: `Ah, eccoci, il nuovo Valentino del parcheggio condominiale. Giacca di pelle lucida, casco nuovo e orgoglio che fa attrito. Accendi il motore: romba come un drago epilettico e già ti senti immortale. Poi un piccione ti taglia la strada e ti parte un “porca di quella frizione ubriaca e maledetta!”: il cane del quartiere ulula in do maggiore e il semaforo si gira dall’altra parte per la vergogna. Riparti come se niente fosse, ma il cavalletto resta giù e ti fa uno sgambetto da bullo: “mannaggia al ferro storto che ti ha creato!”. Ti fermi al bar, ordini un Negroni, il barista ti versa due dita extra “per compassione”. Alla fine ridi, bestemmi piano un’ultima volta, e capisci che la moto non è un’uscita di sicurezza: è un modo elegante di cadere con stile.`
  },
  {
    u: "💔 E se mi innamorassi di nuovo?",
    a: `Ah, di nuovo tu con il cuore in mano. Ti vedo: vestita bene ma con l’occhio lucido, messaggi che cancelli e riscrivi come se stessi trattando un’adozione internazionale. Lui ti visualizza e non risponde — e ti scappa un “porca di quella chat maledetta e dell’algoritmo suo zio!”: la lampada vibra offesa e il gatto si infila dietro la lavatrice. Il bicchiere di vino si riempie da solo per compassione, tu sospiri e imprechi con grazia da signora disperata. “Vabbè, almeno stavolta sapevo dove mi andavo a schiantare”, ti dici. Tra una risata e un rutto di rosé capisci che innamorarsi è come un aperitivo: finirà storto, ma finché dura è vita vera.`
  }
];

const WHIF_ANALYTIC = [
  {
    u: "E se tornassi a vivere all’Aquila?",
    a: `Rientrare oggi all’Aquila significa ritrovare una città che ha cambiato pelle ma non respiro. La ricostruzione ha rimesso in moto artigiani e servizi con un passo costante; meno industria, più impresa locale e università che trattiene per scelta. Il costo della vita resta inferiore al Nord e anche gli stipendi: si guadagna meno, ma si spende con più senso. I tempi di spostamento sono corti, l’aria è più leggera, le reti di vicinato fanno da ammortizzatore. La scuola è diffusa, lo sport guarda alla montagna, la sanità è vicina ma con liste d’attesa a macchia di leopardo. Il Veneto ti mancherebbe per velocità e mercato, ma qui recupereresti pressione bassa e relazioni dense. In pratica: meno rumore, più continuità. E quando chiudi casa la sera, il silenzio non è vuoto — è spazio per respirare.`
  }
];

const WHIF_POETIC = [
  {
    u: "E se tornassi a vivere all’Aquila?",
    a: `Riapri le finestre e l’aria fredda sa di legna e memoria. I vicoli ti riconoscono dal passo, le montagne ti guardano come se non te ne fossi mai andato. Il bar sotto casa serve ancora il caffè corto e ruvido, e qualcuno ti chiama per nome come se il tempo avesse aspettato. I bambini imparano il calendario dalle stagioni, non dall’orologio. Le serate hanno il suono dei portoni che si chiudono e delle chiacchiere che restano sulla soglia. Ogni mattino è un inizio semplice; ogni sera è un pezzo di pace cucito al giorno. Non stai tornando indietro: stai tornando dove la corsa smette di comandare.`
  }
];

// ====== PROMPT RIGIDI ======
function systemFor(style, substyle, memoryExtra, periodo, lang, sex) {
  const base = [
    memoryExtra ? `Long-term context to reuse subtly: ${memoryExtra}` : "",
    periodo ? `Temporal mood: ${periodo === "past" ? "PAST" : "FUTURE"}.` : "",
    sex ? `User sex hint: ${sex}.` : "",
    `Answer language: ${lang || "it"}.`
  ].filter(Boolean).join(" ");

  if (style === "wtf") {
    return `Speak EXACTLY like the “What the F” few-shots.
HARD RULES:
- Start the paragraph with "Ah,".
- Single paragraph. 6–9 sentences. No lists, headings, or emojis.
- Include one loud, adult Italian-style curse; then IMMEDIATELY add TWO reaction beats (objects/people/animals), back-to-back.
- Vivid, streetwise sarcasm; theatrical but friendly; keep it playful and raw.
- End with a sly, self-aware closing (no moral of the story).
Output ONLY the paragraph. ${base}`.trim();
  }

  const isAnalitic = (substyle || "").toLowerCase() === "analitico";
  return `Speak EXACTLY like the “What if — ${isAnalitic ? "Analitico" : "Poetico"}” few-shots.
HARD RULES:
- Single paragraph. 8–11 sentences. No lists, no questions, no emojis.
- ${isAnalitic
    ? "Concrete everyday realism, balanced pros/cons, gentle reflective closing."
    : "Warm everyday images, musical cadence, gentle soft closing."
  }
Output ONLY the paragraph. ${base}`.trim();
}

function fewshotsFor(style, substyle) {
  if (style === "wtf") return WTF_FEWSHOT;
  return (substyle || "").toLowerCase() === "poetico" ? WHIF_POETIC : WHIF_ANALYTIC;
}

// ====== VALIDAZIONE OUTPUT ======
const curseHints = [
  "porca", "mannaggia", "maledetta", "per l’amor", "sacrament",
  "vaff", "stramaled", "di quella", "del diavolo"
];

function isSingleParagraph(text) {
  return !/\n{2,}/.test(text.trim());
}
function sentenceCount(text) {
  const t = text.replace(/\n+/g, " ").trim();
  const parts = t.split(/[.!?…]+[\s)]*/).filter(s => s.trim().length > 0);
  return parts.length;
}
function startsWithAh(text) {
  return /^Ah,\s/.test(text.trim());
}
function hasCurse(text) {
  const low = text.toLowerCase();
  return curseHints.some(w => low.includes(w));
}
function hasTwoReactions(text) {
  // Cerca due reazioni consecutive stile “: … , e …” oppure “— … — …”
  const twoEmDash = (text.match(/—/g) || []).length >= 2;
  const colonThenAnd = /:\s*[^.?!]+,\s*(?:e|ed)\s+[^.?!]+/.test(text);
  const chainVerbs = /(ulula|applaude|trema|ride|fischia|sospira).+?(ulula|applaude|trema|ride|fischia|sospira)/i.test(text);
  return twoEmDash || colonThenAnd || chainVerbs;
}

async function generate(messages, temperature, presence) {
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

// ====== ROUTE ======
router.post("/", express.json(), async (req, res) => {
  try {
    const key = userKey(req);
    const {
      domanda = "",
      stile = "whatif",          // "wtf" | "whatif"
      substyle = "analitico",    // "analitico" | "poetico" (solo per whatif)
      lang = "it",
      extra = "",                // memoria/contesto dal client
      micro = {},                // micro-profili (Jung ecc.)
      periodo = "future",        // "past" | "future"
      sex = ""                   // "m" | "f" | "nb" | ""
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ detail: "bad_request" });
    }

    // ==== RATE LIMIT ====
    const cap = capFor(req);
    if (Number.isFinite(cap)) {
      const used = getUsage(key);
      if (used >= cap) {
        return res.status(402).json({ used, dailyCap: cap });
      }
    }
    // incrementa ora (anche se poi fallisce: come l'app)
    const inc = incUsage(key, cap);
    if (inc.blocked) return res.status(402).json({ used: inc.used, dailyCap: inc.dailyCap });

    // ==== MEMORIA LATO SERVER ====
    const memObj = MEMORY.get(key) || { notes: [], updatedAt: 0 };
    // append subtle facts se passati
    const microLine = micro && Object.keys(micro).length
      ? `Micro-profile today: ${JSON.stringify(micro)}.`
      : "";
    const extraLine = extra ? String(extra) : "";
    const mergedMemory = [memObj.notes.slice(-6).join(" • "), extraLine, microLine].filter(Boolean).join(" | ");
    // salva un frammento della domanda per ricorrenze
    memObj.notes.push(`Q:${domanda.slice(0, 140)}`);
    if (memObj.notes.length > 40) memObj.notes = memObj.notes.slice(-40);
    memObj.updatedAt = Date.now();
    MEMORY.set(key, memObj);

    // ==== PROMPT ====
    const sys = systemFor(stile, substyle, mergedMemory, periodo, lang, sex);
    const shots = fewshotsFor(stile, substyle);
    const messages = [
      { role: "system", content: sys },
      ...shots.flatMap(s => ([
        { role: "user", content: s.u },
        { role: "assistant", content: s.a }
      ])),
      { role: "user", content: domanda }
    ];

    const temp = stile === "wtf" ? 0.9 : 0.7;
    const presence = stile === "wtf" ? 0.6 : 0.2;

    // ==== GENERA ====
    let out = await generate(messages, temp, presence);

    // ==== REPAIR PASS (vincoli duri) ====
    const mustRepair =
      (stile === "wtf" && !startsWithAh(out)) ||
      !isSingleParagraph(out) ||
      (stile === "wtf" && (!hasCurse(out) || !hasTwoReactions(out))) ||
      (stile === "wtf" && (sentenceCount(out) < 6 || sentenceCount(out) > 9)) ||
      (stile !== "wtf" && (sentenceCount(out) < 8 || sentenceCount(out) > 11));

    if (mustRepair) {
      const repair = [
        ...messages,
        {
          role: "system",
          content:
            stile === "wtf"
              ? `REPAIR NOW: rewrite STRICTLY.
Requirements:
- Start with "Ah,".
- Single paragraph (no blank lines).
- 6–9 sentences.
- Include one loud adult curse; then IMMEDIATELY TWO reaction beats in sequence (objects/people/animals responding).
- Keep raw sarcastic tone; end with sly self-aware line.
Output ONLY the paragraph.`
              : `REPAIR NOW: rewrite STRICTLY.
Requirements:
- Single paragraph (no blank lines).
- 8–11 sentences.
- ${ (substyle || "").toLowerCase() === "analitico"
                    ? "Balanced concrete realism with brief reflective closing."
                    : "Warm poetic everyday images with soft closing."
                }
Output ONLY the paragraph.`
        }
      ];
      out = await generate(repair, temp, presence);
    }

    // normalizza: un paragrafo pulito
    out = out.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();

    return res.json({ answer: out });
  } catch (err) {
    console.error("ask error:", err?.response?.data || err);
    return res.status(500).json({ detail: "server_error" });
  }
});

export default router;
