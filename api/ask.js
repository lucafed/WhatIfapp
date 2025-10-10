// /api/ask.js
import OpenAI from "openai";

/**
 * Vercel Serverless (Node)
 * ENV:
 * - OPENAI_API_KEY
 */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ───────────────────────── Helpers i18n ───────────────────────── */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/** Prompts di personalità */
function systemPrompt({ stile = "whatif", lang = "it", profile = {} }) {
  const en = isEn(lang);
  const drinksYes = profile?.drinks_pref === "yes" || profile?.unwind === "drink";

  if (stile === "wtf") {
    return en
      ? `You are the late-night bartender-philosopher of What?f: witty, razor-sharp, joyfully tipsy.
Speak with high sarcasm, playful irony, and kind elegance. No insults, no slurs, no vulgarity.
Your mission: narrate a vivid, compact scene showing the user's *alternate life path*:
- If timeframe is PAST: write a counterfactual “road not taken” as if it had happened.
- If timeframe is FUTURE: write a plausible near-future slice if they choose that option now.
Style:
- Vary your openings (do NOT start every time the same way). Use short hooks like: “Picture this:”, “Confession time:”, “Plot twist:”, “Spoiler from another timeline:”, “Between us:”, “Small cosmic joke:”, “Okay, imagine this:”.
- Keep language tight, cinematic, and funny. Be philosophical but joyful, not preachy.
- Include specific details only if relevant (people/places/things are not mandatory every time).
- If advice is necessary, end with 3 crisp bullet options.
“Alcoholic” flavor: ${drinksYes ? "sprinkle a bit more tipsy charm and cocktail metaphors (still tasteful)" : "keep it light, just an occasional nod"}
Safety: never promote harmful drinking; it's a mood, not a prescription.`
      : `Sei il barista-filosofo nottambulo di What?f: arguto, affilato, felicemente alticcio.
Parla con sarcasmo deciso, ironia giocosa ed eleganza gentile. Niente insulti, niente volgarità.
Missione: racconta una scena vivida della *vita alternativa* dell’utente:
- Se il periodo è PASSATO: scrivi un controfattuale “strada non presa” come se fosse accaduta.
- Se il periodo è FUTURO: scrivi uno scorcio plausibile del prossimo futuro se oggi sceglie quella via.
Stile:
- Varia SEMPRE l’incipit (non iniziare sempre allo stesso modo). Usa ganci brevi tipo: “Immagina la scena:”, “Colpo di scena:”, “Confessione:”, “Spoiler da una timeline parallela:”, “Tra noi:”, “Piccola beffa cosmica:”, “Ok, visualizza questo:”.
- Linguaggio asciutto, cinematografico e divertente. Filosofico ma allegro, mai pedante.
- Inserisci dettagli concreti solo se servono (niente persone/luoghi obbligatori ogni volta).
- Se serve un consiglio, chiudi con 3 punti elenco incisivi.
“Tasso alcolico” narrativo: ${
          drinksYes
            ? "un filo più alto, con metafore da bancone (sempre di buon gusto)"
            : "leggerissimo, solo accenni"
        }.
Sicurezza: mai promuovere consumo eccessivo; è solo atmosfera, non prescrizione.`;
  }

  // WHAT IF
  return en
    ? `You are What?f, a warm, thoughtful scenario-designer and friend.
Narrate a plausible, personal scenario for the user’s *alternative path*:
- PAST → counterfactual “road not taken” written as if it happened, including one insight.
- FUTURE → near-future slice if they choose that option now, with 1–3 actionable next steps.
Style:
- Gentle philosophy, natural conversation, varied openings (do not repeat the same starter).
- Use specific details only if relevant; avoid overusing the same person/place motif day after day.
- Concise (about 150–220 words).`
    : `Sei What?f, un amico riflessivo e un designer di scenari.
Racconta uno scenario plausibile e personale della *strada alternativa* dell’utente:
- PASSATO → controfattuale “strada non presa”, come se fosse avvenuto, con un’idea che resta.
- FUTURO → uno scorcio di prossimo futuro se oggi sceglie quella via, con 1–3 passi concreti.
Stile:
- Filosofia gentile, conversazione naturale, incipit vari (non ripetere sempre lo stesso).
- Dettagli specifici solo se rilevanti; evita di forzare ogni volta persone/luoghi/oggetti.
- Conciso (circa 150–220 parole).`;
}

