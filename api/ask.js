// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ========= Persona & stile ========= */
const PERSONAS = {
  whatif: {
    system: `
Sei "What?f": voce empatica e lucida.
Seconda persona, una sola voce. 8–12 frasi brevi, concrete, visive ma sobrie.
Mostra senza etichettare (no "indicatore/vincolo/primo passo"). Niente moralismi/nostalgia.
Dai micro-dettagli plausibili (email, orari, segnali fisici). Chiudi con invito morbido a due micro-domande domani.
`.trim(),
    few_it: [
      "Ti muovi quando il perché è acceso.",
      "Base solida e finestra aperta: questo cerchi.",
      "Se il respiro si allunga, hai preso la direzione giusta.",
    ],
    few_en: [
      "You move when the why lights up.",
      "A solid base and one open window.",
      "If your breath eases, you picked the right lane.",
    ],
  },
  wtf: {
    system: `
Sei "What the F": barista brillante, sarcastico ma affettuoso.
Seconda persona, 7–10 righe secche, punchline pulite. Zero volgarità. Niente prediche.
Spara verità scomode con leggerezza. Personalizza senza elencare dati.
Chiudi con una battuta/invito tipo “domani due colpi secchi”.
`.trim(),
    few_it: [
      "Vuoi libertà, ma con la ricevuta.",
      "Meno epica, più decisioni pulite.",
      "Ok, niente drammi: lo facciamo bene o non lo facciamo.",
    ],
    few_en: [
      "You want freedom with a warranty.",
      "Less epic, more clean decisions.",
      "Fine, no drama: do it right or don’t.",
    ],
  },
};

/* ========= Mirror & chiusure ========= */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const who = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const goal = (profile?.goals && profile.goals[0]) || profile?.goal || "";
  const itPool = [
    who ? `${who}, non decidi per capriccio: cerchi senso.` : "Non decidi per capriccio: cerchi senso.",
    city ? `${city} ti tiene a terra, ma ti serve anche aria nuova.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel ruolo (${role}) reggi finché il perché resta acceso.` : "Reggi finché il perché resta acceso.",
    goal ? `In testa gira questo: ${goal}. Il resto deve allinearsi.` : "Hai un punto chiaro e il resto deve allinearsi.",
  ];
  const enPool = [
    who ? `${who}, you don’t move on whims — you move for meaning.` : "You don’t move on whims — you move for meaning.",
    city ? `${city} grounds you, but you still need an open window.` : "You like a solid base and one open window.",
    role ? `In ${role}, you keep pace while the why stays lit.` : "You keep pace while the why stays lit.",
    goal ? `There’s a clear target: ${goal}. Everything else must align.` : "There’s a clear target. Everything else must align.",
  ];
  return pick(en ? enPool : itPool);
}

function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const itSoft = [
    "Domani due micro-domande e andiamo più preciso.",
    "Se torni domani, aggiungo due dettagli e si muove.",
    "Quando vuoi, due spunti rapidi e continuiamo.",
  ];
  const itSharp = [
    "Stop qui. Domani due colpi secchi e si decide.",
    "Segnalibro messo: domani due cue puliti e via.",
    "Bancone chiuso: domani due domande e si parte.",
  ];
  const enSoft = [
    "Come back tomorrow — two micro-questions and we move.",
    "Return tomorrow: two small prompts, cleaner path.",
    "We’ll pick it up tomorrow with two quick cues.",
  ];
  const enSharp = [
    "Pause here. Tomorrow two clean shots — then action.",
    "Bookmark this. Two fast cues tomorrow and we move.",
    "Bar’s closed. Tomorrow: two sharp questions.",
  ];
  return style === "wtf" ? (en ? pick(enSharp) : pick(itSharp)) : (en ? pick(enSoft) : pick(itSoft));
}

