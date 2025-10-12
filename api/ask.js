// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Restiamo su 4o-mini come chiesto
const MODEL_TEXT = "gpt-4o-mini";

// Rispetta SEMPRE la lingua passata dal client (niente auto–override)
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ========= Persona & stile ========= */
const PERSONAS = {
  whatif: {
    system: `
Sei "What?f": una voce empatica e lucida, tipo zingara digitale che vede due passi avanti.
Parla in seconda persona, UNA sola voce. 8–12 frasi brevi, concrete, senza fronzoli.
Fai capire che “conosci” l’utente con tocchi sottili (non dichiararlo mai).
Niente etichette (no: indicatore, vincolo, trade-off, primo passo). Mostra, non nominare.
Anti-pattern: evita "chiama un amico" fisso, "immagina" all'inizio di ogni riga, moralismi, nostalgia pesante.
Max 1 metafora corta. Il resto: realtà quotidiana, dettagli plausibili.
Chiudi sempre con invito morbido a tornare domani per 2 micro-domande (varia la frase).`.trim(),
    few_it: [
      "Quando smetti di chiedere permesso alle paure, il passo diventa naturale.",
      "Cerchi stabilità, non immobilità: base solida e finestra aperta.",
      "Lo capisci dal respiro: se si allunga, stai andando dove vuoi stare."
    ],
    few_en: [
      "You don’t move for noise — you move for meaning.",
      "You want stability, not stagnation: solid base, one open window.",
      "Your body tells the truth first: if the breath eases, you’re facing right."
    ]
  },
  wtf: {
    system: `
Sei "What the F": amico geniale e sarcastico da bancone, mezzo brillo ma lucidissimo.
Seconda persona, voce unica. 8–10 righe secche, ritmo da bar. Punchline pulite.
Ironia alta ma mai cattiva; zero volgarità; niente prediche. Sorprendi con verità scomode ma affettuose.
Personalizza in modo implicito (luogo/ruolo) senza elencare dati.
Chiudi con battuta/invito tipo: "domani due colpi secchi", sempre variata.`.trim(),
    few_it: [
      "Vuoi libertà con garanzia. Tenero.",
      "Le idee ti arrivano come gli spritz: una di troppo e diventi saggio.",
      "Facciamolo male ma con stile: tu porti il perché, io porto il casino buono."
    ],
    few_en: [
      "You want freedom with a warranty. Cute.",
      "Ideas hit you like shots: one too many and you finally get wise.",
      "Let’s mess this up beautifully: you bring the why, I’ll bring the chaos."
    ]
  }
};

/* ========= Mirror (specchio) & chiusure ========= */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const goal = (profile?.goals && profile.goals[0]) || profile?.goal || "";

  const itPool = [
    name ? `${name}, non decidi per capriccio: ti muovi quando il perché è vivo.` : "Tu non decidi per capriccio: ti muovi quando il perché è vivo.",
    city ? `${city} ti tiene a terra, ma ogni tanto ti serve aria nuova.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il perché resta acceso.` : "Nel lavoro reggi finché il perché resta acceso.",
    goal ? `In testa c’è questo: ${goal}. Il resto deve allinearsi.` : "Hai un punto chiaro in testa. Il resto deve allinearsi."
  ];
  const enPool = [
    name ? `${name}, you don’t move on whims — you move for meaning.` : "You don’t move on whims — you move for meaning.",
    city ? `${city} grounds you, but you still need an open window.` : "You like a solid base and one open window.",
    role ? `In ${role}, you keep pace while the “why” stays lit.` : "You keep pace while the “why” stays lit.",
    goal ? `There’s a clear target: ${goal}. Everything else must align.` : "There’s a clear target. Everything else must align."
  ];
  return pick(en ? enPool : itPool);
}

function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const itSoft = [
    "Domani due micro-domande e continuiamo puliti.",
    "Se domani torni, aggiungo due dettagli e andiamo più a fondo.",
    "Quando vuoi, riprendiamo: due spunti rapidi e si svolta."
  ];
  const itSharp = [
    "Stop qui. Domani due colpi secchi e si riparte.",
    "Segnalibro messo: domani due cue veloci e alziamo il livello.",
    "Ok, chiudo il bancone: domani due domande e via."
  ];
  const enSoft = [
    "Come back tomorrow — two micro-questions and we move on.",
    "Return tomorrow: two small details, cleaner path.",
    "We’ll pick it up tomorrow with two quick prompts."
  ];
  const enSharp = [
    "Pause here. Tomorrow two clean shots — then action.",
    "Bookmark this. Two fast cues tomorrow and we level up.",
    "Bar’s closed — for now. Tomorrow, two sharp questions."
  ];
  if (style === "wtf") return en ? pick(enSharp) : pick(itSharp);
  return en ? pick(enSoft) : pick(itSoft);
}

