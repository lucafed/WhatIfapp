// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";

/* ========= Utils ========= */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function detectLang(text = "") {
  const enHits = (text.match(/\b(what|if|and|or|you|should|would|move|work|buy|motor|bike|city)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|moto|tornassi|trasferir|lavor|comprare|acquistare|l'aquila|aquila)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

function classifyTopic(q = "") {
  const s = q.toLowerCase();
  if (/(moto|motor(e|bike)|scooter|vespa)/.test(s)) return "moto";
  if (/(aquila|l'aquila)/.test(s)) return "l_aquila";
  if (/(tornassi|trasferi|trasloco|vivere a|move|relocat)/.test(s)) return "trasferimento";
  if (/(lavoro|job|ricercatore|azienda|ufficio|work)/.test(s)) return "lavoro";
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

/* ========= Mirror line (fa “sembrare che ti conosce”) ========= */
function mirrorLine(profile = {}, domanda = "", lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || (/\b(l'aquila|aquila)\b/i.test(domanda) ? "L’Aquila" : "");
  const role = profile?.work_role || profile?.role || "";

  const itPool = [
    name ? `${name}, non decidi per capriccio: scegli quando senti che ha senso.` : "Non decidi per capriccio: scegli quando senti che ha senso.",
    city ? `${city} ti ancora, ma ogni tanto ti serve aria nuova.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il “perché” resta acceso.` : "Reggi finché il “perché” resta acceso.",
  ];
  const enPool = [
    name ? `${name}, you move when it means something, not on whims.` : "You move when it means something, not on whims.",
    city ? `${city} grounds you, but you still need open air.` : "You need one steady base and one open window.",
    role ? `In ${role}, you keep pace while the “why” stays lit.` : "You keep pace while the “why” stays lit.",
  ];

  return pick(en ? enPool : itPool);
}

/* ========= Closings episodici ========= */
function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const itSoft = [
    "Domani vediamo dove ti porta questa storia.",
    "Segna il punto: domani ripartiamo da qui.",
    "Teniamola calda: domani la continuiamo.",
  ];
  const itSharp = [
    "Stesso bancone, domani rimescoliamo.",
    "Non chiudere il conto: domani un altro giro.",
    "Lascia il bicchiere qui: domani riprendiamo.",
  ];
  const enSoft = [
    "Tomorrow we’ll see where this story goes.",
    "Bookmark it; we’ll pick it up tomorrow.",
    "Hold the thread — tomorrow we nudge it forward.",
  ];
  const enSharp = [
    "Same bar, tomorrow we stir again.",
    "Don’t close the tab — back tomorrow.",
    "Leave the glass here — we’ll resume tomorrow.",
  ];
  return style === "wtf" ? pick(en ? enSharp : itSharp) : pick(en ? enSoft : itSoft);
}

/* ========= PERSONAS (regole dure + tono) ========= */
const PERSONAS = {
  whatif: {
    system: (lang) =>
      isEn(lang)
        ? `
You are "What?f": intimate, clear, predictive, non-melancholic.
Italian or English only as requested. Second person, one voice.
Length: 9–13 short sentences (~180–220 words). No lists. No bullet points.
No logistical checklists (no apartments, CVs, markets, agencies) unless the topic is literally about work or housing.
Feel like you know the user without saying it: use a mirror-opening line, then a vivid but grounded scene.
Keep it real, minimal imagery (0–2 tiny), no purple prose, no moralizing. Never generic.
End with a soft episodic hook (the story continues tomorrow).`
        : `
Sei "What?f": intima, chiara, predittiva, NON malinconica.
Rispondi SOLO nella lingua richiesta (qui: Italiano). Seconda persona, una voce.
Lunghezza: 9–13 frasi brevi (~180–220 parole). Niente elenchi o bullet.
Vietati consigli logistici/checklist (niente appartamenti, curriculum, mercato del lavoro) a meno che la domanda non sia letteralmente su lavoro/casa.
Dai la sensazione che conosci l’utente: apri con una frase-specchio, poi una scena concreta e credibile.
Immagini minime (0–2), niente lirismi, niente prediche. Mai generica.
Chiudi con un gancio episodico morbido (la storia continua domani).`
  },
  wtf: {
    system: (lang) =>
      isEn(lang)
        ? `
You are "What the F": late-night witty bartender — funny, punchy, a bit boozy, never mean.
Second person, one voice. 7–11 tight lines, ≤15 words each. No lists.
High sarcasm that makes them laugh AND think. No logistics, no life admin checklists.
Small, sharp images allowed; still concrete. Never melancholy. No therapy tone.
End with a playful episodic hook (same-bar tomorrow).`
        : `
Sei "What the F": barista di notte, brillante, sarcastico, un filo “alcolico”, mai cattivo.
Seconda persona, una voce. 7–11 righe secche, ≤15 parole. Niente elenchi.
Fai RIDERE e pensare. Niente logistica, niente to-do. Immagini piccole e taglienti.
Mai malinconico. Niente tono terapeutico.
Chiudi con un gancio episodico giocoso (stesso bancone, domani).`
  }
};

/* ========= FEW-SHOTS (insegnano precisamente il tono) ========= */
function fewShots(style = "whatif", lang = "it") {
  const en = isEn(lang);
  if (style === "wtf") {
    // WHAT THE F — sarcastico/ubriaco (moto + L’Aquila)
    const IT = [
`Utente: "E se comprassi una moto?"
Assistente:
Moto a marzo? Geniale.
Pioggia, casco appannato, e sorriso da “ne valeva la pena”.
Ti vedo già: benzinai amici, conti nervosi, libertà che fa rumore.
I colleghi penseranno “crisi di mezza età”.
Tu chiamala “terapia a due ruote”.
Le curve? Piccole sveglie esistenziali.
La città? Più stretta, appena scendi.
Ti mancherà solo quando non puoi guidarla.
Domani cambiamo olio alla storia. Stesso bancone, domani rimescoliamo.`,

`Utente: "E se tornassi a vivere all’Aquila?"
Assistente:
Certo, torna.
Aria pulita, ritmi lenti, e zia che chiede “allora, il lavoro?”.
Il freddo è onesto: ti congela con dignità.
Le montagne ti guardano e pensano “vediamo quanto resti”.
Verona ti manda foto dell’aperitivo da nove euro.
Tu rispondi col silenzio buono.
A metà seconda settimana, però, succede sempre qualcosa.
E no, non è il meteo.
Stesso bancone, domani rimescoliamo.`
    ];
    return en ? [] : IT;
  }

  // WHAT IF — realistico, empatico, non poetico, episodico (moto + L’Aquila)
  const IT = [
`Utente: "E se comprassi una moto?"
Assistente:
Ti immagini di provarla un sabato, senza fretta.
Ti sorprende il rumore nel casco: non è solo il motore, è spazio mentale.
I primi giorni pensi ai costi, alla pioggia, al traffico.
Poi ti ritrovi a fare giri brevi solo per sentire che puoi.
Le spese ci sono, anche la paura di scivolare.
Ma ogni curva ti divide la giornata in momenti chiari.
Non diventi “un altro”: ti concedi un pezzo di te che era rimasto in parcheggio.
La libertà non risolve tutto, ti ricorda come suoni quando non ti comprimi.
Se domani ancora ti svegli con quella voglia, la storia sa dove andare.
Domani vediamo dove ti porta questa storia.`,

`Utente: "E se tornassi a vivere all’Aquila?"
Assistente:
Ti svegli con aria fredda e familiare.
All’inizio è pace, poi diventa domanda.
Verona ti manca come manca una spinta: ti muoveva anche quando non volevi.
L’Aquila ti abbraccia senza chiederti niente, e lì senti quanto spazio hai nella testa.
Dopo qualche giorno ti accorgi che cammini più piano ma decidi più netto.
Ti chiama un numero salvato come “non so se rispondere”.
Rispondi. La voce dall’altra parte ti ricorda perché eri partito.
Non è nostalgia: è orientamento.
Se domani fai quel passo in più, lo capisci senza cercare conferme.
Domani vediamo dove ti porta questa storia.`
  ];
  return isEn(lang) ? [] : IT;
}

/* ========= Clarify (resta semplice) ========= */
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
      Q("signal", "Segnale che dice: scelta giusta?", "Signal that says: right choice?", "più energia / meno rumore mentale", "more energy / less noise")
    ];
  }
  if (topic === "l_aquila" || topic === "trasferimento") {
    return [
      Q("window", "Finestra realistica per lo spostamento?", "Real window to move?", "entro 3 mesi / 6–12 mesi", "within 3 months / 6–12 months"),
      Q("anchor", "Cosa ti ancora dove sei ora?", "What anchors you now?", "famiglia / lavoro / costi", "family / work / costs"),
      Q("signal", "Segnale che direbbe: è giusto?", "Sign that says: it’s right?", "sonno/energia/senso", "sleep/energy/sense")
    ];
  }
  return [
    Q("window", "Finestra reale della decisione?", "Real decision window?", "questo mese / 3–6 / 12 mesi", "this month / 3–6 / 12 months"),
    Q("signal", "Segnale personale da osservare?", "Personal sign to watch?", "sonno/energia/risposta", "sleep/energy/reply"),
    Q("limit", "Limite più concreto?", "Most concrete limit?", "budget/tempo/energia", "budget/time/energy")
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
      stile = "whatif",         // "whatif" | "wtf"
      stream = false,
      clarify = false,
      profilo = {},             // ← se lo passi, la mirror line “ti conosce”
      clarifications = []
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

    /* ----- Persona & system prompt ----- */
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const system = `
${persona.system(lang).trim()}

HARD RULES (do not break):
- Reply ONLY in ${en ? "English" : "Italiano"}.
- Stay strictly on the user topic: "${topic}".
- NO logistics admin: no appartamenti, curriculum, mercato del lavoro, affitti, stipendi, “piano d’azione”.
- Second person, single voice. Never ask direct questions before the last line.
- ${stile === "wtf" ? "Format: 7–11 short lines, ≤15 words each." : "Format: 9–13 short sentences (~180–220 words)."}
- End with an episodic hook (story continues tomorrow).`.trim();

    /* ----- Few-shots selezionati per stile ----- */
    const shots = fewShots(stile, lang);

    /* ----- Prompt utente ----- */
    const mirror = mirrorLine(profilo, domanda, lang);
    const closing = episodicClosing(stile, lang);

    const clarTxt = Array.isArray(clarifications) && clarifications.length
      ? (en ? `Extra details: ${clarifications.join(", ")}` : `Dettagli: ${clarifications.join(", ")}`)
      : (en ? "Extra details: none" : "Dettagli: nessuno");

    const user = `
${en ? "Mirror-opening" : "Apertura-specchio"}: "${mirror}"
${en ? "User question" : "Domanda utente"}: "${domanda}"
${clarTxt}

${en
  ? `Write in Italian if the user is Italian, otherwise English (here: ${lang}).
Honor style "${stile}". Be concrete, witty or warm as specified. No logistics. No melancholy.
Close with: "${closing}".`
  : `Scrivi in Italiano (qui: ${lang}).
Rispetta lo stile "${stile}". Sii concreto, brillante o caldo come indicato. Niente logistica. Niente malinconia.
Chiudi con: "${closing}".`
}`.trim();

    /* ----- Messaggi ----- */
    const messages = [{ role: "system", content: system }];
    // few-shot come coppie utente/assistant per ancorare il tono
    for (const ex of shots) {
      messages.push({ role: "user", content: ex.split("\nAssistente:\n")[0].replace(/^Utente:\s*/i, "Utente:") });
      messages.push({ role: "assistant", content: ex.split("\nAssistente:\n")[1] });
    }
    messages.push({ role: "user", content: user });

    const temperature = stile === "wtf" ? 0.95 : 0.85;
    const maxTokens = 700;

    /* ----- Streaming (SSE) ----- */
    const doStream = stream || String(req.headers["x-whatif-stream"] || "") !== "";
    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const s = await client.chat.completions.create({
        model: MODEL_TEXT,
        temperature,
        stream: true,
        max_tokens: maxTokens,
        messages
      });

      for await (const chunk of s) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    /* ----- Non-stream ----- */
    const c = await client.chat.completions.create({
      model: MODEL_TEXT,
      temperature,
      max_tokens: maxTokens,
      messages
    });

    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text, lang, topic });
  } catch (err) {
    console.error("API /ask error:", err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
