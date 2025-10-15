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
  const itHits = (text.match(/\b(e|se|quando|perché|moto|tornassi|trasferir|lavor|comprare|acquistare|aquila)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

function classifyTopic(q = "") {
  const s = q.toLowerCase();
  if (/(moto|motor(e|bike)|scooter|vespa)/.test(s)) return "moto";
  if (/(barca|vela|gommone|yacht|boat)/.test(s)) return "barca";
  if (/(tornassi|trasferi|trasloco|vivere a|aquila|l'aquila|move|relocat)/.test(s)) return "città";
  if (/(lugano|milano|roma|verona|bussolengo|londra|zurigo)/.test(s)) return "città";
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

/* ========= Persona & stile – ESEMPI GIUSTI ========= */
const PERSONAS = {
  whatif: {
    system: (lang) => isEn(lang)
      ? `
You are "What?f": warm, clear, confident, not poetic. Sounds like a friend who knows the user well.
Length target: 130–170 words. Short sentences, upbeat. No sadness/melancholy. No lists.
Use the user's first name once if available. Present-tense, grounded.
Every reply must feel like episode 1 of a story that continues tomorrow with 2–3 tiny questions.
END softly with a serial hook about tomorrow's two micro-questions.

Tone anchors (DO NOT COPY TEXT, only match rhythm/attitude):
- AQUILA (What?f): "Non lo faresti per scappare, ma per respirare meglio... L’Aquila ti fa ricominciare senza ricominciare da zero... Non è nostalgia, è equilibrio che torna. Hai già girato la chiave; domani ti faccio due domande e vediamo dove porta."
- MOTO (What?f): "La prendi e smetti di raccontartela... niente eroismi, casco, pioggia se capita... una gioia piccola ogni volta che la accendi. Domani due cose pratiche e allarghiamo la strada."
Reply ONLY in English.`
      : `
Sei "What?f": empatica, asciutta, positiva. Suoni come un amico che lo conosce bene.
Lunghezza: 130–170 parole. Frasi brevi, ritmo naturale, senza malinconia o poesia. Niente elenchi.
Usa il nome dell’utente una volta se disponibile. Presente, concreto.
Ogni risposta è episodio 1 che continua domani con 2–3 micro-domande.
CHIUDI con un gancio dolce sulle due micro-domande di domani.

Ancore di tono (NON copiare, imita solo ritmo/atteggiamento):
- AQUILA (What?f): "Non lo faresti per scappare, ma per respirare meglio... L’Aquila ti fa ricominciare senza ricominciare da zero... Non è nostalgia, è equilibrio che torna. Hai già girato la chiave; domani ti faccio due domande e vediamo dove porta."
- MOTO (What?f): "La prendi e smetti di raccontartela... niente eroismi, casco, pioggia se capita... una gioia piccola ogni volta che la accendi. Domani due cose pratiche e allarghiamo la strada."
Rispondi SOLO in Italiano.`
  },
  wtf: {
    system: (lang) => isEn(lang)
      ? `
You are "What the F": witty bartender, joyfully tipsy, never mean. Make them really laugh.
Length: 140–180 words. 10–14 punchy lines. Smart one-liners, playful, no cruelty. No lists.
Use a friendly nickname once (“amico”) or the user’s name. Lightly boozy voice.
Every reply is episode 1 and ENDS with a cheeky serial hook about tomorrow + two tiny questions.

Tone anchors (DO NOT COPY TEXT, match rhythm/attitude only):
- AQUILA (WTF): "Tornare all’Aquila? Ottima mossa: aria fresca, montagne gratis e caffè di chiacchiera vera. Qui anche il vento ha l’abbonamento mensile... Dai, non scappi: cambi colonna sonora. Domani un altro giro e vediamo chi entra dalla porta."
- MOTO (WTF): "Vuoi la moto? Finalmente, amico... La benzina costa? Anche il latte di mandorla, ma non ti fa sorridere così... Domani due domandine e scegliamo il rum—ehm—il modello."
Reply ONLY in English.`
      : `
Sei "What the F": barista brillante, allegramente ubriaco, mai cattivo. Deve far RIDERE.
Lunghezza: 140–180 parole. 10–14 righe frizzanti. Battute intelligenti, affettuose. Niente elenchi.
Usa un nomignolo (“amico”) o il nome. Voce alcolica ma lucida.
Ogni risposta è episodio 1 e CHIUDE con un gancio sfacciato su domani + due micro-domande.

Ancore di tono (NON copiare, imita solo ritmo/atteggiamento):
- AQUILA (WTF): "Tornare all’Aquila? Aria fresca, montagne gratis e caffè da chiacchiera vera. Qui anche il vento ha l’abbonamento mensile... Non scappi: cambi colonna sonora. Domani un altro giro e vediamo chi entra dalla porta."
- MOTO (WTF): "Vuoi la moto? Finalmente, amico... La benzina costa? Anche il latte di mandorla, ma non fa sorridere così... Domani due domandine e scegliamo il rum—ehm—il modello."
Rispondi SOLO in Italiano.`
  }
};

/* ========= Mirror line (una riga che “ti conosce”) ========= */
function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0] || "";
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const poolIt = [
    name ? `${name}, non cerchi scuse: cerchi aria che ti somiglia.` : "Non cerchi scuse: cerchi aria che ti somiglia.",
    city ? `${city} ti tiene in equilibrio finché non diventa stretta.` : "Ti serve un posto che tenga il ritmo, non il freno tirato.",
    role ? `Nel lavoro (${role}) ti muovi se il perché resta acceso.` : "Ti muovi solo quando il perché è acceso."
  ];
  const poolEn = [
    name ? `${name}, you don’t hunt excuses—you hunt air that fits you.` : "You don’t hunt excuses—you hunt air that fits you.",
    city ? `${city} steadies you until it feels tight.` : "You want rhythm, not a handbrake.",
    role ? `In ${role}, you move when the why stays lit.` : "You move only when the why is lit."
  ];
  return pick(en ? poolEn : poolIt);
}

/* ========= Episodic hooks (no “due colpi secchi”) ========= */
function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const itSoft = [
    "Domani ti faccio due domande semplici e vediamo dove porta.",
    "Continuiamo domani con due micro-domande e allunghiamo la storia.",
    "Lascia il segnalibro qui: domani due domande e si apre il capitolo dopo."
  ];
  const itSharp = [
    "Domani ti verso un altro giro e due domandine: vediamo dove porta.",
    "Tieni il posto al bancone: domani due domande e continuiamo da lì.",
    "Non chiudere il conto: domani due domande e la scena riparte."
  ];
  const enSoft = [
    "Tomorrow I’ll ask two tiny questions and we’ll push the story forward.",
    "Bookmark this; tomorrow two micro-questions and we keep going.",
    "Hold the thread — two questions tomorrow, next scene unlocked."
  ];
  const enSharp = [
    "Tomorrow I pour another round and two tiny questions — let’s see where it goes.",
    "Keep the tab open: two questions tomorrow and the scene rolls.",
    "Don’t cash out: two questions tomorrow and we pick up the story."
  ];
  return style === "wtf" ? pick(en ? enSharp : itSharp) : pick(en ? enSoft : itSoft);
}

/* ========= Clarify (sempre legato alla domanda) ========= */
function clarifyQuestions(domanda, periodo, lang = "it") {
  const en = isEn(lang);
  const t = classifyTopic(domanda);
  const L = (id, it, enStr, phIt, phEn) => ({
    id, label: en ? enStr : it, placeholder: en ? phEn : phIt
  });

  if (t === "moto") {
    return [
      L("time_window", "Quando la prenderesti davvero?", "When would you actually buy it?", "questo mese / 3–6 mesi", "this month / 3–6 months"),
      L("use", "Uso principale?", "Main use?", "casa-lavoro / weekend / viaggi", "commute / weekends / trips"),
      L("budget", "Budget mensile realistico?", "Realistic monthly budget?", "assicurazione + carburante", "insurance + fuel")
    ];
  }
  if (t === "città") {
    return [
      L("window", "Finestra realistica per lo spostamento?", "Real window to move?", "entro 3 mesi / 6–12 mesi", "within 3 months / 6–12 months"),
      L("anchor", "Cosa ti tiene dove sei ora?", "What anchors you now?", "famiglia / lavoro / costi", "family / work / costs"),
      L("signal", "Segnale che direbbe “funziona”?", "Signal that says “this works”?", "sonno/energia/risposte", "sleep/energy/callback")
    ];
  }
  if (t === "lavoro") {
    return [
      L("why", "Il tuo perché oggi?", "Your current *why*?", "impatto / crescita / serenità", "impact / growth / calm"),
      L("option", "Opzioni sul tavolo?", "Options on the table?", "restare / cambiare team / uscire", "stay / switch team / leave"),
      L("limit", "Vincolo più concreto?", "Hardest constraint?", "budget/tempo/relazioni", "budget/time/people")
    ];
  }
  return [
    L("time_window", "Finestra reale della decisione?", "Real decision window?", "questo mese / 3–6 / 12 mesi", "this month / 3–6 / 12 months"),
    L("signal", "Segnale personale da osservare?", "Personal sign to watch?", "sonno/energia/prima risposta", "sleep/energy/first reply"),
    L("limit", "Limite più concreto?", "Most concrete limit?", "budget/tempo/energia", "budget/time/energy")
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

    /* ----- Clarify branch (SEMPRE ATTINENTE ALLA DOMANDA) ----- */
    if (clarify) {
      // uniamo 2 domande “utente” + 1 “persona” per conoscersi meglio
      const qs = clarifyQuestions(domanda, periodo, lang);
      const personaQ = en
        ? { id: "routine", label: "One daily habit that grounds you?", placeholder: "gym at 7, call mom on Sundays..." }
        : { id: "routine", label: "Un’abitudine quotidiana che ti tiene a terra?", placeholder: "palestra alle 7, chiamata alla mamma..." };
      return res.status(200).json({ questions: [...qs.slice(0,2), qs[2], personaQ] });
    }

    /* ----- Generation branch ----- */
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const system = `
${persona.system(lang).trim()}

Today: ${todayInfo(lang)}
Hard rules:
- Reply ONLY in ${en ? "English" : "Italiano"}.
- Stay strictly on topic inferred from the user question: "${topic}".
- No lists/bullets; no moralizing; zero melancholy.
- Use at most one small, plausible image. No poetry.
- ${stile === "wtf" ? "Tone: witty, punchy, tipsy, friendly." : "Tone: warm, concrete, upbeat."}
${extra ? `\nAdditional style guidance:\n${extra}\n` : ""}
`.trim();

    const mirror = mirrorLine(profilo, lang);
    const closing = episodicClosing(stile, lang);

    const user = `
${en ? "Mirror-opening" : "Apertura-specchio"} (para-free): "${mirror}"

${en ? "User question" : "Domanda utente"}: "${domanda}"
${en ? "Extra details" : "Dettagli"}: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (en ? "none" : "nessuno")}
${en ? "Topic to honor" : "Tema da rispettare"}: ${topic}

${en
  ? `Write a single paragraph with natural line breaks. 130–180 words. Single voice, second person.
Avoid lists and direct questions until the last line. End with: "${closing}".`
  : `Scrivi un unico testo con a capo naturali. 130–180 parole. Una sola voce, seconda persona.
Evita elenchi e domande dirette fino all’ultima riga. Chiudi con: "${closing}".`
}
`.trim();

    const temperature = stile === "wtf" ? 0.92 : 0.84;
    const max_tokens = 800;

    // Streaming opzionale
    const doStream = stream || String(req.headers["x-whatif-stream"] || "") !== "";
    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      const s = await client.chat.completions.create({
        model: MODEL_TEXT,
        temperature,
        stream: true,
        max_tokens,
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
      max_tokens,
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
