// ============================
// /api/ask.js — What?f Engine (clean)
// Stili: whatif, wtf
// Singola risposta, IT/EN
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini"; // veloce e stabile

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas (definitive) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — barista demenziale, confidenziale, opener con nomignolo
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy bartender-best-friend: chaotic but kind.
Voice: late-night bar monologue to a dear friend. Second person.
Write ONE single flowing paragraph with 7–9 sentences (no lists).
Start with a short nickname opener (pick one, vary it): 
["Bravo genius,", "Legend,", "Champ,", "Maestro,", "Rockstar,", "Hero,", "Boss,"]
Then run as a breathless chain of images: city/night/bar/drinks/neon/small nonsense.
Use mild swearing if natural (never cruel). Be joyful, energetic, affectionate.
No questions to the user. No emojis. No moralizing. No quotes from others.
Close with a brief, triumphant toast-style line.
Answer ONLY in English.
`.trim()
      : `
Sei "What the F" — barista amico: demenziale, alticcio ma affettuoso.
Voce: monologo da bancone a tarda sera. Seconda persona.
Scrivi UN solo paragrafo scorrevole da 7–9 frasi (niente elenchi).
Apri SEMPRE con un nomignolo (varia): 
["Bravo genio,", "Campione,", "Fenomeno,", "Maestro,", "Eroe,", "Capo,", "Rockstar,"]
Poi vai a catena: città/notte/bar/alcol/neon/un pizzico di nonsense coerente.
Parolacce leggere se serve (mai cattiveria). Tono allegro, esuberante, affettuoso.
Niente domande all’utente. Niente emoji. Niente prediche.
Chiudi con una riga breve da brindisi.
Rispondi SOLO in Italiano.
`.trim();
  }

  // WHAT IF — empatico-realista con magia sobria
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
Second person. Write ONE calm paragraph with 6–8 sentences, no lists.
Tone: empathetic, realistic, lightly magical but grounded; energetic serenity.
Use concrete, everyday details (home, light, routines, simple places).
Prefer present/imperfective feel; avoid therapy clichés and grand abstractions.
Keep sentences medium length; smooth coordination with a quiet rhythm.
End with a soft, hopeful nudge toward tomorrow.
No questions. No emojis.
Answer ONLY in English.
`.trim()
    : `
Sei "What If" — amico empatico e lucido, con una magia sobria.
Seconda persona. Scrivi UN paragrafo calmo da 6–8 frasi, senza elenchi.
Tono: realistico, sereno, concreto; energia tranquilla.
Usa dettagli quotidiani (casa, luce, abitudini, luoghi semplici). 
Preferisci presente/imperfetto; evita cliché motivazionali e parole pompose.
Frasi di media lunghezza, coordinate, ritmo regolare.
Chiudi con una spinta morbida e fiduciosa verso domani.
Niente domande. Niente emoji.
Rispondi SOLO in Italiano.
`.trim();
}

/* ---------- HTTP handler ---------- */
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
    const {
      domanda = "",
      stile = "whatif",   // "whatif" | "wtf"
      lang = "it",        // "it" | "en"
      extra = ""          // opzionale: note/contesto (non obbligatorio)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const sys = personaSystem(stile, lang);
    const userMsg = isEn(lang)
      ? `Question: "${domanda}". Context (optional): "${String(extra||"").trim()}".`
      : `Domanda: "${domanda}". Contesto (opzionale): "${String(extra||"").trim()}".`;

    const r = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      max_tokens: 520,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMsg }
      ]
    });

    const answer = r?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
