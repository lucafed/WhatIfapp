/**
 * /api/ask.js — What?f
 * - Few-shot IDENTICI a quelli forniti (WTF bar/moto/innamorarsi, What if Analitico/Poetico Aquila)
 * - Stile forzato: “What the F” (apre con "Ah,", bestemmione adulto + 2 reazioni) / “What if” (analitico o poetico)
 * - Memoria utente (volatile in-memory, LRU semplice)
 * - Rate limit giornaliero: FREE 3 / PRO 10 / ADMIN ∞ (402 con {used, dailyCap})
 * - Parametri: domanda, stile("wtf"|"whatif"), substyle("analitico"|"poetico"), lang, extra, micro, periodo, sex
 * - Repair-pass se l’output non rispetta i vincoli
 * - Mini bootstrap Express opzionale a fondo file
 */

import express from "express";
import { OpenAI } from "openai";

// ========= CONFIG =========
const MODEL = process.env.OPENAI_MODEL || "gpt-5.1-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // obbligatoria
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ""; // opzionale
const DAILY_CAP_FREE = 3;
const DAILY_CAP_PRO = 10;
const MAX_MEMO_PER_USER = 40;
const MAX_SHOTS_USED = 6; // quanti snippet di memoria rimettere nel system

// ========= CLIENT =========
if (!OPENAI_API_KEY) {
  console.error("[ask] Manca OPENAI_API_KEY nell'ambiente.");
}
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// ========= STATE (volatile) =========
const router = express.Router();
const USAGE = new Map();  // key|yyyy-mm-dd -> count
const MEMORY = new Map(); // key -> { notes: string[], updatedAt: number }

const nowISODate = () => new Date().toISOString().slice(0, 10);
const userKey = (req) => (req.header("x-user-id") || req.ip || "anon").slice(0, 120);
const isAdmin = (req) => !!ADMIN_TOKEN && req.header("x-admin-token") === ADMIN_TOKEN;
const isPro = (req) => req.header("x-pro") === "1";
const capFor = (req) => (isAdmin(req) ? Infinity : isPro(req) ? DAILY_CAP_PRO : DAILY_CAP_FREE);
const addUsage = (key, cap) => {
  const k = `${key}|${nowISODate()}`;
  const v = (USAGE.get(k) || 0) + 1;
  USAGE.set(k, v);
  if (Number.isFinite(cap) && v > cap) return { blocked: true, used: v, dailyCap: cap };
  return { blocked: false, used: v, dailyCap: cap };
};
const getUsage = (key) => USAGE.get(`${key}|${nowISODate()}`) || 0;

// ========= FEW-SHOT (TUOI TESTI) =========
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

// ========= PROMPT BUILDER =========
function systemFor(style, substyle, memoryExtra, periodo, lang, sex) {
  const base = [
    memoryExtra ? `Long-term context to subtly reuse: ${memoryExtra}` : "",
    periodo ? `Temporal mood: ${periodo === "past" ? "PAST" : "FUTURE"}.` : "",
    sex ? `User sex hint: ${sex}.` : "",
    `Answer language: ${lang || "it"}.`
  ].filter(Boolean).join(" ");

  if (style === "wtf") {
    return `Speak EXACTLY like the “What the F” few-shots the user provided.
HARD RULES:
- Start the paragraph with "Ah,".
- Single paragraph. 6–9 sentences. No lists, no emojis.
- Include ONE loud, adult Italian-style curse; then IMMEDIATELY add TWO reaction beats in sequence (objects/people/animals responding).
- Raw, streetwise sarcasm; theatrical but friendly; a bit dirty but playful.
- Close with a sly, self-aware line (no moral).
Output ONLY the paragraph. ${base}`.trim();
  }

  const isAnalytic = (substyle || "").toLowerCase() === "analitico";
  return `Speak EXACTLY like the “What if — ${isAnalytic ? "Analitico" : "Poetico"}” few-shots the user provided.
HARD RULES:
- Single paragraph. 8–11 sentences. No lists, no questions, no emojis.
- ${isAnalytic
    ? "Concrete, balanced realism (pros/cons); warm but grounded; short reflective closing."
    : "Warm everyday images; musical cadence; soft reflective closing."
  }
Output ONLY the paragraph. ${base}`.trim();
}

function fewshotsFor(style, substyle) {
  if (style === "wtf") return WTF_FEWSHOT;
  return (substyle || "").toLowerCase() === "poetico" ? WHIF_POETIC : WHIF_ANALYTIC;
}

// ========= VALIDAZIONE =========
const curseHints = [
  "porca", "mannaggia", "maledett", "vaff", "di quella", "del diavolo", "sacrament", "bestemm"
];

const countSentences = (t) =>
  t.replace(/\n+/g, " ").split(/[.!?…]+[\s)]*/).filter(s => s.trim()).length;

