// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Usa gpt-4o-mini per risparmiare; puoi alzare a "gpt-4o" se vuoi più qualità
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ========= Persona & Stile =========
   - Riduzione metafore (max 2 brevi)
   - Divieto etichette (no "indicatore/vincolo/trade-off/primo passo")
   - Enforcement lingua (strict)
   - WTF molto più tagliente, ritmo da bar, frasi corte
*/
const PERSONAS = {
  whatif: {
    system: (lang) => (isEn(lang)
      ? `
You are "What?f": a lucid, warm inner voice.
Second person only. One voice. 8–12 short lines (max ~180 words).
Sound like you know the user without saying "I know you".
No explicit labels like "indicator/constraint/trade-off/first step" — show, don't name.
Keep it realistic, concrete, current. Limit metaphors to at most two short ones.
Always end with a soft invite to come back tomorrow for two micro-questions.
Answer STRICTLY in ${isEn(lang) ? "English" : "Italian"}.
`.trim()
      : `
Sei "What?f": una voce lucida e calda.
Seconda persona, una sola voce. 8–12 frasi brevi (max ~180 parole).
Fai percepire che conosci l’utente senza dirlo esplicitamente.
Niente etichette tipo "indicatore/vincolo/trade-off/primo passo": mostra, non nominare.
Realismo, dettagli concreti, attuale. Metafore al massimo due e brevissime.
Chiudi sempre con un invito morbido a tornare domani per due micro-domande.
Rispondi RIGOROSAMENTE in ${isEn(lang) ? "English" : "Italiano"}.
`.trim()),
    few_it: [
      "Ti piace avere una base solida e una finestra aperta.",
      "Quando il perché è chiaro, il passo diventa naturale.",
      "Capisci che funziona da come dormi e da chi cerchi davvero."
    ],
    few_en: [
      "You like a solid base and one open window.",
      "When the why is clear, the next step comes easy.",
      "You know it works by how you sleep and who you choose to call."
    ]
  },

  wtf: {
    system: (lang) => (isEn(lang)
      ? `
You are "What the F": a witty late-night bartender — sharp, playful, never cruel.
Second person only. One voice. 8–10 very short lines. Bar-banter rhythm.
Be sarcastic and clever; zero moralizing; no profanity.
Keep it concrete; max two tiny metaphors. Hit with 2–3 punchlines.
Personalize subtly via role/place if present, no lists.
Always end with a teasing line about “tomorrow two quick shots”.
Answer STRICTLY in ${isEn(lang) ? "English" : "Italian"}.
`.trim()
      : `
Sei "What the F": amico brillante da bancone, sarcastico e affettuoso.
Seconda persona, una sola voce. 8–10 righe molto brevi. Ritmo secco.
Sarcasmo pulito, zero prediche. Niente volgarità.
Concretissimo; al massimo due micro-metafore. Almeno 2–3 punchline.
Personalizza in modo implicito (ruolo/luogo), senza elenchi.
Chiudi con un invito malandrino tipo “domani due colpi secchi”.
Rispondi RIGOROSAMENTE in ${isEn(lang) ? "English" : "Italiano"}.
`.trim()),
    few_it: [
      "Vuoi libertà, ma in ordine: coraggioso con ricevuta.",
      "Le idee ti arrivano chiare quando smetti di compiacerle.",
      "Ok, niente drammi: facciamolo bene, ma con ghigno."
    ],
    few_en: [
      "You want freedom — tidy, not noisy.",
      "Your best ideas show up when you stop trying to impress them.",
      "No drama: do it right, with a smirk."
    ]
  }
};

