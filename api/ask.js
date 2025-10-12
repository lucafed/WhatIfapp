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
Sei "What?f": una voce empatica e lucida, come una zingara digitale.
Parla in seconda persona, una sola voce, 8–12 frasi brevi, tono caldo e netto.
Fai percepire che “conosci” l’utente senza dichiararlo: leggi lo stato d’animo e anticipi il passo successivo.
NON usare etichette come "indicatore", "vincolo", "trade-off", "primo passo": mostra, non nominare.
Evita moralismi, nostalgia e consigli banali. Realismo, dettagli plausibili, immagini leggere.
Evita formule tipo "immagina", "pensa se": scrivi come se stesse davvero accadendo.
Chiudi sempre con un invito morbido a tornare/domani per 2 micro-domande.
`,
    few_it: [
      "Quando smetti di chiedere permesso alle tue paure, il passo diventa naturale.",
      "Lo capisci dal respiro: se si allunga, stai andando dove vuoi stare.",
      "Cerchi stabilità, non immobilità: base solida e finestra aperta."
    ],
    few_en: [
      "You don’t move for noise, you move for meaning.",
      "Peace beats excitement when it’s real.",
      "A solid base and one open window — that’s your pattern."
    ]
  },
  wtf: {
    system: `
Sei "What the F": amico geniale e sarcastico da bancone, mezzo brillo ma lucidissimo.
Seconda persona, una sola voce, 8–10 righe secche. Ritmo da bar, punchline pulite.
Ironia alta ma mai cattiva; zero volgarità; niente prediche. Verità scomode ma affettuose.
Personalizza in modo implicito (luogo/ruolo) senza elencare dati.
Chiudi con una battuta/invito: "domani due colpi secchi", ecc.
`,
    few_it: [
      "Ti vedo: vuoi libertà ma con la ricevuta. Ambizioso e prudente, cocktail interessante.",
      "Le idee ti arrivano come gli aperitivi: una di troppo e fai la scelta migliore.",
      "Ok, niente drammi: facciamolo male ma con stile."
    ],
    few_en: [
      "You want freedom with a warranty. Cute.",
      "Let’s mess this up beautifully. You bring hope, I’ll bring nonsense.",
      "Chaos has a better sense of humor than logic — use it."
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
    name ? `${name}, quando decidi non è per capriccio: cerchi senso.` : "Tu non decidi per capriccio: cerchi senso.",
    city ? `Ti tiene a terra ${city}, ma ogni tanto ti serve aria nuova.` : "Ti serve una base solida e una finestra aperta.",
    role ? `Nel lavoro (${role}) reggi finché il perché resta acceso.` : "Reggi il ritmo finché il perché resta acceso.",
    goal ? `In testa gira questo: ${goal}. Il resto deve allinearsi.` : "Hai un punto chiaro in testa: il resto deve allinearsi."
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
    "Se torni domani, aggiungo due dettagli e andiamo più a fondo.",
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

/* ========= Time helpers ========= */
function todayInfo(lang) {
  const d = new Date();
  const loc = isEn(lang) ? "en-GB" : "it-IT";
  const weekday = d.toLocaleDateString(loc, { weekday: "long" });
  const date = d.toLocaleDateString(loc, { day: "2-digit", month: "long", year: "numeric" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${weekday}, ${date} • ${hh}:${mm}`;
}

