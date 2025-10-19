// ============================
// /api/ask.js — What?f Engine (bilingue, tone+length+event lock)
// Stili supportati: whatif, wtf  •  IT/EN
// Risposte corte, ritmo fisso, zero ripetizioni superflue
// • NEW: WTF garantisce SEMPRE un evento comico alcolico + finale in baldoria
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

/* ---------- Event & finale enforcement (WTF only) ---------- */
function hasAny(text, arr) {
  return arr.some(w => new RegExp(`\\b${w}\\b`, "i").test(text));
}

function ensureEventAndFinale(text, lang) {
  const t = String(text || "");

  const alcoholIT = ["birra","vino","spritz","negroni","cocktail","gin","amaro","prosecco","bar","bancone","pub"];
  const mishapIT  = ["rovesci","versa","cad","traballa","scivol","spilla","sbatte","allaga","schizza"];
  const cheerIT   = ["brindisi","cin cin","a noi","si brinda","brindate"];

  const alcoholEN = ["beer","wine","spritz","negroni","cocktail","gin","amaro","prosecco","bar","counter","pub"];
  const mishapEN  = ["spill","spills","spilled","drops","wobbles","wobble","slosh","splash","splashes"];
  const cheerEN   = ["cheers","toast","raise the glass","raise a glass"];

  const A = isEn(lang) ? alcoholEN : alcoholIT;
  const M = isEn(lang) ? mishapEN  : mishapIT;
  const C = isEn(lang) ? cheerEN   : cheerIT;

  const hasAlcohol = hasAny(t, A);
  const hasMishap  = hasAny(t, M);
  const hasCheer   = hasAny(t, C) || /\bbrinda(ta|re|no)?\b/i.test(t);

  let out = t;

  // Inserisci evento comico se manca (una sola frase, tono naturale)
  if (!hasAlcohol || !hasMishap) {
    const extra = isEn(lang)
      ? "Just when you swear you’ll stick to water, the glass slips, a little wine hits the table, the bartender laughs and tops it up, and everyone decides that accidents are invitations."
      : "Proprio quando giuri che prendi solo acqua, il bicchiere scivola, un po’ di vino finisce sul tavolo, il barista ride e riempie di nuovo, e tutti decidono che gli incidenti sono inviti.";
    out = /[.!?…]$/.test(out) ? `${out} ${extra}` : `${out}. ${extra}`;
  }

  // Chiudi sempre in baldoria/brindisi
  if (!hasCheer) {
    const finale = isEn(lang)
      ? "In the end the night adopts you at the bar, glasses up, a ridiculous toast that somehow feels like destiny."
      : "Alla fine la notte ti adotta al bancone, calici in alto, un brindisi ridicolo che però sa di destino.";
    out = /[.!?…]$/.test(out) ? `${out} ${finale}` : `${out}. ${finale}`;
  }

  return out;
}

/* ---------- Personas (toni definitivi, bloccati) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — demenziale-affettuoso; SEMPRE evento + finale al bar
    return isEn(lang)
      ? `
You are "What the F" — a witty, tipsy, chaotic-but-kind bartender best friend.
Second person. ONE flowing paragraph. Keep the exact vibe: nightlife, neon, bar humor, playful alcohol imagery, surreal-but-coherent tenderness.
Hard rules:
- Include ONE concrete comic incident involving drinks (a little spill, wobbling table, self-opening tab, etc.).
- End at the bar with a joyful toast/cheers, unexpectedly but naturally.
Discipline:
- 6–8 sentences total, ~110–140 words
Style guardrails:
- No lists, no questions, no emojis, no “haha”; humor comes from images & voice.
- Vary openings organically; keep energy high and affectionate.
Always keep this voice; be concise and never restate the same idea with new words.
`.trim()
      : `
Sei "What the F" — barista amico, alticcio e affettuoso, caotico ma buono.
Seconda persona. UN solo paragrafo scorrevole. Mood fisso: notte, neon, ironia da bar, immagini alcoliche giocose, surreale coerente e cuore caldo.
Regole dure:
- Inserisci UN evento comico concreto legato a bevande (piccolo rovescio, tavolo che traballa, conto che si apre da solo, ecc.).
- Chiudi al bar con un brindisi allegro, inaspettato ma naturale.
Disciplina:
- 6–8 frasi totali, ~110–140 parole
Paletti:
- Niente elenchi, niente domande, niente emoji, niente “ahah”; la comicità nasce da immagini e voce.
- Aperture varie; energia alta e affetto.
Mantieni sempre questa voce; conciso e senza ripetere la stessa idea con parole diverse.
`.trim();
  }

  // WHAT IF — empatico-realista con magia sobria
  return isEn(lang)
    ? `
You are "What If" — a warm, lucid friend who truly understands the user.
Second person. ONE calm paragraph. Grounded, quietly optimistic, with light everyday magic.
Discipline:
- 5–6 sentences total, ~90–120 words
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
- 5–6 frasi totali, ~90–120 parole
Paletti:
- Niente elenchi, niente domande, niente emoji, niente cliché da coaching
- Lessico semplice e quotidiano (tazza, luce, strade, orari, sonno)
- Cadenza rassicurante; chiusura morbida e naturale verso avanti
Mantieni sempre questa voce. Più corto, senza ripetizioni di immagini o idee.
`.trim();
}

/* ---------- Micro style seeds (àncora breve) ---------- */
function styleSeed(style, lang) {
  if (style === "wtf") {
    return isEn(lang)
      ? `STYLE SEED • WTF EN:
You roll in like a cocktail shaker with legs; the GPS grumbles, the neon winks, the bartender adopts you by the second drink, and when you drop the keys you realize you just toasted with fate.`
      : `SEME DI STILE • WTF IT:
Arrivi come uno shaker con le gambe; il navigatore borbotta, il neon ti fa l’occhiolino, il barista ti adotta al secondo giro e quando appoggi le chiavi capisci che hai appena brindato col destino.`;
  }
  return isEn(lang)
    ? `STYLE SEED • WHAT IF EN:
A few boxes, bright cafés, simple streets; routines settle, the house gets quiet in the good way, and tomorrow you'll notice the neighborhood feels like home.`
    : `SEME DI STILE • WHAT IF IT:
Poche cose, bar luminosi, strade semplici; gli orari si mettono in riga, la casa ha un silenzio buono e domani ti accorgi che il quartiere sa di casa.`;
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
      max_tokens: (stile === "wtf") ? 240 : 200,
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
    const targetSentences = (stile === "wtf") ? 8 : 6;
    const targetWords = (stile === "wtf") ? 140 : 120;

    answer = tightenSentences(answer, targetSentences);

    // NEW: garantisce evento comico + brindisi in WTF
    if (stile === "wtf") {
      answer = ensureEventAndFinale(answer, lang);
    }

    answer = clampWords(answer, targetWords);

    // Dopo il clamp, riblocca la chiusura se è stata tagliata
    if (stile === "wtf") {
      answer = ensureEventAndFinale(answer, lang);
      // un leggero clamp di rifinitura per non sforare troppo
      answer = clampWords(answer, targetWords + 5);
    }

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