/* ========= Time helper ========= */
function todayInfo(lang) {
  const d = new Date();
  const loc = isEn(lang) ? "en-GB" : "it-IT";
  const weekday = d.toLocaleDateString(loc, { weekday: "long" });
  const date = d.toLocaleDateString(loc, { day: "2-digit", month: "long", year: "numeric" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${weekday}, ${date} • ${hh}:${mm}`;
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
      lang = "it",
      periodo = "future",     // "future" | "past"
      stile = "whatif",       // "whatif" | "wtf"
      stream = false,         // true => SSE
      clarify = false,        // true => 2–3 domande
      profilo = {},
      clarifications = []     // array stringhe brevi
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ----- Clarify branch (agganciato e localizzato) ----- */
    if (clarify) {
      const en = isEn(lang);
      const qs = [];
      if (periodo === "past") {
        qs.push({ id: "pivot",  label: en ? "Turning point year/event?" : "Anno/evento di svolta?",       placeholder: en ? "e.g., 2018 move / 2010 offer" : "es. trasferimento 2018 / offerta 2010" });
        qs.push({ id: "place",  label: en ? "Where & what context then?" : "Dove e quale contesto allora?", placeholder: en ? "city/team/family" : "città/team/famiglia" });
        qs.push({ id: "signal", label: en ? "One sign it worked?" : "Un segno che funzionava?",            placeholder: en ? "sleep/energy/text back" : "sonno/energia/richiami" });
      } else {
        qs.push({ id: "window", label: en ? "Real decision window?" : "Finestra reale?",                   placeholder: en ? "this month / 3–6 / 12 months" : "questo mese / 3–6 / 12 mesi" });
        qs.push({ id: "signal", label: en ? "Personal sign to watch?" : "Segno personale da osservare?",   placeholder: en ? "sleep/energy/first reply" : "sonno/energia/prima risposta" });
        qs.push({ id: "limit",  label: en ? "Most concrete limit?" : "Limite più concreto?",               placeholder: en ? "budget/time/energy" : "budget/tempo/energia" });
      }
      return res.status(200).json({ questions: qs });
    }

    /* ----- Generation branch ----- */
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const mirror = mirrorLine(profilo, lang);
    const closing = episodicClosing(stile, lang);

    // Prompt di sistema: meno metafore, niente cliché, lingua allineata
    const system = `
${persona.system}

Oggi: ${todayInfo(lang)}
Regole dure:
- Max 1 metafora breve. No filastrocche oniriche.
- Zero etichette (non scrivere “indicatore, vincolo, trade-off, primo passo”).
- Seconda persona, niente “io”. Varia lessico/struttura. Evita ripetizioni.
- Inserisci tocchi realistici (orari, piccoli contesti) solo se servono.
- Periodo: ${periodo === "past" ? (isEn(lang) ? "counterfactual past" : "controfattuale") : (isEn(lang) ? "near-future" : "futuro vicino")}.

Esempi IT:
${persona.few_it.map(s => `• ${s}`).join("\n")}
Esempi EN:
${persona.few_en.map(s => `• ${s}`).join("\n")}
`.trim();

    // Messaggio utente: apertura specchio + istruzioni sintetiche
    const user = `
Apri con una riga di “specchio” (parafrasa, non copiare): "${mirror}"

Domanda: "${domanda}"
Extra: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (isEn(lang) ? "none" : "nessuno")}

Scrivi 8–12 frasi ${stile === "wtf" ? "sarcastiche, brillanti, ritmo da bar" : "empatiche, predittive, concrete"} (≈180 parole max).
Niente elenco puntato. Niente “chiama un amico” ricorrente. Pochi dettagli mirati.
Chiudi con UNA sola riga variata nello spirito: "${closing}".
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
    return res.status(200).json({ answer: text });

  } catch (err) {
    console.error("API /ask error:", err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
