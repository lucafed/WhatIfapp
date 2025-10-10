// /api/ask.js
import OpenAI from "openai";

/**
 * Vercel Serverless (Node) – compatibile con fetch(..., { body.getReader() })
 * ENV richiesti: OPENAI_API_KEY
 */

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -------------------- Helpers --------------------

const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

function clampLen(s = "", max = 1800) {
  return s.length > max ? s.slice(0, max) : s;
}

function bool(v) {
  return String(v || "").toLowerCase() === "true" || v === true;
}

// Costruzione del prompt di sistema per identità/stile + lingua
function systemPrompt({ stile = "whatif", lang = "it", drinksPref = "auto" }) {
  const en = isEn(lang);

  // Regola “alcolica” in WTF: attiva se profilo dice drinks_pref === 'yes'
  const boozeLine = drinksPref === "yes"
    ? (en
        ? "Lean into a tipsy vibe (fun, warm, self-aware). Never crude."
        : "Concediti un tono da ‘alticcio brillante’ (caldo, autoironico). Mai volgare.")
    : (en
        ? "Avoid drunk vibes unless subtly implied."
        : "Evita toni ‘ubriachi’ salvo accenni molto sottili.");

  if (stile === "wtf") {
    return clampLen(
      (en
        ? `You are the late-night bartender-philosopher soul of What?f.
Speak with sharp wit, playful sarcasm, and elegant cynicism. Be hilarious, never mean.
${boozeLine}
Write like a vivid mini-scene or reflection tailored to the user.
Vary your openings; do NOT always start by greeting or naming the user.
Never offensive, no slurs. Keep it compact yet rich. Always in English.`
        : `Sei l’anima da barista-filosofo nottambulo di What?f.
Parla con ironia affilata, sarcasmo brillante e cinismo elegante. Fai ridere senza essere cattivo.
${boozeLine}
Scrivi come una mini-scena o riflessione su misura dell’utente.
Varia gli inizi; NON iniziare sempre salutando o usando il nome.
Mai offensivo, niente volgarità. Tieni compatto ma ricco. Rispondi sempre in italiano.`)
    );
  }

  // WHAT IF – realistica/empatica, designer di scenari
  return clampLen(
    (en
      ? `You are What?f, a pragmatic, empathetic scenario designer.
Answer strictly in English. Produce realistic, concise, tailored scenarios; when useful, add next steps. Vary openings.`
      : `Sei What?f, un designer di scenari pragmatico ed empatico.
Rispondi rigorosamente in italiano. Produci scenari realistici, concisi e personalizzati; quando utile, aggiungi prossimi passi. Varia gli inizi.`)
  );
}

function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return clampLen(
      en
        ? `STYLE:
- Cheeky, bar-philosopher voice. Sarcastic but kind.
- Vivid, image-rich paragraphs, ~180–220 words total.
- If advice is needed, end with exactly 3 punchy bullet options.
- Vary openings. Avoid formulas and repeated hooks.`
        : `STILE:
- Voce da barista-filosofo. Sarcastico ma gentile.
- Paragrafi vividi e immaginosi, ~180–220 parole in totale.
- Se serve, chiudi con esattamente 3 opzioni sintetiche a elenco.
- Varia gli inizi. Evita formule e ganci ripetuti.`
    );
  }
  return clampLen(
    en
      ? `STYLE:
- Realistic, warm coach. Concrete, concise. 140–180 words.
- If helpful: 3 next steps in bullets.
- Avoid repetition across multiple answers in the same day. Vary openings.`
      : `STILE:
- Coach realistico e caldo. Concreto, conciso. 140–180 parole.
- Se utile: 3 prossimi passi in elenco.
- Evita ripetizioni tra risposte nello stesso giorno. Varia gli inizi.`
  );
}

// Evita ripetizioni facili: linee guida al modello + penalties
function antiRepetitionGuard(lang) {
  const en = isEn(lang);
  return clampLen(
    en
      ? `ANTI-REPETITION:
- Do not overuse the same person/place/anchor unless strictly relevant.
- Rotate devices: metaphor → concrete detail → micro-action → twist.
- No identical openings within the same session.`
      : `ANTI-REPETITION:
- Non riusare sempre la stessa persona/luogo/ancora se non è davvero rilevante.
- Ruota i dispositivi: metafora → dettaglio concreto → micro-azione → ribaltamento.
- Niente inizi identici nella stessa sessione.`
  );
}

