// ============================
// /api/ask.js — What?f Engine (compat + corto)
// Stili: whatif, wtf • IT/EN
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini"; // stesso tuo modello

const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

// -------- Personas (senza incipit/chiusure forzate)
function personaSystem(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender friend.
Voice: late-night bar monologue; second person; the user is the protagonist.
One single paragraph. 6–7 flowing sentences. 105–125 words max.
High energy, city/night/bar lexicon, light irreverence, surreal but coherent.
No questions, no lists, no emojis, no moralizing. End naturally (no fixed tagline).
Answer ONLY in English.
`.trim()
      : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
Voce: monologo da bancone; seconda persona; l’utente è il protagonista.
Un unico paragrafo. 6–7 frasi scorrevoli. Massimo 105–125 parole.
Lessico notte/bar/città, ironia surreale leggera, ritmo alto ma caldo.
Niente domande, elenchi, emoji, prediche. Chiudi naturale (nessuna formula fissa).
Rispondi SOLO in Italiano.
`.trim();
  }

  // whatif
  return isEn(lang)
    ? `
You are "What If" — a calm, lucid friend.
Second person. One paragraph. 5–6 smooth sentences. 85–100 words.
Empathetic, realistic, lightly poetic but concrete (mug, routines, streets, light).
No questions, no exclamations, no lists, no therapy clichés.
End with a gentle forward nudge (natural, not templated). Answer ONLY in English.
`.trim()
    : `
Sei "What If" — amico calmo e lucido.
Seconda persona. Un paragrafo. 5–6 frasi fluide. 85–100 parole.
Empatico, realistico, leggermente poetico ma concreto (tazza, orari, strada, luce).
Niente domande, niente punti esclamativi, niente elenchi, niente cliché da coaching.
Chiudi con una spinta morbida verso domani (naturale, non fissa). Rispondi SOLO in Italiano.
`.trim();
}

// -------- Few-shot come ASSISTANT (compat)
const FEWSHOT = {
  it: {
    whatif: `Ti ci vedo già: pochi scatoloni, le cose giuste, il resto lo lasci senza sensi di colpa. Ti muovi piano ma deciso, come quando sai che il posto nuovo ti farà respirare meglio. Le prime settimane scegli bar luminosi, strade semplici, volti gentili; ti sistemi gli orari e il sonno si mette in riga. Un pomeriggio rientri e ti stupisce il silenzio buono della casa, quel suono di “ci sto riuscendo”. Piccoli rituali: la tazza preferita, il mercato del sabato, un percorso che diventa tuo senza fatica. La nostalgia passa in onde più basse; domani ti accorgerai che chiamerai “casa” anche questo quartiere.`,
    wtf: `Bravo genio, prendi la valigia come fosse un cocktail shaker e ci butti dentro vita nuova, due calzini spaiati e un paio di idee marce che sanno di miracolo; arrivi in città con l’ansia che balla il twist e il navigatore che brontola in dialetto, ma la musica dei bar ti adotta prima ancora dell’affitto, il primo aperitivo ti chiama per nome, il lampione fuori casa ti fa l’occhiolino, il barista diventa consulente spirituale dopo il secondo spritz, poi rientri tardi, appoggi le chiavi, guardi il neon dalla finestra e capisci che hai appena fatto un brindisi col destino, campione.`
  },
  en: {
    whatif: `I can already see you: a few boxes, the right things, the rest you leave without guilt. You move slowly but sure, like when you know the new place will let you breathe. Bright cafés, simple streets, kind faces; your hours settle and sleep lines up. One afternoon the quiet of the house surprises you — the sound of “I’m making it.” Small rituals — your mug, the Saturday market, a route that becomes yours. Nostalgia ebbs; tomorrow you’ll notice you call this neighborhood “home.”`,
    wtf: `You legend, treat the suitcase like a cocktail shaker and toss in new life, mismatched socks and a couple of rotten ideas that taste like miracles; you roll into town with anxiety doing the twist and the GPS grumbling in dialect, but the bars adopt you before the rent does, the first aperitivo knows your name without asking, the lamp post winks, the bartender becomes your spiritual consultant by the second spritz, you drop the keys, catch the neon in the window and realize you just toasted with fate, champ.`
  }
};

// -------- API
export default async function handler(req, res) {
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

    const sys = personaSystem(stile, lang);
    const seed = FEWSHOT[isEn(lang) ? "en" : "it"][stile];

    const userMsg = isEn(lang)
      ? `Question: "${domanda}". Context: "${String(extra||"").trim()}". Keep to the style and length ranges.`
      : `Domanda: "${domanda}". Contesto: "${String(extra||"").trim()}". Mantieni stile e range di lunghezza.`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.9 : 0.78,
      max_tokens: 320, // corto ma sicuro
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages: [
        { role: "system", content: sys },
        // few-shot come assistant (compat) — guida il tono senza imporre la copia
        { role: "assistant", content: seed },
        { role: "user", content: userMsg }
      ]
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // rifinitura soft: spazi e finali
    answer = answer.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!/[.!?…]$/.test(answer)) answer += ".";

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
