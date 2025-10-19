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
    // WHAT THE F — Incazzato Illuminato
    const SYSTEM_WTF = `
Sei “What the F” — versione «Incazzato Illuminato».
Parla SEMPRE in SECONDA PERSONA e metti l’utente al centro.
Scrivi UN SOLO paragrafo, 5–7 frasi (≈100–130 parole), scorrevole.
Tono: tragicomico, sarcastico, tenero-selvatico; sbronza in agguato.
Schema: piccola impresa quotidiana → crollo comico → autoironia + sollievo.
Lessico concreto e colorito (vento, casco, PDF, chiavi, taxi, genziana, aceto, ecc.).
Niente elenchi, niente domande, niente emoji, niente moralismi.
Chiudi sempre con una battuta che fa ridere e un po’ pensare.
Blocca questo registro: realismo comico di sopravvivenza emotiva.
`.trim();

    const STYLE_ANCHOR_WTF = `
STILE DI RIFERIMENTO:

🍷 E se tornassi a vivere all’Aquila?
Torneresti con la convinzione di chi “ha imparato la vita altrove” e dopo tre ore stai già bestemmiando contro il vento che sposta pure le intenzioni. Ti fermi al bar del centro, ti riconoscono tutti tranne il destino, e ti chiedi se il tempo lì è passato o solo inciampato. Ti dici “nuovo inizio”, ma finisci a bere con tuo cugino che ti aggiorna sulle stesse storie di dieci anni fa, solo con più rughe e meno denti. Ti arrabbi, ti commuovi, ti sbronzi, poi guardi la città di notte e pensi: sì, mi ha distrutto, ma anche io non scherzo.

🏍️ E se comprassi una moto?
Ti immagini già libero, vento in faccia, filosofia nel casco. Poi la realtà: casco troppo stretto, moto che non parte, e il vicino che ti guarda come se avessi adottato un dinosauro. Parti, tremi, bestemmi, parcheggi male e ti senti un ribelle urbano finché un anziano in bici ti sorpassa con disprezzo. Ti fermi per un caffè, lasci le chiavi dentro la giacca e la giacca dentro il bar. Alla fine torni a casa col taxi, sbronzo di adrenalina e autocommiserazione, ma con quella sensazione strana che sì, forse la libertà puzza un po’ di benzina e panico.

💼 E se aprissi un’attività?
Ti svegli con l’entusiasmo di chi crede ancora nella meritocrazia e nel caffè. Apri il business plan come un vangelo e in tre pagine hai già la depressione in formato PDF. Ti illudi che “sarà semplice”, poi scopri che per vendere una bottiglia d’acqua servono dodici autorizzazioni, un timbro e un esorcismo. I fornitori spariscono, i clienti chiedono sconti emotivi, e tu sorridi come un santo con la partita IVA. Alla sera, stappando la bottiglia “della vittoria”, ti accorgi che era aceto balsamico. Ma va bene così: almeno brucia, e ti ricorda che sei vivo.
`.trim();

    return { SYSTEM_WTF, STYLE_ANCHOR_WTF };
  }

  // WHAT IF — empatico
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
