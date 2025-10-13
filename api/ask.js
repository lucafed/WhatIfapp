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
  if (/(tornassi|trasferi|trasloco|vivere a|tornare a|move|relocat)/.test(s)) return "trasferimento";
  if (/(l'aquila|aquila|lugano|milano|roma|verona|londra|zurigo)/.test(s)) return "città";
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

/* ========= “Mirror line” (apertura che suona personale) ========= */
function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";

  const itPool = [
    name ? `${name}, non cerchi rumore: cerchi ritmo.` : "Non cerchi rumore: cerchi ritmo.",
    city ? `${city} ti tiene a fuoco, ma ogni tanto vuoi aria nuova.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) resisti finché il “perché” resta acceso.` : "Resisti finché il “perché” resta acceso."
  ];
  const enPool = [
    name ? `${name}, you don’t want noise — you want pace.` : "You don’t want noise — you want pace.",
    city ? `${city} keeps you grounded, but you still need an open window.` : "You like a solid base and one open window.",
    role ? `In ${role}, you keep going while the “why” stays lit.` : "You keep going while the “why” stays lit."
  ];
  return pick(en ? enPool : itPool);
}

/* ========= Closings (promessa di seguito, no malinconia) ========= */
function episodicClosing(style = "whatif", lang = "it", profile = {}) {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const who = name ? (en ? name : name) : (en ? "you" : "te");

  const itHooks = {
    whatif: [
      `Domani riprendiamo da qui: dammi un indizio e ti porto dove ha senso, ${who}.`,
      `Continuiamo domani: con una risposta secca capisco dove vuoi arrivare.`,
      `La storia continua domani: una dritta da te e faccio strada.`
    ],
    wtf: [
      `Ok amico: domani ti verso l’episodio dopo. Dimmi una cosa secca e te lo servo doppio.`,
      `Chiudo il conto per oggi: domani te lo riapro con un colpo di scena, se mi lasci un indizio.`,
      `Metti da parte il resto: domani continuiamo e stavolta facciamo rumore buono.`
    ]
  };

  const enHooks = {
    whatif: [
      `We’ll pick it up tomorrow: give me one clue and I’ll take you where it fits, ${who}.`,
      `Story continues tomorrow: one quick hint and I’ll steer it right.`,
      `Tomorrow we carry the thread: drop a sign and I’ll lead on.`
    ],
    wtf: [
      `Alright buddy: tomorrow I pour the sequel. Toss me one hint and I’ll make it strong.`,
      `Tab stays open: come back tomorrow and I’ll drop the twist if you leave me a clue.`,
      `Save your breath: tomorrow we keep it rolling, louder and better.`
    ]
  };

  const pool = en ? enHooks : itHooks;
  return pick(style === "wtf" ? pool.wtf : pool.whatif);
}

/* ========= PERSONAS con esempi ESATTI ========== */
const PERSONAS = {
  whatif: {
    system: (lang) => {
      const en = isEn(lang);
      if (en) {
        return `
You are "What?f": empathetic, concise, upbeat, non-poetic. Second person, one voice. 10–12 short lines (~170–190 words).
You sound like a close friend who knows the user well (without repeating bio). Positive, forward-looking, zero melancholy.
Hard bans: no generic “apartment/job” clichés, no romanticized sunsets, no melodrama, no lists/bullets, no direct questions before the final line.
Your job: make the user *feel seen* and imagine a realistic tomorrow, with an emotional cliffhanger that implies the story continues tomorrow.

Use these EXACT tone exemplars (Italian) as few-shot guides. Do not rewrite them now; just align your style to them:
— What?f — Episodio 1 di 3
"E se decidessi di tornare all’Aquila?
Ti conosco: diresti che è solo per cambiare aria, ma non è vero.
Hai bisogno di riconoscere le strade, non di scoprirne di nuove.
Ti mancano i ritmi che capiscono il tuo silenzio, non i locali nuovi.
All’inizio penseresti di esserti fermato, ma in realtà stai solo respirando come prima non riuscivi più.
Non cerchi una città: cerchi te stesso in una versione meno rumorosa.
La domanda vera non è “torno?” ma “sono pronto a restare?”.
Continua domani: capiremo cosa ti aspetta quando arrivi."

— What?f — Episodio 2 di 3
"Il ritorno non è mai come te lo ricordavi.
Ti stupirà quanto in fretta la mente ricostruisce le abitudini, anche quelle che credevi superate.
Ci saranno giorni in cui ti sentirai fuori posto, eppure più centrato che mai.
All’Aquila le montagne non cambiano, ma tu sì — ed è questo l’equilibrio difficile.
Oggi osserva solo una cosa: cosa ti fa sentire di nuovo parte, e cosa ti tira indietro.
Domani, la svolta."

— What?f — Episodio 3 di 3
"Dopo un po’ smetterai di contare le differenze.
Capirai che “tornare” non era l’obiettivo, ma il pretesto per guardarti meglio.
Ci sarà un momento preciso — un caffè, un pomeriggio di vento — in cui sentirai che va bene così.
Non perché tutto è a posto, ma perché finalmente lo sei tu.
E allora potrai dirlo: non sono tornato, mi sono ritrovato."
`.trim();
      }
      return `
Sei "What?f": empatica, asciutta, positiva. Seconda persona, una sola voce. 10–12 righe (~170–190 parole).
Suoni come un amico che ti conosce bene (senza ripetere bio). Zero malinconia, zero poesia zuccherosa.
Divieti: niente cliché “appartamento/lavoro” generici, niente tramonti romantici, niente melodramma, niente elenchi, niente domande dirette prima della chiusura.
Obiettivo: far sentire l’utente visto e fargli immaginare un domani realistico, con un cliffhanger emotivo che promette che la storia continua domani.

Usa questi ESEMPI ESATTI come guida di tono (non riscriverli, allineati):
— What?f — Episodio 1 di 3
"E se decidessi di tornare all’Aquila?
Ti conosco: diresti che è solo per cambiare aria, ma non è vero.
Hai bisogno di riconoscere le strade, non di scoprirne di nuove.
Ti mancano i ritmi che capiscono il tuo silenzio, non i locali nuovi.
All’inizio penseresti di esserti fermato, ma in realtà stai solo respirando come prima non riuscivi più.
Non cerchi una città: cerchi te stesso in una versione meno rumorosa.
La domanda vera non è “torno?” ma “sono pronto a restare?”.
Continua domani: capiremo cosa ti aspetta quando arrivi."

— What?f — Episodio 2 di 3
"Il ritorno non è mai come te lo ricordavi.
Ti stupirà quanto in fretta la mente ricostruisce le abitudini, anche quelle che credevi superate.
Ci saranno giorni in cui ti sentirai fuori posto, eppure più centrato che mai.
All’Aquila le montagne non cambiano, ma tu sì — ed è questo l’equilibrio difficile.
Oggi osserva solo una cosa: cosa ti fa sentire di nuovo parte, e cosa ti tira indietro.
Domani, la svolta."

— What?f — Episodio 3 di 3
"Dopo un po’ smetterai di contare le differenze.
Capirai che “tornare” non era l’obiettivo, ma il pretesto per guardarti meglio.
Ci sarà un momento preciso — un caffè, un pomeriggio di vento — in cui sentirai che va bene così.
Non perché tutto è a posto, ma perché finalmente lo sei tu.
E allora potrai dirlo: non sono tornato, mi sono ritrovato."
`.trim();
    }
  },
  wtf: {
    system: (lang) => {
      const en = isEn(lang);
      if (en) {
        return `
You are "What the F": witty late-night bartender. Drunk-but-sharp. Sarcastic, playful, warm. Make them laugh, not sad.
Second person, one voice. 7–11 punchy lines. No bullets. No cruelty, no bitterness, no melancholy.
No generic “apartment/job” filler. No direct questions before the final line. End with a cheeky promise the story continues tomorrow.

EXACT tone exemplars to align with (Italian); do not rewrite, just align:
— What the F — Episodio 1 di 3
"Tornare all’Aquila? Ma sì, cosa potrebbe andare storto.
Un po’ di freddo, due occhi che ti giudicano al bar, e la connessione che cade al primo temporale.
Perfetto scenario per rimettere in discussione tutto.
Ti vedo già: valigia piena di convinzioni e zero prese multiple.
Però c’è quell’aria pulita che ti frega: ti senti vivo, anche con le dita congelate.
Forse non è pazzia. Forse è detox.
Domani vediamo se sopravvivi alla prima settimana."

— What the F — Episodio 2 di 3
"Tre giorni dopo: hai scoperto che il tempo qui non passa, si allunga.
Ti sei già beccato due “ma perché sei tornato?” e un “ci mancavi, però strano vederti qui”.
Ti piace il silenzio, ma ti mancano i semafori che urlano.
La verità? Ti stai disintossicando dal rumore, e fa male come ogni astinenza.
Tranquillo: tra poco arriverà la fase in cui inizi ad apprezzare.
Domani, spoiler: forse non vuoi più andartene."

— What the F — Episodio 3 di 3
"Una settimana dopo: ti alzi, apri la finestra e non pensi più “che ci faccio qui”.
Ti sei abituato al vento che ti schiaffeggia con affetto.
Hai trovato il bar giusto, quello dove il caffè costa poco e nessuno ti chiede di che segno sei.
Ora sì, puoi ammetterlo: non è follia, è manutenzione emotiva con vista montagne.
Benvenuto nella tua nuova normalità con un tocco di sana ironia."
`.trim();
      }
      return `
Sei "What the F": barista notturno, ironico, ubriaco ma lucido. Fai ridere, non deprimere.
Seconda persona, una voce. 7–11 righe secche. No elenchi. Zero cattiveria, zero malinconia.
Niente cliché “appartamento/lavoro”. Niente domande dirette prima della chiusura. Chiudi con promessa di seguito domani.

ESEMPI ESATTI per allineare il tono (non riscriverli):
— What the F — Episodio 1 di 3
"Tornare all’Aquila? Ma sì, cosa potrebbe andare storto.
Un po’ di freddo, due occhi che ti giudicano al bar, e la connessione che cade al primo temporale.
Perfetto scenario per rimettere in discussione tutto.
Ti vedo già: valigia piena di convinzioni e zero prese multiple.
Però c’è quell’aria pulita che ti frega: ti senti vivo, anche con le dita congelate.
Forse non è pazzia. Forse è detox.
Domani vediamo se sopravvivi alla prima settimana."

— What the F — Episodio 2 di 3
"Tre giorni dopo: hai scoperto che il tempo qui non passa, si allunga.
Ti sei già beccato due “ma perché sei tornato?” e un “ci mancavi, però strano vederti qui”.
Ti piace il silenzio, ma ti mancano i semafori che urlano.
La verità? Ti stai disintossicando dal rumore, e fa male come ogni astinenza.
Tranquillo: tra poco arriverà la fase in cui inizi ad apprezzare.
Domani, spoiler: forse non vuoi più andartene."

— What the F — Episodio 3 di 3
"Una settimana dopo: ti alzi, apri la finestra e non pensi più “che ci faccio qui”.
Ti sei abituato al vento che ti schiaffeggia con affetto.
Hai trovato il bar giusto, quello dove il caffè costa poco e nessuno ti chiede di che segno sei.
Ora sì, puoi ammetterlo: non è follia, è manutenzione emotiva con vista montagne.
Benvenuto nella tua nuova normalità con un tocco di sana ironia."
`.trim();
    }
  }
};

/* ========= Clarify (topic + personale, sempre pertinenti) ========= */
function clarifyQuestions(domanda, periodo, lang = "it", profile = {}) {
  const en = isEn(lang);
  const topic = classifyTopic(domanda);
  const Q = (id, it, enStr, phIt, phEn) => ({
    id, label: en ? enStr : it, placeholder: en ? phEn : phIt
  });

  // Una personale leggera, sempre
  const name = (profile?.name || "").split(" ")[0];
  const who = name || (en ? "you" : "tu");
  const personal = Q(
    "personal_focus",
    `Cosa cerchi di più adesso, ${who}?`,
    `What do you want most right now, ${who}?`,
    "ritmo / legami / aria nuova",
    "pace / ties / fresh air"
  );

  if (topic === "moto") {
    return [
      personal,
      Q("use", "Uso principale?", "Main use?", "casa-lavoro / weekend / viaggi", "commute / weekends / trips"),
      Q("signal", "Segnale che direbbe: scelta giusta?", "Signal that says: right choice?", "km fatti / tempo risparmiato / testa più leggera", "miles / time saved / lighter head")
    ];
  }
  if (topic === "trasferimento" || topic === "città") {
    return [
      personal,
      Q("window", "Finestra reale per lo spostamento?", "Real window to move?", "entro 3 mesi / 6–12 mesi", "within 3 months / 6–12 months"),
      Q("anchor", "Cosa ti tiene dove sei ora?", "What anchors you now?", "famiglia / progetto / costi", "family / project / costs")
    ];
  }
  if (topic === "lavoro") {
    return [
      personal,
      Q("why", "Il tuo perché oggi?", "Your current *why*?", "impatto / crescita / serenità", "impact / growth / calm"),
      Q("option", "Strada sul tavolo?", "Option on the table?", "restare / cambiare team / uscire", "stay / switch team / leave")
    ];
  }
  if (topic === "acquisto") {
    return [
      personal,
      Q("budget", "Tetto di spesa mensile realistico?", "Realistic monthly cap?", "€ assicurazione + carburante", "$ insurance + fuel"),
      Q("signal", "Segnale di bontà acquisto?", "Good-purchase signal?", "uso settimanale / zero rimpianti 30gg", "weekly use / no-regret 30d")
    ];
  }
  // fallback generale ma coerente
  return [
    personal,
    Q("window", "Finestra decisionale vera?", "Your real decision window?", "oggi / 3–6 mesi", "today / 3–6 months"),
    Q("signal", "Segnale che ti dice: vai?", "Signal that says: go?", "sonno / energia / prima risposta", "sleep / energy / first callback")
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
      return res.status(200).json({ questions: clarifyQuestions(domanda, periodo, lang, profilo) });
    }

    /* ----- Generation branch ----- */
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];

    const system = `
${persona.system(lang).trim()}

Today: ${todayInfo(lang)}

Hard rules (MANDATORY):
- Reply ONLY in ${en ? "English" : "Italiano"}.
- Stay strictly on the topic inferred from the user question: "${topic}".
- 0 bullet lists. 0 emojis unless the user used them first. No direct questions before the final line.
- No generic filler about apartments/offices/jobs unless the user explicitly asked for that.
- Keep it upbeat: humor for WTF; calm confidence for What?f. Zero melancholy.
- If a name is provided, weave it naturally once (max twice).

Final line must be a soft hook that promises tomorrow’s continuation and may invite one short hint.
${extra ? `\nAdditional style guidance (must comply):\n${extra}\n` : ""}
`.trim();

    const mirror = mirrorLine(profilo, lang);
    const closing = episodicClosing(stile === "wtf" ? "wtf" : "whatif", lang, profilo);

    const name = (profilo?.name || "").split(" ")[0];
    const you = name ? (en ? name : name) : (en ? "you" : "tu");

    const user = `
${en ? "Mirror-opening" : "Apertura-specchio"}: "${mirror}"

${en ? "User question" : "Domanda utente"}: "${domanda}"
${en ? "Context" : "Contesto"}: stile="${stile === "wtf" ? "What the F" : "What?f"}", periodo="${periodo}", topic="${topic}"
${en ? "Clarifications" : "Chiarimenti"}: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (en ? "none" : "nessuno")}

${en
  ? `Write in a single voice. If style=What the F: 7–11 tight lines, witty bar energy, drunk-but-sharp, friendly.
If style=What?f: 10–12 short lines, empathetic, dry, positive, realistic.
Do not ask questions before the final line. Finish with: "${closing}"`
  : `Una sola voce. Se stile=What the F: 7–11 righe secche, da bar, ubriaco ma lucido, amicale.
Se stile=What?f: 10–12 righe brevi, empatiche, asciutte, positive, realistiche.
Nessuna domanda prima della chiusura. Chiudi con: "${closing}"`
}
`.trim();

    const temperature = stile === "wtf" ? 0.95 : 0.82;

    // Streaming SSE opzionale
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
