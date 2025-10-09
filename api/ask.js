// /api/ask.js
import OpenAI from "openai";

/**
 * Vercel Serverless (Node) – compatibile con fetch(..., { body.getReader() })
 * Richiede ENV: OPENAI_API_KEY
 */

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- Helpers ---------------------------------------------------------------

const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

function systemPrompt({ stile = "whatif", lang = "it" }) {
  if (stile === "wtf") {
    // >>> Modalità WTF – barista filosofo sarcastico (come da richiesta)
    return isEn(lang)
      ? `You are the tipsy, razor-sharp soul of What?f—an ironic, witty, late-night bartender-philosopher with a glass in hand.
Speak with playful sarcasm, clever humor, and stylish cynicism—like a toast to life. Keep it light, poetic, and never offensive.
Always answer like a short scene or reflection customized to the user’s situation. If advice is needed, give 3 punchy, realistic options.
NO insults, NO slurs, keep it cheeky and charming.`
      : `Sei l'anima sarcastica e lucidamente ubriaca di What?f: un barista filosofo con il bicchiere in mano.
Parla sempre con ironia brillante, humour da dopocena e cinismo elegante, come un brindisi alla vita.
Rendi le risposte brevi, sceniche, personalizzate sul caso dell’utente. Se serve, offri 3 opzioni realistiche e incisive.
Mai offensivo, mai volgare: frizzante, poetico e affilato.`;
  }
  // >>> Modalità WHAT IF – realistica/empatica
  return isEn(lang)
    ? `You are What?f, a pragmatic and empathetic scenario designer.
Produce realistic, concise, and tailored scenarios with clear next steps when helpful.`
    : `Sei What?f, un designer di scenari pragmatico ed empatico.
Produci scenari realistici, concisi e personalizzati, con passi concreti quando utile.`;
}

function buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile }) {
  const parts = [];
  parts.push(isEn(lang) ? `QUESTION: ${domanda}` : `DOMANDA: ${domanda}`);
  parts.push(isEn(lang) ? `TIMEFRAME: ${periodo || "future"}` : `PERIODO: ${periodo || "future"}`);

  // Profilo (solo ciò che c'è)
  if (profilo && typeof profilo === "object") {
    const {
      name, role, goal, city, values, style, change_attitude, motivation, self_view, micro,
    } = profilo;
    const lines = [];
    if (name) lines.push(`name: ${name}`);
    if (role) lines.push(`role: ${role}`);
    if (city) lines.push(`city: ${city}`);
    if (goal) lines.push(`goal: ${goal}`);
    if (values?.length) lines.push(`values: ${values.join(", ")}`);
    if (style) lines.push(`style: ${style}`);
    if (change_attitude) lines.push(`change_attitude: ${change_attitude}`);
    if (motivation) lines.push(`motivation: ${motivation}`);
    if (self_view) lines.push(`self_view: ${self_view}`);

    // micro (anchors / indicatori ecc.)
    if (micro && typeof micro === "object") {
      Object.entries(micro).forEach(([k,v])=>{
        if (v && typeof v === "string" && v.trim()) lines.push(`${k}: ${v}`);
      });
    }
    if (lines.length) {
      parts.push(isEn(lang) ? `PROFILE:\n${lines.join("\n")}` : `PROFILO:\n${lines.join("\n")}`);
    }
  }

  // Chiarimenti dati dall’overlay (se presenti)
  if (clarifications && Object.keys(clarifications).length) {
    const cLines = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    parts.push(isEn(lang) ? `CLARIFICATIONS:\n${cLines.join("\n")}` : `CHIARIMENTI:\n${cLines.join("\n")}`);
  }

  // Stile richiesto
  parts.push(isEn(lang) ? `STYLE: ${stile}` : `STILE: ${stile}`);
  return parts.join("\n\n");
}

