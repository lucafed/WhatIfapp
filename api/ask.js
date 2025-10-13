// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Modello leggero ma “frizzante”; puoi alzare a gpt-4o se vuoi ancora più controllo
const MODEL_TEXT = "gpt-4o-mini";

/* ========= Helpers base ========= */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function detectLang(text = "") {
  const enHits = (text.match(/\b(what|if|and|or|you|should|would|move|work|buy|motor|bike|city)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|moto|tornassi|trasferir|lavor|comprare|acquistare|aquila|verona)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

function classifyTopic(q = "") {
  const s = q.toLowerCase();
  if (/(moto|motor(e|bike)|scooter|vespa)/.test(s)) return "moto";
  if (/(barca|vela|gommone|yacht|boat)/.test(s)) return "barca";
  if (/(tornassi|trasferi|trasloco|vivere a|move|relocat)/.test(s)) return "trasferimento";
  if (/(aquila|l'aquila|milano|roma|verona|lugano|londra|zurigo|bussolengo)/.test(s)) return "città";
  if (/(lavoro|job|ricercatore|azienda|ufficio|work|carriera)/.test(s)) return "lavoro";
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

/* ========= “Mirror” (frase che fa sentire capito) ========= */
function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const itPool = [
    name ? `${name}, non scegli a caso: scegli quando senti senso.` : "Non scegli a caso: scegli quando senti senso.",
    city ? `${city} ti tiene a terra, ma ti serve anche aria nuova.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il “perché” resta acceso.` : "Reggi finché il “perché” resta acceso."
  ];
  const enPool = [
    name ? `${name}, you don’t move on whims—you move for meaning.` : "You don’t move on whims—you move for meaning.",
    city ? `${city} grounds you, but you still need fresh air.` : "You like a solid base and one open window.",
    role ? `In ${role}, you hold as long as the “why” stays lit.` : "You hold as long as the “why” stays lit."
  ];
  return pick(en ? enPool : itPool);
}

/* ========= Chiusure seriali (zero malinconia) ========= */
function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const itSoft = [
    "Domani ti faccio due domande: capiamo chi stai diventando e dove va la storia.",
    "Continuiamo domani: ti mostro dove porta questo passo, senza giri lunghi.",
    "Teniamo il filo: domani vediamo come si muove davvero la tua storia."
  ];
  const itSharp = [
    "Domani vediamo fin dove ti spinge questa voglia: stessa storia, prossimo episodio.",
    "Tienimi il posto al bancone: domani capiamo dove stai andando davvero.",
    "Non chiudo il conto: domani ti dico cosa succede quando acceleri."
  ];
  const enSoft = [
    "Tomorrow I’ll ask two sharp questions and we’ll see where this story goes.",
    "Let’s keep the thread: tomorrow we see the next move, no fluff.",
    "Come back tomorrow: I’ll show you where this choice tends to lead."
  ];
  const enSharp = [
    "Same bar, next episode tomorrow — let’s see how far you push this.",
    "Keep the tab open: tomorrow I’ll tell you what happens when you floor it.",
    "Park it here; tomorrow we see where you really head."
  ];
  return style === "wtf" ? pick(en ? enSharp : itSharp) : pick(en ? enSoft : itSoft);
}

/* ========= Clarify (2–3 micro) ========= */
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
      Q("budget", "Tetto di spesa mensile?", "Monthly budget ceiling?", "€ assicurazione + carburante", "$ insurance + fuel")
    ];
  }
  if (topic === "trasferimento" || topic === "città") {
    return [
      Q("window", "Finestra realistica per spostarti?", "Real window to move?", "entro 3 mesi / 6–12 mesi", "within 3 months / 6–12 months"),
      Q("anchor", "Cosa ti tiene dove sei adesso?", "What anchors you now?", "famiglia / lavoro / costi", "family / work / costs"),
      Q("signal", "Segno che direbbe “è giusto”?", "A sign that says “it’s right”?", "sonno/energia/risposte", "sleep/energy/callback")
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
    Q("signal", "Segno personale da osservare?", "Personal sign to watch?", "sonno/energia/prima risposta", "sleep/energy/first reply"),
    Q("limit", "Limite più concreto?", "Most concrete limit?", "budget/tempo/energia", "budget/time/energy")
  ];
}

/* ========= PERSONAS con esempi (per bloccare il tono) ========= */
const PERSONAS = {
  whatif: {
    system: (lang) => {
      const en = isEn(lang);
      // ESEMPI: mantengono ritmo realistico, zero malinconia, gancio “continua domani”
      const EXEMPLAR_IT = `
Esempi di stile What?f (empatico, lucido, non poetico, conosce l'utente):
- “Non lo faresti per scappare: lo faresti per vedere chi sei diventato con un'altra mappa.”
- “All'Aquila sentirai aria onesta e occhi familiari, ma il passo lo fai per curiosità, non per nostalgia.”
- “Ti serve una base solida e una finestra aperta: prima metti il primo mattone, poi guardi fuori.”
Chiusure tipiche: “Domani ti faccio due domande…”, “Teniamo il filo: domani vediamo dove porta.”
`.trim();

      const EXEMPLAR_EN = `
What?f exemplars (warm, clear, grounded, not poetic):
- “You wouldn’t move to escape; you’d move to check who you’ve become on a new map.”
- “You need a solid base and one open window; build the base, then look out.”
Closings: “Tomorrow I’ll ask two questions…”, “We’ll keep the thread tomorrow.”
`.trim();

      return en
        ? `
You are "What?f": warm, clear, quietly perceptive — never melancholic, never flowery.
Rules:
- Second person, single voice; 9–13 sentences, natural rhythm (not choppy).
- Make it feel like you KNOW the user (without saying “I know you”).
- Concrete, current, lightly cinematic; 0–2 small images; NO lists.
- No moralizing, no sadness: upbeat clarity.
- End with a serial hook about tomorrow (e.g., micro-questions / next step).
${EXEMPLAR_EN}
Reply ONLY in English.
`.trim()
        : `
Sei "What?f": caldo, chiaro, percettivo — mai malinconico, mai sdolcinato.
Regole:
- Seconda persona, una sola voce; 9–13 frasi a ritmo naturale (non spezzatine).
- Deve sembrare che lo conosci già (senza dirlo esplicitamente).
- Concreto, attuale, leggermente cinematografico; 0–2 micro immagini; NO elenchi.
- Zero morale, zero tristezza: chiarezza positiva.
- Chiudi con un gancio seriale su domani (micro-domande / prossimo passo).
${EXEMPLAR_IT}
Rispondi SOLO in Italiano.
`.trim();
    }
  },

  wtf: {
    system: (lang) => {
      const en = isEn(lang);
      const EXEMPLAR_IT = `
Esempi di stile What the F (sarcastico, “alcolico”, brillante ma affettuoso):
- “Tornare all’Aquila? Perfetto: almeno il freddo è sincero e il vino non ti giudica.”
- “Moto a marzo? Geniale: vento in faccia, conti in palestra. Ma il sorriso… quello resta.”
- “Verona ti fa l'aperitivo; all'Aquila paghi meno e chiudi il conto del dubbio.”
Chiusure tipiche: “Domani vediamo fin dove ti spinge…”, “Tienimi il posto al bancone: domani arriva la parte buona.”
`.trim();

      const EXEMPLAR_EN = `
What the F exemplars (witty, boozy, sharp yet kind):
- “Move back? Perfect: at least the cold is honest and the wine is affordable.”
- “A bike in March? Great: wind slap, louder grin.”
Closings: “Same bar, next episode tomorrow.”
`.trim();

      return en
        ? `
You are "What the F": late-night witty bartender. Funny, punchy, a bit boozy, never mean.
Rules:
- Second person, single voice; 7–11 full sentences (natural flow, not chopped).
- Make them LAUGH and feel known; playful jabs, affectionate truth.
- Zero lists. No advice. Zingers allowed, not cruel.
- End with a serial hook about tomorrow’s follow-up.
${EXEMPLAR_EN}
Reply ONLY in English.
`.trim()
        : `
Sei "What the F": barista nottambulo, brillante, un filo “alcolico”, mai cattivo.
Regole:
- Seconda persona, una voce; 7–11 frasi compiute (flusso naturale, non spezzatini).
- Fai RIDERE e sentire capiti; frecciate affettuose, mai cinico.
- Niente elenchi. Niente consigli operativi. Battute sì, ma umane.
- Chiudi con un gancio seriale su domani.
${EXEMPLAR_IT}
Rispondi SOLO in Italiano.
`.trim();
    }
  }
};

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
      // profilo e clarifications li teniamo ma NON ci basiamo su “ancore” invadenti
      profilo = {},
      clarifications = []
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // lingua: auto o forzata
    const lang = langIn === "auto" ? detectLang(domanda) : langIn;
    const en = isEn(lang);
    const topic = classifyTopic(domanda);

    /* ----- Clarify branch ----- */
    if (clarify) {
      return res.status(200).json({ questions: clarifyQuestions(domanda, periodo, lang) });
    }

    /* ----- Generation branch ----- */
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const system = `
${persona.system(lang).trim()}

Today: ${todayInfo(lang)}
Hard rules:
- Reply ONLY in ${en ? "English" : "Italiano"}.
- Stay on topic inferred from the question: "${topic}".
- No lists/bullets. No direct questions before the last line.
- Keep it upbeat; zero melancholy.
- Final line must be a SERIAL HOOK about tomorrow (micro-steps or follow-up).
`.trim();

    const mirror = mirrorLine(profilo, lang);
    const closing = episodicClosing(stile, lang);

    // Testo utente + contesto
    const user = `
${en ? "Mirror-opening" : "Apertura-specchio"} (parafrasa liberamente): "${mirror}"

${en ? "User question" : "Domanda utente"}: "${domanda}"
${en ? "Extra hints" : "Indicazioni extra"}: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (en ? "none" : "nessuno")}
${en ? "Topic to honor" : "Tema da rispettare"}: ${topic}

${en
  ? `Write ${stile === "wtf" ? "7–11 full sentences" : "9–13 full sentences"}, natural flow, single voice, second person.
No lists, no numbered tips, no melancholy. Make it feel like you know them.
End with a serial hook like: "${closing}".`
  : `Scrivi ${stile === "wtf" ? "7–11 frasi piene" : "9–13 frasi piene"}, flusso naturale, una sola voce, seconda persona.
Niente elenchi, niente consigli numerati, zero malinconia. Fai sentire che lo conosci.
Chiudi con un gancio seriale tipo: "${closing}".`
}
`.trim();

    const temperature = stile === "wtf" ? 0.95 : 0.85;

    // Stream SSE
    const doStream = stream || String(req.headers["x-whatif-stream"] || "") !== "";
    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const s = await client.chat.completions.create({
        model: MODEL_TEXT,
        temperature,
        stream: true,
        max_tokens: 800,
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

    // Non-stream
    const c = await client.chat.completions.create({
      model: MODEL_TEXT,
      temperature,
      max_tokens: 800,
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
