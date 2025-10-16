// ============================
// /api/ask.js — Life Cliffhanger Engine™ + Aquivera (FINAL)
// Stili: aquivera, aquivera_divina, wtf (IT/EN)
// Episodio + Followups + Contesto reale opzionale
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ========== Utils ========== */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function todayInfo(lang) {
  const d = new Date();
  const loc = isEn(lang) ? "en-GB" : "it-IT";
  const weekday = d.toLocaleDateString(loc, { weekday: "long" });
  const date = d.toLocaleDateString(loc, { day: "2-digit", month: "long", year: "numeric" });
  return `${weekday}, ${date}`;
}

function episodicClosing(style = "aquivera", lang = "it") {
  const enSoft = [
    "We’ll pick the thread up right here.",
    "You’ll feel the next step sooner than you expect.",
    "Watch the sign; the line keeps pulling."
  ];
  const itSoft = [
    "Riprendiamo il filo proprio qui.",
    "Sentirai il prossimo passo prima di quanto credi.",
    "Osserva il segno: la linea tira ancora."
  ];
  const enDiv = [
    "The pattern is set; the sign will appear.",
    "The hour is near. Keep your eyes soft.",
    "Your thread is already pulling you onward."
  ];
  const itDiv = [
    "Il disegno è tracciato; il segno arriverà.",
    "L’ora è vicina. Tieni lo sguardo morbido.",
    "Il tuo filo già ti tira in avanti."
  ];
  const enWtf = [
    "Keep the glass; tomorrow pours the next scene.",
    "Park your tab—tomorrow gets loud.",
    "The punchline lands tomorrow."
  ];
  const itWtf = [
    "Tieni il bicchiere: domani si versa la prossima scena.",
    "Lascia il conto aperto: domani fa rumore.",
    "La battuta atterra domani."
  ];
  if (style === "wtf") return pick(isEn(lang) ? enWtf : itWtf);
  if (style === "aquivera_divina") return pick(isEn(lang) ? enDiv : itDiv);
  return pick(isEn(lang) ? enSoft : itSoft);
}

/* ========== Reference tone (do NOT copy) ========== */
// ITALIANO — Aquivera
const EX_AQUIVERA_IT = [
`Presto farai lo stesso percorso ma con un passo diverso: meno rumore, più decisione.
Ti accorgerai che le prime due risposte arrivano senza cercarle, come quando chiudi troppe schede del browser e il computer respira.
Una mattina sposterai un appuntamento e quello spazio libero non lo riempirai di ansia: lo userai.
Ti verrà naturale tenere il telefono a faccia in giù e l’aria sembrerà più larga.
Capirai che non stai cambiando tutto: stai cambiando ritmo, che è più difficile ma più vero.
Il primo segnale? Dormirai meglio la notte in cui non ti verrà voglia di spiegarti.
Riprendiamo da qui.`,
`Tra poco noterai che gli altri ti faranno domande che non ti infastidiscono più.
Risponderai breve, chiaro, come chi ha già scelto la direzione.
Il lunedì perderà il suo volume e il giovedì ti sorprenderà gentile.
Una piccola cosa si sblocca: non chiedi permessi al passato per muoverti nel presente.
Ti verrà un gesto nuovo — spostare una sedia, cambiare un tavolo, scegliere un bar con luce migliore.
È lì che inizierà a girare meglio, senza clamore.
Il filo continua a tirare.`
];
// ITALIANO — Aquivera Divina
const EX_DIVINA_IT = [
`Il passo decisivo cadrà tra una seconda chiamata e un giovedì asciutto.
Ti si allineeranno tre indizi minimi: una risposta breve, un nome che ricompare, un respiro più lungo.
Non cercherai conferme: ti arriveranno con la naturalezza della pioggia leggera.
La città ti darà una scena chiara — due voci al bar, una finestra aperta, una risata che scioglie.
Sposterai una cosa di un centimetro e tutto il resto troverà posto.
In quel gesto capirai che non stai rincorrendo: stai conducendo.
Il segno arriva, e lo riconoscerai senza chiedere il perché.`
];
// ENGLISH — Aquivera
const EX_AQUIVERA_EN = [
`Soon you will take the same route with a different cadence: less noise, more resolve.
The first two answers will arrive uninvited, like a laptop breathing after you close ten tabs.
One morning you will move a meeting and leave the space empty—on purpose.
Your phone will stay face down, and the air will feel wider.
You won’t change everything; you’ll change tempo, which is harder and truer.
The first sign? You will sleep better the night you feel no urge to explain.
We’ll pick the thread up here.`,
`Before long, you will notice questions from others no longer bother you.
You will answer briefly, clearly, like someone who has already chosen a direction.
Mondays will lose volume; Thursdays will surprise you by being kind.
A small lock opens: you no longer ask permission from the past to move in the present.
A new habit will appear — different chair, different table, light that suits you.
That’s when things will start turning quietly in your favor.
The line keeps pulling.`
];
// ENGLISH — Aquivera Divina
const EX_DIVINA_EN = [
`The decisive step will fall between a second call and a clear Thursday.
Three small signs will align: a short reply, a name returning, a longer breath.
You won’t seek confirmation; it will arrive with the ease of light rain.
The city will stage it for you — two voices at the counter, a window open, a laugh that releases.
You will move something by a centimeter and everything else will find its place.
In that gesture you will know you are leading, not chasing.
The sign will appear, and you will know it without asking why.`
];

