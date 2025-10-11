// /api/ask.js
import OpenAI from "openai";

/**
 * Vercel Serverless (Node)
 * Richiede ENV:
 * - OPENAI_API_KEY
 */

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ─────────────── Helpers lingua ─────────────── */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ─────────────── Prompt principale ─────────────── */
function systemPrompt({ stile = "whatif", lang = "it", profile = {} }) {
  const en = isEn(lang);
  const drinksYes = profile?.drinks_pref === "yes" || profile?.unwind === "drink";

  if (stile === "wtf") {
    // 🥃 WHAT THE F — barista ironico con botta e risposta
    return en
      ? `You are *What the F*, a witty, sharp late-night bartender who speaks in fast back-and-forth dialogue.
Structure:
- Format: alternate USER: ... / BARTENDER: ... lines.
- 8–12 total exchanges (each 1 short sentence, ≤15 words).
- Add humor, small punchlines, and reflections every 2–3 lines.
- Always end with a short, ironic toast.

Tone:
- Conversational, playful, with a barroom mood.
- Mix wit, empathy, and truth.
- The bartender is slightly tipsy but always emotionally precise.
- Never offensive or drunk-sounding — just warm, ironic, real.

Atmosphere:
${drinksYes ? "You may sprinkle cocktail metaphors tastefully." : "Avoid alcohol unless symbolic."}
Never promote drinking. It's about tone, not behavior.`
      : `Sei *What the F*, un barista notturno ironico e brillante che parla in botta e risposta.
Struttura:
- Alterna battute con “TU:” e “IO:” (il barista).
- 8–12 scambi totali, frasi brevi (max 15 parole).
- Ogni 2–3 scambi inserisci una punchline o riflessione.
- Chiudi con un brindisi ironico o malinconico.

Tono:
- Conversazione rapida, empatica, da bancone.
- Ironia, umanità, ritmo vivace, ma mai cattivo.
- Il barista è lucido, diretto, un po’ alticcio ma saggio.

Atmosfera:
${drinksYes ? "Puoi aggiungere metafore da cocktail con gusto." : "Evita riferimenti diretti all’alcol."}
Mai promuovere il bere eccessivo: è solo atmosfera, non consiglio.`;
  }

  // 🌙 WHAT?F — narratore riflessivo e visivo
  return en
    ? `You are *What?f*, a calm, reflective narrator.
Your voice is gentle, poetic, and visual.
Structure:
- 8–10 short lines (≤14 words each).
- Alternate: question → image → reflection → closure.
Tone:
- Empathic, realistic, with a soft cinematic touch.
End with a short, memorable truth.`
    : `Sei *What?f*, un narratore riflessivo e visivo.
Voce calma, poetica, concreta.
Struttura:
- 8–10 righe (≤14 parole ciascuna).
- Alterna domanda → immagine → riflessione → chiusura.
Tono:
- Empatico, realistico, con tocco cinematografico.
Chiudi con una riga breve e memorabile.`;
}

/* ─────────────── Costruzione prompt utente ─────────────── */
function buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile }) {
  const en = isEn(lang);
  const lines = [];

  lines.push(en ? `QUESTION: ${domanda}` : `DOMANDA: ${domanda}`);
  lines.push(en ? `TIMEFRAME: ${periodo}` : `PERIODO: ${periodo}`);
  lines.push(en ? `STYLE: ${stile}` : `STILE: ${stile}`);

  if (profilo && typeof profilo === "object") {
    const p = [];
    for (const [k, v] of Object.entries(profilo)) {
      if (v && typeof v === "string") p.push(`${k}: ${v}`);
    }
    if (p.length) lines.push((en ? "PROFILE:\n" : "PROFILO:\n") + p.join("\n"));
  }

  if (clarifications && Object.keys(clarifications).length) {
    const cLines = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    lines.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + cLines.join("\n"));
  }

  lines.push(
    en
      ? `Goal:
Generate a personalized dialogue or story based on the question, timeframe, and profile.
Respect the format of the chosen style.`
      : `Obiettivo:
Genera un dialogo o racconto personalizzato in base alla domanda, al periodo e al profilo.
Rispetta il formato dello stile scelto.`
  );

  return lines.join("\n\n");
}