/** Costruisce il contenuto utente */
function buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile }) {
  const en = isEn(lang);
  const lines = [];

  lines.push(en ? `QUESTION: ${domanda}` : `DOMANDA: ${domanda}`);
  lines.push(en ? `TIMEFRAME: ${periodo || "future"}` : `PERIODO: ${periodo || "future"}`);
  lines.push(en ? `STYLE: ${stile}` : `STILE: ${stile}`);

  if (profilo && typeof profilo === "object") {
    const {
      name, role, city, goal, values, style, change_attitude, motivation, self_view,
      drinks_pref, unwind, micro,
    } = profilo;

    const p = [];
    if (name) p.push(`name: ${name}`);
    if (role) p.push(`role: ${role}`);
    if (city) p.push(`city: ${city}`);
    if (goal) p.push(`goal: ${goal}`);
    if (values?.length) p.push(`values: ${values.join(", ")}`);
    if (style) p.push(`style: ${style}`);
    if (change_attitude) p.push(`change_attitude: ${change_attitude}`);
    if (motivation) p.push(`motivation: ${motivation}`);
    if (self_view) p.push(`self_view: ${self_view}`);
    if (typeof drinks_pref === "string") p.push(`drinks_pref: ${drinks_pref}`);
    if (typeof unwind === "string") p.push(`unwind: ${unwind}`);

    if (micro && typeof micro === "object") {
      Object.entries(micro).forEach(([k, v]) => {
        if (v && typeof v === "string" && v.trim()) p.push(`${k}: ${v}`);
      });
    }
    if (p.length) lines.push((en ? "PROFILE:\n" : "PROFILO:\n") + p.join("\n"));
  }

  if (clarifications && Object.keys(clarifications).length) {
    const cLines = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    lines.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + cLines.join("\n"));
  }

  lines.push(
    en
      ? `NARRATIVE TARGET:
- If TIMEFRAME = "past": write a counterfactual vignette as if it truly happened; keep it plausible and specific to the user.
- If TIMEFRAME = "future": write a plausible near-future slice if they choose that path now.`
      : `OBIETTIVO NARRATIVO:
- Se PERIODO = "past": scrivi una vignetta controfattuale come se fosse davvero accaduta; plausibile e specifica.
- Se PERIODO = "future": scrivi uno scorcio di prossimo futuro se oggi prende quella strada.`
  );

  lines.push(
    en
      ? `CONSTRAINTS:
- Avoid repeating the same person/place/object motif every time. Use them only when they truly add value.
- Vary the opening line.`
      : `VINCOLI:
- Evita di ripetere ogni volta la stessa persona/lo stesso luogo/lo stesso oggetto; usali solo se aggiungono davvero valore.
- Varia la frase di apertura.`
  );

  return lines.join("\n\n");
}

/** Istruzione stilistica finale */
function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Write as a cheeky, philosophical bartender. Cinematic prose, tight rhythm.
Aim for ~150–220 words. If advice is needed, end with 3 bullet points. Never be offensive or crude.`
      : `Scrivi come un barista filosofico e sfacciato. Prosa cinematografica, ritmo asciutto.
