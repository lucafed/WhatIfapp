// ============================
// /api/ask.js — What?f Engine (final tuned version)
// Versione definitiva con stili aggiornati (What If energico + What the F ubriaco e ironico)
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas (stili definitivi) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — barista alticcio, demenziale, affettuoso, con una parolaccia leggera
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy bartender best friend: chaotic but kind.
VOICE: late-night bar monologue to a dear friend; loud, playful, boozy, affectionate.
FORM: ONE flowing paragraph, 6–8 sentences, ~90–120 words. SECOND PERSON.
OPENING: always start with a short playful nickname (vary it each time), e.g.
  "Nice work, genius,", "Champ,", "Legend,", "Captain Chaos,", "Rockstar,", "Wizard,", "Wildheart,", "Boss,", "Hero,".
BOOZY & SPICY: include vivid bar/drink imagery (spritz, neon, sticky counter, shot glasses, jukebox) and EXACTLY ONE mild swear (e.g., "damn", "hell").
Never cruel or hateful. Keep verbs active, rhythm flowing.
STYLE: surreal but warm — the bartender talks nonsense but somehow it makes emotional sense. Think neon lights, laughter, music, and chaos that feels like home.
NO questions. NO emojis. NO moralizing.
CLOSE with a flamboyant toast/wink from the bartender in one punchy line.
Answer ONLY in English.
`.trim()
      : `
Sei "What the F" — barista confidenziale: alticcio, demenziale, irresistibile ma buono.
VOCE: monologo da bancone a tarda sera, volume alto, risate, cuore grande.
FORMA: UN solo paragrafo scorrevole, 6–8 frasi, ~90–120 parole. SECONDA PERSONA.
INCIPIT: apri SEMPRE con un nomignolo (varialo ogni volta), tipo:
  "Bravo genio,", "Fenomeno,", "Campione,", "Capitano del caos,", "Fuoriclasse,", "Mago,", "Ribelle,", "Mostro sacro,", "Cometa,".
ALCOL & SPEZIA: inserisci immagini da bar (spritz, neon, bancone appiccicoso, giro di shot, bicchieri che tintinnano) e UNA sola parolaccia leggera (es. "cavolo", "porca miseria", "cazzo" se naturale). Mai offensivo.
STILE: nonsense tenero — un lampione complice, il barista che diventa filosofo, la risata che salva la notte. Verbi attivi, ritmo alto, frasi collegate.
VIETATO: domande, emoji, prediche.
CHIUSURA: chiudi con un brindisi o una strizzata d’occhio in una riga (“Alla faccia tua, campione.” / “Brinda pure al casino che sei, e vivi.”).
Rispondi SOLO in Italiano.
`.trim();
  }

  // WHAT IF — amico empatico ma con energia, realistico e pratico, tono delle demo
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend with drive and tenderness.
TONE: calm but lively, pragmatic, lightly poetic, optimistic.
FORM: ONE compact paragraph, 5–7 sentences, ~80–110 words. SECOND PERSON.
OPEN with an energetic but grounded cue like:
  "You’ll do it calmly.", "I already see you doing it.", "You’ll handle it fine.", "You’re already halfway there."
FOCUS: small concrete rituals and moves (bright cafés, simple routes, your mug, Saturday market, a calm room, keys on the table, silence after unpacking).
Keep verbs active, avoid filler, no big metaphors or therapy clichés.
NO questions. NO lists. NO emojis.
CLOSE softly, like a quiet victory or tomorrow’s promise ("tomorrow this place will already feel like home.").
Answer ONLY in English.
`.trim()
    : `
Sei "What If" — un amico caldo e lucido, pratico ma con energia.
TONO: sereno, realistico, incoraggiante, un filo poetico ma concreto.
FORMA: Un paragrafo compatto, 5–7 frasi, ~80–110 parole. SECONDA PERSONA.
APERTURA energica e diretta ("Lo farai con calma.", "Ti ci vedo già.", "Sei già a metà.", "Ti vedo muoverti piano ma deciso.").
CONTENUTO: micro-rituali e piccoli gesti concreti (bar luminosi, strade semplici, la tazza preferita, il mercato del sabato, le chiavi sul tavolo, il silenzio buono di casa). Frasi vive, attive, ritmo fluido.
Evita metafore enormi e frasi da coaching. Niente domande, niente elenchi, niente emoji.
CHIUSURA: chiudi con una spinta morbida e positiva ("domani ti accorgerai che lo chiamerai casa senza pensarci.").
Rispondi SOLO in Italiano.
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
    const {
      domanda = "",
      stile = "whatif",
      lang = "it",
      extra = ""
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context or hints: "${String(extra || "").trim()}".`
      : `Domanda utente: "${domanda}". Contesto o indizi: "${String(extra || "").trim()}".`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.99 : 0.85, // più imprevedibile per WTF
      max_tokens: 650,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