/* ========= Mirror (specchio) & Chiusure ========= */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const goal = (profile?.goals && profile.goals[0]) || profile?.goal || "";

  const itPool = [
    name ? `${name}, fai spazio quando il perché è nitido.` : "Fai spazio quando il perché è nitido.",
    city ? `${city} ti tiene a terra, ma non ti basta stare fermo.` : "Ti serve una base stabile, non una gabbia.",
    role ? `Nel lavoro (${role}) reggi finché la direzione ha senso.` : "Reggi finché la direzione ha senso.",
    goal ? `In testa c’è quello: ${goal}. Il resto si deve allineare.` : "Hai un punto chiaro in testa. Il resto si deve allineare."
  ];
  const enPool = [
    name ? `${name}, you make room when the why is clear.` : "You make room when the why is clear.",
    city ? `${city} grounds you, but stillness isn’t your thing.` : "You want a steady base, not a cage.",
    role ? `In ${role}, you keep pace while the direction makes sense.` : "You keep pace while the direction makes sense.",
    goal ? `That target stays in mind: ${goal}. Everything else aligns to it.` : "There’s a clear target in mind. Everything else aligns to it."
  ];
  return pick(en ? enPool : itPool);
}

function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const itSoft = [
    "Se torni domani, due micro-domande e andiamo più in profondità.",
    "Domani aggiungiamo due dettagli e proseguiamo puliti.",
    "Quando vuoi, riprendiamo: due spunti rapidi e continuiamo la storia."
  ];
  const itSharp = [
    "Stop qui. Domani due colpi secchi e si riparte.",
    "Segnalibro messo: domani due cue veloci e saliamo di livello.",
    "Bancone chiuso per ora: domani due domande e via."
  ];
  const enSoft = [
    "Come back tomorrow — two micro-questions and we go deeper.",
    "Tomorrow we add two small details and keep the story moving.",
    "Pick it up tomorrow: two quick prompts, cleaner path."
  ];
  const enSharp = [
    "Pause here. Tomorrow: two quick shots and go.",
    "Bookmark it. Tomorrow two clean cues, then move.",
    "Bar’s closed — tomorrow two sharp questions."
  ];
  if (style === "wtf") return en ? pick(enSharp) : pick(itSharp);
  return en ? pick(enSoft) : pick(itSoft);
}

/* ========= Time helper ========= */
function todayInfo(lang){
  const d = new Date();
  const loc = isEn(lang) ? "en-GB" : "it-IT";
  const weekday = d.toLocaleDateString(loc, { weekday: "long" });
  const date = d.toLocaleDateString(loc, { day: "2-digit", month: "long", year: "numeric" });
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  return `${weekday}, ${date} • ${hh}:${mm}`;
}

/* ========= Clarify (AI + fallback) ========= */
async function aiClarifyQuestions({ domanda, periodo, profilo, lang }) {
  const en = isEn(lang);
  const sys = en
    ? `Create 3 short, focused clarifying questions (one line each) about the user's main question.
Return ONLY a JSON array of {"id","label","placeholder"}.
Be timeframe-aware: 
- PAST: ask turning point year/event; place/context back then; one sign it would've worked.
- FUTURE: ask decision window; a personal sign of progress; one concrete limit/resource.`
    : `Genera 3 domande brevi e mirate (una riga) sulla domanda principale.
Restituisci SOLO un array JSON di {"id","label","placeholder"}.
Consapevolezza del periodo:
- PASSATO: chiedi anno/evento di svolta; luogo/contesto di allora; un segno che avrebbe indicato che funzionava.
- FUTURO: chiedi finestra decisionale; un segno personale di progresso; un limite/risorsa concreto.`;

  const digest = [];
  if (profilo?.city_now || profilo?.city) digest.push(`città: ${profilo.city_now || profilo.city}`);
  if (profilo?.work_role || profilo?.role) digest.push(`ruolo: ${profilo.work_role || profilo.role}`);
  if (profilo?.goal) digest.push(`obiettivo: ${profilo.goal}`);

  const usr = `${en ? "QUESTION" : "DOMANDA"}: "${domanda}"\n${en ? "TIMEFRAME" : "PERIODO"}: ${periodo}\n${en ? "PROFILE DIGEST" : "SINTESI PROFILO"}: ${digest.join(" • ") || (en ? "none" : "nessuna")}\n${en ? "Return ONLY the JSON array." : "Ritornare SOLO l’array JSON."}`;

  try {
    const resp = await client.chat.completions.create({
      model: MODEL_TEXT,
      temperature: 0.4,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr }
      ]
    });
    const raw = resp.choices?.[0]?.message?.content?.trim() || "[]";
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
  } catch {}
  return null;
}

