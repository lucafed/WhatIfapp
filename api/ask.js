// ============================
// /api/ask.js — What?f Engine (bilingue, episodio lock)
// Stili supportati: whatif, wtf  •  IT/EN
// Risposte con ritmo fisso, episodio concreto e finale corretto
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas (tono bloccato) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — demenziale-affettuoso, notturno, bar-centrico
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
Voice rules:
- SECOND PERSON (the user is the protagonist). Never first person narrator.
- ONE flowing paragraph, no line breaks.
- 7–9 sentences, ~120–160 words.
- Nightlife lexicon, neon, playful alcohol imagery, surreal but coherent.
- Humor from images/voice (no “haha” text, no emojis).
- MUST include a concrete mini-episode with an unexpected booze-related twist that naturally leads to a jubilant bar toast at the end.
- Vary openings naturally (nicknames or bold starts ok), keep warmth and affection.
- No lists, no questions, no moralizing.
Keep this exact voice, always.
`.trim()
      : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
Regole di voce:
- SECONDA PERSONA (tu protagonista). Mai narratore in prima persona.
- UN solo paragrafo scorrevole, senza a capo.
- 7–9 frasi, ~120–160 parole.
- Lessico da notte/bar, neon, immagini alcoliche giocose, surreale ma coerente.
- La comicità nasce da immagini e ritmo (niente “ahah”, niente emoji).
- DEVE esserci un mini-episodio concreto con imprevisto alcolico che porta a un brindisi corale finale.
- Aperture varie naturali; tono caldo e affettuoso.
- Niente elenchi, niente domande, niente prediche.
Mantieni SEMPRE questa voce.
`.trim();
  }

  // WHAT IF — empatico realistico con micro-magia quotidiana
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend.
Voice rules:
- SECOND PERSON. One calm paragraph, smooth cadence.
- 6–8 sentences, ~100–130 words.
- Grounded, quietly optimistic, simple concrete lexicon (mug, light, streets, sleep, routines).
- Include ONE small concrete scene (an action the user takes today) and end with a gentle forward nudge (tomorrow/you’ll notice/it will feel easier).
- No lists, no questions, no emojis, no therapy clichés.
Keep this exact voice, always.
`.trim()
    : `
Sei "What If" — amico caldo e lucido.
Regole di voce:
- SECONDA PERSONA. Un paragrafo calmo, cadenza morbida.
- 6–8 frasi, ~100–130 parole.
- Concreto e domestico (tazza, luce, strade, orari, sonno) con ottimismo sobrio.
- Inserisci UNA piccola scena concreta (un’azione che fai oggi) e chiudi con una spinta gentile verso domani.
- Niente elenchi, niente domande, niente emoji, niente cliché da coaching.
Mantieni SEMPRE questa voce.
`.trim();
}

/* ---------- Style seeds (ancore narrative, non da copiare ma da imitare) ---------- */
function styleSeed(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `STYLE SEED — WTF:
You roll back into town like a cocktail shaker with legs; a streetlight winks, you swear it knows your order. You promise “just water”, but the glass defects mid-route and turns into wine; an old friend materializes yelling “on me!”, someone spills half a bottle and calls it modern art, the bartender applauds, and you end up toasting to everything and nothing.`
      : `SEME DI STILE — WTF:
Rientri come uno shaker con le gambe; il lampione ti fa l’occhiolino come se sapesse il tuo drink. Giuri “solo acqua”, ma il bicchiere cambia idea e diventa vino; un amico spunta dal nulla urlando “offro io!”, qualcuno rovescia mezza bottiglia e la chiama arte, il barista applaude e finisce in un brindisi a tutto e a niente.`;
  }
  return isEn(lang)
    ? `STYLE SEED — WHAT IF:
A few boxes, bright cafés, simple streets; you set a tiny routine, wash your favorite mug, open the window, and tomorrow the neighborhood feels a little more like home.`
    : `SEME DI STILE — WHAT IF:
Poche cose, bar luminosi, strade semplici; sistemi due orari, lavi la tazza preferita, apri la finestra, e domani il quartiere sa un po’ più di casa.`;
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
      stile = "whatif",   // "whatif" | "wtf"
      lang = "it",        // "it" | "en"
      extra = ""          // opzionale: contesto (NON cambia il tono)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const seed = styleSeed(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}".
Keep the persona voice EXACTLY. One paragraph. Respect sentence and length limits. Include the required scene pattern.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}".
Mantieni la voce della persona ESATTAMENTE. Un paragrafo. Rispetta limiti di frasi e lunghezza. Inserisci lo schema di scena richiesto.`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile === "wtf") ? 0.92 : 0.82,
      max_tokens: (stile === "wtf") ? 320 : 280,
      frequency_penalty: 0.15,
      presence_penalty: 0.0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: seed },
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
