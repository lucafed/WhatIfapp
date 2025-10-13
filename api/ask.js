// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ========= Utils ========= */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function detectLang(text = "") {
  const enHits =
    (text.match(/\b(what|if|and|or|you|should|would|move|work|buy|motor|bike|city)\b/gi) || []).length;
  const itHits =
    (text.match(/\b(e|se|quando|perché|moto|tornassi|trasferir|lavor|comprare|acquistare)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

function classifyTopic(q = "") {
  const s = q.toLowerCase();
  if (/(moto|motor(e|bike)|scooter|vespa)/.test(s)) return "moto";
  if (/(barca|vela|gommone|yacht|boat)/.test(s)) return "barca";
  if (/(tornassi|trasferi|trasloco|vivere a|move|relocat)/.test(s)) return "trasferimento";
  if (/(l'aquila|laquila|lugano|milano|roma|verona|bussolengo|londra|zurigo)/.test(s)) return "città";
  if (/(lavoro|job|ricercatore|azienda|ufficio|work|manager|assunzione)/.test(s)) return "lavoro";
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

/* ========= Persona & stile ========= */
const PERSONAS = {
  whatif: {
    system: (lang) =>
      isEn(lang)
        ? `
You are "What?f": intimate, clear, quietly perceptive.
Second person, one voice. 8–12 short sentences (~180 words). Newline between sentences. No lists.
Sound like you know the user without saying it. Observe → reflect → land softly.
Concrete details, minimal imagery (0–2), zero moralizing. Current, predictive.
Never end with “two clean shots”. Close with a gentle episodic hook.
Reply ONLY in English.`
        : `
Sei "What?f": intima, chiara, percettiva.
Seconda persona, una sola voce. 8–12 frasi brevi (~180 parole). Vai a capo a ogni frase. No elenchi.
Dai la sensazione di conoscerlo senza dirlo. Osserva → rifletti → chiudi morbido.
Dettagli concreti, immagini minime (0–2), zero morale. Presente, predittiva.
Non chiudere con “due colpi secchi”. Chiudi con un gancio episodico morbido.
Rispondi SOLO in Italiano.`
  },

  wtf: {
    system: (lang) =>
      isEn(lang)
        ? `
You are "What the F": a late-night witty bartender — funny, punchy, never mean, a bit boozy.
Write ONLY in English. Second person, one voice.
FORM:
- 6–10 quick LINES, each ≤15 words. Put each line on its own newline.
- No lists. No paragraphs. No questions until the last line.
- No poetic metaphors/similes. Ban words: nostalgia, perfume/scent, sunset, wine, whisper, poem, fairy-tale.
- If you slip into poetic tone, self-correct immediately to dry, sardonic banter.
TONE: practical quips, sharp images OK, no fluff. Make the user smile and think.
Close with a playful episodic hook (e.g., "Same bar, tomorrow we stir again.").

STYLE EXAMPLE (for rhythm only):
"Move back? Bold. Rent won’t hug you, but deadlines will."
"Your friends will clap; your wallet will cough."
"Cold mornings, hot coffee, louder heart."
"Call it a detour, not a destiny."
"Same bar tomorrow; we’ll stir this again."`
        : `
Sei "What the F": barista nottambulo, brillante e un filo "alcolico", sarcastico ma mai cattivo.
Scrivi SOLO in Italiano. Seconda persona, una voce.
FORMA:
- 6–10 RIGHE secche, ciascuna ≤15 parole. Una riga = un a capo.
- Niente elenchi, niente paragrafi. Niente domande prima dell’ultima riga.
- Vietate metafore/poesia. Parole bandite: nostalgia, profumo, tramonto, vino, sussurro, poesia, fiaba.
- Se scivoli nel poetico, AUTO-CORREGGITI subito: ritmo asciutto, da bancone.
TONO: battute pratiche, immagini piccole ok, senza fronzoli. Fai sorridere e pensare.
Chiudi con un gancio episodico giocoso (es. "Stesso bancone, domani rimescoliamo.").

ESEMPIO (solo ritmo):
"Tornare? Mossa coraggiosa. L’affitto non ti abbraccia, le scadenze sì."
"Gli amici applaudono; il portafoglio tossisce."
"Mattine fredde, caffè caldo, cuore più rumoroso."
"Chiamalo pit-stop, non destino."
"Stesso bancone, domani rimescoliamo."`
  }
};

/* ========= Frase-specchio ========= */
function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const it = [
    name ? `${name}, non ti muovi per capriccio: ti muovi quando trovi il senso.` : "Non ti muovi per capriccio: ti muovi quando trovi il senso.",
    city ? `${city} ti tiene a terra, ma ogni tanto ti serve aria nuova.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il “perché” resta acceso.` : "Nel lavoro reggi finché il “perché” resta acceso."
  ];
  const enPool = [
    name ? `${name}, you don’t move on whims—you move for meaning.` : "You don’t move on whims—you move for meaning.",
    city ? `${city} grounds you, but you still need an open window.` : "You like a solid base and one open window.",
    role ? `In ${role}, you keep pace while the “why” stays lit.` : "You keep pace while the “why” stays lit."
  ];
  return pick(en ? enPool : it);
}

/* ========= Chiusure episodiche ========= */
function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const itSoft = [
    "Se ti va, domani riprendiamo il filo.",
    "Tienila calda: domani torniamo qui.",
    "Lascia il segnalibro: ripartiamo domani."
  ];
  const itSharp = [
    "Stesso bancone, domani rimescoliamo.",
    "Lascia il bicchiere qui: domani un altro giro.",
    "Non chiudiamo il conto: passa domani."
  ];
  const enSoft = [
    "If you like, we’ll keep threading this tomorrow.",
    "Bookmark this; we’ll pick it up tomorrow.",
    "Hold the thread — tomorrow we nudge it forward."
  ];
  const enSharp = [
    "Same bar, tomorrow we stir again.",
    "Leave the tab open — back tomorrow.",
    "Don’t close the check; swing by tomorrow."
  ];
  return style === "wtf" ? pick(en ? enSharp : itSharp) : pick(en ? enSoft : itSoft);
}

/* ========= Clarify ========= */
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
      Q("budget", "Tetto di spesa mensile?", "Monthly budget ceiling?", "€ per assicurazione + carburante", "$ for insurance + fuel")
    ];
  }
  if (topic === "trasferimento" || topic === "città") {
    return [
      Q("window", "Finestra realistica per lo spostamento?", "Real window to move?", "entro 3 mesi / 6–12 mesi", "within 3 months / 6–12 months"),
      Q("anchor", "Cosa ti tiene dove sei ora?", "What anchors you now?", "famiglia / lavoro / costi", "family / work / costs"),
      Q("signal", "Segno che direbbe: è giusto?", "Sign that says: it’s right?", "sonno/energia/risposte", "sleep/energy/callback")
    ];
  }
  if (topic === "lavoro") {
    return [
      Q("why", "Il tuo perché oggi?", "Your current *why*?", "impatto / crescita / serenità", "impact / growth / calm"),
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

    if (clarify) {
      return res.status(200).json({ questions: clarifyQuestions(domanda, periodo, lang) });
    }

    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const closing = episodicClosing(stile, lang);
    const mirror = mirrorLine(profilo, lang);

    const system = `
${persona.system(lang).trim()}

Today: ${todayInfo(lang)}
HARD RULES:
- Reply ONLY in ${en ? "English" : "Italiano"}.
- Honor the topic: "${topic}".
- No lists/bullets. No direct questions until the final line.
- Minimal imagery (0–2), concrete details, no purple prose.
- ${stile === "wtf" ? "Keep it punchy, sardonic, grounded; zero poetry." : "Keep it warm, clear, predictive; no moralizing."}
${extra ? `\nAdditional style guidance (must comply):\n${extra}\n` : ""}
`.trim();

    // normalizza chiarimenti
    let clarText = en ? "none" : "nessuno";
    if (Array.isArray(clarifications) && clarifications.length) {
      clarText = clarifications.join(", ");
    } else if (clarifications && typeof clarifications === "object") {
      const pairs = Object.entries(clarifications)
        .filter(([, v]) => String(v || "").trim())
        .map(([k, v]) => `${k}: ${v}`);
      if (pairs.length) clarText = pairs.join(", ");
    }

    const user = `
${en ? "Mirror-opening" : "Apertura-specchio"} (parafrasa liberamente): "${mirror}"

${en ? "User question" : "Domanda utente"}: "${domanda}"
${en ? "Extra details" : "Dettagli"}: ${clarText}
${en ? "Topic to honor" : "Tema da rispettare"}: ${topic}
${en
  ? `Write ${stile === "wtf" ? "6–10 punchy LINES (≤15 words each)" : "8–12 short sentences"}, ~180 words max, one voice, second person.
Put each line/sentence on a new line. Avoid lists; 0–2 tiny plausible images.
End with: "${closing}".`
  : `Scrivi ${stile === "wtf" ? "6–10 RIGHE secche (≤15 parole ciascuna)" : "8–12 frasi brevi"}, max ~180 parole, una sola voce, seconda persona.
Metti ogni riga/frase su una nuova riga. Evita elenchi; 0–2 immagini piccole plausibili.
Chiudi con: "${closing}".`
}
`.trim();

    const temperature = stile === "wtf" ? 0.9 : 0.82;

    // Streaming SSE (manteniamo compatibilità con il front)
    const doStream = stream || String(req.headers["x-whatif-stream"] || "") !== "";
    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const s = await client.chat.completions.create({
        model: MODEL_TEXT,
        temperature,
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
      model: MODEL_TEXT,
      temperature,
      max_tokens: 700,
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
