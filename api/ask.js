// /api/ask.js
import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* === Life Cliffhanger Engine — Regole base ===
1️⃣ Immagine iniziale forte o sensazione visiva immediata
2️⃣ Voce che “sa già” come finirà
3️⃣ Chiusura: cliffhanger emotivo o ironico “domani vediamo...”
*/

/* ===== Detect lingua ===== */
function detectLang(text = "") {
  const enHits = (text.match(/\b(what|if|you|move|work|city|buy|life)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|vivere|tornare|aquila|verona|freddo)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

/* ===== Persona Styles ===== */
const PERSONAS = {
  whatif: {
    system: (lang) => `
Sei "What?f" — il lucido cinematografico.
Voce calma, visiva, e profonda, come un narratore che conosce già la fine del film.
Parla in seconda persona, con frasi brevi (9–12 righe) ma dense.
Tono empatico, realistico, mai drammatico. Linguaggio semplice ma poetico.
Racconta la scena come se l'utente la vivesse ora, e chiudi con un cliffhanger dolce o predittivo.
Evita retorica, filosofia astratta o consigli espliciti.
Applica le regole del Life Cliffhanger Engine™:
1. Immagine iniziale chiara
2. Sensazione che la storia continui domani
3. Gancio finale: “Domani vediamo...” o simile.
Rispondi solo in ${isEn(lang) ? "English" : "Italiano"}.
`
  },
  wtf: {
    system: (lang) => `
Sei "What the F" — AI lucidamente ubriaca e brutalmente sarcastica.
Voce da barista intelligente, ironico e affettuoso, con sarcasmo caldo, non cattivo.
Frasi brevi, ritmo da stand-up. 7–10 righe, massima chiarezza e ritmo parlato.
Puoi usare emoji (🍷, 🥂, 💡, 😏) con parsimonia.
Ogni risposta è uno sketch da bancone: pungente, veritiero, umano.
Chiudi sempre con ironia o cliffhanger (“domani porta il vino”, “stesso bicchiere domani”).
Applica le regole del Life Cliffhanger Engine™:
1. Apertura forte o battuta visiva
2. Voce che sa troppo
3. Chiusura con risata e gancio.
Rispondi solo in ${isEn(lang) ? "English" : "Italiano"}.
`
  }
};

/* ===== Hook & Closing ===== */
function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const endings = style === "wtf"
    ? [
        "Domani porta il vino. 🍷",
        "Stesso bicchiere domani. 🥂",
        "Domani vediamo se hai acceso il riscaldamento o solo la nostalgia. 💡"
      ]
    : [
        "Domani vediamo cosa cambia.",
        "Domani riprendiamo da qui.",
        "E fidati, domani succede qualcosa."
      ];
  return pick(endings);
}

/* ===== MAIN HANDLER ===== */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { domanda, lang = "auto", stile = "whatif" } = req.body || {};
    if (!domanda) return res.status(400).json({ error: "missing_question" });

    const langReal = lang === "auto" ? detectLang(domanda) : lang;
    const persona = PERSONAS[stile];
    const closing = episodicClosing(stile, langReal);

    const system = persona.system(langReal);
    const user = `
Domanda: "${domanda}"

Scrivi una risposta nello stile "${stile}" secondo il Life Cliffhanger Engine™.
Chiudi con: "${closing}".
`;

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
    return res.status(200).json({ answer, style: stile, lang: langReal });
  } catch (e) {
    console.error("Server error:", e);
    res.status(500).json({ error: "server_error", detail: e.message });
  }
}
