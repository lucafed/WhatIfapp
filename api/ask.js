// ============================
// /api/ask.js — What?f Engine (Incazzato Illuminato • locked)
// Stili supportati: whatif, wtf
// IT/EN — singolo paragrafo, ritmo fisso, niente emoji/liste/domande
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

function normLine(s = "") {
  return String(s)
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
  let t = out.join(" ");
  if (!/[.!?…]$/.test(t)) t += ".";
  return t;
}

function clampWords(text, maxWords) {
  const w = String(text || "").split(/\s+/);
  if (w.length <= maxWords) return text;
  const slice = w.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m ? m[1] : slice + "…";
}

function normalizeOneParagraph(s = "") {
  return String(s)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/* ---------- Personas ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // NON TOCCATO: What the F (Incazzato Illuminato)
    const SYS = (isEn(lang)
      ? `You are “What the F” — version: Incazzato Illuminato ...`
      : `Sei “What the F” — versione Incazzato Illuminato ...`);
    // ... (resto identico)
    return { sys: SYS, fewshots: [] };
  }

  // WHAT IF — nuova versione “Realismo lucido con sorriso”
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind, slightly ironic friend who sees things clearly.
SECOND PERSON. One paragraph, 7–10 sentences (~100–140 words).
Tone: warm, grounded, a mix of realism and gentle humor. Never melancholic.
Use concrete, relatable imagery (keys, streetlights, notebooks, hands, air, noise).
Show small truths that feel human, not heroic. Keep it conversational, never poetic.
End with a clear, real forward nudge — something doable today, not someday.
`
    : `
Sei "What If" — un amico lucido e affettuoso, realistico con una punta d’ironia.
SECONDA PERSONA. Un paragrafo, 7–10 frasi (~100–140 parole).
Tono caldo, concreto, mai malinconico. Realismo con sorriso leggero.
Usa immagini quotidiane (chiavi, lampioni, taccuini, mani, rumore, aria).
Racconta piccole verità umane, non grandi eroi. Linguaggio semplice, sincero.
Chiudi sempre con una spinta reale e fattibile — qualcosa che puoi fare oggi.
`).trim();

  const FEWSHOTS = [
    // ——— ITALIANI ———
    {
      role: "system",
      content: `ESEMPIO IT • E se tornassi a vivere all’Aquila?
Tornare non sarebbe un passo indietro, ma un modo diverso di camminare. Ti accorgeresti che certi luoghi non cambiano, ma ti riflettono: ti mostrano quanto sei cresciuto senza accorgertene. Ti darebbe fastidio la lentezza, poi capisci che è proprio quella a rimetterti in ritmo. Le persone sembrano uguali, ma sei tu che le vedi con occhi nuovi, meno impazienti. E capisci che non serve ricominciare da zero: basta ricominciare da sé.`
    },
    {
      role: "system",
      content: `ESEMPIO IT • E se aprissi un’attività?
All’inizio penseresti “che follia”, e forse lo è. Ma certe cose nascono solo quando smetti di aspettare il momento giusto. Ti sentiresti piccolo davanti ai moduli e alle incognite, ma è lì che la realtà diventa tua. Scopriresti che il coraggio arriva mentre lo usi. E capisci che il rischio non è fallire: è restare fermo a immaginare.`
    },
    {
      role: "system",
      content: `ESEMPIO IT • E se cambiassi città?
Ti sembrerebbe di tradire qualcosa, poi capisci che non stai scappando: stai solo cercando aria che ti assomiglia di più. Ogni città ti obbliga a reinventarti, e all’inizio è scomodo, ma poi diventa tuo. Ti mancherebbe tutto, poi solo ciò che conta. E quando cominci a sentirti parte, scopri che non eri mai lontano: stavi solo tornando a te.`
    },
    {
      role: "system",
      content: `ESEMPIO IT • E se mollassi tutto per viaggiare?
Ti spaventerebbe non avere un piano, poi scopriresti che i piani sono spesso trappole eleganti. Ti perderesti, certo, ma anche ritrovarti in posti che non sapevi di cercare. E ogni confine diventerebbe una riga cancellata con il sorriso. Non per scappare dal mondo, ma per ricordarti che ci sei dentro.`
    },
    {
      role: "system",
      content: `ESEMPIO IT • E se tornassi con quella persona?
Ti verrebbe voglia di riscrivere la storia, ma scopriresti che certe pagine si leggono meglio da lontano. L’affetto resterebbe, più adulto, più calmo. Ti accorgeresti che non serve tornare per capire: basta guardare con la stessa cura, ma in direzioni nuove.`
    },
    // ——— ENGLISH ———
    {
      role: "system",
      content: `EXAMPLE EN • What if I moved back to my hometown?
Coming back wouldn’t be a step back, just a slower step forward. You’d notice that places don’t change, they mirror you. The quiet would annoy you, then fix your rhythm. People would look the same, but your gaze wouldn’t. And you’d realize you don’t need a new start — you just need to start as you are.`
    },
    {
      role: "system",
      content: `EXAMPLE EN • What if I started a business?
At first you’d call it madness, and maybe it is. But some plans only breathe when you stop waiting for perfection. You’d shrink before the paperwork, then grow into the process. Fear would tag along but turn into fuel. You’d see that risk isn’t failure — it’s movement.`
    },
    {
      role: "system",
      content: `EXAMPLE EN • What if I changed city?
It would feel like betrayal, then like oxygen. You’d miss the familiar noise, then find your own rhythm in the new one. Every wrong turn would teach you a word you didn’t know about yourself. And one day you’d realize you never left — you just arrived somewhere true.`
    }
  ];

  return { sys: SYS_WHATIF, fewshots: FEWSHOTS };
}

/* ---------- API Handler ---------- */
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
    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const { sys, fewshots } = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona voice.`
      : `Domanda: "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce della persona.`;

    const messages = [{ role: "system", content: sys }, ...(fewshots || []), { role: "user", content: userPrompt }];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : 0.82,
      top_p: 0.9,
      max_tokens: 260,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    answer = tightenSentences(answer, stile === "wtf" ? 7 : 10);
    answer = clampWords(answer, stile === "wtf" ? 130 : 140);
    answer = normalizeOneParagraph(answer);

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
