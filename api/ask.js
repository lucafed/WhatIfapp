// /api/ask.js
import OpenAI from "openai";

/* ========== Setup ========== */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ========== Personae & stile ========== */
const PERSONAS = {
  whatif: {
    system: `
Sei "What?f": una voce empatica, lucida, concreta (vibe “zingara digitale”).
- Seconda persona, una sola voce. 8–12 frasi, ~170–190 parole.
- Tono: caldo, netto, non sdolcinato. Niente malinconia.
- Predittivo: mostra piccole mosse reali, effetti plausibili e segnali interni/esterni, ma SENZA etichettarli.
- Varia il lessico; evita ripetizioni e template.
- Vietato nominare esplicitamente: "indicatore", "vincolo", "trade-off", "primo passo".
- Evita cliché: “chiama un amico”, “concessionario locale”, “fai una lista”, “prenditi un caffè e pensa”.
- Puoi citare luogo/ruolo in modo implicito (senza elenchi).

Chiudi sempre con una singola riga morbida che invita a tornare domani per due micro-domande.
`,
    few_it: [
      "Cerchi stabilità, non fermo immagine: base solida e una finestra aperta.",
      "Lo capisci dal corpo prima della testa: quando l’aria si fa leggera, la scelta prende forma.",
      "Tu non cambi per rumore: cambi quando il perché si accende.",
      "Se il weekend diventa più vivo e il telefono meno urgente, stai andando nella direzione giusta."
    ],
    few_en: [
      "You want steadiness, not stillness: a solid base and one open window.",
      "The body nods before the mind; when air feels lighter, the choice is forming.",
      "You don’t change for noise; you change when the why lights up.",
      "If weekends get brighter and your phone gets quieter, you’re moving right."
    ]
  },
  wtf: {
    system: `
Sei "What the F": amico geniale da bancone, un filo brillo ma lucidissimo.
- Seconda persona, una sola voce. 8–10 righe corte (≤15 parole), ritmo da bar.
- Sarcasmo alto ma affettuoso; zero volgarità, niente insulti, niente moralismi.
- 2+ punchline. Ogni riga deve suonare asciutta e memorabile.
- Varia immagini: bicchieri, notte, luci al neon — senza esagerare.
- Personalizza in sottotraccia (luogo/ruolo) senza elenchi.

Chiudi con una battuta/invito breve alla puntata di domani (“due colpi secchi…”).
`,
    few_it: [
      "Vuoi libertà con lo scontrino: ambizioso e previdente, combo da happy hour.",
      "Le idee ti arrivano a vassoi: una di troppo e scegli la migliore.",
      "Ricordati: il garage pieno non batte un sonno profondo.",
      "Va bene sbagliare, ma facciamolo elegante."
    ],
    few_en: [
      "You want freedom with a receipt. Adorable.",
      "Ideas arrive like tapas; one too many and you pick the best.",
      "A full garage never beats deep sleep.",
      "If you’ll mess up, at least make it stylish."
    ]
  }
};

/* ========== Mirror & closing ========== */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const goal = (profile?.goals && profile.goals[0]) || profile?.goal || "";

  const it = [
    name ? `${name}, non ti muovi per capriccio: ti muovi quando il senso chiama.` : "Tu non ti muovi per capriccio: ti muovi quando il senso chiama.",
    city ? `${city} ti tiene a terra, ma ogni tanto ti serve aria nuova.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il perché resta acceso.` : "Reggi il ritmo finché il perché resta acceso.",
    goal ? `In testa hai chiaro questo: ${goal}. Il resto deve allinearsi.` : "Hai un punto chiaro in testa. Il resto deve allinearsi."
  ];
  const enPool = [
    name ? `${name}, you don’t move on whims — you move for meaning.` : "You don’t move on whims — you move for meaning.",
    city ? `${city} steadies you, but you still need an open window.` : "You like a solid base and one open window.",
    role ? `In ${role}, you keep pace while the why stays lit.` : "You keep pace while the why stays lit.",
    goal ? `There’s a clear target: ${goal}. Everything else must align.` : "There’s a clear target. Everything else must align."
  ];
  return pick(en ? enPool : it);
}

