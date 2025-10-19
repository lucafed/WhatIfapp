// ============================
// /api/ask.js — What?f Engine (bilingue, episodio+bar lock • friendly open)
// Stili: whatif, wtf  •  IT/EN
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function normLine(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "")
    .trim();
}

/** Taglia a N frasi; elimina duplicati quasi-identici; mantiene ritmo. */
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

    // scarta filler brevissimi (<=3 parole) che non chiudono
    const wc = p.split(/\s+/).length;
    if (wc <= 3 && !/[.!?]$/.test(p)) continue;

    out.push(p);
    seen.add(n);
    if (out.length >= maxSentences) break;
  }

  let txt = out.join(" ");
  if (!/[.!?…]$/.test(txt)) txt += ".";
  return txt;
}

/** Clamp parole con chiusura pulita (cerca fine frase) */
function clampWords(text, maxWords) {
  const words = String(text || "").split(/\s+/);
  if (words.length <= maxWords) return text;
  const slice = words.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return (m && m[1]) ? m[1] : (slice + "…");
}

/* ---------- Personas (tono bloccato) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
Second person. ONE flowing paragraph with nightlife cadence (neon, bar counter, liquid metaphors).
ALWAYS open with a warm friendly address (buddy/champ/my friend), then roll into a MINI-EPISODE:
set-up → gentle turn → cheerful bar resolution where destiny “brings a toast”.
The user tries to stay sober, life conspirers, a drink appears anyway; humor is surreal but coherent, affectionate, a bit unhinged.
Discipline:
- 7–8 sentences
- ~130–160 words
Style guardrails:
- No lists, no questions, no emojis, no moralizing
- No written laughter (“haha” etc.)
- Vary openings naturally; keep warmth + bite; NEVER switch to first person narrator
Keep THIS exact voice every time; avoid repeating the same idea with new words.
`.trim()
      : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
Seconda persona. UN paragrafo scorrevole con ritmo da notte (neon, bancone, metafore liquide).
APRl SEMPRE con un saluto caldo (“amico mio”, “campione”, “compà”); poi MINI-EPISODIO:
innesco → piccola svolta → chiusura festosa al bar dove il destino “ti offre un brindisi”.
Tu provi a restare sobrio, la vita complotta, il bicchiere arriva comunque; comicità surreale ma coerente, affettuosa, un filo scatenata.
Disciplina:
- 7–8 frasi
- ~130–160 parole
Paletti:
- Niente elenchi, domande, emoji, prediche
- Niente risate scritte (“ahah” ecc.)
- Aperture varie; voce costante; MAI passare alla prima persona del narratore
Mantieni SEMPRE questa voce; non ripetere la stessa idea con parole diverse.
`.trim();
  }

  // WHAT IF — amico empatico, realistico, magia quotidiana sobria
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend: grounded, quietly optimistic, light everyday magic.
Second person. ONE calm paragraph with smooth cadence and concrete details.
Discipline:
- 5–6 sentences
- ~90–110 words
Style guardrails:
- No lists, no questions, no emojis, no therapy clichés
- Simple, domestic lexicon (mug, light, streets, routines, sleep)
- End with a gentle, natural forward nudge (no set formula, vary it)
Keep THIS exact voice; avoid repeated images or ideas.
`.trim()
    : `
Sei "What If" — amico caldo e lucido: realistico, ottimismo quieto, piccola magia quotidiana.
Seconda persona. UN paragrafo calmo, cadenza scorrevole e dettagli concreti.
Disciplina:
- 5–6 frasi
- ~90–110 parole
Paletti:
- Niente elenchi, domande, emoji, cliché da coaching
- Lessico semplice e domestico (tazza, luce, strade, orari, sonno)
- Chiusura morbida verso domani (varia naturalmente)
Mantieni SEMPRE questa voce; niente ripetizioni di immagini o idee.
`.trim();
}

/* ---------- Style seeds (apertura amichevole, destino-al-bar) ---------- */
const SEEDS_WTF_IT = [
  "Amico mio, esci con la testa piena di buoni propositi e il passo leggero: la città ti annusa, il neon fa l’occhiolino, e il bancone si comporta come se avesse già tenuto il posto a tuo nome.",
  "Campione, parti con l’idea dell’acqua frizzante e del rientro presto: poi il semaforo sbaglia ritmo, il profumo di luppolo ti saluta per primo, e un bicchiere compare come una vecchia conoscenza.",
  "Compà, dici “stasera leggero”, ma i tavolini allungano le gambe, il barista ti chiama per cognome e il destino appare sotto forma di giro offerto."
];
const SEEDS_WTF_EN = [
  "Buddy, you step out full of good intentions and light footsteps: the city sniffs you, neon winks, and the counter behaves like it saved you a seat.",
  "Champ, you swear it’s sparkling water and an early night: then the traffic light loses the beat, hops perfume says hello, and a glass appears like an old friend.",
  "My friend, you mutter “tonight I’m good,” but tables grow legs, the bartender knows your last name, and destiny arrives as a round on the house."
];

const SEEDS_WHATIF_IT = [
  "Poche cose in valigia, luce buona sul tavolo, strade semplici: ti sistemi gli orari, il sonno torna educato, e la casa impara a respirare con te."
];
const SEEDS_WHATIF_EN = [
  "A few things in the bag, good light on the table, simple streets: your hours settle, sleep behaves, and the house learns to breathe with you."
];

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
      extra = ""          // opzionale: contesto (NON cambia tono)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const seed =
      stile === "wtf"
        ? (isEn(lang) ? pick(SEEDS_WTF_EN) : pick(SEEDS_WTF_IT))
        : (isEn(lang) ? pick(SEEDS_WHATIF_EN) : pick(SEEDS_WHATIF_IT));

    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}".
Keep the EXACT persona voice. Second person. Friendly opening.
No lists, no questions, no emojis, no written laughter.
WTF: mini-episode → gentle turn → cheerful bar ending (destiny brings a toast); user tries to stay sober but a drink appears anyway; surreal yet coherent, affectionate, never cruel.
What If: calm, concrete, quiet optimism; end with a gentle forward nudge.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}".
Mantieni ESATTAMENTE la voce. Seconda persona. Apertura amichevole.
Niente elenchi, domande, emoji, risate scritte.
WTF: mini-episodio → piccola svolta → chiusura festosa al bar (il destino porta un brindisi); provi a restare sobrio ma il bicchiere arriva comunque; surreale coerente, affettuoso, mai cattivo.
What If: calmo, concreto, ottimismo quieto; chiusura morbida in avanti.`;

    // Generazione (parametri stretti per costanza)
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile === "wtf") ? 0.9 : 0.78,
      top_p: 0.9,
      max_tokens: (stile === "wtf") ? 320 : 240,
      frequency_penalty: 0.6,
      presence_penalty: 0.0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: `STYLE SEED:\n${seed}` },
        { role: "user", content: userPrompt }
      ]
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Lunghezze stabili come concordato
    const targetSentences = (stile === "wtf") ? 8 : 6;
    const targetWords = (stile === "wtf") ? 155 : 105;

    answer = tightenSentences(answer, targetSentences);
    answer = clampWords(answer, targetWords);

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