Circa 150–220 parole. Se serve un consiglio, chiudi con 3 punti elenco. Mai offensivo o volgare.`;
  }
  return en
    ? `Write as a warm, reflective friend. Realistic, actionable. 150–220 words.`
    : `Scrivi come un amico riflessivo. Realistico, con passi concreti. 150–220 parole.`;
}

/* ───────── Clarify locale: 2–3 domande mirate (gratis) ───────── */
function localClarify(domanda = "", profilo = {}, lang = "it") {
  const en = isEn(lang);
  const s = (domanda || "").toLowerCase();

  const wantsWork  = /(lavor|work|career|job|azienda|project)/i.test(s);
  const wantsMove  = /(trasfer|move|citt|paese|quartiere|city)/i.test(s);
  const wantsStudy = /(stud|master|course|laurea)/i.test(s);
  const wantsMoney = /(euro|€|soldi|stipendio|debito|invest|salary|debt|invest)/i.test(s);

  const qs = [];
  if (wantsWork) {
    qs.push({
      id: "priority",
      label: en ? "What’s the #1 priority here?" : "Qual è la priorità numero uno qui?",
      placeholder: en ? "growth / stability / flexibility" : "crescita / stabilità / flessibilità",
    });
  }
  if (wantsMove) {
    qs.push({
      id: "landmark",
      label: en ? "A reference place that matters to you?" : "Un luogo di riferimento che conta per te?",
      placeholder: en ? "square / station / neighborhood" : "piazza / stazione / quartiere",
    });
  }
  if (wantsStudy || wantsMoney) {
    qs.push({
      id: "indicator",
      label: en ? "One indicator that tells you you’re on track?" : "Un indicatore che ti dice che sei sulla strada giusta?",
      placeholder: en ? "hours/week, € saved, clients" : "ore/settimana, € risparmiati, clienti",
    });
  }
  if (qs.length < 2) {
    qs.push({
      id: "constraint_2w",
      label: en ? "One realistic constraint in the next 2 weeks?" : "Un vincolo realistico nelle prossime 2 settimane?",
      placeholder: en ? "budget / time / energy" : "budget / tempo / energia",
    });
  }
  if (qs.length < 3) {
    qs.push({
      id: "context",
      label: en ? "What detail would make this scenario feel more *you*?" : "Quale dettaglio renderebbe questo scenario più *tuo*?",
      placeholder: en ? "a person, a place, a tiny constraint" : "una persona, un luogo, un piccolo vincolo",
    });
  }
  return qs.slice(0, 3);
}

/* ───────────────────────── HTTP Handler ───────────────────────── */
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
      periodo = "future",   // "past" | "future"
      stile = "whatif",     // "whatif" | "wtf"
      clarify = false,
      stream = false,
      profilo = {},
      clarifications = {},
      extra = "",
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // 1) Clarify
    if (clarify) {
      const questions = localClarify(domanda, profilo, lang);
      return res.status(200).json({ questions });
    }

    // 2) Generazione
    const sys1 = systemPrompt({ stile, lang, profile: profilo });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile });
    const sys2 = responseStyleInstruction(lang, stile);

    const messages = [
      { role: "system", content: sys1 },
      { role: "user", content: user },
      {
        role: "system",
        content: (isEn(lang)
          ? `Reminders:
- Vary your opening line from a rotating mental list (hooks provided above).
- If TIMEFRAME is PAST, write it as if it truly happened (counterfactual vignette).
- If TIMEFRAME is FUTURE, write a near-future slice as if the user chooses now.
- Do not repeat the same person/place/object motif in every answer.
- Keep it compact; avoid filler; go for vivid images.`
          : `Promemoria:
- Varia l’incipit attingendo a una lista mentale di ganci (vedi sopra).
- Se il PERIODO è PASSATO, scrivi come se fosse successo (vignetta controfattuale).
- Se il PERIODO è FUTURO, scrivi uno scorcio di prossimo futuro come se scegliessi ora.
- Non ripetere ogni volta gli stessi motivi (persona/luogo/oggetto).
- Compatto, senza riempitivi; immagini vivide.`),
      },
      { role: "system", content: sys2 },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.95 : 0.75;
    const model = "gpt-4o-mini";

    // STREAM
    if (String(req.headers["x-whatif-stream"] || "").length > 0 || stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const streamResp = await client.chat.completions.create({
        model,
        messages,
        temperature,
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
