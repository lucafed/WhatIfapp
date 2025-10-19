// ============================
// /api/ask.js — What?f Engine (Finale Assoluto)
// Stili: whatif | wtf (“Incazzato Illuminato”)
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

function normLine(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "")
    .trim();
}

function tightenSentences(text, maxSentences) {
  const parts = String(text || "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n) continue;
    if (seen.has(n)) continue;
    const wc = p.split(/\s+/).length;
    if (wc <= 3 && !/[.!?]$/.test(p)) continue;
    out.push(p);
    seen.add(n);
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

/* ---------- Personas ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — versione “Incazzato Illuminato”
    const SYSTEM_WTF = `
Sei “What the F” — versione «Incazzato Illuminato».
Parla SEMPRE in SECONDA PERSONA, come un narratore sarcastico e affettuoso che ti conosce troppo bene.
Scrivi UN SOLO PARAGRAFO di 5–7 frasi (circa 100–130 parole), fluido, ironico e pieno di ritmo.
Tono: tragicomico, autoironico, sarcastico ma tenero; come un amico ubriaco che ha capito tutto e niente.
Stile: realismo comico da sopravvivenza emotiva. Ogni scena parte da un piccolo atto quotidiano, degenera nel caos, e si chiude con una battuta geniale o amara che fa ridere e pensare.
Lessico: concreto e vivido — vento, PDF, taxi, casco, genziana, dignità smarrita, ecc.
Niente elenchi, niente domande, niente emoji, niente morale. Mai spiegare: mostra tutto nel tono.
Scrivi come se la vita fosse un bar mal gestito, ma dove ogni sbronza ha un insegnamento che non ti ricordi più.
`.trim();

    const STYLE_ANCHOR_WTF = `
🍷 E se tornassi a vivere all’Aquila?
Torneresti convinto di aver capito la vita, poi il vento ti ribalta i pensieri e la città ti accoglie con un sorriso storto. Ti siedi al bar, ordini un caffè e finisci con una genziana perché “tanto è ancora presto”. Ti ritrovi a chiacchierare con facce familiari che sembrano uscite da un vecchio VHS, e ogni battuta sa di déjà-vu e tabacco freddo. Ti dici “riparto da qui”, ma già ti sei iscritto al campionato di bestemmie contro i lavori infiniti e l’umidità che ti entra nell’anima. Poi però la sera cala, la pietra brilla, e capisci che L’Aquila non ti perdona, ma ti abbraccia male. E in quell’abbraccio storto, un po’ ti ritrovi e un po’ ti perdi — come sempre.

🏍️ E se comprassi una moto?
Ti senti già un eroe del vento, poi scopri che il casco ti strappa l’orecchio e la moto non parte perché ha più ansia di te. Parti comunque, col battito cardiaco in curva e il dubbio che la libertà costi troppa benzina. Ti fermi per un caffè da duro, ma lasci le chiavi al bancone e la dignità nel parcheggio. Un ragazzino su un motorino ti saluta con pietà, e un signore in bici ti dà una lezione di equilibrio. Ridi, bestemmi piano, e prometti a te stesso che la prossima volta ti compri un monopattino. Ma poi il motore tossisce, il vento torna, e senti quella fitta al petto che non è paura — è amore a due tempi.

💼 E se aprissi un’attività?
Ti svegli carico, credi nel destino, nel caffè e nella burocrazia gentile. Dopo due ore sei a litigare con un PDF che non si firma e con un funzionario che parla solo in dialetto amministrativo. I fornitori ti scrivono “tranquillo” e spariscono, i clienti ti chiedono “uno sconto simbolico”, e il commercialista ti manda un messaggio con la scritta “🙏”. Ti dici che è solo l’inizio, poi guardi il conto e ti viene da invocare un santo patrono della partita IVA. La sera stappi la bottiglia della vittoria e scopri che è aceto balsamico. Ma lo bevi lo stesso, perché brucia — e in fondo, anche quello, è un segno che sei vivo.
`.trim();

    return { SYSTEM_WTF, STYLE_ANCHOR_WTF };
  }

  // WHAT IF — voce empatica (invariata)
  return {
    SYSTEM_WTF: `
Sei “What If” — un amico empatico, lucido e concreto.
Parla in SECONDA PERSONA, 7–10 frasi fluide in un unico paragrafo.
Tono: realistico, poetico ma pratico, fiducioso senza zucchero.
Mai dire “ti conosco”: suggeriscilo con dettagli concreti.
Niente domande, elenchi, emoji o frasi da coach.
`.trim(),
    STYLE_ANCHOR_WTF: ""
  };
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "missing_api_key" });

    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { domanda = "", stile = "whatif", lang = "it", extra = "" } = body;

    if (!domanda || typeof domanda !== "string")
      return res
        .status(400)
        .json({ error: "bad_request", detail: "domanda_required" });

    const { SYSTEM_WTF, STYLE_ANCHOR_WTF } = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}".`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}".`;

    const messages =
      stile === "wtf"
        ? [
            { role: "system", content: SYSTEM_WTF },
            { role: "system", content: STYLE_ANCHOR_WTF },
            { role: "user", content: userPrompt }
          ]
        : [
            { role: "system", content: SYSTEM_WTF },
            { role: "user", content: userPrompt }
          ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : 0.86,
      max_tokens: stile === "wtf" ? 250 : 700,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.0,
      presence_penalty: 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Mantieni ritmo e densità del tono “Incazzato Illuminato”
    if (stile === "wtf") {
      answer = tightenSentences(answer, 7);
      answer = clampWords(answer, 130);
      answer = answer.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
    }

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res
      .status(500)
      .json({ error: "server_error", detail: String(err?.message || err) });
  }
}
