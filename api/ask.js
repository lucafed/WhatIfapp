// /api/ask.js — completo (IT/EN), risposte + followups, stili "whatif" / "wtf"
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";
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

/* ========= Exemplars approvati ========= */
const EXEMPLARS_IT = {
  whatif: [
`E se decidessi di tornare all’Aquila?
Ti conosco: diresti che è solo per cambiare aria, ma non è vero.
Hai bisogno di riconoscere le strade, non di scoprirne di nuove.
Ti mancano i ritmi che capiscono il tuo silenzio, non i locali nuovi.
All’inizio penseresti di esserti fermato, ma in realtà stai solo respirando come prima non riuscivi più.
Non cerchi una città: cerchi te stesso in una versione meno rumorosa.
La domanda vera non è “torno?” ma “sono pronto a restare?”.
Continua domani: capiremo cosa ti aspetta quando arrivi.`,
`Il ritorno non è mai come te lo ricordavi.
Ti stupirà quanto in fretta la mente ricostruisce le abitudini, anche quelle che credevi superate.
Ci saranno giorni in cui ti sentirai fuori posto, eppure più centrato che mai.
All’Aquila le montagne non cambiano, ma tu sì — ed è questo l’equilibrio difficile.
Oggi osserva solo una cosa: cosa ti fa sentire di nuovo parte, e cosa ti tira indietro.
Domani, la svolta.`,
`Dopo un po’ smetterai di contare le differenze.
Capirai che “tornare” non era l’obiettivo, ma il pretesto per guardarti meglio.
Ci sarà un momento preciso — un caffè, un pomeriggio di vento — in cui sentirai che va bene così.
Non perché tutto è a posto, ma perché finalmente lo sei tu.
E allora potrai dirlo: non sono tornato, mi sono ritrovato.`
  ],
  wtf: [
`Tornare all’Aquila?
Ah, geniale: la città dove anche il vento ha l’abbonamento mensile.
Ti vedo già al bar, a dire “mi serviva cambiare aria”… mentre ordini il terzo corretto.
Qui la gente non corre, ma ti batte comunque sul tempo.
Hai lasciato Verona per il caos? Bravo: hai scelto un freddo che ti dà del tu.
Ma sai che c’è? Ti farà bene.
L’Aquila è un detox a base di vino rosso e silenzio.
Vediamo domani se reggi la prima settimana senza insultare il meteo.`,
`Tre giorni dopo: frigo vuoto, Wi-Fi pure.
Due “ah, sei tornato?” e un “ma che t’è venuto in mente?” già incassati.
Però ammettilo: ti senti strano, ma vivo.
Qui anche il silenzio ha carattere: ti guarda e dice “non ti nascondere, eh?”.
Stai facendo pace col vuoto e vi state pure simpatici.
Tranquillo: la fase “forse non era un errore” sta arrivando.
Domani vediamo se il bar sotto casa ti adotta ufficialmente.`,
`Una settimana dopo: apri la finestra e non pensi più “che ci faccio qui?”.
Hai il tuo bar, il tuo tavolo, e l’illusione che il vino scaldi più del termosifone.
L’Aquila non è cambiata, ma tu sì: ridi anche quando va storto, e lo fai meglio di prima.
Hai scoperto che la normalità, con il bicchiere giusto, è una festa sobria.
Il difficile non era tornare: era restare senza prenderti troppo sul serio.
E domani, chissà, magari succede pure qualcosa — niente spoiler.`
  ]
};

