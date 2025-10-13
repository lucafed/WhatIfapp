// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";

/* ========= Utils ========= */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function detectLang(text = "") {
  // semplice euristica: se molti token inglesi, usa EN
  const enHits = (text.match(/\b(what|if|and|or|you|should|would|move|work|buy|motor|bike|city)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|moto|tornassi|trasferir|lavor|comprare|acquistare)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

function classifyTopic(q = "") {
  const s = q.toLowerCase();
  if (/(moto|motor(e|bike)|scooter|vespa)/.test(s)) return "moto";
  if (/(barca|vela|gommone|yacht|boat)/.test(s)) return "barca";
  if (/(tornassi|trasferi|trasloco|vivere a|l'aquila|aquila|verona|lugano|milano|roma|move|relocat)/.test(s)) return "città";
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

/* ========= Mirror (apertura confidenziale) ========= */
function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0] || "";
  const baseIt = [
    name ? `${name}, lo so: non cerchi drammi, cerchi mosse sensate.` : "Non cerchi drammi, cerchi mosse sensate.",
    "Ti piace quando le cose hanno un ritmo e un perché.",
    "Se capisci il quadro, decidi senza farla lunga."
  ];
  const baseEn = [
    name ? `${name}, you don’t chase drama — you chase moves that make sense.` : "You don’t chase drama — you chase moves that make sense.",
    "You like it when things have rhythm and a reason.",
    "Once you see the board clearly, you decide fast."
  ];
  return pick(en ? baseEn : baseIt);
}

/* ========= Clarify generator (sempre attinente) ========= */
function keywordHints(q) {
  const words = (q || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  const count = {};
  words.forEach((w) => (count[w] = (count[w] || 0) + 1));
  return Object.entries(count)
    .sort((a, b) => b[1] - a[1])
    .map((x) => x[0])
    .filter((w) => !["all", "the", "and", "con", "per", "una", "che", "come"].includes(w))
    .slice(0, 5);
}

function clarifyQuestions(domanda, periodo, lang = "it") {
  const en = isEn(lang);
  const topic = classifyTopic(domanda);
  const hints = keywordHints(domanda);
  const H = (it, enStr, phIt, phEn) => ({
    label: en ? enStr : it,
    placeholder: en ? phEn : phIt
  });

  if (topic === "moto") {
    return [
      H("Uso principale?", "Main use?", "casa-lavoro / weekend / viaggi", "commute / weekends / trips"),
      H("Finestra realistica per l’acquisto?", "Real purchase window?", "questo mese / 3–6 mesi", "this month / 3–6 months"),
      H("Tetto mensile totale (assicurazione+carburante+manut.)?", "Monthly ceiling (insurance+fuel+maint)?", "€ al mese", "$ per month")
    ];
  }
  if (topic === "città") {
    return [
      H("Perché proprio lì, adesso?", "Why there, now?", "famiglia / lavoro / aria nuova", "family / work / fresh start"),
      H("Qual è il segnale che ti direbbe ‘funziona’?", "What’s the signal that says ‘it works’?", "sonno / energia / risposta certa", "sleep / energy / clear callback"),
      H("Finestra reale per muoverti?", "Real window to move?", "entro 3 mesi / 6–12 mesi", "within 3 months / 6–12 months")
    ];
  }
  if (topic === "lavoro") {
    return [
      H("Obiettivo nei prossimi 6 mesi?", "Goal in 6 months?", "impatto / crescita / serenità", "impact / growth / calm"),
      H("Opzioni sul tavolo?", "Options on the table?", "restare / cambiare team / uscire", "stay / switch team / leave"),
      H("Vincolo concreto?", "Hard constraint?", "budget / tempo / persone", "budget / time / people")
    ];
  }
  // fallback: domande ancorate ai hints
  const k = hints[0] || (en ? "your topic" : "il tema");
  return [
    H(`Cosa vuoi ottenere su ${k}?`, `What do you want on ${k}?`, "1 riga concreta", "1 concrete line"),
    H("Finestra decisionale reale?", "Real decision window?", "questo mese / 3–6 / 12 mesi", "this month / 3–6 / 12 months"),
    H("Vincolo non negoziabile?", "Non-negotiable constraint?", "budget/tempo/energia", "budget/time/energy")
  ];
}

/* ========= PERSONAS (con esempi approvati) ========= */
const PERSONAS = {
  wtf: {
    // sarcastico, ironico, da bar, “lucidamente ubriaco”, mai cattivo
    system: (lang) => {
      const en = isEn(lang);
      return `
You are "What the F": late-night witty bartender — sarcastic, playful, warm, never mean.
One voice. Short, punchy, natural sentences (no fragment spam).
Make the user LAUGH and feel seen. No cynicism or gloom.
Forbidden words: hero, champion, destiny, dream, fairytale (and Italian equivalents).

Hard rules:
- Reply ONLY in ${en ? "English" : "Italiano"}.
- 7–11 lines, one idea per line. No bullets, no numbered lists.
- No moralizing, no “how-to”. Avoid purple prose.
- Use the user's first name naturally if provided (max 1 time).
- Cap imagery to 1 tiny concrete detail (weather/object/sound) if any.
- End with a continuation hook like: "${en ? "Tomorrow I’ll ask you two micro-questions and we push the story forward." : "Domani ti faccio due micro-domande e spingiamo avanti la storia."}"

Examples to imitate (do NOT rewrite them unless the user’s question is the same; they define tone):

[EXAMPLE — L’Aquila]
"Tornare all’Aquila? Grande mossa: aria fresca, montagne gratis e caffè che sa di chiacchiera vera. Qui anche il traffico ha la decenza di salutarti prima di bloccarti. Ti siedi al bancone, il barista ti riconosce e finge di non sapere quante ne hai bevute. Parli, ridi, qualcuno ti offre un giro e all’improvviso il tempo smette di correre. Non c’è cinismo, solo quel tipo di confusione che fa bene al fegato e all’anima. Dai, non sei scappato: hai solo cambiato musica. Clink. Stesso bancone, domani rimescoliamo."

[EXAMPLE — Moto (tono analogo, allegro, non cattivo)]
"Una moto? Bravo, ${en ? "my friend" : "amico"}: vento in faccia, parcheggi come se fossi VIP, e una scusa onesta per allungare la strada al ritorno. Ti vedo già: casco in mano, sorriso scemo, e quella pace che arriva solo quando il motore fa ‘ok, ci sono anch’io’. I conti li fai, ma stavolta non ti rovinano la festa. Non stai comprando un capriccio: stai comprando chilometri di buon umore. ${en ? "Deal?" : "Si fa?"} (E no, non te la rubano: gliela fai ascoltare domani.)"
`.trim();
    }
  },
  whatif: {
    // empatico, asciutto, realistico-positivo, amico che ti conosce bene
    system: (lang) => {
      const en = isEn(lang);
      return `
You are "What?f": empathetic, clear, realistic-positive. A friend who knows the user well.
No melancholy. No poetry. Concrete, breathable writing.

Hard rules:
- Reply ONLY in ${en ? "English" : "Italiano"}.
- 9–12 compact sentences, natural flow. No bullets/lists.
- Minimal imagery (0–2 small touches). No metaphors chains.
- Use the user's first name naturally if provided (max 1 time).
- End with a continuation hook like: "${en ? "Tomorrow I’ll ask two micro-questions and we move the story one step." : "Domani ti faccio due micro-domande e la muoviamo di un passo."}"

Examples to imitate (tone, not content):

[EXAMPLE — L’Aquila]
"Non lo faresti per scappare, ma per respirare meglio. Ti serve ogni tanto: tornare dove le giornate hanno il ritmo giusto, dove ti basta poco per stare bene. All’Aquila potresti ricominciare senza dover ricominciare da zero — solo con un passo più tuo. La gente giusta, il caffè di sempre, e quella sensazione di ‘ok, adesso va bene così’. Quando succede, lo riconosci subito: non è nostalgia, è equilibrio che torna. Hai già girato la chiave, il resto prende forma domani."

[EXAMPLE — Moto (asciutto, concreto, positivo)]
"Se la prendi, cambia il modo in cui ti muovi e pensi al tempo. Smetti di ‘arrivare’ e inizi ‘a stare’ nel tragitto. Ti conosci: finché il perché resta acceso, la scelta tiene. La moto non risolve niente da sola, ma ti regala spazio mentale e due ore a settimana che senti davvero tue. Se questo è il punto, è già quasi deciso."
`.trim();
    }
  }
};

/* ========= User prompt builder ========= */
function buildUserPrompt({ domanda, lang, stile, topic, profile, clarifications }) {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0] || "";
  const mirror = mirrorLine(profile, lang);

  const closing = en
    ? "Tomorrow I’ll ask you two micro-questions and we push the story forward."
    : "Domani ti faccio due micro-domande e vediamo dove porta.";

  const guard = `
Hard constraints:
- Stay strictly on the inferred topic: "${topic}".
- No lists, no bullet points, no moralizing.
- Zero purple prose; keep it light, witty/clear.
- Do NOT invent jobs, apartments, or relationships not in the question.
- If name exists, weave it once, naturally: "${name || "(nessun nome)"}".
- The closing line MUST invite to continue tomorrow; do not add new questions today.
- Close with: "${closing}"
`.trim();

  const header = en ? "Write a single, flowing answer." : "Scrivi una singola risposta fluida.";

  const clar = Array.isArray(clarifications) ? clarifications.join(", ") : (
    clarifications && typeof clarifications === "object"
      ? Object.values(clarifications).join(", ")
      : ""
  );

  return `
${en ? "Mirror-opening" : "Apertura confidenziale"}: ${mirror}

${en ? "User question" : "Domanda"}: "${domanda}"
${en ? "Extra details" : "Dettagli"}: ${clar || (en ? "none" : "nessuno")}
${en ? "Style" : "Stile"}: ${stile === "wtf" ? (en ? "What the F (witty, boozy, warm)" : "What the F (ironico, da bar, caldo)") : (en ? "What?f (empathetic, dry, upbeat)" : "What?f (empatico, asciutto, positivo)")}
${guard}

${header}
`.trim();
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
      stile = "whatif",      // "wtf" | "whatif"
      stream = false,
      clarify = false,
      profilo = {},          // { name?, city_now?, role? } – opzionale
      clarifications = [],
      extra = ""             // ignorato volutamente per evitare incoerenze
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // lingua & topic
    const lang = langIn === "auto" ? detectLang(domanda) : langIn;
    const topic = classifyTopic(domanda);
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];

    /* ----- Clarify branch (sempre attinente alla domanda) ----- */
    if (clarify) {
      const qs = clarifyQuestions(domanda, periodo, lang);
      return res.status(200).json({ questions: qs });
    }

    /* ----- Generation branch ----- */
    const system = `
${persona.system(lang)}

Today: ${todayInfo(lang)}

REMEMBER:
- No melancholy. Keep it upbeat and human.
- No "eroe/campione/sogno/destino/fiaba" or their English equivalents.
- Natural sentences, not chopped. Punchy ≠ fragmented.
- Never output lists or numbered steps; keep one flowing paragraph (What?f) or 7–11 single lines (WTF).
`.trim();

    const user = buildUserPrompt({
      domanda,
      lang,
      stile,
      topic,
      profile: profilo || {},
      clarifications
    });

    const temperature = stile === "wtf" ? 0.95 : 0.82;
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
        stop: ["\n- ", "\n• ", "\n1. ", "\n2. ", "\n•\t"],
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
      max_tokens: 900,
      stop: ["\n- ", "\n• ", "\n1. ", "\n2. ", "\n•\t"],
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