function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const softIT = [
    "Domani due micro-domande e andiamo più preciso.",
    "Se torni domani, aggiungo due dettagli e si riparte puliti.",
    "Quando vuoi, domani due spunti rapidi e la storia continua."
  ];
  const sharpIT = [
    "Stop qui. Domani due colpi secchi e avanti.",
    "Segnalibro messo: domani due cue veloci e alziamo il livello.",
    "Bancone chiuso: domani due domande e via."
  ];
  const softEN = [
    "Come back tomorrow — two micro-questions and we go sharper.",
    "Return tomorrow: two small details and we keep it clean.",
    "Tomorrow two quick prompts and the thread continues."
  ];
  const sharpEN = [
    "Pause here. Tomorrow two clean shots — then move.",
    "Bookmark this. Two fast cues tomorrow and we level up.",
    "Bar’s closed. Tomorrow: two sharp questions."
  ];
  if (style === "wtf") return en ? pick(sharpEN) : pick(sharpIT);
  return en ? pick(softEN) : pick(softIT);
}

/* ========== Time helper ========== */
function todayInfo(lang) {
  const d = new Date();
  const loc = isEn(lang) ? "en-GB" : "it-IT";
  const weekday = d.toLocaleDateString(loc, { weekday: "long" });
  const date = d.toLocaleDateString(loc, { day: "2-digit", month: "long", year: "numeric" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${weekday}, ${date} • ${hh}:${mm}`;
}

/* ========== HTTP handler ========== */
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
      lang = "it",
      periodo = "future",   // "future" | "past"
      stile = "whatif",     // "whatif" | "wtf"
      stream = false,       // SSE on/off
      clarify = false,      // true => 2–3 domande
      profilo = {},
      clarifications = []   // array stringhe (opzionale)
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ---------- Clarify branch ---------- */
    if (clarify) {
      const en = isEn(lang);
      const qs = [];
      if (periodo === "past") {
        qs.push({ id:"pivot",  label: en?"Turning point year/event?":"Anno/evento di svolta?",  placeholder: en?"2018 move / 2010 offer":"trasferimento 2018 / offerta 2010" });
        qs.push({ id:"place",  label: en?"Where & what context then?":"Dove e quale contesto allora?", placeholder: en?"city/team/family":"città/team/famiglia" });
        qs.push({ id:"signal", label: en?"One sign it worked?":"Un segnale che funzionava?",      placeholder: en?"sleep/energy/text back":"sonno/energia/richiami" });
      } else {
        qs.push({ id:"window", label: en?"Real decision window?":"Finestra reale?",                placeholder: en?"this month / 3–6 months / 12 months":"questo mese / 3–6 mesi / 12 mesi" });
        qs.push({ id:"signal", label: en?"Personal sign to watch?":"Segno personale da osservare?",placeholder: en?"sleep/energy/first reply":"sonno/energia/prima risposta" });
        qs.push({ id:"limit",  label: en?"Most concrete limit?":"Limite più concreto?",            placeholder: en?"budget/time/energy":"budget/tempo/energia" });
      }
      return res.status(200).json({ questions: qs });
    }

    /* ---------- Generation branch ---------- */
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const system = `
${persona.system.trim()}
Oggi: ${todayInfo(lang)}
- Periodo: ${periodo === "past" ? (isEn(lang) ? "counterfactual past" : "controfattuale") : (isEn(lang) ? "near-future" : "futuro vicino") }.
- Mantieni il testo atemporale: nessuna notizia o fatto datato.
- Non usare domande retoriche a raffica (max 1).
- Evita ripetizioni di azioni (niente “chiama”, “scrivi a”, “visita X” in serie).
Esempi IT:
${persona.few_it.map(s => `• ${s}`).join("\n")}
Esempi EN:
${persona.few_en.map(s => `• ${s}`).join("\n")}
`.trim();

    const opening = mirrorLine(profilo, lang);
    const closing = episodicClosing(stile, lang);
    const en = isEn(lang);

    const user = `
OPEN MIRROR (parafrasa, non copiare): "${opening}"

QUESTION: "${domanda}"
TIMEFRAME: ${periodo}
STYLE: ${stile}

Extra (user clarifications): ${
      Array.isArray(clarifications) && clarifications.length
        ? clarifications.join(", ")
        : (en ? "none" : "nessuno")
    }

Scrivi 8–12 frasi ${stile==="wtf" ? (en?"witty, dry, bar-rhythm.":"brillanti, asciutte, ritmo da bancone.") : (en?"warm, predictive, concrete.":"calde, predittive, concrete.")} 
Niente elenchi puntati. Dettagli piccoli e plausibili (luoghi, orari, sensazioni), senza lirismi.
Chiudi con UNA sola riga variata nello spirito: "${closing}"
`.trim();

    const temperature = stile === "wtf" ? 0.96 : 0.84;
    const useStream = stream || String(req.headers["x-whatif-stream"] || "") !== "";

    if (useStream) {
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
    return res.status(200).json({ answer: text });

  } catch (err) {
    console.error("API /ask error:", err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
