// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ========= Utils ========= */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function detectLang(text = "") {
  const enHits = (text.match(/\b(what|if|and|or|you|should|would|move|work|buy|motor|bike|city)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|moto|tornassi|trasferir|lavor|comprare|acquistare)\b/gi) || []).length;
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

/* ========= Persona & stile ========= */
const PERSONAS = {
  whatif: {
    system: (lang) =>
      isEn(lang)
        ? `
You are "What?f": empathetic, upbeat, lightly intellectual.
Second person, single voice. 9–12 short, clear sentences (~170–210 words).
No melancholy, no coaching clichés. Present, concrete, gently forward-looking.
Make it feel like you know the user (naturally), not forced.
Always end with a soft episodic hook that implies tomorrow continues the same story.
Reply ONLY in English.`
        : `
Sei "What?f": empatica, asciutta, brillante (leggermente “intellettuale”).
Seconda persona, una voce. 9–12 frasi brevi e chiare (~170–210 parole).
Zero malinconia, zero cliché da coach. Presente, concreto, con brio e fiducia.
Fai sentire che conosci l’utente (in modo naturale), mai forzato.
Chiudi sempre con un gancio morbido che fa capire che la storia continua domani.
Rispondi SOLO in Italiano.`
  },
  wtf: {
    system: (lang) =>
      isEn(lang)
        ? `
You are "What the F": witty late-night bartender — tipsy, warm, irreverent, never mean.
Single voice, punchy rhythm. 7–11 lines, ≤18 words per line.
Make the user laugh; use clever, friendly sarcasm (no bitterness). A little “boozy wisdom”.
Close with a playful serial hook that promises tomorrow continues the same scene.
Reply ONLY in English.`
        : `
Sei "What the F": barista notturno — brillante, un po’ alticcio, irriverente ma affettuoso.
Una voce, ritmo secco. 7–11 righe, max 18 parole per riga.
Fai ridere con sarcasmo intelligente e caldo (mai acido). Un po’ di “saggezza ubriaca”.
Chiudi con un gancio giocoso che promette che domani la scena prosegue.
Rispondi SOLO in Italiano.`
  }
};

/* ========= Mirror (frase-specchio) ========= */
function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const it = [
    name ? `${name}, non ti muovi per capriccio: cerchi coerenza.` : "Non ti muovi per capriccio: cerchi coerenza.",
    city ? `${city ti ? "" : ""}` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il perché resta acceso.` : "Reggi finché il perché resta acceso."
  ].filter(Boolean);
  const enPool = [
    name ? `${name}, you don’t move on whims — you chase coherence.` : "You don’t move on whims — you chase coherence.",
    city ? `${city} grounds you, but you still need an open window.` : "You like a solid base and one open window.",
    role ? `In ${role}, you keep pace while the “why” stays lit.` : "You keep pace while the “why” stays lit."
  ];
  return pick(en ? enPool : it);
}

/* ========= Episodic closings ========= */
function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const itSoft = [
    "Domani riprendiamo da qui: vediamo come si muove davvero la tua storia.",
    "Teniamo il filo: domani capiamo il passo successivo senza strappi.",
    "Lascia il segnalibro qui: domani aggiungiamo il capitolo giusto."
  ];
  const itSharp = [
    "Domani non cambiamo bar: continuiamo lo stesso brindisi, stessa storia.",
    "Tieni il bicchiere: domani capiamo dove porta questo giro.",
    "Non chiudere il conto: domani prosegue da qui, non altrove."
  ];
  const enSoft = [
    "Tomorrow we pick up right here — same thread, one step forward.",
    "Hold the thread; tomorrow we nudge this exact story.",
    "Bookmark this spot; tomorrow we add the next beat."
  ];
  const enSharp = [
    "Same bar tomorrow — same story, next pour.",
    "Keep the tab open; tomorrow we push this scene.",
    "Don’t close the check; tomorrow continues right here."
  ];
  return style === "wtf" ? pick(en ? enSharp : itSharp) : pick(en ? enSoft : itSoft);
}

/* ========= Clarify questions (leggere e contestuali) ========= */
function clarifyQuestions(domanda, periodo, lang = "it") {
  const en = isEn(lang);
  const topic = classifyTopic(domanda);
  const Q = (id, it, enStr, phIt, phEn) => ({
    id, label: en ? enStr : it, placeholder: en ? phEn : phIt
  });

  if (topic === "moto") {
    return [
      Q("timing", "Quando la prenderesti davvero?", "When would you actually buy it?", "questo mese / 3–6 mesi", "this month / 3–6 months"),
      Q("use", "Uso principale?", "Main use?", "casa-lavoro / weekend / viaggi", "commute / weekends / trips"),
      Q("budget", "Tetto di spesa mensile?", "Monthly budget ceiling?", "€ assicurazione + carburante", "$ insurance + fuel")
    ];
  }
  if (topic === "trasferimento" || topic === "città") {
    return [
      Q("window", "Finestra realistica per lo spostamento?", "Real window to move?", "entro 3 mesi / 6–12 mesi", "within 3 months / 6–12 months"),
      Q("anchor", "Cosa ti tiene dove sei ora?", "What anchors you now?", "famiglia / lavoro / costi", "family / work / costs"),
      Q("signal", "Segno che direbbe: è giusto?", "Sign that says: it’s right?", "energia/risposte/sonno", "energy/callback/sleep")
    ];
  }
  if (topic === "lavoro") {
    return [
      Q("why", "Il tuo perché oggi?", "Your current why?", "impatto / crescita / serenità", "impact / growth / calm"),
      Q("option", "Opzioni sul tavolo?", "Options on the table?", "restare / cambiare team / uscire", "stay / switch team / leave"),
      Q("limit", "Vincolo più concreto?", "Hardest constraint?", "budget/tempo/relazioni", "budget/time/people")
    ];
  }
  return [
    Q("window", "Finestra reale della decisione?", "Real decision window?", "questo mese / 3–6 / 12 mesi", "this month / 3–6 / 12 months"),
    Q("signal", "Segno personale da osservare?", "Personal sign to watch?", "energia/prima risposta/sonno", "energy/first reply/sleep"),
    Q("limit", "Limite più concreto?", "Most concrete limit?", "budget/tempo/energia", "budget/time/energy")
  ];
}

/* ========= FOLLOW-UP builder prompt ========= */
function followupInstruction(lang, stile, closing) {
  const en = isEn(lang);
  return en
    ? `
After you write the answer in the requested persona and tone,
also craft two *tailored* follow-up questions, strictly derived from BOTH:
- the user's question, and
- the content of your answer you just wrote.

The two follow-ups must be:
1) Reflective (personal insight, concrete but not therapy).
2) Actionable (a single specific next step the user could try within 7 days).

