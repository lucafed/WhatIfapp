// /api/ask.js
import OpenAI from "openai";

/* ================== Setup ================== */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ================== Utils ================== */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function detectLang(text = "") {
  const enHits = (text.match(/\b(what|if|and|or|you|should|would|move|work|buy|motor|bike|city|how|why)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|moto|tornassi|trasfer|lavor|comprare|acquistare|città)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

function classifyTopic(q = "") {
  const s = q.toLowerCase();
  if (/(moto|motor(e|bike)|scooter|vespa)/.test(s)) return "moto";
  if (/(barca|vela|gommone|yacht|boat)/.test(s)) return "barca";
  if (/(tornassi|trasferi|trasloco|vivere a|move|relocat)/.test(s)) return "trasferimento";
  if (/(l'aquila|aquila|lugano|milano|roma|verona|bussolengo|londra|zurigo)/.test(s)) return "città";
  if (/(lavoro|job|ricercatore|azienda|ufficio|work)/.test(s)) return "lavoro";
  if (/(comprare|acquistare|buy|purchase)/.test(s)) return "acquisto";
  return "generale";
}

function todayInfo(lang) {
  const d = new Date();
  const loc = isEn(lang) ? "en-GB" : "it-IT";
  const weekday = d.toLocaleDateString(loc, { weekday: "long" });
  const date = d.toLocaleDateString(loc, { day: "2-digit", month: "long", year: "numeric" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${weekday}, ${date} • ${hh}:${mm}`;
}

/* ================== Mirror line ================== */
function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0] || "";
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const base = en
    ? [
        name ? `${name}, you don’t chase noise — you chase signal.` : "You don’t chase noise — you chase signal.",
        city ? `${city} steadies you when things spin too fast.` : "A familiar base steadies you when things spin too fast.",
        role ? `In ${role}, purpose beats prestige for you.` : "Purpose beats prestige for you."
      ]
    : [
        name ? `${name}, non cerchi rumore: cerchi segnali.` : "Non cerchi rumore: cerchi segnali.",
        city ? `${city} ti raddrizza quando tutto corre troppo.` : "Una base familiare ti raddrizza quando tutto corre troppo.",
        role ? `Nel tuo lavoro (${role}) il perché vince sul prestigio.` : "Nel lavoro, il perché vince sul prestigio."
      ];
  return pick(base);
}

/* ================== Clarify (sempre legato alla domanda) ================== */
function extractKeywords(q = "") {
  const tokens = q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const stop = new Set(["e","ed","di","a","da","in","con","su","per","tra","fra","the","and","of","to","for"]);
  const freq = {};
  tokens.forEach(w => { if (!stop.has(w) && w.length > 2) freq[w] = (freq[w] || 0) + 1; });
  return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0]);
}

function clarifyQuestions(domanda, periodo, lang = "it") {
  const en = isEn(lang);
  const topic = classifyTopic(domanda);
  const hints = extractKeywords(domanda);
  const key = (i, def) => hints[i] ? hints[i] : def;

  const Q = (id, it, enStr, phIt, phEn) => ({
    id, label: en ? enStr : it, placeholder: en ? phEn : phIt
  });

  // Base mirata per topic
  if (topic === "moto") {
    return [
      Q("timing", "Quando la prenderesti davvero?", "When would you actually buy it?", "questo mese / 3–6 mesi", "this month / 3–6 months"),
      Q("use", "Uso principale?", "Main use?", "casa-lavoro / weekend / viaggi", "commute / weekends / trips"),
      Q("budget", "Tetto mensile realistico?", "Real monthly ceiling?", "assicurazione + carburante", "insurance + fuel")
    ];
  }
  if (topic === "città" || topic === "trasferimento") {
    return [
      Q("window", "Finestra realistica per lo spostamento?", "Real window to move?", "entro 3 mesi / 6–12 mesi", "within 3 months / 6–12 months"),
      Q("anchor", "Cosa ti tiene dove sei ora?", "What anchors you now?", "famiglia / lavoro / costi", "family / work / costs"),
      Q("signal", "Segnale che direbbe: è giusto?", "Signal that says: it’s right?", "energia/sonno/una risposta", "energy/sleep/a callback")
    ];
  }
  if (topic === "lavoro") {
    return [
      Q("why", "Il tuo perché oggi?", "Your current why?", "impatto / crescita / serenità", "impact / growth / calm"),
      Q("option", "Opzioni sul tavolo?", "Options on the table?", "restare / cambiare team / uscire", "stay / switch team / leave"),
      Q("limit", "Vincolo più concreto?", "Hardest constraint?", "budget/tempo/relazioni", "budget/time/people")
    ];
  }

  // Generale ma contestuale alla domanda
  return [
    Q("time_window",
      `Finestra decisionale reale su “${key(0, "il tema")}”?`,
      `Real decision window for “${key(0, "the topic")}”?`,
      "questo mese / 3–6 / 12 mesi", "this month / 3–6 / 12 months"),
    Q("success_indicator",
      `Un indicatore di successo legato a “${key(1, "la scelta")}”?`,
      `One success indicator tied to “${key(1, "the choice")}”?`,
      "prima risposta / € / ore", "first reply / € / hours"),
    Q("constraint",
      `Un vincolo concreto da rispettare su “${key(2, "la mossa")}”?`,
      `One concrete constraint you must respect for “${key(2, "the move")}”?`,
      "budget / tempo / energia", "budget / time / energy")
  ];
}

/* ================== PERSONAS (toni definitivi) ================== */
function systemFor(style, lang) {
  const en = isEn(lang);
  const header =
`${en ? "You are" : "Sei"} What?f / What the F.
${en ? "Date" : "Oggi"}: ${todayInfo(lang)}

Hard rules:
- ${en ? "Reply ONLY in" : "Rispondi SOLO in"} ${en ? "English" : "Italiano"}.
- ${en ? "Stay on the inferred topic" : "Resta nel tema inferito"}.
- ${en ? "No bullet lists; one voice; second person." : "Niente elenchi; una sola voce; seconda persona."}
- ${en ? "Use the user’s name naturally if provided; never overdo it." : "Usa il nome in modo naturale se presente; mai forzare."}
- ${en ? "Keep it upbeat, zero melancholy." : "Tono positivo, zero malinconia."}
- ${en ? "End with a gentle cliffhanger that implies the story continues tomorrow and hints that tomorrow we’ll ask 2 small follow-ups." : "Chiudi con un cliffhanger dolce che fa capire che la storia continua domani e che domani ti farò 2 piccole domande di follow-up."}
`;

  if (style === "wtf") {
    // What the F — bar, ubriaco, ironico ma affettuoso
    return header + `
Persona: "What the F" — witty late-night bartender, tipsy but lucid, never mean.
Style:
- 7–11 righe, frasi brevi, ritmo da bancone, battute intelligenti; allegro, caloroso.
- Zero acidità, zero tristezza. Divertente, confidenziale ("oh amico", soprannomi leggeri).
- Piccola immagine concreta ok (1–2 max). Niente lirismi.
- Sembra che conosci l’utente da tempo: riferimenti plausibili, mai invadenti.

Approved examples to imitate (Italiano):
— “Tornare all’Aquila? Grande mossa: aria fresca, montagne gratis e caffè che sa di chiacchiera vera… Clink.”
— “Certo, torna. Aria pulita, ritmi lenti… Però c’è quel momento: tra il secondo caffè e la pioggia…”
— “Sì, l’Aquila: città dove anche il vento ha l’abbonamento mensile.”

Closing vibe examples (don’t copy verbatim, vary them):
— “Domani ti racconto cosa succede quando ti fermi davvero in piazza.”
— “Continuiamo qui domani: stessa sedia, altra storia.”
`;
  }

  // What?f — empatico, asciutto, positivo, amico intelligente
  return header + `
Persona: "What?f" — calm, clear, quietly perceptive friend; optimistic, practical.
Style:
- 9–13 frasi, asciutte ma vive. Zero poesia smielata, zero malinconia.
- Tono empatico, un po’ brillante, fa venire voglia di provarci.
- Sembra che ti conosca: dettagli plausibili (routine, ritmi, abitudini), mai invadenti.
- Mostra una scena credibile, poi un piccolo passo successivo.

Approved examples to imitate (Italiano):
— “Non lo faresti per scappare, ma per respirare meglio… Hai già girato la chiave, il resto prende forma domani.”
— “Ti serve ogni tanto tornare dove le giornate hanno il ritmo giusto… Non è nostalgia, è equilibrio che torna.”
— “La domanda vera non è ‘torno?’ ma ‘sono pronto a restare?’… Continua domani.”

Closing vibe examples (don’t copy verbatim, vary them):
— “Domani ti faccio due domande e vediamo dove porta.”
— “La storia continua domani: un passo e capiamo il resto.”
`;
}

/* ================== Follow-ups coerenti ================== */
function followupPrompt(lang, domanda, answer, style) {
  const en = isEn(lang);
  const ask = en ? "Propose exactly 2 short follow-up questions" : "Proponi esattamente 2 domande brevi di follow-up";
  const tone = style === "wtf"
    ? (en ? "Bartender witty tone, playful." : "Tono da barista brillante, giocoso.")
    : (en ? "Empathic, upbeat, concise." : "Empatico, positivo, conciso.");
  return `
${ask} tied to the user's question and to the answer’s content.
They must help continue tomorrow’s episode.
${tone}
Return JSON: {"followups":["q1","q2"]}

Question: "${domanda}"
Answer excerpt: "${(answer||"").slice(0,400)}"
`.trim();
}

/* ================== HTTP handler ================== */
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
      lang: langIn = "auto",
      periodo = "future",
      stile = "whatif",
      stream = false,
      clarify = false,
      profilo = {},
      clarifications = [],
      extra = ""
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // lingua & topic
    const lang = langIn === "auto" ? detectLang(domanda) : langIn;
    const en = isEn(lang);
    const topic = classifyTopic(domanda);

    // ----- Clarify branch -----
    if (clarify) {
      // domande strettamente legate alla domanda (no random)
      const qs = clarifyQuestions(domanda, periodo, lang);
      return res.status(200).json({ questions: qs });
    }

    // ----- Generation branch -----
    const system = systemFor(stile === "wtf" ? "wtf" : "whatif", lang);

    const mirror = mirrorLine(profilo, lang);

    // user instruction
    const closingHint = en
      ? `Close with a gentle cliffhanger like “Tomorrow I’ll ask two quick things and we push the story forward.”`
      : `Chiudi con un cliffhanger tipo “Domani ti faccio due domande veloci e spingiamo avanti la storia.”`;

    const userMsg = `
${en ? "Mirror-opening (paraphrase this naturally):" : "Apertura-specchio (parafrasa con naturalezza):"} "${mirror}"

${en ? "User question" : "Domanda utente"}: "${domanda}"
${en ? "Context" : "Contesto"}: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (en ? "none" : "nessuno")}
${en ? "Topic to honor" : "Tema da rispettare"}: ${topic}

Constraints:
- ${stile === "wtf"
  ? (en
    ? "7–11 short lively lines; witty, playful, tipsy-but-kind bartender; zero sadness; no bullets."
    : "7–11 righe vive; barista brillante e un po’ alticcio ma affettuoso; zero tristezza; niente elenchi.")
  : (en
    ? "9–13 concise, upbeat sentences; empathetic, practical; zero melancholy; no bullets."
    : "9–13 frasi asciutte e positive; empatico, pratico; zero malinconia; niente elenchi.")
}
- ${en ? "Sound like you know the user (light, plausible details)." : "Suona come se lo conoscessi (dettagli plausibili, leggeri)."}
- ${closingHint}
`.trim();

    const temperature = stile === "wtf" ? 0.95 : 0.82;
    const max_tokens = 700;

    // Streaming SSE?
    const doStream = stream || String(req.headers["x-whatif-stream"] || "") !== "";
    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const s = await client.chat.completions.create({
        model: MODEL,
        temperature,
        max_tokens,
        stream: true,
        messages: [
          { role: "system", content: system + (extra ? `\nAdditional guidance:\n${extra}` : "") },
          { role: "user", content: userMsg }
        ]
      });

      for await (const chunk of s) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // Non-stream: genera testo + followups coerenti
    const c = await client.chat.completions.create({
      model: MODEL,
      temperature,
      max_tokens,
      messages: [
        { role: "system", content: system + (extra ? `\nAdditional guidance:\n${extra}` : "") },
        { role: "user", content: userMsg }
      ]
    });

    const text = (c.choices?.[0]?.message?.content || "").trim();

    // Follow-ups (2) in JSON
    let followups = [];
    try {
      const f = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 120,
        messages: [
          { role: "system", content: isEn(lang)
              ? "You generate tiny JSON objects only."
              : "Generi solo piccoli oggetti JSON." },
          { role: "user", content: followupPrompt(lang, domanda, text, stile) }
        ]
      });
      const raw = (f.choices?.[0]?.message?.content || "").trim();
      const j = JSON.parse(raw);
      if (Array.isArray(j.followups)) {
        followups = j.followups.slice(0,2).map(x => String(x).trim()).filter(Boolean);
      }
    } catch {
      // fallback minimale
      if (isEn(lang)) {
        followups = [
          "What small sign tomorrow would tell you this is right?",
          "What constraint would you ignore for a week to test it?"
        ];
      } else {
        followups = [
          "Quale segnale domani ti direbbe che è la direzione giusta?",
          "Quale vincolo ignoreresti per una settimana per testarlo?"
        ];
      }
    }

    return res.status(200).json({ answer: text, lang, topic, followups });

  } catch (err) {
    console.error("API /ask error:", err?.message || err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
                             }
