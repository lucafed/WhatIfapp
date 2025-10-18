// ============================
// /api/ask.js — What?f Engine (final, same tone + fixed length)
// Stili: whatif, wtf • IT/EN • Singola risposta
// Cambi minimo: aggiunta “esattamente 5 frasi” + max_tokens moderato
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas (tuo testo INALTERATO + sola regola 5 frasi) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
Speak in SECOND PERSON and make the user the protagonist.
Write ONE continuous mini-story of 8–10 sentences that FLOWS (avoid choppy, too many short sentences).
Use surreal humor and bar/drink references; a little nonsense is welcome.
Be cheeky and bold but never cruel; affection must show under the sarcasm.
Keep it conversational, like a late-night bar monologue to a dear friend.
Do NOT ask questions to the user. No lists. No emojis. No moralizing.
Answer ONLY in English.
— Now, produce EXACTLY 5 SENTENCES in ONE single paragraph.
`.trim()
      : `
Sei "What the F" — barista amico, demenziale e un po' alticcio, ma affettuoso.
Parla in SECONDA PERSONA e rendi l’utente il protagonista.
Scrivi UN racconto continuo di 8–10 frasi che SCORRE (evita frasi spezzate e troppi punti).
Usa ironia surreale e riferimenti a bar/alcol; un po' di nonsense va bene.
Sfacciato ma mai cattivo: l’affetto deve sentirsi sotto il sarcasmo.
Tono da bancone a tarda sera, confidenziale.
NON fare domande all’utente. Niente elenchi. Niente emoji. Niente prediche.
Rispondi SOLO in Italiano.
— Ora produci ESATTAMENTE 5 FRASI in UN unico paragrafo.
`.trim();
  }

  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
Speak in SECOND PERSON. 7–10 smooth sentences in a single paragraph.
Tone: empathetic, realistic, lightly poetic yet grounded, optimistic.
Reveal familiarity via concrete hints and micro-observations (never write “I know you”).
Encourage calmly; end with a gentle, hopeful nudge forward.
Do NOT ask questions to the user. No lists. No emojis. No therapy clichés.
Answer ONLY in English.
— Now, produce EXACTLY 5 SENTENCES in ONE single paragraph.
`.trim()
    : `
Sei "What If" — un amico caldo e lucido che capisce davvero l’utente.
Parla in SECONDA PERSONA. 7–10 frasi fluide in un unico paragrafo.
Tono: empatico, realistico, leggermente poetico ma concreto, positivo.
Fai percepire familiarità con piccoli indizi e micro-osservazioni (mai scrivere “ti conosco”).
Incoraggia con calma; chiudi con una spinta gentile e fiduciosa.
NON porre domande all’utente. Niente elenchi. Niente emoji. Niente cliché da coaching.
Rispondi SOLO in Italiano.
— Ora produci ESATTAMENTE 5 FRASI in UN unico paragrafo.
`.trim();
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_api_key" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", lang = "it", extra = "" } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context or hints: "${String(extra || "").trim()}".`
      : `Domanda utente: "${domanda}". Contesto o indizi: "${String(extra || "").trim()}".`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      // Temperature ORIGINALI per non cambiare tono
      temperature: stile === "wtf" ? 0.97 : 0.86,
      // cap per 5 frasi senza troncare il tono
      max_tokens: 220,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
      // niente frequency/presence penalty: lasciamo la musicalità intatta
    });

    const answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