/* ========= Tempo ========= */
function todayInfo(lang) {
  const d = new Date();
  const loc = isEn(lang) ? "en-GB" : "it-IT";
  const weekday = d.toLocaleDateString(loc, { weekday: "long" });
  const date = d.toLocaleDateString(loc, { day: "2-digit", month: "long", year: "numeric" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${weekday}, ${date} • ${hh}:${mm}`;
}

/* ========= Clarify: generatore locale intelligente ========= */
/** Classifica la domanda in un tema per domande pertinenti */
function classifyIntent(q) {
  const s = String(q || "").toLowerCase();
  if (/(moto|motor[ei]|motorcycle|bike)/.test(s)) return "moto";
  if (/(barca|boat|sail|vela)/.test(s)) return "barca";
  if (/(tornassi|tornare|rientrare|back|return).*(aquila|all'aquila)/.test(s)) return "torna_aquila";
  if (/(trasfer|move|relocat|cambiare citt)/.test(s)) return "trasferimento";
  if (/(lugano).*(rimast|restat|stare|fosssi|fossi)/.test(s)) return "lugano_restare";
  if (/(comprare|acquistare|buy|purchase)/.test(s)) return "acquisto_generico";
  return "generico";
}

function clarifyQuestions(domanda, periodo = "future", lang = "it") {
  const en = isEn(lang);
  const intent = classifyIntent(domanda);
  const L = [];

  const push = (id, it, enq, phIt, phEn) =>
    L.push({
      id,
      label: en ? enq : it,
      placeholder: en ? phEn : phIt,
    });

  if (intent === "moto") {
    if (periodo === "future") {
      push("when", "Quando la decidi davvero?", "When would you really decide?", "questo mese / 3–6 mesi", "this month / 3–6 months");
      push("budget", "Budget netto per tutto (assicurazione/bollo/manutenzione)?", "All-in budget (insurance/tax/maintenance)?", "€ al mese", "$ per month");
      push("signal", "Quale segno ti dice che è la scelta giusta?", "What personal sign says it’s right?", "sonno più profondo / mente leggera", "sleep deeper / mind lighter");
    } else {
      push("then_cost", "Quale costo concreto avresti accettato allora?", "What real cost would you have accepted then?", "tempo/denaro/energia", "time/money/energy");
      push("route", "Dove l’avresti usata di più?", "Where would you have used it most?", "casa-lavoro/gite weekend", "commute/weekend rides");
      push("sign", "Un segno che avrebbe funzionato?", "One sign it would’ve worked?", "più calma / più energia", "more calm / more energy");
    }
    return L;
  }

  if (intent === "barca") {
    push("use", "Uso reale? quante uscite/anno", "Real use? trips/year", "es. 10–15 uscite", "e.g., 10–15 trips");
    push("mooring", "Ormeggio e costi fissi?", "Mooring and fixed costs?", "€ mese / posto barca", "$/mo / berth");
    push("crew", "Con chi vai davvero?", "Who would you actually go with?", "famiglia / 1–2 amici", "family / 1–2 friends");
    return L;
  }

  if (intent === "torna_aquila" || intent === "trasferimento") {
    push("window", en ? "Decision window?" : "Finestra decisionale?", en ? "this month / 3–6 months / 12 months" : "questo mese / 3–6 mesi / 12 mesi", en ? "this month / 3–6 months / 12 months" : "questo mese / 3–6 mesi / 12 mesi");
    push("anchor", en ? "One anchor there you’d rely on?" : "Un’ancora lì su cui conti?", en ? "person/place/routine" : "persona/luogo/rituale", en ? "person/place/routine" : "persona/luogo/rituale");
    push("limit", en ? "Most concrete limit?" : "Limite più concreto?", en ? "budget/time/role" : "budget/tempo/ruolo", en ? "budget/time/role" : "budget/tempo/ruolo");
    return L;
  }

  if (intent === "lugano_restare") {
    // controfattuale ≈ "past"
    push("when", en ? "Which year/role back then?" : "Quale anno/ruolo allora?", en ? "e.g., 2021, research engineer" : "es. 2021, ricercatore", en ? "2021, role" : "2021, ruolo");
    push("context", en ? "Team & place you’d be in?" : "Team e contesto in cui saresti?", en ? "team/office/schedule" : "team/ufficio/orari");
    push("signal", en ? "One sign it would’ve worked?" : "Un segno che avrebbe funzionato?", en ? "better sleep / clearer inbox" : "sonno migliore / inbox più pulita");
    return L;
  }

  if (intent === "acquisto_generico") {
    push("budget", en ? "All-in budget?" : "Budget complessivo?", en ? "$ or €/mo" : "€ o €/mese", en ? "$ per month" : "€ al mese");
    push("use", en ? "Main use-case?" : "Uso principale?", en ? "work/commute/family/weekend" : "lavoro/spostamenti/famiglia/weekend");
    push("window", en ? "Decision window?" : "Finestra decisionale?", en ? "now / 3–6 months" : "ora / 3–6 mesi");
    return L;
  }

  // generico
  push("window", en ? "Real decision window?" : "Finestra reale?", en ? "this month / 3–6 months / 12 months" : "questo mese / 3–6 mesi / 12 mesi", en ? "timeline" : "timeline");
  push("signal", en ? "Personal sign to watch?" : "Segno personale da osservare?", en ? "sleep/energy/first reply" : "sonno/energia/prima risposta", en ? "e.g., deeper sleep" : "es. dormi meglio");
  push("limit", en ? "Most concrete limit?" : "Limite più concreto?", en ? "budget/time/energy" : "budget/tempo/energia", en ? "choose one" : "scegline uno");
  return L;
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
      lang = "it",            // <-- arriva dal toggle UI
      periodo = "future",     // "future" | "past"
      stile = "whatif",       // "whatif" | "wtf"
      stream = false,         // true => SSE
      clarify = false,        // true => 2–3 domande
      profilo = {},
      clarifications = [],    // array brevi
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ----- Clarify branch ----- */
    if (clarify) {
      const qs = clarifyQuestions(domanda, periodo, lang);
      return res.status(200).json({ questions: qs.slice(0, 3) });
    }

    /* ----- Generation branch ----- */
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const mirror = mirrorLine(profilo, lang);
    const closing = episodicClosing(stile, lang);

    const system = `
${persona.system}

Oggi: ${todayInfo(lang)}
Linee guida:
- Rispondi solo al tema della domanda, senza introdurre argomenti estranei.
- Niente etichette esplicite (tipo "vincolo"/"indicatore"/"primo passo").
- Seconda persona, una sola voce, niente "io".
- Lessico vario, immagini piccole e plausibili.
- Periodo: ${periodo === "past" ? (isEn(lang) ? "counterfactual past" : "controfattuale") : (isEn(lang) ? "near-future" : "futuro vicino") }.
Esempi IT:
${persona.few_it.map(s => `• ${s}`).join("\n")}
Esempi EN:
${persona.few_en.map(s => `• ${s}`).join("\n")}
`.trim();

    // Apertura specchio e regole anti-“tema fisso”
    const opener = isEn(lang)
      ? "Direct, grounded, zero fluff."
      : "Diretto, concreto, zero fronzoli.";

    const user = `
Domanda: "${domanda}"

Regole forti:
- Parla subito del tema della domanda (niente introduzioni generiche tipo "nel lavoro" se non è nella domanda).
- Apri con una breve riga-specchio ispirata a: "${mirror}" (parafrasa e adatta al tema).
- Poi una riga d'apertura di tono: "${opener}".
- Sviluppa in 2–3 paragrafi brevi, ${stile === "wtf" ? (isEn(lang) ? "sarcastic & sharp" : "sarcastici e puliti") : (isEn(lang) ? "warm & lucid" : "caldi e lucidi")}.
- Inserisci un micro-costo realistico e un segnale naturale da osservare, senza chiamarli per nome.
- Chiudi con UNA sola riga finale nello spirito: "${closing}".

Dettagli extra: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (isEn(lang) ? "none" : "nessuno")}
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
          { role: "user", content: user },
        ],
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
        { role: "user", content: user },
      ],
    });
    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text });
  } catch (err) {
    console.error("API /ask error:", err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
