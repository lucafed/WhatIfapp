// ============================
// /api/ask.js — What?f Engine (short + anchored)
// Stili: whatif, wtf • IT/EN
// Risposta singola, incipit/chiusure variabili
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ---------- Personas (toni definitivi, NO incipit fissi) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    return isEn(lang) ? `
You are "What the F" — tipsy, witty, chaotic-but-kind bartender friend.
Second person. ONE flowing paragraph, 6–7 sentences, ~105–125 words.
Night/bar lexicon; 2–3 playful surreal touches (neon lamp post winks, GPS grumbles, penguin DJ).
Cheeky, affectionate, never mean. One light swear max (e.g., “damn”); NO blasphemy/slurs.
No questions, no lists, no dialogue. Musical rhythm.
Open with a playful nickname (varied each time) and finish with a short, varied toast/embrace line.
`.trim() : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
Seconda persona. UN solo paragrafo scorrevole, 6–7 frasi, ~105–125 parole.
Lessico da notte/bar; 2–3 tocchi surreali coerenti (lampione che fa l’occhiolino, GPS che brontola, pinguino DJ).
Sfacciato ma tenero; al massimo una parolina leggera tipo “cavolo”; NO bestemmie.
Niente domande, niente elenchi, niente dialoghi. Ritmo musicale.
Apri con un nomignolo (sempre diverso) e chiudi con un brindisi/abbraccio breve, sempre diverso.
`.trim();
  }

  // WHAT IF
  return isEn(lang) ? `
You are "What If" — warm, lucid friend.
Second person. ONE paragraph, 5–6 sentences, ~85–100 words.
Empathetic, realistic, grounded; small domestic images (mug, simple streets, sleep, light, market).
Present/imperf tenses. No questions, no exclamations, no lists, no therapy clichés.
Avoid grand words (soul/heart/destiny). End with a soft forward nudge (varied each time).
`.trim() : `
Sei "What If" — amico caldo e lucido.
Seconda persona. UN solo paragrafo, 5–6 frasi, ~85–100 parole.
Empatico, realistico e concreto; immagini quotidiane (tazza, orari, strade semplici, luce, sonno, mercato).
Tempi presente/imperfetto. Niente domande, niente punti esclamativi, niente elenchi, niente cliché.
Evita parole altisonanti (anima/cuore/destino). Chiudi con una spinta morbida a domani (varia sempre).
`.trim();
}

/* ---------- Esempi-ancora (non da copiare) ---------- */
const EXAMPLES_IT = {
  whatif: `
Ti ci vedo già: pochi scatoloni, le cose giuste, il resto lo lasci senza sensi di colpa. Ti muovi piano ma deciso, come quando sai che il posto nuovo ti farà respirare meglio. Le prime settimane scegli bar luminosi, strade semplici, volti gentili; ti sistemi gli orari e il sonno si mette in riga. Un pomeriggio rientri e ti stupisce il silenzio buono della casa, quel suono di “ci sto riuscendo”. Piccoli rituali: la tazza preferita, il mercato del sabato, un percorso che diventa tuo senza fatica. La nostalgia passa in onde più basse, l’abitudine fa il suo lavoro; e domani ti accorgerai che chiamerai “casa” anche questo quartiere.
`.trim(),
  wtf: `
Bravo genio, prendi la valigia come fosse un cocktail shaker e ci butti dentro vita nuova, due calzini spaiati e un paio di idee marce che sanno di miracolo; arrivi in città con l’ansia che balla il twist e il navigatore che brontola in dialetto, ma la musica dei bar ti adotta prima ancora dell’affitto, il primo aperitivo ti chiama per nome anche se non lo hai detto, il lampione fuori casa ti fa l’occhiolino come un compare di sbronze, il barista diventa consulente spirituale dopo il secondo spritz, firmi mentalmente un patto col marciapiede che non scivola e col forno che sa di abbraccio, poi rientri tardi, appoggi le chiavi, guardi il neon dalla finestra e capisci che hai appena fatto un brindisi col destino, campione.
`.trim()
};

const EXAMPLES_EN = {
  whatif: `
I can already see you: a few boxes, the right things, the rest you leave without guilt. You move slowly but sure, the new place lets you breathe better. Bright cafés, simple streets, kind faces; routines settle and sleep falls in line. One afternoon the quiet of the house surprises you, that sound of “I’m getting there”. Small rituals: the mug, the Saturday market, a route that becomes yours. Nostalgia ebbs in lower waves, habit does its work; tomorrow you’ll notice you call this neighborhood “home”.
`.trim(),
  wtf: `
You legend, you shake the suitcase like a cocktail and toss in new life, mismatched socks and a couple of rotten ideas that somehow smell like miracles; you arrive with your nerves doing the twist and the GPS muttering, but the bars adopt you before the lease does, the first aperitif calls your name, the lamp post winks like a drinking buddy, the bartender turns into a life coach by spritz number two, you sign a pact with the non-slippery sidewalk and the oven that hugs, then you get home late, drop the keys, watch the neon, and realize you just toasted with fate, champ.
`.trim()
};

/* ---------- Post-processing: compatta & limita parole ---------- */
function clampWords(text, min, max) {
  let t = (text || "").replace(/\s+/g, " ").trim();
  const words = t.split(" ");
  if (words.length > max) t = words.slice(0, max).join(" ") + ".";
  // se è troppo corto, lasciamo così (meglio conciso che riempito a caso)
  return t;
}

function tidy(text, style) {
  const t = text.replace(/\s+/g, " ").trim();
  const ranges = style === "wtf" ? { min: 105, max: 125 } : { min: 85, max: 100 };
  return clampWords(t, ranges.min, ranges.max);
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

    // Input
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", lang = "it", extra = "" } = body;
    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `Question: "${domanda}". Context: "${String(extra || "").trim()}". Keep opening/ending varied (no fixed catchphrases).`
      : `Domanda: "${domanda}". Contesto: "${String(extra || "").trim()}". Incipit/chiusura variati (nessuna formula fissa).`;

    const examples = isEn(lang) ? EXAMPLES_EN : EXAMPLES_IT;
    const styleSeed = stile === "wtf" ? examples.wtf : examples.whatif;

    // Generate
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.9 : 0.78,
      frequency_penalty: stile === "wtf" ? 0.35 : 0.25,
      presence_penalty: 0.1,
      max_tokens: 360, // poi rifiliamo
      messages: [
        { role: "system", content: systemPrompt },
        // ancora di ritmo/tono — NON da copiare
        { role: "system", content: `STYLE EXAMPLE (do not copy verbatim):\n${styleSeed}` },
        { role: "user", content: userPrompt }
      ]
    });

    const raw = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!raw) throw new Error("empty_model_response");

    const answer = tidy(raw, stile);
    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
