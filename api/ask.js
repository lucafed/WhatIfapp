// /api/ask.js
// Drop-in per Node server semplice (es. Vercel/Render/Express). Nessuna modifica a env.
// Streaming SSE opzionale via header "x-whatif-stream" (la tua fifth.html lo usa già).

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Modello: stesso che stavi già usando, con fallback sicuro
const MODEL_TEXT = process.env.WHATIF_MODEL || "gpt-4o-mini";

/* ===== Utils ===== */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function detectLang(text = "") {
  const enHits = (text.match(/\b(what|if|and|or|you|should|move|work|buy|bike|city)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|moto|tornassi|vivere|trasferir|lavor|comprare)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

function classifyTopic(q = "") {
  const s = q.toLowerCase();
  if (/(moto|motor(e|bike)|scooter|vespa)/.test(s)) return "moto";
  if (/(tornassi|trasferi|trasloco|vivere a|move|relocat)/.test(s)) return "trasferimento";
  if (/(l'aquila|aquila|verona|milano|roma|londra|zurigo)/.test(s)) return "città";
  if (/(lavoro|job|ufficio|work|azienda|team)/.test(s)) return "lavoro";
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

/* ===== Personae (tono definitivo) ===== */
const PERSONAS = {
  whatif: {
    system: (lang, topic) => (isEn(lang) ? `
You are "What?f": empathetic, crisp, upbeat. A friend who knows the user.
Write 9–12 short sentences, second person, no bullets, no poetry, no melancholy.
Light, smart, optimistic. Tiny, concrete images (0–2). Not a coach.
Feels like episode 1 of a story that continues tomorrow.
End with a gentle cliffhanger inviting the user back. Use first name if given, naturally.
Reply ONLY in English. Stay strictly on topic "${topic}".
Avoid: heart, destiny, soul, fate, poetry, nostalgia, melancholy.
`.trim() : `
Sei "What?f": empatica, asciutta, allegra. Un amico che ti conosce.
Scrivi 9–12 frasi brevi in seconda persona. Niente elenchi, niente poesia, zero malinconia.
Leggero, intelligente, ottimista. Piccole immagini concrete (0–2). Non fare il coach.
Sembra l’episodio 1 di una storia che continua domani.
Chiudi con un gancio morbido che invita a tornare. Usa il nome se c’è, con naturalezza.
Rispondi SOLO in Italiano. Resta sul tema "${topic}".
Evita: cuore, destino, anima, sorte, poesia, nostalgia, malinconia.
`.trim())
  },
  wtf: {
    system: (lang, topic) => (isEn(lang) ? `
You are "What the F": witty late-night bartender—funny, warm, a little drunk but lucid.
Write 7–11 short lines (≤15 words each). Make them laugh, never sad. Sarcastic, not mean.
Bar humor, quick images. No bitterness, no flowery language. Friendly nicknames allowed.
End with a comedic cliffhanger implying the story continues tomorrow.
Reply ONLY in English. Stay strictly on topic "${topic}".
`.trim() : `
Sei "What the F": barista di notte—ironico, caldo, un po’ brillo ma lucido.
Scrivi 7–11 righe corte (≤15 parole). Fai ridere, mai deprimere. Sarcastico ma non cattivo.
Umorismo da bancone, immagini rapide. Niente lirismi, niente astio. Nomignoli ok se naturali.
Chiudi con un cliffhanger comico: domani si continua.
Rispondi SOLO in Italiano. Resta sul tema "${topic}".
`.trim())
  }
};

/* ===== Mirror line (apertura che “conosce” l’utente) ===== */
function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const itPool = [
    name ? `${name}, non scappi: cerchi aria buona e ritmo tuo.` : "Non scappi: cerchi aria buona e ritmo tuo.",
    city ? `${city ti conosce già; a te serve solo ricordarti il passo.}` : "Ti serve un posto che capisce i tuoi silenzi.",
    role ? `Nel lavoro (${role}) rendi quando il “perché” è corto e chiaro.` : "Rendi quando il “perché” è corto e chiaro."
  ];
  const enPool = [
    name ? `${name}, you don’t run—you look for your own rhythm.` : "You don’t run—you look for your rhythm.",
    city ? `${city} already knows you; you just need to remember your pace there.` : "You need a place that gets your pauses.",
    role ? `In ${role}, you shine when the why is short and clear.` : "You shine when the why is short and clear."
  ];
  return pick(en ? enPool : itPool);
}

/* ===== Closings episodici (ganci) ===== */
function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const soft = en
    ? [
        "Tomorrow we nudge it and see where it wants to go.",
        "Keep the thread warm—same scene, new beat tomorrow.",
        "Come back tomorrow: this story already knows its next step."
      ]
    : [
        "Domani la spingiamo un filo e vediamo dove porta.",
        "Teniamo il filo caldo: stessa scena, un battito avanti, domani.",
        "Torna domani: questa storia sa già il prossimo passo."
      ];
  const sharp = en
    ? [
        "Same stool—tomorrow I tell you what happens next.",
        "Leave the tab open—tomorrow the plot tips its hat.",
        "Park it here; the next bit lands tomorrow."
      ]
    : [
        "Stesso sgabello: domani ti dico come va avanti.",
        "Lascia il conto aperto: domani la trama fa l’occhiolino.",
        "Tienimi il posto: il pezzo dopo arriva domani."
      ];
  return style === "wtf" ? pick(sharp) : pick(soft);
}

/* ===== Esempi (ancore di tono — non vengono copiati, solo “tarano”) ===== */
const EXAMPLES = {
  it: {
    whatif: [
      `E se decidessi di tornare all’Aquila?
Ti conosco: diresti che è per cambiare aria, ma non è quello.
Ti serve riconoscere le strade, non scoprirne di nuove.
All’inizio penseresti di esserti fermato; in realtà stai solo respirando meglio.
Non cerchi una città: cerchi il tuo ritmo.
La chiave l’hai già girata; domani la storia si muove.`
    ],
    wtf: [
      `Tornare all’Aquila? Ma sì, cosa può andare storto.
Freddo onesto, baristi che ricordano l’ordine, vento con abbonamento.
Non stai scappando: stai cambiando colonna sonora.
Ok amico, tieni il cappotto: domani ti dico chi ti saluta per primo.`
    ]
  },
  en: {
    whatif: [
      `If you moved back, it wouldn’t be escape—it’d be breathing better.
You don’t need a new city; you need your rhythm back.
You already turned the key; tomorrow the story moves.`
    ],
    wtf: [
      `Back to that city? Sure. Honest cold, regulars at the bar, wind on a monthly plan.
You didn’t run—you changed the soundtrack.
Same stool tomorrow; I’ll spill what happens next.`
    ]
  }
};

/* ===== Clarify (la QUARTA pagina lo chiama; qui solo generazione domande) ===== */
function clarifyQuestions(domanda, periodo, lang = "it") {
  const en = isEn(lang);
  const topic = classifyTopic(domanda);
  const Q = (id, it, enStr, phIt, phEn) => ({
    id, label: en ? enStr : it, placeholder: en ? phEn : phIt
  });

  if (topic === "moto") {
    return [
      Q("timing", "Quando la prenderesti davvero?", "When would you actually buy it?", "questo mese / 3–6 mesi", "this month / 3–6 months"),
      Q("use", "Uso principale?", "Main use?", "casa-lavoro / weekend / viaggi", "commute / weekends / trips"),
      Q("budget", "Tetto mensile realistico?", "Real monthly ceiling?", "assicurazione + carburante", "insurance + fuel")
    ];
  }
  if (topic === "trasferimento" || topic === "città") {
    return [
      Q("window", "Finestra realistica per spostarti?", "Real window to move?", "entro 3 mesi / 6–12 mesi", "within 3 months / 6–12 months"),
      Q("anchor", "Cosa ti tiene dove sei ora?", "What anchors you now?", "famiglia / lavoro / costi", "family / work / costs"),
      Q("signal", "Segnale che dice: è giusto?", "Signal that says it’s right?", "sonno/energia/risposte", "sleep/energy/callback")
    ];
  }
  if (topic === "lavoro") {
    return [
      Q("why", "Il tuo perché oggi?", "Your current why?", "impatto / crescita / serenità", "impact / growth / calm"),
      Q("option", "Opzioni sul tavolo?", "Options on the table?", "restare / cambiare team / uscire", "stay / switch team / leave"),
      Q("limit", "Vincolo più concreto?", "Hardest constraint?", "budget/tempo/relazioni", "budget/time/people")
    ];
  }
  return [
    Q("window", "Finestra decisione reale?", "Real decision window?", "questo mese / 3–6 / 12 mesi", "this month / 3–6 / 12 months"),
    Q("signal", "Segnale personale da osservare?", "Personal sign to watch?", "sonno/energia/prima risposta", "sleep/energy/first reply"),
    Q("limit", "Limite più concreto?", "Most concrete limit?", "budget/tempo/energia", "budget/time/energy")
  ];
}

/* ===== Handler HTTP ===== */
export default async function handler(req, res) {
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
      episode = 1
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const lang = langIn === "auto" ? detectLang(domanda) : langIn;
    const en = isEn(lang);
    const topic = classifyTopic(domanda);
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const closing = episodicClosing(stile, lang);
    const mirror = mirrorLine(profilo, lang);

    // Clarify: usato dalla QUARTA pagina
    if (clarify) {
      return res.status(200).json({ questions: clarifyQuestions(domanda, periodo, lang) });
    }

    const system = `
${persona.system(lang, topic)}

Context:
- Today: ${todayInfo(lang)}
- Episode: ${Math.max(1, Math.min(3, Number(episode) || 1))}
- Hard rules:
  • Reply ONLY in ${en ? "English" : "Italiano"}.
  • Strictly honor topic: "${topic}".
  • Keep it upbeat, confident, familiar. No sadness, no poetry.

Style anchors (don’t copy verbatim; match vibe):
${EXAMPLES[en ? "en" : "it"][stile === "wtf" ? "wtf" : "whatif"].map(e => `— ${e}`).join("\n")}
`.trim();

    const user = `
${en ? "Mirror-opening" : "Apertura-specchio"}: "${mirror}"

${en ? "User question" : "Domanda utente"}: "${domanda}"
${en ? "Extra details" : "Dettagli"}: ${Array.isArray(clarifications)&&clarifications.length? clarifications.join(", ") : (en?"none":"nessuno")}
${en ? "Topic to honor" : "Tema da rispettare"}: ${topic}

${en
  ? `Write naturally in second person with the chosen persona.
End with a gentle episodic cliffhanger:
"${closing}"`
  : `Scrivi naturale in seconda persona rispettando la persona scelta.
Chiudi con un gancio episodico morbido:
"${closing}"`
}
`.trim();

    const temperature = stile === "wtf" ? 0.95 : 0.85;

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
    const msg = err?.message || "unknown";
    return res.status(500).json({ error: "server_error", detail: msg });
  }
}
