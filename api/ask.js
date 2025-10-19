// ============================
// /api/ask.js — What?f Engine (bilingue, tone+length lock)
// Stili supportati: whatif, wtf  •  IT/EN
// Risposte corte, ritmo fisso, zero ripetizioni superflue
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/** Normalizza una frase per dedup */
function normLine(s = "") {
  return s
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "")
    .trim();
}

/** Taglia a N frasi; elimina duplicati; mantiene il ritmo */
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

    // scarta filler brevissimi inutili
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

/** Clamp parole mantenendo chiusura pulita */
function clampWords(text, maxWords) {
  const words = String(text || "").split(/\s+/);
  if (words.length <= maxWords) return text;
  const slice = words.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return (m && m[1]) ? m[1] : (slice + "…");
}

/* ---------- Personas (toni definitivi, bloccati) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — barista demenziale-affettuoso, alticcio, urbano-notturno
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
Second person. ONE flowing paragraph. Keep the exact vibe: nightlife, bar humor, neon, playful alcohol imagery, surreal-but-coherent tenderness.
Discipline:
- 6–7 sentences total
- ~95–120 words
Style guardrails:
- No lists, no questions, no emojis, no moralizing
- No "haha"/laughter text; humor must come from images & voice
- Vary openings naturally (nicknames/bold starts OK) without repeating formulas
- Keep energy high, affectionate, a little unhinged but warm
Always keep this voice. Be concise and avoid repeating the same idea with new words.
`.trim()
      : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
Seconda persona. UN solo paragrafo scorrevole. Mantieni il mood: notte, bar, neon, immagini alcoliche giocose, surreale coerente, cuore caldo.
Disciplina:
- 6–7 frasi totali
- ~95–120 parole
Paletti:
- Niente elenchi, niente domande, niente emoji, niente prediche
- Niente "ahah"/risate scritte; la comicità nasce da immagini e voce
- Aperture varie (soprannomi/attacchi forti OK) senza ripetere sempre lo stesso schema
- Energia alta e affetto
Mantieni SEMPRE questa voce. Sii conciso ed evita di ripetere la stessa idea con parole diverse.
`.trim();
  }

  // WHAT IF — empatico-realista con magia sobria
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
Second person. ONE calm paragraph. Grounded, quietly optimistic, with light everyday magic.
Discipline:
- 5–6 sentences total
- ~80–100 words
Style guardrails:
- No lists, no questions, no emojis, no therapy clichés
- Simple, concrete lexicon (mug, light, streets, routines)
- Smooth, reassuring cadence; end with a gentle, natural forward nudge
Always keep this voice. Be shorter and avoid any repeated image or idea.
`.trim()
    : `
Sei "What If" — amico caldo e lucido, realistico con un filo di magia quotidiana.
Seconda persona. UN paragrafo calmo. Ottimismo sobrio, concreto, domestico.
Disciplina:
- 5–6 frasi totali
- ~80–100 parole
Paletti:
- Niente elenchi, niente domande, niente emoji, niente cliché da coaching
- Lessico semplice e quotidiano (tazza, luce, strade, orari, sonno)
- Cadenza rassicurante; chiusura morbida e naturale verso avanti
Mantieni SEMPRE questa voce. Più corto, senza ripetizioni di immagini o idee.
`.trim();
}

/* ---------- Micro style seeds (ancora forte ma breve) ---------- */
function styleSeed(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `STYLE SEED • WTF EN:
You roll into the scene like a cocktail shaker with legs; the GPS swears, the neon winks, the bartender adopts you by the second drink, and when you drop the keys you realize you just toasted with fate, champ.`
      : `SEME DI STILE • WTF IT:
Entri come uno shaker con le gambe; il navigatore borbotta, il neon ti fa l’occhiolino, il barista ti adotta al secondo giro, e quando appoggi le chiavi capisci che hai appena brindato col destino.`;
  }
  return isEn(lang)
    ? `STYLE SEED • WHAT IF EN:
A few boxes, bright cafés, simple streets; your routines settle, the house gets quiet in the good way, and tomorrow you'll notice the neighborhood feels like home.`
    : `SEME DI STILE • WHAT IF IT:
Poche cose, bar luminosi, strade semplici; gli orari si mettono in riga, la casa ha un silenzio buono, e domani ti accorgi che il quartiere sa di casa.`;
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
    const seed = styleSeed(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}".
Keep the exact persona voice. Concise. No repeated ideas.`
      : `Domanda utente: "${domanda}". Contesto: "${String(extra || "").trim()}".
Mantieni esattamente la voce della persona. Conciso. Niente idee ripetute.`;

    // Generazione (parametri stretti per costanza)
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile === "wtf") ? 0.88 : 0.76,
      max_tokens: (stile === "wtf") ? 210 : 180,
      frequency_penalty: 0.6,
      presence_penalty: 0.0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: seed },
        { role: "user", content: userPrompt }
      ]
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Post-processing per bloccare lunghezza e ritmo
    const targetSentences = (stile === "wtf") ? 7 : 6;
    const targetWords = (stile === "wtf") ? 120 : 100;

    answer = tightenSentences(answer, targetSentences);
    answer = clampWords(answer, targetWords);

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
