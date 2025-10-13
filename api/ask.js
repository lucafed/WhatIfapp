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
  if (/(tornassi|trasferi|trasloco|vivere a|move|relocat)/.test(s)) return "trasferimento";
  if (/(aquila|l'aquila|verona|milano|roma|lugano|londra|zurigo)/.test(s)) return "città";
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

/* ========= Parole vietate (anti-lirismo) ========= */
const BAN_IT = [
  "aria","accarezza","profuma","montagne","silenzio","eco",
  "nostalgia","anima","cuore","tramonto","dipinto","abbraccia",
  "fiaba","poesia","sussurra","orizzonti","respiro","orizzonte",
  "carezza","magia","magico","fiori","fiore","cielo","stelle",
];

function listBan(lang){
  return (lang?.startsWith("en") ? [] : BAN_IT).map(w => `"${w}"`).join(", ");
}

/* ========= Personae ========= */
const PERSONAS = {
  whatif: {
    system: (lang) => `
Sei "What?f".
Scrivi RIGOROSAMENTE in ${lang?.startsWith("en") ? "English" : "Italiano"}.
Voce unica, seconda persona. Zero virgolette, zero elenchi.
8–12 frasi corte (~150–180 parole). Una frase per riga.
Tono: lucido, concreto, NON malinconico. Niente moralismi.
Evita parole liriche vietate: ${listBan(lang)}.
Regole di contenuto:
- 1 primo passo piccolo e pratico (es. una chiamata/20 minuti/entro domani).
- 1 trade-off reale (costo/tempo/energia).
- 1 segnale misurabile di riuscita (es. € risparmiati, una risposta, 30 giorni).
- 0–2 micro-immagini plausibili, mai poetiche.
- Chiudi SEMPRE con un gancio emotivo sobrio (es. “Domani riprendiamo il filo.”).

Formato: righe a capo, niente domande a metà testo; al massimo nell’ultima riga in forma di gancio.
`.trim()
  },
  wtf: {
    system: (lang) => `
Sei "What the F".
Scrivi RIGOROSAMENTE in ${lang?.startsWith("en") ? "English" : "Italiano"}.
Barista nottambulo: sarcastico, brillante, un filo “alcolico”, mai cattivo.
6–10 righe secche, ≤15 parole a riga. Una battuta per riga. Zero virgolette, zero elenchi.
Vietate parole liriche: ${listBan(lang)}.
Consentiti: battute pratiche, paragoni terra-terra, autoironia, verità scomode.
Chiudi SEMPRE con un gancio comico: “Stesso bancone, domani rimescoliamo.” o simili.
`.trim()
  }
};

/* ========= Few-shot: esempi di tono (IT) ========= */
const EXAMPLES_IT = [
  // WHATIF
  {
    role: "system",
    content: `Esempio WHAT?F – Moto:
Decidi di comprarla davvero.
All’inizio è curiosità, poi diventa spazio mentale.
Primo passo: un’ora con un usato affidabile, entro domani.
Trade-off: assicurazione e manutenzione che bussano ogni mese.
Segnale di riuscita: 3 uscite nelle prime 4 settimane, senza rimpianti.
Scopri che il rumore nel casco non è fuga: è ordine.
Se ti accorgi che dormi meglio e ti muovi di più, sta funzionando.
Domani riprendiamo il filo.`
  },
  {
    role: "system",
    content: `Esempio WHAT?F – Tornare all’Aquila:
Ritrovi ritmo e facce note, ma non cerchi il passato: cerchi modo.
Primo passo: due telefonate, uno studio e una persona chiave, entro venerdì.
Trade-off: stipendi e opportunità meno elastici, più spostamenti.
Segnale di riuscita: una proposta concreta in 30 giorni, agenda piena di nomi reali.
Scopri che ti serve un motivo, non un ricordo.
Se lo senti, resta. Se non lo senti, riparti.
Il resto te lo racconto domani.`
  },

  // WTF
  {
    role: "system",
    content: `Esempio WTF – Moto:
Moto nuova? Ottimo. Così il conto in banca prova l’adrenalina pure lui.
Il vento è gratis, le gomme no.
Gli amici dicono “prendila usata”. Gli amici hanno ragione.
Se la compri per fare colpo, fai prima col casco.
Fallo, ma ricordati che la benzina non accetta scuse.
Stesso bancone, domani rimescoliamo.`
  },
  {
    role: "system",
    content: `Esempio WTF – Tornare all’Aquila:
Torna pure. Le zie sono già pronte col “allora, il lavoro?”.
Dopo due settimane saluti i piccioni per avere novità.
Il freddo è onesto: ti congela senza chiacchiere.
La città ti piace? Bene. Il mutuo meno.
Se resti, che sia per scelta, non per coperta.
Stesso bancone, domani rimescoliamo.`
  },
];

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

    /* ----- System persona + hard rules ----- */
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const system = `
${persona.system(lang)}

Oggi: ${todayInfo(lang)}
Hard rules:
- Answer ONLY in ${en ? "English" : "Italiano"}.
- Stay strictly on topic: "${topic}".
- No bullet points. No quotes. No emojis.
- Minimal imagery, concrete outcomes. No melancholic tone.
${extra ? `\n(Additional guidance)\n${extra}\n` : ""}
`.trim();

    /* ----- Few-shot esempi di tono (solo IT qui) ----- */
    const fewShot = lang.startsWith("en") ? [] : EXAMPLES_IT;

    /* ----- Prompt utente ----- */
    const user = `
Domanda utente: "${domanda.trim()}"
Dettagli extra: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : "nessuno"}
Stile richiesto: ${stile === "wtf" ? "What the F (sarcastico, righe secche)" : "What?f (lucido, concreto, gancio finale)"}
Scrivi come negli esempi sopra, rispettando lunghezze e chiusure.
`.trim();

    const temperature = stile === "wtf" ? 0.85 : 0.70;

    // Streaming
    const doStream = stream || String(req.headers["x-whatif-stream"] || "") !== "";
    const messages = [{ role: "system", content: system }, ...fewShot, { role: "user", content: user }];

    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      const s = await client.chat.completions.create({
        model: MODEL_TEXT,
        temperature,
        stream: true,
        max_tokens: 700,
        messages
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
      messages
    });
    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text, lang, topic });

  } catch (err) {
    console.error("API /ask error:", err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