const isSingleParagraph = (t) => !/\n{2,}/.test(t.trim());
const startsWithAh = (t) => /^Ah,\s/.test(t.trim());
const hasCurse = (t) => curseHints.some(w => t.toLowerCase().includes(w));
const hasTwoReactions = (t) => {
  const twoDash = (t.match(/—/g) || []).length >= 2;
  const colonChain = /:\s*[^.?!]+,\s*(?:e|ed)\s+[^.?!]+/.test(t);
  const verbs = /(ulula|applaude|trema|ride|fischia|sospira|borbotta).+?(ulula|applaude|trema|ride|fischia|sospira|borbotta)/i.test(t);
  return twoDash || colonChain || verbs;
};

// ========= OPENAI WRAPPER =========
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

// ========= ROUTE =========
router.post("/", express.json(), async (req, res) => {
  try {
    const key = userKey(req);
    const cap = capFor(req);

    const {
      domanda = "",
      stile = "whatif",
      substyle,                  // "analitico" | "poetico" (se assente, provo a inferire)
      lang = "it",
      extra = "",                // note varie dal client
      micro = {},                // micro-profili (mood/anchor/decide + Jung ecc.)
      periodo = "future",
      sex = ""
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ detail: "bad_request" });
    }

    // RATE LIMIT
    if (Number.isFinite(cap)) {
      const used = getUsage(key);
      if (used >= cap) return res.status(402).json({ used, dailyCap: cap });
    }
    const bef = addUsage(key, cap);
    if (bef.blocked) return res.status(402).json({ used: bef.used, dailyCap: bef.dailyCap });

    // MEMORIA
    const mem = MEMORY.get(key) || { notes: [], updatedAt: 0 };
    mem.notes.push(`Q:${domanda.slice(0, 140)}`);
    if (mem.notes.length > MAX_MEMO_PER_USER) mem.notes = mem.notes.slice(-MAX_MEMO_PER_USER);
    mem.updatedAt = Date.now();
    MEMORY.set(key, mem);

    const microLine = micro && Object.keys(micro).length ? `Micro-profile: ${JSON.stringify(micro)}` : "";
    const extraLine = extra ? String(extra) : "";
    const memoryExtra = [
      mem.notes.slice(-MAX_SHOTS_USED).join(" • "),
      extraLine,
      microLine
    ].filter(Boolean).join(" | ");

    // Sotto-stile “what if” (default analitico)
    let effSub = substyle;
    if (stile === "whatif" && !effSub) {
      // euristica: se micro.jung in [NF/idealista] => poetico, altrimenti analitico
      const jung = `${micro?.jung || micro?.jung_style || ""}`.toLowerCase();
      effSub = /nf|idealist|poet|dream|feeling/.test(jung) ? "poetico" : "analitico";
    }

    const sys = systemFor(stile, effSub, memoryExtra, periodo, lang, sex);
    const shots = fewshotsFor(stile, effSub);

    const messages = [
      { role: "system", content: sys },
      ...shots.flatMap(s => [{ role: "user", content: s.u }, { role: "assistant", content: s.a }]),
      { role: "user", content: domanda }
    ];

    const temperature = stile === "wtf" ? 0.9 : 0.7;
    const presence = stile === "wtf" ? 0.6 : 0.2;

    // 1) GENERA
    let text = await chat(messages, temperature, presence);

    // 2) REPAIR PASS se serve
    const sent = countSentences(text);
    const mustRepair =
      !isSingleParagraph(text) ||
      (stile === "wtf" && !startsWithAh(text)) ||
      (stile === "wtf" && (!hasCurse(text) || !hasTwoReactions(text))) ||
      (stile === "wtf" && (sent < 6 || sent > 9)) ||
      (stile !== "wtf" && (sent < 8 || sent > 11));

    if (mustRepair) {
      const fixRules =
        stile === "wtf"
          ? `REPAIR NOW (STRICT):
- Start with "Ah,".
- One single paragraph (no blank lines).
- 6–9 sentences.
- Include one loud adult Italian-style curse; then IMMEDIATELY TWO reaction beats in sequence (objects/people/animals).
- Raw sarcastic voice; sly self-aware closing.
Return ONLY the paragraph.`
          : `REPAIR NOW (STRICT):
- One single paragraph (no blank lines).
- 8–11 sentences.
- ${ (effSub || "").toLowerCase() === "analitico"
              ? "Concrete, balanced realism; short reflective closing."
              : "Warm poetic everyday images; soft reflective closing."
            }
Return ONLY the paragraph.`;

      text = await chat(
        [...messages, { role: "system", content: fixRules }],
        temperature,
        presence
      );
    }

    // Normalizza whitespace e assicura punto finale
    text = text.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
    if (!/[.!?…]$/.test(text)) text += ".";

    return res.json({ answer: text });
  } catch (err) {
    console.error("[ask] error:", err?.response?.data || err);
    return res.status(500).json({ detail: "server_error" });
  }
});

export default router;

/* ======== BOOTSTRAP FACOLTATIVO =========
   Usa questa se vuoi farlo girare standalone: node api/ask.js
   Altrimenti importa `router` nel tuo server principale:
   app.use("/api/ask", askRouter)
*/
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const app = express();
  // CORS very open per test locali
  app.use((_, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-pro, x-user-id, x-admin-token");
    next();
  });
  app.use("/api/ask", router);
  const PORT = process.env.PORT || 8787;
  app.listen(PORT, () => console.log(`[ask] up on :${PORT}`));
}
