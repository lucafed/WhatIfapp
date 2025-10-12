// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";

/* ========= Lang helpers ========= */
function resolveLang(explicit, req) {
  if (explicit) return explicit;
  const hdr = (req.headers["accept-language"] || "").toLowerCase();
  return hdr.startsWith("en") ? "en" : "it";
}
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ========= Persona & stile ========= */
const PERSONAS = {
  whatif: {
    system: (lang) => isEn(lang)
      ? `
You are "What?f": warm, lucid, predictive friend.
Second person only. One voice. 8–12 concise lines.
Sound like you *know* the user without saying it: read mood and anticipate the next move.
No labels like “indicator/constraint/trade-off/first step”: show, don’t name.
Keep metaphors to max 1–2, small and grounded. No moralizing, no nostalgia dump.
Real timings, tiny realistic costs, inner/outer signals woven in narrative.
Always close with a gentle invite to return tomorrow for two micro-questions.
`
      : `
Sei "What?f": amico lucido e caldo, predittivo.
Solo seconda persona. Una voce. 8–12 righe concise.
Fai sentire che *lo conosci* senza dirlo: leggi l’umore e anticipi la mossa.
Niente etichette (“indicatore/vincolo/trade-off/primo passo”): mostra, non nominare.
Metafore max 1–2, piccole e concrete. Niente moralismi, niente nostalgia pesante.
Tempi reali, piccoli costi plausibili e segnali interiori/esterni intrecciati.
Chiudi sempre invitando a tornare domani per due micro-domande.
`,
    // frasi-seme che spingono verso lo stile che vuoi
    seeds_it: [
      "Non cerchi spettacolo: cerchi coerenza.",
      "Il ritmo conta più del rumore.",
      "Una base solida e una finestra aperta: è il tuo modo di stare bene.",
    ],
    seeds_en: [
      "You don’t want noise — you want alignment.",
      "Rhythm beats hype.",
      "A solid base and one open window — that’s your way.",
    ],
    closing_it: [
      "Domani, due micro-domande: cosa temi di perdere e cosa speri di ritrovare?",
      "Passa domani: due micro-domande per mettere a fuoco.",
      "Domani torni: due micro-domande e andiamo più preciso.",
    ],
    closing_en: [
      "Tomorrow, two micro-questions: what might you lose, what do you hope to regain?",
      "Drop by tomorrow: two micro-questions to sharpen the path.",
      "Come back tomorrow: two tiny questions and we go deeper.",
    ],
  },

  wtf: {
    system: (lang) => isEn(lang)
      ? `
You are "What the F": witty late-night bartender — slightly tipsy, laser-smart.
Second person only. One voice. 7–10 punchy lines. Bar rhythm.
High sarcasm, never cruel. No vulgarity. No lectures.
Very few metaphors; keep them street-level. Be visual, concrete, direct.
Clearly different from What?f: shorter lines, spikier tone, playful truth.
Always end with a cheeky invite for tomorrow's two quick shots.
`
      : `
Sei "What the F": barista nottambulo, brillante e un filo brillo.
Solo seconda persona. Una voce. 7–10 righe secche, ritmo da bancone.
Sarcasmo alto ma mai cattivo. Niente volgarità. Niente prediche.
Metafore poche e terra-terra. Visivo, concreto, diretto.
Diverso da What?f: frasi più corte, tono pungente, verità affettuose.
Chiudi sempre con un invito sfrontato alle due domande di domani.
`,
    seeds_it: [
      "Vuoi libertà ma con lo scontrino.",
      "Taglia il melodramma: meglio una scelta corta che un rimpianto lungo.",
      "Le scuse pesano, i passi no.",
    ],
    seeds_en: [
      "You want freedom with a receipt.",
      "Skip the melodrama: short choice beats long regret.",
      "Excuses are heavy; steps aren’t.",
    ],
    closing_it: [
      "Bancone chiuso: domani due colpi secchi e via.",
      "Chiudo qui: domani due domande rapide e si parte.",
      "Ok, stappa l’aria: domani due colpi dritti.",
    ],
    closing_en: [
      "Bar’s closed: tomorrow two clean shots, then go.",
      "Bookmark this: tomorrow two quick hits and move.",
      "Cut here — tomorrow two sharp questions.",
    ],
  },
};

/* ========= Mirror (specchio) ========= */
function pick(arr) { return arr[Math.floor(Math.random()*arr.length)] }

function mirrorLine(profile = {}, lang = "it") {
  const en = isEn(lang);
  const name = (profile?.name || "").split(" ")[0];
  const city = profile?.city_now || profile?.city || "";
  const role = profile?.work_role || profile?.role || "";
  const goal = (profile?.goals && profile.goals[0]) || profile?.goal || "";

  const itPool = [
    name ? `${name}, quando decidi non è per capriccio: cerchi senso.` : "Tu non decidi per capriccio: cerchi senso.",
    city ? `${city} ti tiene a terra, ma ti serve anche aria nuova.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il “perché” resta acceso.` : "Reggi il ritmo finché il “perché” resta acceso.",
    goal ? `In testa gira questo: ${goal}. Il resto deve allinearsi.` : "Hai un punto chiaro in testa: il resto deve allinearsi.",
  ];
  const enPool = [
    name ? `${name}, you don’t move on whims — you move for meaning.` : "You don’t move on whims — you move for meaning.",
    city ? `${city} grounds you, but you still want an open window.` : "You like a solid base and one open window.",
    role ? `In ${role} you keep pace while the “why” stays lit.` : "You keep pace while the “why” stays lit.",
    goal ? `There’s a clear target: ${goal}. Everything else aligns with it.` : "There’s a clear target. Everything else aligns with it.",
  ];
  return pick(en ? enPool : itPool);
}

