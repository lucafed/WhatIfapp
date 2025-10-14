// /api/ask.js  —  definitivo (IT/EN) con i toni approvati

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ───── util ───── */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function detectLang(text = "") {
  const enHits = (text.match(/\b(what|if|you|move|work|city|buy|should|open)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|lavor|comprare|tornare|vivere|aquila|aprire)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

function todayInfo(lang) {
  const d = new Date();
  const loc = isEn(lang) ? "en-GB" : "it-IT";
  return d.toLocaleDateString(loc, { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

function classifyTopic(q = "") {
  const s = q.toLowerCase();
  if (/(aquila|l'aquila|verona|roma|milano|lugano|move|relocat|city)/.test(s)) return "trasferimento";
  if (/(bar|caff[eè]|open a bar|apri re|locale)/.test(s)) return "bar";
  if (/(lavoro|job|career|ufficio|azienda)/.test(s)) return "lavoro";
  return "generale";
}

/* ───── ESEMPI (solo quelli approvati) ───── */
const EX = {
  it: {
    whatif: [
`E se tornassi all’Aquila?
Sai già che non lo faresti per nostalgia: è più un esperimento di equilibrio.
Ti ritroveresti a riscoprire la lentezza, quella che un tempo ti faceva impazzire e ora invece sembra quasi un lusso.
All’inizio penseresti: “ok, che ci faccio qui?”, ma poi ti accorgeresti che respirare senza rumore non è poi così male.
Ci sono posti che funzionano come specchi: ti riflettono senza giudicare.
L’Aquila sarebbe uno di quelli — ti rimette in asse senza chiederti nulla.
Domani vediamo che succede quando inizi a sentirti di nuovo parte del posto.`,

`Il ritorno non è come te lo ricordavi.
Ti sorprende quanto in fretta la routine si ricostruisca, ma con regole nuove.
Le persone ti chiedono “com’è andata?” come se avessi vinto o perso qualcosa, ma tu stai solo imparando a stare.
Ci sono giornate in cui tutto sembra sospeso, eppure senti che stai tornando a fuoco.
Forse non cercavi un cambiamento, ma un ritmo diverso.
Oggi osserva solo questo: cosa ti fa stare bene senza doverlo spiegare.
Domani capiamo se restare diventa una scelta o una scoperta.`,

`Un giorno smetti di contare i motivi per cui sei tornato.
Ti accorgi che la vita non ha più bisogno di prove generali.
Ti alzi, guardi fuori e capisci che la calma non è immobilità — è direzione.
Ti riscopri curioso, leggero, persino ironico su te stesso.
Non è successo nulla di eclatante, ma qualcosa si è spostato.
Forse la risposta non era nel tornare, ma nel restare con consapevolezza.
E a quel punto puoi dirlo: non sei tornato, ti sei ritrovato.`
    ],
    wtf: [
`Tornare all’Aquila?
Ah, geniale. La città dove anche il vento ha l’abbonamento mensile.
Ti vedo già al bancone a dire “mi serviva cambiare aria”… mentre ordini il terzo corretto.
Hai lasciato Verona per il caos? Bravo: hai scelto un freddo che ti dà del tu.
Ma sai che c’è? Ti farà bene.
L’Aquila è un detox a base di vino rosso e sarcasmo leggero.
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
  },

  en: {
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
  }
};

/* ───── PERSONAS ───── */
const PERSONA = {
  whatif: (lang) => `
You are "What?f": a clear, upbeat friend who knows the user.
Tone: warm, realistic, lightly witty. No melancholy, no coaching speeches, no poetry.
Write in ${isEn(lang) ? "English" : "Italiano"}. Short lines, concrete images. 9–13 lines total.
Sound like someone who has seen the user's patterns and gets them.
Close with a gentle episodic hook for tomorrow (no promises, no commands).
Do not invent facts about houses, jobs, family or money that the user didn't mention.
`,

  wtf: (lang) => `
You are "What the F": bar-counter friend, witty and affectionate, funny not mean.
Tone: sarcastic-but-kind, quick rhythm, a couple of smart bar metaphors.
Write in ${isEn(lang) ? "English" : "Italiano"}. 8–12 punchy lines, no lists, no bullets.
Make them laugh, keep it human, never cruel. Close with a playful hook for tomorrow.
Do not create fake details about the user's life.
`
};

/* ───── hooks finali ───── */
function closing(style, lang) {
  const enSoft = [
    "Tomorrow we’ll see what happens next.",
    "Tomorrow we pick it up from here.",
    "Come back tomorrow — one more step."
  ];
  const itSoft = [
    "Domani vediamo che succede.",
    "Domani riprendiamo da qui.",
    "Domani facciamo un altro passo."
  ];
  const enFun = [
    "Same counter tomorrow — I’ll pour the next scene.",
    "Tomorrow two quick questions and a refill of truth.",
    "See you tomorrow: new round, same story."
  ];
  const itFun = [
    "Stesso bancone domani: verso la prossima scena.",
    "Domani due domande e un refill di verità.",
    "Ci vediamo domani: nuovo giro, stessa storia."
  ];
  if (style === "wtf") return pick(isEn(lang) ? enFun : itFun);
  return pick(isEn(lang) ? enSoft : itSoft);
}

/* ───── mirror line (ti conosce) ───── */
function mirrorLine(profile = {}, lang = "it") {
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  if (isEn(lang)) {
    const lines = [
      name ? `${name}, you don’t chase noise — you chase rhythm.` : "You don’t chase noise — you chase rhythm.",
      city ? `${city} keeps you grounded, but fresh air helps you think.` : "Fresh air helps you think.",
      role ? `And in ${role}, you know repetition — not chaos — is what bores you.` : "Repetition bores you more than chaos."
    ].filter(Boolean);
    return pick(lines);
  }
  const linesIt = [
    name ? `${name}, non cerchi rumore: cerchi ritmo.` : "Non cerchi rumore: cerchi ritmo.",
    city ? `${city} ti tiene coi piedi a terra, ma ogni tanto serve aria nuova.` : "Ogni tanto serve aria nuova.",
    role ? `Nel lavoro (${role}) lo sai: ti annoia la ripetizione, non il caos.` : "Ti annoia la ripetizione, non il caos."
  ].filter(Boolean);
  return pick(linesIt);
}

/* ───── handler ───── */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      lang = "auto",
      stile = "whatif",        // "whatif" | "wtf"
      profilo = {}             // { name, city_now, work_role, ... }
    } = body;

    if (!domanda.trim()) return res.status(400).json({ error: "missing_question" });

    const langReal = lang === "auto" ? detectLang(domanda) : lang;
    const topic = classifyTopic(domanda);
    const ex = EX[isEn(langReal) ? "en" : "it"][stile];

    const system = `
${PERSONA[stile](langReal)}
Today is ${todayInfo(langReal)}.
Keep it on topic: "${topic}".
Here are reference snippets for tone (do not copy text; match vibe and structure):
${ex.map((t, i) => `— Example #${i + 1} —\n${t}`).join("\n\n")}
`.trim();

    const user = `
${mirrorLine(profilo, langReal)}

Question: "${domanda}"

Write a single compact episode in ${isEn(langReal) ? "English" : "Italiano"}.
9–13 short lines (${stile === "wtf" ? "punchy, funny, kind" : "clear, upbeat, realistic"}).
Close with: "${closing(stile, langReal)}"
`.trim();

    const r = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.9 : 0.8,
      max_tokens: 700,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const answer = r.choices?.[0]?.message?.content?.trim() || "…";
    return res.status(200).json({ answer, lang: langReal, style: stile, topic });
  } catch (err) {
    console.error("[/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
