import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function detectLang(text = "") {
  const enHits = (text.match(/\b(what|if|you|move|work|city|buy|should)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|lavor|comprare|tornare|vivere|aquila)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

function classifyTopic(q = "") {
  const s = q.toLowerCase();
  if (/(moto|motor(e|bike)|scooter|vespa)/.test(s)) return "moto";
  if (/(tornare|trasferir|vivere|l'aquila|milano|roma|lugano)/.test(s)) return "trasferimento";
  if (/(lavoro|azienda|ufficio|job|career)/.test(s)) return "lavoro";
  if (/(comprare|acquistare|buy|purchase)/.test(s)) return "acquisto";
  return "generale";
}

function todayInfo(lang) {
  const d = new Date();
  const loc = isEn(lang) ? "en-GB" : "it-IT";
  return d.toLocaleDateString(loc, { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

/* === ESEMPI DEFINITIVI === */
const EXEMPLARS_IT = {
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
Ti vedo già al bancone, a dire “mi serviva cambiare aria”… mentre ordini il terzo corretto.
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
};

/* === PERSONALITÀ === */
const PERSONAS = {
  whatif: {
    system: (lang) => `
Sei "What?f": amico lucido e curioso, con tono allegro e realistico.
Parli come chi conosce bene l’utente, ma senza essere invadente.
Usa la seconda persona, frasi brevi e concrete (9-13 righe max).
Evita malinconia, poesia e retorica; sii ironico ma gentile.
Ogni risposta è come un piccolo episodio quotidiano, con un gancio finale per “domani”.
Mai inventare appartamenti, lavori o dettagli non citati.
Rispondi solo in ${isEn(lang) ? "English" : "Italiano"}.
`
  },
  wtf: {
    system: (lang) => `
Sei "What the F": amico da bar intelligente, sarcastico e affettuoso.
Parli come chi ti conosce bene, con tono ironico ma empatico.
Usa frasi brevi, ritmo secco e battute intelligenti.
Fai ridere senza essere cattivo, come uno che capisce la vita dopo tre bicchieri.
Inserisci una o due metafore da bancone per colore.
Ogni episodio si chiude con una frase tipo “domani vediamo...” o “stesso bancone domani”.
Rispondi solo in ${isEn(lang) ? "English" : "Italiano"}.
`
  }
};

/* === CLOSINGS === */
function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const soft = en
    ? ["Tomorrow we’ll see what happens next.", "Come back tomorrow for the next step."]
    : ["Domani vediamo che succede.", "Domani riprendiamo da qui.", "Domani un altro pezzo della storia."];
  const playful = en
    ? ["Same bar tomorrow, new story.", "Tomorrow, two quick questions and another drink of truth."]
    : ["Stesso bancone domani, nuova scena.", "Domani due domande e un sorso di verità."];
  return style === "wtf" ? pick(playful) : pick(soft);
}

/* === MIRROR OPENING === */
function mirrorLine(profile = {}, lang = "it") {
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || "";
  const base = [
    name ? `${name}, ti conosco: quando pensi troppo, in realtà stai solo cercando il ritmo giusto.` : "Ti conosco: quando pensi troppo, in realtà stai solo cercando il ritmo giusto.",
    city ? `${city} ti tiene con i piedi a terra, ma ogni tanto serve aria nuova.` : "A volte serve aria nuova, non una nuova vita.",
    role ? `E nel lavoro (${role}) lo sai: il caos non ti spaventa, ti annoia la ripetizione.` : "Il caos non ti spaventa, ti annoia la ripetizione."
  ];
  return pick(base);
}

/* === HANDLER === */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { domanda, lang = "auto", stile = "whatif", profilo = {}, stream = false } = req.body || {};
    if (!domanda) return res.status(400).json({ error: "missing_question" });

    const langReal = lang === "auto" ? detectLang(domanda) : lang;
    const topic = classifyTopic(domanda);
    const persona = PERSONAS[stile];
    const closing = episodicClosing(stile, langReal);
    const mirror = mirrorLine(profilo, langReal);
    const exemplars = EXEMPLARS_IT[stile] || [];

    const system = `
${persona.system(langReal)}
Oggi è ${todayInfo(langReal)}.
Rimani sul tema: "${topic}".
Tono coerente con gli esempi sotto (solo come riferimento, non copiare):
${exemplars.map((e, i) => `— Esempio #${i + 1} —\n${e}`).join("\n\n")}
`.trim();

    const user = `
${mirror}

Domanda: "${domanda}"

Scrivi una risposta nello stile "${stile}".
Chiudi con: "${closing}".
`.trim();

    const c = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.9 : 0.8,
      max_tokens: 700,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const answer = c.choices?.[0]?.message?.content?.trim() || "…";
    return res.status(200).json({ answer, lang: langReal, topic });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server_error", detail: e.message });
  }
}
