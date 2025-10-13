// /api/ask.js (LEAN)
import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* Utils */
function detectLang(text = "") {
  const enHits = (text.match(/\b(what|if|and|or|you|should|would|move|work|buy|city|bike)\b/gi) || []).length;
  const itHits = (text.match(/\b(se|quando|perché|tornare|trasferir|lavor|comprare|città|moto)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}
function classifyTopic(q = "") {
  const s = q.toLowerCase();
  if (/(moto|motor(e|bike)|scooter|vespa)/.test(s)) return "moto";
  if (/(trasfer|tornassi|vivere a|relocat|move)/.test(s)) return "trasferimento";
  if (/(l'aquila|laquila|milano|roma|verona|lugano|zurigo|londra)/.test(s)) return "città";
  if (/(lavoro|work|azienda|ufficio|manager|ricercatore)/.test(s)) return "lavoro";
  return "generale";
}

/* PERSONAS – zero ancore, solo regole */
const PERSONA = {
  whatif: (lang) => isEn(lang) ? `
You are "What?f": intimate, clear, concrete.
ONLY English. Second person. One voice. No quotes. No lists.
8–12 short sentences (~180 words). One sentence per line.
Current and predictive, no moralizing, 0–2 tiny images max.
If FUTURE: include 1 very small first step, 1 success indicator, 1 realistic constraint.
If PAST: include exactly 1 trade-off and 1 success signal.
End with a soft episodic hook (not “two clean shots”).
` : `
Sei "What?f": intima, chiara, concreta.
SOLO Italiano. Seconda persona. Una voce. Niente virgolette. Niente elenchi.
8–12 frasi brevi (~180 parole). Una frase per riga.
Presente e predittiva, zero morale, 0–2 immagini piccole max.
Se FUTURO: 1 primo passo piccolo, 1 indicatore di successo, 1 vincolo realistico.
Se PASSATO: 1 trade-off reale e 1 segnale di successo.
Chiudi con un gancio episodico morbido (non “due colpi secchi”).
`,
  wtf: (lang) => isEn(lang) ? `
You are "What the F": late-night witty bartender—punchy, sardonic, never mean.
ONLY English. Second person. One voice. No quotes. No lists.
FORM: 6–10 LINES, each ≤15 words. One line per newline.
BAN words/tones: nostalgia, perfume, sunset, wine, whisper, poem/poetic, fairy-tale, lyrical, romantic.
If you slip into poetry, immediately self-correct to dry bar banter.
No questions until the final line. End with a playful episodic hook.
` : `
Sei "What the F": barista nottambulo—secco, sarcastico, mai cattivo.
SOLO Italiano. Seconda persona. Una voce. Niente virgolette. Niente elenchi.
FORMA: 6–10 RIGHE, ≤15 parole ciascuna. Una riga per a capo.
VIETA toni/parole: nostalgia, profumo, tramonto, vino, sussurro, poesia/poetico, fiaba, lirico, romantico.
Se scivoli nel poetico, AUTO-CORREGGITI subito in battuta asciutta da bancone.
Niente domande fino all’ultima riga. Chiudi con un gancio episodico giocoso.
`
};

/* Clarify – minimale */
function clarifyQuestions(domanda, periodo, lang = "it") {
  const en = isEn(lang);
  const L = (id, it, enStr, phIt, phEn) => ({ id, label: en ? enStr : it, placeholder: en ? phEn : phIt });
  const s = domanda.toLowerCase();
  if (/(moto|motor(e|bike)|scooter|vespa)/.test(s)) {
    return [
      L("timing","Quando la prenderesti davvero?","When would you actually buy it?","questo mese / 3–6 mesi","this month / 3–6 months"),
      L("use","Uso principale?","Main use?","casa-lavoro / weekend / viaggi","commute / weekends / trips"),
      L("budget","Budget mensile?","Monthly budget?","assicurazione + carburante","insurance + fuel")
    ];
  }
  return [
    L("window","Finestra decisionale reale?","Real decision window?","questo mese / 3–6 / 12","this month / 3–6 / 12"),
    L("signal","Segnale di successo?","Success signal?","prima risposta / energia / sonno","first reply / energy / sleep"),
    L("limit","Vincolo concreto?","Hard constraint?","budget / tempo / energia","budget / time / energy")
  ];
}

/* Handler */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-whatif-stream");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const {
      domanda,
      lang: langIn = "auto",
      periodo = "future",
      stile = "whatif",
      stream = false,
      clarify = false,
      clarifications = []
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const lang = langIn === "auto" ? detectLang(domanda) : langIn;
    const en = isEn(lang);
    const topic = classifyTopic(domanda);

    if (clarify) {
      return res.status(200).json({ questions: clarifyQuestions(domanda, periodo, lang) });
    }

    const system = `
${PERSONA[stile === "wtf" ? "wtf" : "whatif"](lang).trim()}
HARD RULES:
- Reply ONLY in ${en ? "English" : "Italiano"}.
- Stay strictly on the user question topic: "${topic}".
- No lists/bullets. No quotation marks.
- For WTF: if a line >15 words, split it.
`.trim();

    // normalizza chiarimenti (solo info grezze; nessuna ancora profilo)
    let clarText = en ? "none" : "nessuno";
    if (Array.isArray(clarifications) && clarifications.length) {
      clarText = clarifications.join(", ");
    } else if (clarifications && typeof clarifications === "object") {
      const pairs = Object.entries(clarifications)
        .filter(([, v]) => String(v || "").trim())
        .map(([k, v]) => `${k}: ${v}`);
      if (pairs.length) clarText = pairs.join(", ");
    }

    const user = `
${en ? "User question" : "Domanda utente"}: ${domanda}
${en ? "Extra details" : "Dettagli"}: ${clarText}
${en
  ? `Write ${stile === "wtf" ? "6–10 punchy LINES (≤15 words each)" : "8–12 short sentences"}, ~180 words max.
One line per sentence. Second person. Single voice. End with a soft episodic hook.`
  : `Scrivi ${stile === "wtf" ? "6–10 RIGHE secche (≤15 parole ciascuna)" : "8–12 frasi brevi"}, max ~180 parole.
Una riga per frase. Seconda persona. Una sola voce. Chiudi con un gancio episodico morbido.`
}`.trim();

    const temperature = stile === "wtf" ? 0.97 : 0.82;
    const doStream = stream || String(req.headers["x-whatif-stream"] || "") !== "";

    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      const s = await client.chat.completions.create({
        model: MODEL_TEXT,
        temperature,
        stream: true,
        max_tokens: 700,
        messages: [{ role: "system", content: system }, { role: "user", content: user }]
      });
      for await (const chunk of s) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    const c = await client.chat.completions.create({
      model: MODEL_TEXT,
      temperature,
      max_tokens: 700,
      messages: [{ role: "system", content: system }, { role: "user", content: user }]
    });

    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text, lang, topic });

  } catch (err) {
    console.error("API /ask error:", err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