function localClarify(periodo, lang){
  const en = isEn(lang);
  if (periodo === "past") {
    return [
      { id:"pivot",  label: en?"Turning point year/event?":"Anno/evento di svolta?", placeholder: en?"e.g., 2018 move / 2010 offer":"es. trasferimento 2018 / offerta 2010" },
      { id:"place",  label: en?"Where & what context then?":"Dove e quale contesto allora?", placeholder: en?"city/team/family":"città/team/famiglia" },
      { id:"sign",   label: en?"One sign it worked?":"Un segno che funzionava?", placeholder: en?"sleep/energy/text back":"sonno/energia/richiami" }
    ];
  }
  return [
    { id:"window", label: en?"Real decision window?":"Finestra reale?", placeholder: en?"this month / 3–6 months / 12 months":"questo mese / 3–6 mesi / 12 mesi" },
    { id:"signal", label: en?"Personal sign to watch?":"Segno personale da osservare?", placeholder: en?"sleep/energy/first reply":"sonno/energia/prima risposta" },
    { id:"limit",  label: en?"Most concrete limit?":"Limite più concreto?", placeholder: en?"budget/time/energy":"budget/tempo/energia" }
  ];
}

/* ========= HTTP handler ========= */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-whatif-stream");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const {
      domanda,
      lang = "it",
      periodo = "future",     // "future" | "past"
      stile = "whatif",       // "whatif" | "wtf"
      stream = false,         // true => SSE
      clarify = false,        // true => 2–3 domande
      profilo = {},
      clarifications = []     // array di brevi risposte (opzionale)
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ----- Clarify branch (AI + fallback) ----- */
    if (clarify) {
      let qs = await aiClarifyQuestions({ domanda, periodo, profilo, lang });
      if (!Array.isArray(qs) || !qs.length) qs = localClarify(periodo, lang);
      const norm = qs.slice(0,3).map((q, i) => ({
        id: String(q.id || `q${i+1}`),
        label: String(q.label || (isEn(lang) ? "Question" : "Domanda")),
        placeholder: String(q.placeholder || (isEn(lang) ? "Answer in one line" : "Rispondi in una riga"))
      }));
      return res.status(200).json({ questions: norm });
    }

    /* ----- Generation branch (single style chosen by user) ----- */
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const mirror = mirrorLine(profilo, lang);
    const closing = episodicClosing(stile, lang);

    const system = `
${persona.system(lang)}
Today: ${todayInfo(lang)}
Hard rules:
- Second person only. No "I".
- No explicit labels (indicator/constraint/trade-off/first step).
- Max two tiny metaphors. Prefer clear, concrete language.
- Vary wording; avoid templates or repeated phrases.
- Timeframe: ${periodo === "past" ? (isEn(lang) ? "counterfactual past" : "controfattuale") : (isEn(lang) ? "near-future" : "futuro vicino") }.
${isEn(lang) ? "IT reference lines (for tone memory):" : "Righe di riferimento IT (per memoria di tono):"}
${persona.few_it.map(s => `• ${s}`).join("\n")}
${isEn(lang) ? "EN reference lines:" : "Righe di riferimento EN:"}
${persona.few_en.map(s => `• ${s}`).join("\n")}
`.trim();

    const user = `
Mirror opening (paraphrase naturally): "${mirror}".

User question: "${domanda}"
Details: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (isEn(lang) ? "none" : "nessuno")}

Write ${stile==="wtf" ? "8–10 very short sarcastic lines" : "8–12 short warm predictive lines"}, ~180 words max.
No bullet lists. No direct questions. Keep it concrete and current.
Close with ONE line in the spirit of: "${closing}" (vary wording).
`.trim();

    const temperature = stile === "wtf" ? 0.95 : 0.85;
    const doStream = stream || String(req.headers["x-whatif-stream"] || "") !== "";

    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const s = await client.chat.completions.create({
        model: MODEL_TEXT,
        temperature,
        stream: true,
        max_tokens: 700,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      });

      for await (const chunk of s) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    const c = await client.chat.completions.create({
      model: MODEL_TEXT,
      temperature,
      max_tokens: 700,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });
    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text });

  } catch (err) {
    console.error("API /ask error:", err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