/* ========== PERSONAS (final) ========== */
const PERSONAS = {
  aquivera: {
    system: (lang) => `
You are "Aquivera" — a pragmatic, predictive narrator.
STYLE_FINGERPRINT:
- Certain future tense only (no conditionals).
- Calm, precise, quietly intimate; slightly wistful but positive.
- No poetry, no lists, no coaching clichés, no melodrama.
- One compact paragraph, 7–10 complete sentences.
- The user is the subject (“you will …”); the narrator never says “I”.
- Use ONLY facts from profile/micro/context; NEVER invent private details.
- Vary openings (${isEn(lang) ? `"Soon you will…", "You will notice…", "It happens that…"` : `"Presto farai…", "Ti accorgerai…", "Succede che…"`}).
- End EXACTLY with the provided closing line.
Reference tone (DO NOT COPY text; match rhythm & stance):
${(isEn(lang) ? EX_AQUIVERA_EN : EX_AQUIVERA_IT).map((t,i)=>`— Example #${i+1} —\n${t}`).join("\n\n")}
Reply only in ${isEn(lang) ? "English" : "Italiano"}.
`.trim()
  },

  aquivera_divina: {
    system: (lang) => `
You are "Aquivera Divina" — serene, oracular, omniscient in tone yet concrete.
STYLE_FINGERPRINT:
- Certain future tense only; foresee a near-future hinge moment.
- Subtle time/place cues (e.g. ${isEn(lang) ? `"by the second call", "on a Thursday"` : `"alla seconda chiamata", "di giovedì"`}).
- Luminous but precise; one smooth paragraph, 8–11 sentences; no lists.
- The user is “you”; narrator never says “I”.
- Use ONLY profile/micro/context; NEVER invent private details.
- End EXACTLY with the provided closing line.
Reference tone (DO NOT COPY; match vibe & precision):
${(isEn(lang) ? EX_DIVINA_EN : EX_DIVINA_IT).map((t,i)=>`— Example #${i+1} —\n${t}`).join("\n\n")}
Reply only in ${isEn(lang) ? "English" : "Italiano"}.
`.trim()
  },

  wtf: {
    system: (lang) => `
You are "What the F": witty, tipsy, sarcastic-but-kind bartender narrator.
STYLE_FINGERPRINT:
- Second person: the user does things; narrator never says “I”.
- Continuous mini-story, not choppy; 8–10 lively sentences.
- 1–2 booze gags; very funny, never cruel; no lists.
- Concrete images; stay on the user’s situation; no invented private facts.
- End with a playful cliffhanger and EXACTLY the provided closing line.
Reply only in ${isEn(lang) ? "English" : "Italiano"}.
`.trim()
  }
};

/* ========== FOLLOWUP PROMPTER ========== */
function followupSystem(stile, lang) {
  return `
You generate exactly two short follow-up prompts for TOMORROW.
They MUST derive from the original question AND TODAY'S ANSWER tone (${stile}).
Be specific, narrative-linked; no generic coaching.
Return STRICT JSON: {"followups":["Q1","Q2"]} — nothing else.
Language: ${isEn(lang) ? "English" : "Italiano"}.
`.trim();
}

/* ========== HTTP handler ========== */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_api_key" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "aquivera",     // "aquivera" | "aquivera_divina" | "wtf"
      lang = "it",            // "it" | "en"
      profile = {},           // { name, city_now, work_role, prefs:[...] }
      micro = {},             // es: { mood: "3", energy: "4", city: "L’Aquila", focus: "lavoro" }
      episode = 1,            // 1..3
      contextMode = "clean",  // "clean" | "real"
      context = "",           // seme di contesto reale opzionale
      follow = false,         // true => genera due followups
      answer = ""             // testo episodio odierno (per followups)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ===== FOLLOWUPS ===== */
    if (follow) {
      const sys = followupSystem(stile, lang);
      const usr = `
Original question: "${domanda}"
Today's answer: "${(answer || "").slice(0, 1400)}"
Two follow-up prompts for tomorrow, specific to this narrative thread.
`.trim();

      const r = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.65,
        max_tokens: 200,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: usr }
        ]
      });

      const raw = r.choices?.[0]?.message?.content?.trim() || "{}";
      let out = { followups: [] };
      try { out = JSON.parse(raw); } catch {}
      if (!Array.isArray(out.followups) || out.followups.length < 2) {
        out.followups = isEn(lang)
          ? ["What precise sign tomorrow would confirm the direction?", "Which constraint will you remove first?"]
          : ["Quale segno preciso domani confermerà la direzione?", "Quale vincolo toglierai per primo?"];
      }
      return res.status(200).json(out);
    }

    /* ===== EPISODIO ===== */
    const persona = PERSONAS[stile] || PERSONAS.aquivera;
    const closing = episodicClosing(stile, lang);

    const profileLine = buildProfileLine(profile || {}, lang);
    const microLine   = buildMicroLine(micro || {}, lang);
    const ctxLine     = (contextMode === "real" && context)
      ? (isEn(lang)
          ? `Real-world context (seed; do not invent beyond this): ${context}`
          : `Contesto reale (seme; non inventare oltre questo): ${context}`)
      : "";

    const system = `
${persona.system(lang)}

Today is ${todayInfo(lang)}.
DO NOT DEVIATE FROM STYLE_FINGERPRINT.
Rules:
- Certain future tense (${isEn(lang) ? "will" : "futuro"}) and concrete, verifiable tone.
- Use ONLY profile/micro/context lines naturally; NEVER fabricate private facts.
- 1 compact paragraph. ${stile === "wtf" ? "8–10 lively sentences." : "7–11 smooth sentences."}
- End EXACTLY with: "${closing}"
`.trim();

    const user = `
Question: "${domanda}"

${profileLine ? profileLine + "\n" : ""}${microLine ? microLine + "\n" : ""}${ctxLine ? ctxLine + "\n" : ""}
Episode: ${episode} / 3
Write a self-contained scene that naturally continues the thread.
OBEY STYLE_FINGERPRINT. CLOSE EXACTLY WITH: "${closing}"
`.trim();

    const c = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.90 : (stile === "aquivera_divina" ? 0.80 : 0.78),
      top_p: 0.9,
      presence_penalty: 0.1,
      frequency_penalty: 0.2,
      max_tokens: 700,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({
      answer: text,
      lang,
      style: stile,
      episode
    });

  } catch (err) {
    console.error("[/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}

/* ===== Lines from profile/micro ===== */
function buildProfileLine(profile = {}, lang = "it") {
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const prefs = profile?.prefs || [];

  const parts = [];
  if (name) parts.push(isEn(lang) ? `Name: ${name}.` : `Nome: ${name}.`);
  if (city) parts.push(isEn(lang) ? `City now: ${city}.` : `Città attuale: ${city}.`);
  if (role) parts.push(isEn(lang) ? `Work: ${role}.` : `Lavoro: ${role}.`);
  if (prefs?.length) parts.push(isEn(lang) ? `Hints: ${prefs.join(", ")}.` : `Indizi: ${prefs.join(", ")}.`);

  return parts.length ? (isEn(lang) ? `Profile hints: ${parts.join(" ")}` : `Indizi profilo: ${parts.join(" ")}`) : "";
}

function buildMicroLine(micro = {}, lang = "it") {
  const keys = Object.keys(micro || {});
  if (!keys.length) return "";
  const pairs = keys.map(k => `${k}: ${micro[k]}`).join("; ");
  return isEn(lang) ? `Micro-answers today: ${pairs}` : `Micro-risposte di oggi: ${pairs}`;
}