/* ========= Time info ========= */
function todayInfo(lang){
  const d = new Date();
  const loc = isEn(lang) ? "en-GB" : "it-IT";
  const weekday = d.toLocaleDateString(loc, { weekday:"long" });
  const date = d.toLocaleDateString(loc, { day:"2-digit", month:"long", year:"numeric" });
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  return `${weekday}, ${date} • ${hh}:${mm}`;
}

/* ========= Clarify questions ========= */
function clarifyQs(periodo, lang) {
  const en = isEn(lang);
  if (periodo === "past") {
    return [
      { id:"pivot",  label: en?"Turning point year/event?":"Anno/evento di svolta?",           placeholder: en?"e.g., 2018 move / 2010 offer":"es. trasferimento 2018 / offerta 2010" },
      { id:"place",  label: en?"Where & what context then?":"Dove e quale contesto allora?",    placeholder: en?"city/team/family":"città/team/famiglia" },
      { id:"signal", label: en?"One sign it would’ve worked?":"Un segno che avrebbe funzionato?", placeholder: en?"sleep/energy/text back":"sonno/energia/richiami" },
    ];
  }
  return [
    { id:"window", label: en?"Real decision window?":"Finestra reale?",         placeholder: en?"this month / 3–6 months / 12 months":"questo mese / 3–6 mesi / 12 mesi" },
    { id:"signal", label: en?"Personal sign to watch?":"Segno personale?",      placeholder: en?"sleep/energy/first reply":"sonno/energia/prima risposta" },
    { id:"limit",  label: en?"Most concrete limit?":"Limite più concreto?",     placeholder: en?"budget/time/energy":"budget/tempo/energia" },
  ];
}

/* ========= HTTP handler ========= */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-whatif-stream, Accept-Language");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const {
      domanda,
      lang: langBody,
      periodo = "future",    // "future" | "past"
      stile = "whatif",      // "whatif" | "wtf"
      stream = false,        // SSE
      clarify = false,       // 2–3 domande
      profilo = {},
      clarifications = []
    } = req.body || {};

    const lang = resolveLang(langBody, req);
    const en = isEn(lang);

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ----- Clarify branch (collegato all’AI e alla lingua) ----- */
    if (clarify) {
      const qs = clarifyQs(periodo, lang);
      res.setHeader("X-Whatif-Lang", lang);
      return res.status(200).json({ questions: qs });
    }

    /* ----- Generation branch ----- */
    const p = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const seeds = en ? (p.seeds_en || []) : (p.seeds_it || []);
    const closings = en ? p.closing_en : p.closing_it;

    const system = `
${p.system(lang).trim()}
Oggi: ${todayInfo(lang)}
Linee guida forti:
- Niente etichette esplicite (“indicatore”, “vincolo”, ecc.).
- Seconda persona, nessun “io”.
- Varia lessico e struttura; niente ripetizioni, niente “chiama un amico” fisso.
- Metafore massimo due, concrete.
- Periodo: ${periodo === "past" ? (en ? "counterfactual past" : "controfattuale") : (en ? "near-future" : "futuro vicino") }.
Esempi-seme:
${seeds.map(s => `• ${s}`).join("\n")}
`.trim();

    const specchio = mirrorLine(profilo, lang);
    const closing = pick(closings);

    const user = `
Open with a short mirror line (paraphrase this): "${specchio}".
User question: "${domanda}"
Clarifications: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (en ? "none" : "nessuno")}
Write ${stile==="wtf" ? "7–10 punchy lines, playful and direct" : "8–12 concise lines, warm and predictive"} (~180 words max).
No bullet lists, no Q&A style. Small concrete details.
Close with one single line in this spirit: "${closing}".
`.trim();

    const temperature = stile === "wtf" ? 0.95 : 0.85;
    const frequency_penalty = stile === "wtf" ? 0.5 : 0.3;
    const presence_penalty = stile === "wtf" ? 0.3 : 0.2;

    const doStream = stream || String(req.headers["x-whatif-stream"] || "") !== "";

    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const s = await client.chat.completions.create({
        model: MODEL_TEXT,
        temperature,
        frequency_penalty,
        presence_penalty,
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
      res.write(`data: ${JSON.stringify({ done: true, lang })}\n\n`);
      return res.end();
    }

    const c = await client.chat.completions.create({
      model: MODEL_TEXT,
      temperature,
      frequency_penalty,
      presence_penalty,
      max_tokens: 700,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const text = c.choices?.[0]?.message?.content?.trim() || "";
    res.setHeader("X-Whatif-Lang", lang);
    return res.status(200).json({ answer: text, lang });

  } catch (err) {
    console.error("API /ask error:", err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