const EXEMPLARS_EN = {
  whatif: [
`What if you moved back to L’Aquila?
You know it wouldn’t be nostalgia — more like a balance experiment.
You’d rediscover slowness: once annoying, now almost a luxury.
At first you’d think “why am I here?”, then notice how breathing without noise feels good.
Some places work like mirrors: they reflect without judging.
L’Aquila would be one of those — puts you back in line without asking anything.
Tomorrow we’ll see what happens when it starts to feel like yours again.`,
`Return never matches the memory.
Routines rebuild fast, with new rules.
People ask “so, did it work?” as if you won or lost something — you’re just learning to be.
Some days feel suspended, yet you’re coming back into focus.
Maybe you weren’t chasing change, just a different tempo.
Today, notice what makes you feel good without needing an explanation.
Tomorrow we’ll see whether staying becomes a choice or a discovery.`,
`One day you stop counting reasons for coming back.
Life no longer needs rehearsals.
You wake up, look outside, and realize calm isn’t stillness — it’s direction.
You’re curious again, lighter, even a bit ironic about yourself.
Nothing dramatic happened, yet something shifted.
Maybe the point wasn’t returning, but staying on purpose.
And then you can say it: you didn’t just come back — you found yourself.`
  ],
  wtf: [
`Back to L’Aquila?
Brilliant. A city where even the wind pays a monthly subscription.
I can see you at the counter saying “needed fresh air”… while ordering a third espresso with attitude.
You left the chaos? Congrats — you chose a cold that calls you by your first name.
But hey, it might be good for you.
L’Aquila is detox powered by red wine and friendly sarcasm.
Tomorrow we’ll check if you survive a week without swearing at the weather.`,
`Day three: empty fridge, empty Wi-Fi.
Two “oh, you’re back?” and one “what were you thinking?” collected already.
Admit it: odd feeling, but you’re alive.
Even the silence has character here — it stares and says “don’t hide.”
You’re making peace with the void, and you two get along.
Relax: the “maybe this wasn’t a mistake” phase is loading.
Tomorrow we’ll see if the bar downstairs adopts you.`,
`One week in: you open the window and stop thinking “why am I here?”
You’ve got your bar, your table, and the illusion that wine heats better than radiators.
L’Aquila hasn’t changed — you have: you laugh when things go sideways, and you’re good at it.
Turns out normal life, with the right glass, is a quiet party.
The hard part wasn’t returning — it was staying without taking yourself too seriously.
Tomorrow? Who knows — no spoilers.`
  ]
};

/* ========= Persona & stile ========= */
const PERSONAS = {
  whatif: {
    system: (lang) =>
      isEn(lang)
        ? `You are "What?f": warm, clear, upbeat friend. Second person. 9–13 short, concrete lines; no bullets. No melancholy; no coaching; no purple prose. Sound like you already know the user (natural, never forced). Feel episodic with a soft hook for tomorrow. Never invent jobs/apartments/recruiters unless the user mentioned them. Reply ONLY in English.`
        : `Sei "What?f": amico lucido e positivo. Seconda persona. 9–13 frasi brevi e concrete; niente elenchi. Niente malinconia/retorica/poesia. Suona come se conoscessi già l’utente (naturale). Episodico con gancio morbido per domani. Non inventare appartamenti/uffici/recruiter se non citati. Rispondi SOLO in Italiano.`
  },
  wtf: {
    system: (lang) =>
      isEn(lang)
        ? `You are "What the F": witty late-night bartender, cheerfully tipsy. Second person. 7–11 punchy lines (≤15 words each); no bullets. Make them laugh; never mean. 1–2 clever bar/booze metaphors. End with playful hook for tomorrow. Do not invent user details. Reply ONLY in English.`
        : `Sei "What the F": barista notturno brillante, simpaticamente sbronzo. Seconda persona. 7–11 righe secche (≤15 parole); niente elenchi. Fai ridere, mai cattivo. 1–2 metafore da bancone. Chiudi con gancio giocoso per domani. Non inventare dettagli. Rispondi SOLO in Italiano.`
  }
};

/* ========= Closings seriali ========= */
function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const soft = en
    ? [
        "Tomorrow I’ll nudge the thread with two tiny questions.",
        "Come back tomorrow — two quick checks and we push it forward.",
        "We’ll keep the thread alive tomorrow — small step, same story."
      ]
    : [
        "Domani due micro-domande e spingiamo avanti il filo.",
        "Torna domani: due domande rapide e andiamo avanti.",
        "Domani riprendiamo il filo: passo piccolo, storia viva."
      ];
  const playful = en
    ? [
        "Same counter tomorrow — two sharp questions, story keeps pouring.",
        "Park the tab: tomorrow two bar-questions and a new scene.",
        "Tomorrow I’ll stir the plot with two quick shots."
      ]
    : [
        "Stesso bancone domani: due domande secche e si va.",
        "Lascia il conto aperto: domani due domande e nuova scena.",
        "Domani ti verso due domande e vediamo dove porta."
      ];
  return style === "wtf" ? pick(playful) : pick(soft);
}

