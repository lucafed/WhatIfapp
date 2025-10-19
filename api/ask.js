// ============================
// /api/ask.js — What?f Engine (concise lock + humor boost + second-person lock)
// Stili: whatif, wtf  •  IT/EN
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

function normLine(s = "") {
  return s
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

  let txt = out.join(" ");
  if (!/[.!?…]$/.test(txt)) txt += ".";
  return txt;
}

function clampWords(text, maxWords) {
  const words = String(text || "").split(/\s+/);
  if (words.length <= maxWords) return text;
  const slice = words.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return (m && m[1]) ? m[1] : (slice + "…");
}

/* ---------- Personas ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `
You are "What the F" — witty, tipsy, chaotic-but-kind bartender best friend.
Second person ONLY (you). Speak directly TO the user, never about yourself.
The narrator never drinks or acts; the USER is always the one living the scene.
One flowing paragraph. Keep the vibe: nightlife, bar humor, surreal but coherent warmth.

Length discipline:
- 6–7 sentences total
- about 95–120 words

Style guardrails:
- No lists, no bullet points, no questions, no emoji, no moralizing
- Light swearing allowed but keep it human and fun
- Vary openings naturally (nicknames or bold starts are fine)
- Keep energy high and affectionate

Keep the same core vibe; concise, direct, second person only.
`.trim()
      : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
SOLO seconda persona (tu). Parla DIRETTAMENTE all’utente, mai di te stesso.
Il narratore non beve né agisce: è sempre l’UTENTE a vivere la scena.
Un paragrafo scorrevole, notturno e ironico, da bar.

Disciplina di lunghezza:
- 6–7 frasi totali
- circa 95–120 parole

Paletti di stile:
- Niente elenchi, niente domande, niente emoji, niente prediche
- Parolacce leggere umane ok ma senza esagerare
- Aperture varie e naturali (soprannomi, toni da bar)
- Energia alta e affetto
Mantieni esattamente il tono solito; conciso, diretto e solo in seconda persona.
`.trim();
  }

  // WHAT IF invariato
  return isEn(lang)
    ? `
You are "What If" — warm, lucid friend who truly understands the user.
Second person. One calm paragraph. Same vibe as usual: grounded, quiet optimism, light everyday magic.
Length discipline:
- 5–6 sentences total
- about 80–100 words
Style guardrails:
- No lists, no questions, no emojis, no therapy clichés
- Simple, concrete lexicon (mug, light, streets, routines)
- Smooth, reassuring cadence; end with a gentle forward nudge
Keep the exact tone; concise and without repeated images.
`.trim()
    : `
Sei "What If" — amico caldo e lucido che capisce davvero l’utente.
Seconda persona. Un paragrafo calmo. Identico mood: concreto, ottimismo quieto, piccola magia quotidiana.
Disciplina di lunghezza:
- 5–6 frasi totali
- circa 80–100 parole
Paletti di stile:
- Niente elenchi, niente domande, niente emoji, niente cliché
- Lessico semplice e domestico (tazza, luce, strade, orari)
- Cadenza rassicurante; chiusura morbida in avanti
Mantieni esattamente il tono; più corto e senza ripetizioni.
`.trim();
}

/* ---------- Humor Booster ---------- */
function humorBooster(style, lang) {
  if (style !== "wtf") return "";
  return isEn(lang)
    ? `
COMEDY LOCK (mandatory):
- Speak directly to the user in second person only.
- Mini-episode arc: setup ➜ ironic twist ➜ cheerful BAR ending.
- Mention at least 3 alcoholic drinks (beer, wine, Negroni, rum, tequila, gin, whisky, amaro, etc.)
  and at least 1 bar object (glass, bottle, counter, shaker).
- Running gag: the user swears to stay sober (orders water/soft drink) but destiny hands them a toast anyway.
- Sarcastic, absurd but warm tone; no written laughter, no slapstick.
`.trim()
    : `
BLOCCO COMICO (obbligatorio):
- Parla SEMPRE in seconda persona (tu), mai di te.
- Mini-episodio con innesco ➜ svolta ironica ➜ chiusura FESTOSA al BAR.
- Cita almeno 3 drink (birra, vino, spritz, Negroni, rum, gin, whisky, amaro…) e almeno 1 oggetto da bar (bicchiere, bottiglia, bancone, shaker).
- Gag ricorrente: provi a restare sobrio (ordini acqua/analcolico) ma il destino ti offre un brindisi.
- Tono sarcastico, affettuoso, demenziale e notturno; niente risate scritte, niente slapstick.
`.trim();
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
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const {
      domanda = "",
      stile = "whatif",
      lang = "it",
      extra = "",
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res
        .status(400)
        .json({ error: "bad_request", detail: "domanda_required" });
    }

    const systemPrompt = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona tone you already use; concise and in second person.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni il tono esatto che usi, conciso e solo in seconda persona.`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...(stile === "wtf"
        ? [{ role: "system", content: humorBooster(stile, lang) }]
        : []),
      { role: "user", content: userPrompt },
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.9 : 0.78,
      max_tokens: stile === "wtf" ? 210 : 180,
      frequency_penalty: 0.5,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    const targetSentences = stile === "wtf" ? 7 : 6;
    const targetWords = stile === "wtf" ? 120 : 100;

    answer = tightenSentences(answer, targetSentences);
    answer = clampWords(answer, targetWords);

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res
      .status(500)
      .json({ error: "server_error", detail: String(err?.message || err) });
  }
}