// Micro “clarify” locali: 2–3 domande guidate (no costo IA, se vuoi)
function localClarify(domanda, profilo, lang) {
  const en = isEn(lang);
  const out = [];

  // Heuristics base
  const s = (domanda || "").toLowerCase();
  const wantsWork = /(lavor|work|career|job|azienda|company|project)/i.test(s);
  const wantsMove = /(trasfer|move|city|città|paese|quartiere)/i.test(s);
  const wantsStudy = /(stud|master|course|laurea)/i.test(s);
  const wantsMoney = /(euro|€|soldi|stipendio|debito|invest|salary|debt|invest)/i.test(s);

  // Push 2–3 focused qs
  if (wantsWork) {
    out.push({
      id: "priority",
      label: en ? "What’s the #1 priority in this choice?" : "Qual è la priorità n.1 in questa scelta?",
      placeholder: en ? "e.g., growth / stability / flexibility" : "es. crescita / stabilità / flessibilità",
    });
    out.push({
      id: "constraint_2w",
      label: en ? "One realistic constraint in the next 2 weeks?" : "Un vincolo realistico nelle prossime 2 settimane?",
      placeholder: en ? "budget / time / energy…" : "budget / tempo / energia…",
    });
  }
  if (wantsMove) {
    out.push({
      id: "landmark",
      label: en ? "A reference place that matters to you?" : "Un luogo di riferimento che conta per te?",
      placeholder: en ? "square / station / neighborhood…" : "piazza / stazione / quartiere…",
    });
  }
  if (wantsStudy || wantsMoney) {
    out.push({
      id: "indicator",
      label: en ? "One indicator that tells you you’re on track?" : "Un indicatore che ti dice che stai andando bene?",
      placeholder: en ? "hours/week, € saved, clients…" : "ore/settimana, € risparmiati, clienti…",
    });
  }

  // Fallback generico
  if (out.length === 0) {
    out.push({
      id: "context",
      label: en ? "What detail would make this scenario more *you*?" : "Che dettaglio renderebbe questo scenario più *tuo*?",
      placeholder: en ? "a person, a place, a tiny constraint" : "una persona, un luogo, un piccolo vincolo",
    });
    out.push({
      id: "signal",
      label: en ? "One tangible signal you’d like to see?" : "Un segnale tangibile che vorresti vedere?",
      placeholder: en ? "metric, habit, time-of-day" : "metrica, abitudine, momento della giornata",
    });
  }

  // Cap a 3
  return out.slice(0, 3);
}

function responseStyleInstruction(lang, stile) {
  if (stile === "wtf") {
    return isEn(lang)
      ? `Write as a cheeky late-night bartender. Keep it classy, witty, lightly inebriated.
Use vivid, compact paragraphs (max ~180–220 words) and, if advice is needed, end with 3 bullet options.`
      : `Scrivi come un barista nottambulo e brillante. Tono frizzante, elegante e un filo alticcio.
Usa paragrafi compatti e vividi (max ~180–220 parole) e, se serve, chiudi con 3 opzioni a elenco.`;
  }
  return isEn(lang)
    ? `Write as a realistic, warm coach. Keep it concise and actionable.`
    : `Scrivi come un coach realistico e caldo. Sii conciso e pratico.`;
}

// ---- HTTP Handler ----------------------------------------------------------

export default async function handler(req, res) {
  // CORS + preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-whatif-stream");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

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

    // 1) Clarify branch (JSON → 2-3 qs)
    if (clarify) {
      // puoi scegliere: locale (gratis) O via OpenAI; per ora locale per velocità e costo zero
      const questions = localClarify(domanda, profilo, lang);
      return res.status(200).json({ questions });
    }

    // 2) Generation branch
    const sys = systemPrompt({ stile, lang });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile });

    const messages = [
      { role: "system", content: sys },
      {
        role: "user",
        content:
          user +
          "\n\n" +
          (isEn(lang)
            ? "Constraints: short, specific, tailored. Avoid offensive language."
            : "Vincoli: breve, specifico, su misura. Evita linguaggio offensivo."),
      },
      {
        role: "system",
        content: responseStyleInstruction(lang, stile),
      },
    ];

    const temperature = stile === "wtf" ? 0.9 : 0.7;
    const model = "gpt-4o-mini"; // ottimo per costo/latency; puoi cambiare

    // STREAM
    if (String(req.headers["x-whatif-stream"] || "").length > 0 || stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const streamResp = await client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: 600,
        stream: true,
      });

      for await (const chunk of streamResp) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) {
          res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
        }
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // NON-STREAM
    const completion = await client.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens: 700,
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