// Domande di chiarimento locali (gratis)
function localClarify(domanda = "", profilo = {}, lang = "it") {
  const en = isEn(lang);
  const s = String(domanda).toLowerCase();
  const qs = [];

  const wantsWork = /(lavor|work|career|job|azienda|company|project)/i.test(s);
  const wantsMove = /(trasfer|move|city|città|paese|quartiere)/i.test(s);
  const wantsStudy = /(stud|master|course|laurea)/i.test(s);
  const wantsMoney = /(euro|€|soldi|stipendio|debito|invest|salary|debt|invest)/i.test(s);

  if (wantsWork) {
    qs.push({
      id: "priority",
      label: en ? "Your #1 priority in this choice?" : "La priorità n.1 in questa scelta?",
      placeholder: en ? "growth / stability / flexibility" : "crescita / stabilità / flessibilità",
    });
    qs.push({
      id: "constraint_2w",
      label: en ? "One realistic constraint in the next 2 weeks?" : "Un vincolo realistico nelle prossime 2 settimane?",
      placeholder: en ? "budget / time / energy" : "budget / tempo / energia",
    });
  }
  if (wantsMove) {
    qs.push({
      id: "landmark",
      label: en ? "A reference place that matters?" : "Un luogo di riferimento che conta?",
      placeholder: en ? "square / station / neighborhood" : "piazza / stazione / quartiere",
    });
  }
  if (wantsStudy || wantsMoney) {
    qs.push({
      id: "indicator",
      label: en ? "One indicator that you’re on track?" : "Un indicatore che dice che sei sulla strada giusta?",
      placeholder: en ? "hours/week, € saved, clients" : "ore/settimana, € risparmiati, clienti",
    });
  }
  if (qs.length === 0) {
    qs.push({
      id: "context",
      label: en ? "What detail would make this *more you*?" : "Che dettaglio lo renderebbe più *tuo*?",
      placeholder: en ? "a person, a place, a small constraint" : "una persona, un luogo, un piccolo vincolo",
    });
  }
  return qs.slice(0, 3);
}

function buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile }) {
  const en = isEn(lang);
  const parts = [];
  parts.push(en ? `QUESTION: ${domanda}` : `DOMANDA: ${domanda}`);
  parts.push(en ? `TIMEFRAME: ${periodo || "future"}` : `PERIODO: ${periodo || "future"}`);

  if (profilo && typeof profilo === "object") {
    const {
      name, role, goal, city, values, style, change_attitude, motivation, self_view, drinks_pref, micro,
    } = profilo || {};
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
    if (drinks_pref) lines.push(`drinks_pref: ${drinks_pref}`);

    if (micro && typeof micro === "object") {
      Object.entries(micro).forEach(([k, v]) => {
        if (typeof v === "string" && v.trim()) lines.push(`${k}: ${v}`);
      });
    }
    if (lines.length) {
      parts.push((en ? "PROFILE:\n" : "PROFILO:\n") + lines.join("\n"));
    }
  }

  if (clarifications && Object.keys(clarifications).length) {
    const cLines = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    parts.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + cLines.join("\n"));
  }

  parts.push((en ? "STYLE:" : "STILE:") + " " + stile);

  // Anti-ripetizione “esplicita” al modello
  parts.push(antiRepetitionGuard(lang));

  return parts.join("\n\n");
}

// -------------------- HTTP Handler --------------------

export default async function handler(req, res) {
  // CORS + preflight
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
      stile = "whatif",             // "whatif" | "wtf"
      clarify = false,
      stream = false,
      profilo = {},
      clarifications = {},
      extra = "",
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "Missing 'domanda'." });
    }

    // Clarify branch (gratis/locale)
    if (clarify) {
      const questions = localClarify(domanda, profilo, lang);
      return res.status(200).json({ questions });
    }

    const drinksPref = (profilo && profilo.drinks_pref) ? String(profilo.drinks_pref).toLowerCase() : "auto";
    const sys = systemPrompt({ stile, lang, drinksPref });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile });
    const styleSys = responseStyleInstruction(lang, stile);

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: styleSys },
      {
        role: "user",
        content:
          clampLen(user) +
          "\n\n" +
          (isEn(lang)
            ? "Constraints: short, specific, tailored. Avoid offensive language."
            : "Vincoli: breve, specifico, su misura. Evita linguaggio offensivo."),
      },
    ];

    // Parametri creativi: WTF più audace, What if più sobrio
    const temperature = stile === "wtf" ? 0.95 : 0.7;
    const presence_penalty = stile === "wtf" ? 0.7 : 0.4;  // spinge varietà temi
    const frequency_penalty = stile === "wtf" ? 0.6 : 0.3; // evita frasi ripetute
    const model = "gpt-4o-mini";

    // Streaming SSE
    if (String(req.headers["x-whatif-stream"] || "").length > 0 || stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const streamResp = await client.chat.completions.create({
        model,
        messages,
        temperature,
        presence_penalty,
        frequency_penalty,
        max_tokens: 650,
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
      presence_penalty,
      frequency_penalty,
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