/* ========= Mirror ========= */
function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const it = [
    name ? `${name}, non ti muovi per capriccio: cerchi coerenza.` : "Non ti muovi per capriccio: cerchi coerenza.",
    city ? `${city} ti tiene dritto, ma ogni tanto vuoi aria più larga.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il perché resta acceso.` : "Reggi finché il perché resta acceso."
  ];
  const enPool = [
    name ? `${name}, you don’t move on whims — you move for coherence.` : "You don’t move on whims — you move for coherence.",
    city ? `${city} steadies you, but you still need a wider window.` : "You want one solid base and one open window.",
    role ? `In ${role}, you hold as long as the “why” stays lit.` : "You hold as long as the “why” stays lit."
  ];
  return pick(en ? enPool : it);
}

/* ========= Followups (2 domande pertinenti) ========= */
async function genFollowups({ domanda, answer, stile, lang }) {
  const en = isEn(lang);
  const persona = PERSONAS[stile || "whatif"].system(lang);
  const prompt = `
${persona}

Today: ${todayInfo(lang)}
User question: "${domanda}"
Model's last answer (context): """${(answer || "").slice(0, 1200)}"""

Task: Produce exactly TWO brief follow-up questions for the user, in ${en ? "English" : "Italiano"}.
Rules:
- Each question max 14 words.
- Must be specific to the question and the given answer.
- No bullets, no numbering, just two lines, each a question.
- Style must match the persona (${stile}).
`.trim();

  const r = await client.chat.completions.create({
    model: MODEL,
    temperature: stile === "wtf" ? 0.9 : 0.7,
    max_tokens: 150,
    messages: [{ role: "system", content: "You generate short, relevant follow-up questions only." }, { role: "user", content: prompt }]
  });

  const raw = r.choices?.[0]?.message?.content || "";
  const lines = raw
    .split(/\n+/)
    .map((l) => l.trim().replace(/^[-•\d.)\s]+/, ""))
    .filter(Boolean)
    .slice(0, 2);
  return lines.length === 2 ? lines : lines.concat(Array(2 - lines.length).fill(en ? "Want to add one more detail?" : "Vuoi aggiungere un dettaglio?")).slice(0, 2);
}

/* ========= Handler ========= */
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
      mode = "answer",          // "answer" | "followups"
      profilo = {},
      stream = false,
      extra = "",
      previous_answer = ""      // per followups
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const lang = langIn === "auto" ? detectLang(domanda) : langIn;
    const en = isEn(lang);
    const topic = classifyTopic(domanda);

    // === Branch: FOLLOWUPS ===
    if (mode === "followups") {
      const followups = await genFollowups({
        domanda,
        answer: previous_answer || "",
        stile,
        lang
      });
      return res.status(200).json({ followups, lang, topic, stile });
    }

    // === Branch: ANSWER ===
    const persona = PERSONAS[stile].system(lang);
    const closing = episodicClosing(stile, lang);
    const mirror = mirrorLine(profilo, lang);
    const exemplars = (en ? EXEMPLARS_EN : EXEMPLARS_IT)[stile] || [];

    const system = `
${persona}

Today: ${todayInfo(lang)}
Hard rules:
- Reply ONLY in ${en ? "English" : "Italiano"}.
- Stay strictly on topic inferred from the user question: "${topic}".
- No lists/bullets; no direct questions before the final line.
- Keep it upbeat; no melancholy; no bitterness.
- DO NOT invent apartments, offices, recruiters, money, family unless the user did.

Style exemplars (do NOT copy; match tone/rhythm only):
${exemplars.map((e, i) => `— Example #${i + 1}:\n${e}`).join("\n\n")}
`.trim();

    const user = `
${en ? "Mirror-opening" : "Apertura confidente"}: "${mirror}"

${en ? "User question" : "Domanda"}: "${domanda}"
${extra ? (en ? "Detail" : "Dettaglio") + `: "${extra}"` : ""}

${en
  ? `Write a single compact episode (9–13 lines for whatif; 7–11 punchy lines for wtf). End with: "${closing}".`
  : `Scrivi un episodio compatto (9–13 righe per whatif; 7–11 righe secche per wtf). Chiudi con: "${closing}".`
}
`.trim();

    const doStream = stream || String(req.headers["x-whatif-stream"] || "") !== "";
    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const s = await client.chat.completions.create({
        model: MODEL,
        temperature: stile === "wtf" ? 0.92 : 0.8,
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

    // Non-stream
    const c = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : 0.8,
      max_tokens: 700,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text, lang, topic, stile });

  } catch (err) {
    console.error("API /ask error:", err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