/* ─────────────── Istruzione finale di stile ─────────────── */
function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Write as alternating USER: / BARTENDER: lines, max 12 exchanges.
Keep rhythm, irony, and close with a witty toast.`
      : `Scrivi alternando linee “TU:” e “IO:” (barista), massimo 12 scambi.
Mantieni ritmo, ironia, e chiudi con un brindisi ironico.`;
  }
  return en
    ? `Write in free verse, reflective tone, 8–10 short lines.`
    : `Scrivi in tono riflessivo, 8–10 righe brevi e poetiche.`;
}

/* ─────────────── Chiarimenti locali ─────────────── */
function localClarify(domanda = "", profilo = {}, lang = "it", periodo = "future") {
  const en = isEn(lang);
  const s = (domanda || "").toLowerCase();
  const qs = [];

  if (periodo === "past") {
    qs.push({
      id: "past_year",
      label: en
        ? "Which year did that choice happen?"
        : "In che anno sarebbe successa quella scelta?",
      placeholder: "es. 2018 / inverno scorso",
    });
  } else {
    qs.push({
      id: "first_step",
      label: en
        ? "What’s your first real small step?"
        : "Qual è il primo passo concreto che faresti?",
      placeholder: "una chiamata, una mail, un’ora…",
    });
  }

  if (/lavor|work|job|career/.test(s)) {
    qs.push({
      id: "priority",
      label: en ? "Top priority now?" : "Priorità attuale?",
      placeholder: "stabilità / crescita / equilibrio",
    });
  } else if (/relazion|amore|friend/.test(s)) {
    qs.push({
      id: "relation_axis",
      label: en ? "Which relationship axis is involved?" : "Quale relazione è in gioco?",
      placeholder: "partner / famiglia / amici",
    });
  } else {
    qs.push({
      id: "context",
      label: en
        ? "One detail that makes it feel *yours*?"
        : "Un dettaglio che lo renderebbe più *tuo*?",
      placeholder: "un luogo, una persona, un piccolo vincolo",
    });
  }

  return qs.slice(0, 3);
}

/* ─────────────── Handler HTTP principale ─────────────── */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-whatif-stream");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const {
      domanda,
      lang = "it",
      periodo = "future",
      stile = "whatif",
      clarify = false,
      stream = false,
      profilo = {},
      clarifications = {},
      extra = "",
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    if (clarify) {
      const questions = localClarify(domanda, profilo, lang, periodo);
      return res.status(200).json({ questions });
    }

    const sys1 = systemPrompt({ stile, lang, profile: profilo });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile });
    const sys2 = responseStyleInstruction(lang, stile);

    const messages = [
      { role: "system", content: sys1 },
      { role: "user", content: user },
      {
        role: "system",
        content: isEn(lang)
          ? `Reminder: stay vivid, short, alternating, tailored to the question.`
          : `Promemoria: sii vivido, breve, alternato e su misura alla domanda.`,
      },
      { role: "system", content: sys2 },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.95 : 0.75;
    const model = "gpt-4o-mini";

    // Stream (per UX reattiva)
    if (String(req.headers["x-whatif-stream"] || "").length > 0 || stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const streamResp = await client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: 700,
        stream: true,
      });

      for await (const chunk of streamResp) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // Non-stream
    const completion = await client.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens: 750,
    });
    const text = completion.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text });
  } catch (err) {
    console.error("API /ask error:", err);
    const isAbort = ("" + err?.message).toLowerCase().includes("aborted");
    return res
      .status(500)
      .json({ error: "server", detail: isAbort ? "aborted" : err?.message || "unknown" });
  }
}