/* ========= Intensità (manopola) =========
   intensity: "soft" | "default" | "bold"
   - regola temperatura e “spigolo” del tono.
*/
function toneSettings(style = "whatif", intensity = "default") {
  const base = { temperature: style === "wtf" ? 0.93 : 0.82, extra: "" };
  if (intensity === "soft") {
    return {
      temperature: style === "wtf" ? 0.88 : 0.75,
      extra:
        style === "wtf"
          ? "Sarcasmo più leggero, zero eccessi. Mantieni calore e un filo di autoironia."
          : "Tono più pacato e concreto; privilegia chiarezza e piccoli esempi reali."
    };
  }
  if (intensity === "bold") {
    return {
      temperature: style === "wtf" ? 0.98 : 0.9,
      extra:
        style === "wtf"
          ? "Spingi su ritmo e punchline, resta affettuoso ma netto. Frasi corte, taglio brillante."
          : "Più intuitivo e assertivo: nomina i micro-segnali interni, riduci le premesse e vai al punto."
    };
  }
  return base;
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
      periodo = "future",      // "future" | "past"
      stile = "whatif",        // "whatif" | "wtf"
      intensity = "default",   // "soft" | "default" | "bold"
      stream = false,          // true => SSE
      clarify = false,         // true => 2–3 domande
      profilo = {},
      clarifications = []      // array di brevi risposte (opzionale)
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ----- Clarify branch ----- */
    if (clarify) {
      const en = isEn(lang);
      const qs = [];
      if (periodo === "past") {
        qs.push({ id:"pivot",  label: en?"Turning point year/event?":"Anno/evento di svolta?",    placeholder: en?"e.g., 2018 move / 2010 offer":"es. trasferimento 2018 / offerta 2010" });
        qs.push({ id:"place",  label: en?"Where & what context then?":"Dove e quale contesto allora?", placeholder: en?"city/team/family":"città/team/famiglia" });
        qs.push({ id:"sign",   label: en?"One sign it worked?":"Un segno che funzionava?",       placeholder: en?"sleep/energy/text back":"sonno/energia/richiami" });
      } else {
        qs.push({ id:"window", label: en?"Real decision window?":"Finestra reale?",               placeholder: en?"this month / 3–6 months / 12 months":"questo mese / 3–6 mesi / 12 mesi" });
        qs.push({ id:"signal", label: en?"Personal sign to watch?":"Segno personale da osservare?", placeholder: en?"sleep/energy/first reply":"sonno/energia/prima risposta" });
        qs.push({ id:"limit",  label: en?"Most concrete limit?":"Limite più concreto?",          placeholder: en?"budget/time/energy":"budget/tempo/energia" });
      }
      return res.status(200).json({ questions: qs });
    }

    /* ----- Generation branch ----- */
    const persona = PERSONAS[stile === "wtf" ? "wtf" : "whatif"];
    const mirror = mirrorLine(profilo, lang);
    const closing = episodicClosing(stile, lang);
    const tone = toneSettings(stile, intensity);

    const system = `
${persona.system.trim()}
${tone.extra}
Oggi: ${todayInfo(lang)}

Linee guida forti:
- Mai etichette esplicite (no "indicatore", "vincolo", "primo passo", ecc.).
- Seconda persona, zero "io". Varia lessico e struttura; evita ripetizioni (niente "chiama un amico" fisso).
- Integra impliciti di città/ruolo/valori se presenti, senza elenchi.
- Periodo: ${periodo === "past" ? (isEn(lang) ? "counterfactual past" : "controfattuale") : (isEn(lang) ? "near-future" : "futuro vicino")}.

Esempi IT:
${persona.few_it.map(s => `• ${s}`).join("\n")}
Esempi EN:
${persona.few_en.map(s => `• ${s}`).join("\n")}
`.trim();

    const user = `
Apertura-specchio (parafrasa, non copiare): "${mirror}".

Domanda utente: "${domanda}"
Dettagli: ${Array.isArray(clarifications) && clarifications.length ? clarifications.join(", ") : (isEn(lang) ? "none" : "nessuno")}

Scrivi 8–12 frasi fluide (${stile === "wtf" ? "sarcastiche e brillanti" : "empatiche e predittive"}), max ~180 parole.
Evita l'elenco puntato e le domande retoriche; usa segnali interni e dettagli plausibili.
Chiudi con UNA sola riga variata, nello spirito: "${closing}".
`.trim();

    const doStream = stream || String(req.headers["x-whatif-stream"] || "") !== "";
    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const s = await client.chat.completions.create({
        model: MODEL_TEXT,
        temperature: tone.temperature,
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
      temperature: tone.temperature,
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
