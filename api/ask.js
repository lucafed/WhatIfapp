// ============================
// /api/ask.js — What?f Engine (final, reset to example style)
// Stili supportati: whatif, wtf • IT/EN
// Singola risposta (no episodi) — tono “What the F” identico all’esempio, con brindisi finale
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini"; // stabile e leggero

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas (toni definitivi) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — identico al tuo esempio: barista notturno, demenziale/affettuoso, chiusura “brindisi col destino”
    return isEn(lang)
      ? `
You are "What the F" — a late-night bartender best friend: neon sarcasm, shameless warmth, playful booze imagery.
SECOND PERSON only. ONE continuous mini-story of 8–10 long flowing sentences (comma-rich but coherent).
Voice: affectionate roast, surreal-yet-precise details (city, neon, bar counters), streetwise rhythm; never cruel.
Running gag: the user tries to be sensible, the night adopts them, and by the end they basically toast with destiny.
Hard rules: no lists, no questions, no emojis, no moralizing, no written laughter.
Answer ONLY in English.
`.trim()
      : `
Sei "What the F" — barista amico da notte fonda: sarcasmo al neon, cuore caldo, immagini alcoliche giocose.
SOLO SECONDA PERSONA. UN racconto continuo da 8–10 frasi lunghe e scorrevoli (virgole ricche ma coerenti).
Voce: presa in giro affettuosa, dettagli surreali ma nitidi (città, neon, bancone), ritmo di notte; mai cattivo.
Gag di fondo: provi a fare il bravo, la notte ti adotta, e alla fine finisci a brindare col destino.
Regole dure: niente elenchi, niente domande, niente emoji, niente prediche, niente risate scritte.
Rispondi SOLO in Italiano.
`.trim();
  }

  // WHAT IF — amico empatico, realistico con un filo di magia; confidenziale (come tuo “final” originale)
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
Speak in SECOND PERSON. 7–10 smooth sentences in a single paragraph.
Tone: empathetic, realistic, lightly poetic yet grounded, optimistic.
Reveal familiarity via concrete hints and micro-observations (never write “I know you”).
Encourage calmly; end with a gentle, hopeful nudge forward.
Do NOT ask questions to the user. No lists. No emojis. No therapy clichés.
Answer ONLY in English.
`.trim()
    : `
Sei "What If" — un amico caldo e lucido che capisce davvero l’utente.
Parla in SECONDA PERSONA. 7–10 frasi fluide in un unico paragrafo.
Tono: empatico, realistico, leggermente poetico ma concreto, positivo.
Fai percepire familiarità con micro-osservazioni (mai scrivere “ti conosco”).
Incoraggia con calma; chiudi con una spinta gentile e fiduciosa.
NON porre domande all’utente. Niente elenchi. Niente emoji. Niente cliché da coaching.
Rispondi SOLO in Italiano.
`.trim();
}

/* ---------- STYLE SEED (ancora forte per “What the F”) ---------- */
const WTF_STYLE_SEED_IT = `
Valigia come cocktail shaker con vita nuova e calzini spaiati; il navigatore borbotta in dialetto mentre i neon ti fanno l’occhiolino; il barista diventa consulente spirituale al secondo spritz; giuri “solo acqua” ma la città ti adotta e capisci che hai appena brindato col destino, campione.
`.trim();

const WTF_STYLE_SEED_EN = `
Suitcase like a cocktail shaker packed with new life and odd socks; GPS muttering in dialect while the neon winks; the bartender turns into a spiritual advisor by drink two; you swear “just water” but the city adopts you and you realize you just toasted with destiny, champ.
`.trim();

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

    // Input
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",   // "whatif" | "wtf"
      lang = "it",        // "it" | "en"
      extra = ""          // opzionale: contesto/dettagli (non cambia il tono)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context or hints: "${String(extra || "").trim()}".`
      : `Domanda utente: "${domanda}". Contesto o indizi: "${String(extra || "").trim()}".`;

    // Costruisci i messaggi, aggiungendo il seed SOLO per WTF
    const messages = [
      { role: "system", content: systemPrompt },
      ...(stile === "wtf"
        ? [{ role: "system", content: `STYLE SEED:\n${isEn(lang) ? WTF_STYLE_SEED_EN : WTF_STYLE_SEED_IT}` }]
        : []),
      { role: "user", content: userPrompt }
    ];

    // Generate response (parametri come nel tuo “final”)
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.97 : 0.86,
      max_tokens: 700,
      messages
    });

    const answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
