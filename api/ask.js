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
  if (/(lugano|aquila|l'aquila|milano|roma|verona|bussolengo|londra|zurigo)/.test(s)) return "città";
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
You are "What?f": empathetic, lucid, intimate — never poetic.
Your job: show a concrete mini-scene the user can *see*, then end with a soft emotional cliffhanger.
Strict format:
- 9–13 short sentences, one per line. No lists. No bullets.
- No recommendations, no how-to, no logistics (no apartments, contracts, job search) unless explicitly asked.
- No nostalgia aura, no sentimental clichés (no "sunset", "perfume of air", "mountains watching you").
- Keep imagery tiny (0–2 micro-details), grounded and current.
- Sound like you *know* the user without saying it; use a gentle mirror at the start.
- End with a sweet serial hook (one line), not a question.

Examples of tone:
"You wake up earlier than you admit. Coffee first, then that idea that won’t sit still."
"You don’t chase noise; you choose where silence works for you."
"At the third message, you smile — like you expected it. It’s not luck; it’s you moving."
Cliffhanger closers:
"Domani lo capirai meglio, proprio lì."
"Hai già girato la chiave; senti come prende."
"La prossima parte non la vuoi perdere."

Reply ONLY in Italian.`
        : `
Sei "What?f": empatica, lucida, intima — mai poetica.
Mostra una mini-scena concreta che l’utente può *vedere*, poi chiudi con un cliffhanger emotivo.
Formato obbligatorio:
- 9–13 frasi brevi, una per riga. Niente elenchi.
- Niente consigli pratici o logistica (case, contratti, lavoro) se non richiesti nella domanda.
- Bandite parole/immagini da cartolina: “profumo d’aria”, “tramonto”, “montagne che ti guardano”, “nostalgia”.
- 0–2 micro-dettagli plausibili, attuali.
- Suona come se lo conoscessi, senza dirlo esplicitamente; piccola apertura-specchio.
- Chiudi con un gancio dolce, non una domanda.

Esempi di tono:
"Ti svegli prima di ammetterlo. Caffè, e quell’idea non sta ferma."
"Non insegui il rumore: scegli dove il silenzio lavora per te."
"Al terzo messaggio sorridi. Non è caso: sei tu che ti muovi."
Ganci finali:
"Domani lo capirai meglio, proprio lì."
"Hai già girato la chiave; senti come prende."
"La prossima parte non la vuoi perdere."

Rispondi SOLO in Italiano.`
  },
  wtf: {
    system: (lang) =>
      isEn(lang)
        ? `
You are "What the F": brutally sarcastic, late-night witty bartender. Make the user *laugh out loud*.
Format:
- 7–11 punchy lines, ≤15 words each. One line per beat.
- No pep-talks, no poetry, no life coaching.
- Roast gently, never mean; practical quips allowed but no logistics.
- End with a playful serial hook like a bar line.

Examples of tone:
"Moto a marzo? Geniale. Freddo gratis e casco appannato: combo premium."
"Trasloco per serenità? Certo. Dopo tre scatoloni troverai solo la bestemmia zen."
"Vuoi cambiare vita? Perfetto. Inizia dalla sveglia: quella ti odia già."
Hooks:
"Stesso bancone, domani rimescoliamo."
"Lascia il conto aperto: domani un altro giro."

Reply ONLY in Italian.`
        : `
Sei "What the F": sarcastica, tagliente, barista di notte. Fai ridere *forte*.
Formato:
- 7–11 righe secche, max 15 parole. Una riga un colpo.
- Niente discorsi motivazionali o poesia. Zero logistica.
- Prendi in giro con affetto. Battute pratiche ok.
- Chiudi con un gancio da bar.

Esempi di tono:
"Moto a marzo? Geniale. Freddo gratis e casco appannato: combo premium."
"Tornare all’Aquila? Certo. Le zie hanno già preparato il comitato domande."
"Lavoro nuovo? Ottimo. Anche lo stress è in prova ma conferma subito."
Ganci:
"Stesso bancone, domani rimescoliamo."
"Lascia il conto aperto: domani un altro giro."

Rispondi SOLO in Italiano.`
  }
};

/* ========= Mirror (frase-specchio) ========= */
function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const itPool = [
    name ? `${name}, non scegli per capriccio: cerchi senso.` : "Non scegli per capriccio: cerchi senso.",
    city ? `${city} ti tiene a terra, ma ti serve anche un varco d’aria.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il perché resta acceso.` : "Reggi finché il perché resta acceso."
  ];
  const enPool = [
    name ? `${name}, you don’t move on whims—you move for meaning.` : "You don’t move on whims—you move for meaning.",
    city ? `${city} grounds you, but you still need an open window.` : "You like a solid base and one open window.",
    role ? `In ${role}, you keep pace while the “why” stays lit.` : "You keep pace while the “why” stays lit."
  ];
  return pick(en ? enPool : itPool);
}

/* ========= Closings ========= */
function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const itSoft = [
    "Domani lo capirai meglio, proprio lì.",
    "Hai già girato la chiave; senti come prende.",
    "La prossima parte non la vuoi perdere."
  ];
  const itSharp = [
    "Stesso bancone, domani rimescoliamo.",
    "Lascia il conto aperto: domani un altro giro.",
    "Non chiudere: domani si ride di più."
  ];
  const enSoft = [
    "Tomorrow you’ll hear it click, right there.",
    "You’ve already turned the key; feel it catch.",
    "You won’t want to miss the next part."
  ];
  const enSharp = [
    "Same bar, tomorrow we stir again.",
    "Leave the tab open — another round tomorrow.",
    "Don’t close out: tomorrow’s punchline lands."
  ];
  return style === "wtf" ? pick(en ? enSharp : itSharp) : pick(en ? enSoft : itSoft);
}

/* ========= Clarify ========= */
function clarifyQuestions(domanda, periodo, lang = "it") {
  const en = isEn(lang);
  const topic = classifyTopic(domanda);
  const Q = (id, it, enStr, phIt, phEn) => ({
    id,
    label: en ? enStr : it,
    placeholder: en ? phEn : phIt
  });

  if (topic === "moto") {
    return [
      Q("timing", "Quando la prenderesti davvero?", "When would you actually buy it?", "questo mese / 3–6 mesi", "this month / 3–6 months"),
      Q("use", "Uso principale?", "Main use?", "casa-lavoro / weekend / viaggi", "commute / weekends / trips"),
      Q("fear", "Cosa ti frena sul serio?", "What honestly stops you?", "costi / tempo / rischio", "cost / time / risk")
    ];
  }
  if (topic === "trasferimento" || topic === "città") {
    return [
      Q("window", "Finestra realistica?", "Real window?", "entro 3 mesi / 6–12 mesi", "within 3 months / 6–12 months"),
      Q("anchor", "Cosa ti tiene dove sei?", "What anchors you now?", "famiglia / lavoro / costi", "family / work / costs"),
      Q("tell", "Segnale che direbbe ‘è giusto’?", "Sign that says ‘it’s right’?", "energia / sonno / chiamata", "energy / sleep / a call")
    ];
  }
  return [
    Q("window", "Finestra reale della decisione?", "Real decision window?", "questo mese / 3–6 / 12 mesi", "this month / 3–6 / 12 months"),
    Q("signal", "Un segnale da osservare?", "A sign to watch?", "energia / risposta / calma", "energy / reply / calm"),
    Q("limit", "Limite concreto?", "Concrete limit?", "budget / tempo / rischio", "budget / time / risk")
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

    /* ----- Clarify branch ----- */
    if (clarify) {
      return res.status(200).json({ questions: clarifyQuestions(domanda, periodo, lang) });
    }

    /* ----- Generation branch ----- */
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const banned = en
      ? ["poetic","sunset","nostalgia","embrace of the city","mountains watching you","perfume of the air"]
      : ["poetico","tramonto","nostalgia","abbraccio della città","montagne che ti guardano","profumo d’aria","profumo di aria","fiaba"];

    const system = `
${persona.system(lang).trim()}

Today: ${todayInfo(lang)}
Hard rules (must obey):
- Reply ONLY in ${en ? "Italian" : "Italiano"}.
- Topic to honor: "${topic}" — stay strictly on it.
- NEVER invent logistics (case, affitti, contratti, lavoro) unless the question asks for that.
- Avoid banned words/ideas: ${banned.join(", ")}.
- Keep it serial: it must feel like Ep. 1 of a story.

${extra ? `Additional guidance:\n${extra}\n` : ""}
`.trim();

    const mirror = mirrorLine(profilo, lang);
    const closing = episodicClosing(stile, lang);

    const user = `
${en ? "Mirror-opening" : "Apertura-specchio"}: "${mirror}"

${en ? "User question" : "Domanda"}: "${domanda}"
${en ? "Details" : "Dettagli"}: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (en ? "none" : "nessuno")}
${en ? "Write" : "Scrivi"} ${stile === "wtf" ? (en ? "7–11 punchy lines, one per line." : "7–11 righe secche, una per riga.") : (en ? "9–13 short sentences, one per line." : "9–13 frasi brevi, una per riga.")}

End with: "${closing}" (last line). No questions in the last line.`.trim();

    const temperature = stile === "wtf" ? 0.9 : 0.82;
    const doStream = stream || String(req.headers["x-whatif-stream"] || "") !== "";

    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      const s = await client.chat.completions.create({
        model: MODEL_TEXT,
        temperature,
        stream: true,
        max_tokens: 900,
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
      max_tokens: 900,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text, lang, topic });
  } catch (err) {
    console.error("API /ask error:", err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