Output format (MANDATORY):
<<ANSWER>>
[the answer only; no bullets, no lists]
<<FOLLOWUPS>>
- [Reflective follow-up, one line]
- [Actionable follow-up, one line]
<<CLOSING>>
${closing}
`.trim()
    : `
Dopo aver scritto la risposta nel tono/persona richiesti,
genera anche due *follow-up* su misura, derivati strettamente da:
- la domanda dell’utente, e
- ciò che hai appena scritto nella tua risposta.

I due follow-up devono essere:
1) Riflessivo (intuizione personale, concreto ma non terapeutico).
2) Azionabile (un passo specifico da provare entro 7 giorni).

Formato di output (OBBLIGATORIO):
<<ANSWER>>
[solo la risposta; niente elenchi]
<<FOLLOWUPS>>
- [Follow-up riflessivo, una riga]
- [Follow-up azionabile, una riga]
<<CLOSING>>
${closing}
`.trim();
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

    const lang = langIn === "auto" ? detectLang(domanda) : langIn;
    const en = isEn(lang);
    const topic = classifyTopic(domanda);

    if (clarify) {
      return res.status(200).json({ questions: clarifyQuestions(domanda, periodo, lang) });
    }

    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const closing = episodicClosing(stile, lang);
    const system = `
${persona.system(lang).trim()}

${followupInstruction(lang, stile, closing)}

Today: ${todayInfo(lang)}
Hard rules:
- Reply ONLY in ${en ? "English" : "Italiano"}.
- Stay on the inferred topic: "${topic}".
- No lists/bullets inside <<ANSWER>>; follow-ups must be exactly 2 lines under <<FOLLOWUPS>>.
- Sound naturally familiar with the user (use name if profile.name exists).
- Keep imagery minimal; be concrete and upbeat; zero melancholy for What?f; friendly sarcasm for What the F.
${extra ? `\nAdditional guidance (comply):\n${extra}\n` : ""}
`.trim();

    const mirror = mirrorLine(profilo, lang);
    const user = `
${en ? "Mirror-opening" : "Apertura-specchio"} (libera): "${mirror}"

${en ? "User question" : "Domanda utente"}: "${domanda}"
${en ? "Extra details" : "Dettagli"}: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (en ? "none" : "nessuno")}
${en ? "Topic to honor" : "Tema da rispettare"}: ${topic}

Write the answer inside the <<ANSWER>> block, then the follow-ups inside <<FOLLOWUPS>>, then <<CLOSING>>.
`.trim();

    // Per garantire FOLLOWUPS pertinenti, usiamo NON-STREAM (così possiamo fare parsing sicuro)
    const c = await client.chat.completions.create({
      model: MODEL_TEXT,
      temperature: stile === "wtf" ? 0.9 : 0.82,
      max_tokens: 800,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const raw = c.choices?.[0]?.message?.content || "";
    const answer = (raw.match(/<<ANSWER>>([\s\S]*?)<<FOLLOWUPS>>/i)?.[1] || "").trim();
    const fblock = (raw.match(/<<FOLLOWUPS>>([\s\S]*?)<<CLOSING>>/i)?.[1] || "").trim();
    const closingOut = (raw.match(/<<CLOSING>>([\s\S]*)$/i)?.[1] || "").trim();

    const followups = fblock
      .split("\n")
      .map(s => s.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 2);

    return res.status(200).json({
      answer: answer || raw.trim(),
      followups: followups.length ? followups : [],
      closing: closingOut || closing,
      lang,
      topic,
      style: stile
    });

  } catch (err) {
    console.error("API /ask error:", err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
