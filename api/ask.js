// ============================
// /api/ask.js — What?f Engine (Incazzato Illuminato • locked)
// Stili supportati: whatif, wtf
// IT/EN — singolo paragrafo, ritmo fisso, niente emoji/liste/domande
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

function normLine(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "")
    .trim();
}

function tightenSentences(text, maxSentences) {
  const parts = String(text || "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n) continue;
    if (seen.has(n)) continue;

    const wc = p.split(/\s+/).length;
    if (wc <= 3 && !/[.!?]$/.test(p)) continue;

    out.push(p);
    seen.add(n);
    if (out.length >= maxSentences) break;
  }
  let t = out.join(" ");
  if (!/[.!?…]$/.test(t)) t += ".";
  return t;
}

function clampWords(text, maxWords) {
  const w = String(text || "").split(/\s+/);
  if (w.length <= maxWords) return text;
  const slice = w.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m ? m[1] : slice + "…";
}

function normalizeOneParagraph(s = "") {
  return String(s)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/* ---------- Personas (toni definitivi) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — Incazzato Illuminato (locked)
    const SYS = (isEn(lang) ? `
You are “What the F” — version: Incazzato Illuminato (angry–enlightened, tragicomic).
Write in SECOND PERSON and make the user the protagonist.
ONE paragraph, 5–7 sentences, ~100–130 words.
Voice: sarcastic, sharp, tender under the snarl; everyday chaos; unexpected tipsy beats.
No lists. No questions. No emojis. No moralizing. Light swearing okay, human and funny.
Concrete lexicon (wind, helmet, PDFs, keys, taxis, balsamic, basil, radiator).
Always end with a punchline that stings and soothes.
` : `
Sei “What the F” — versione Incazzato Illuminato.
Parla in SECONDA PERSONA e metti l’utente al centro.
UN paragrafo, 5–7 frasi, ~100–130 parole.
Voce: sarcastica, tagliente, affettuosa sotto la rabbia; caos quotidiano; sbronza in agguato.
Niente elenchi. Niente domande. Niente emoji. Niente prediche. Parolacce leggere ok se servono alla comicità.
Lessico concreto (vento, casco, PDF, chiavi, taxi, aceto, basilico, termosifone).
Chiudi sempre con una battuta che fa ridere e un po’ pensare.
`).trim();

    // Few-shot anchors IT + EN (corti, stesso ritmo)
    const FEWSHOTS = [
      // ===== ITALIANO =====
      {
        role: "system",
        content:
`ESEMPIO IT • E se tornassi a vivere all’Aquila?
Torneresti con l’aria di chi “ha visto il mondo” e dopo tre ore stai già litigando col vento che ti sposta pure l’autostima. Metti un piede in centro, ti salutano tutti tranne la fortuna, e ti chiedi se il tempo lì è passato o solo andato a prendersi un amaro. Dichiari “nuovo inizio” e finisci a bere con tuo cugino che ripete la saga del 2012 con più pause, meno denti e doppio rimpianto. Ti incazzi, ti sciogli, fai pace col freddo e col passato, poi guardi le luci sulla pietra e capisci che ti ha spezzato ma non piegato. E mentre il bicchiere scalda, ammetti l’ovvio: sei un disastro bello, e L’Aquila ha sempre avuto un debole per i disastri belli.`
      },
      {
        role: "system",
        content:
`ESEMPIO IT • E se comprassi una moto?
Ti vedi già filosofo su due ruote, poi il casco ti strizza il cervello come un limone e la moto parte solo per finta. Esci con l’ego alto e ti sorpassa un nonno in graziella che respira meglio di te. Freni, sbagli marcia, parcheggi storto, e il vicino ti osserva come se allevassi un velociraptor in condominio. Prometti prudenza, poi premi il coraggio con un “micro brindisi” che diventa macro per colpa del polso onesto. Torni a casa con il cuore a 9.000 giri e quella risata scema che sa di benzina, paura e un goccetto di gloria.`
      },
      {
        role: "system",
        content:
`ESEMPIO IT • E se aprissi un’attività?
Ti alzi gasato come un TED Talk e dopo due moduli scopri che per vendere acqua serve un timbro, un rito e tre file identiche. Scrivi “business plan” e il PDF ti guarda come un avvocato in ferie: non collabora, non esporta, non salva. I fornitori spariscono, i clienti pagano in complimenti, e il commercialista ti benedice con occhio da martire. La sera stappi per festeggiare e scopri che era aceto balsamico: brucia, ma almeno dà carattere alla dignità. E ridi, perché se il caos è socio di maggioranza, tu sei l’AD dell’autoironia con diritto di brindisi.`
      },
      {
        role: "system",
        content:
`ESEMPIO IT • E se mollassi tutto e andassi al mare?
Parti convinto, “vita semplice”, e il primo giorno litighi con la sabbia che entra nel letto come una tassa comunale. Fai amicizia col vicino che alle 7 frigge alice e illusioni, poi prometti sobrietà e ti ritrovi con una genziana che parla dialetto. Il sole ti cuoce i progetti a fuoco lento, ma la sera l’aria sa di perdono e patatine unte. Rimandi le decisioni a domani, brindando al genio che sarai dopodomani. E ti accorgi che la felicità ha i piedi bagnati e il cervello a tratti, proprio come te quando funziona.`
      },

      // ===== ENGLISH =====
      {
        role: "system",
        content:
`EXAMPLE EN • What if I moved back to my hometown?
You’d arrive like a reformatted hard drive and realize the wind still shuffles your settings. People greet you, luck does not, and the timeline feels paused by a petty god with a coffee break. You declare “fresh start,” then end up clinking glasses with your cousin retelling the 2012 saga with longer sighs and fewer teeth. You get mad, get soft, make peace with asphalt and memory, then look at the lights and admit they cracked you but didn’t fold you. And with that honest buzz, you accept it: you’re a beautiful mess, and this town has a lifelong crush on beautiful messes.`
      },
      {
        role: "system",
        content:
`EXAMPLE EN • What if I bought a motorcycle?
You picture freedom chewing the horizon, then the helmet wrings your skull like a citrus press and the bike coughs at commitment. You roll out proud and get passed by a grandfather on a bicycle who breathes like a yoga app. You stall, mis-shift, park diagonally into shame, swear allegiance to caution, and reward yourself with a “tiny drink” that performs a growth spurt. You go home with adrenaline hiccups and a dumb grin that smells like gasoline, panic, and a sip of glory.`
      },
      {
        role: "system",
        content:
`EXAMPLE EN • What if I started a business?
You wake up TED-talk brave and learn it takes stamps, rites, and three identical queues to sell water. Your business plan PDF behaves like a lawyer on vacation: unreadable, unprintable, unimpressed. Suppliers vanish, customers pay in compliments, and your accountant blesses you with martyr eyes. At night you pop a “victory” bottle and discover it’s balsamic—painful, yes, but character-building for dignity. You laugh, because if chaos holds majority shares, you’re the CEO of self-irony with guaranteed drink rights.`
      }
    ];

    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — aggiornato: stimolante, introspettivo, non malinconico
  const SYS_WHATIF = (isEn(lang) ? `
You are "What If" — a warm, lucid friend with bright realism and a gentle spark.
SECOND PERSON. One calm paragraph, 7–10 smooth sentences (~100–140 words).
Be introspective without melancholy: name small truths, keep the air clear and light.
Use concrete, everyday details (mug, keys, stairwell, early light, soft traffic).
Offer one fresh insight and one practical nudge; no pep-talk clichés.
No lists. No questions. No emojis. No therapy jargon.
End on a natural forward tilt that feels doable today, not someday.
` : `
Sei "What If" — un amico caldo e lucido, realistico con una scintilla gentile.
SECONDA PERSONA. Un paragrafo calmo, 7–10 frasi (~100–140 parole).
Introspezione senza malinconia: verità piccole e chiare, aria pulita.
Dettagli concreti e quotidiani (tazza, chiavi, pianerottolo, luce del mattino, traffico morbido).
Offri un’idea fresca e una spinta pratica; niente frasi da coach.
Niente elenchi. Niente domande. Niente emoji. Niente gergo terapeutico.
Chiudi con un invito semplice da fare oggi, non “un giorno”.
`).trim();

  return { sys: SYS_WHATIF, fewshots: [] };
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_api_key" });
    }

    // Input
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",  // "whatif" | "wtf"
      lang = "it",       // "it" | "en"
      extra = ""         // contesto opzionale (non cambia tono)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const { sys, fewshots } = personaSystem(stile, lang);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona voice.`
      : `Domanda: "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce della persona.`;

    // Build messages
    const messages = [
      { role: "system", content: sys },
      ...(fewshots || []), // few-shots solo per WTF
      { role: "user", content: userPrompt }
    ];

    // Generate
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: (stile === "wtf") ? 0.92 : 0.82,
      top_p: 0.9,
      max_tokens: (stile === "wtf") ? 260 : 260,
      frequency_penalty: (stile === "wtf") ? 0.4 : 0.0,
      presence_penalty: 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Lock ritmo/lunghezza/paragrafo singolo
    if (stile === "wtf") {
      answer = tightenSentences(answer, 7);
      answer = clampWords(answer, 130);
    } else {
      // whatif: leggermente più lungo e morbido
      answer = tightenSentences(answer, 10);
      answer = clampWords(answer, 140);
    }
    answer = normalizeOneParagraph(answer);

    return res.status(200).json({ answer, style: stile, lang });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
