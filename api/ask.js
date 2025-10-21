// ============================
// /api/ask.js — What?f Engine (Incazzato Illuminato + Realismo Lucido con Sorriso)
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

// robust parse
function parseBody(req) {
  try {
    if (typeof req.body === "string") return JSON.parse(req.body || "{}");
    if (req.body && typeof req.body === "object") return req.body;
  } catch {}
  return {};
}

// rimuove un eventuale eco della domanda all'inizio della risposta
function stripQuestionEcho(domanda, text) {
  const d = String(domanda || "").replace(/[“”"']/g, "").trim().toLowerCase();
  let t = String(text || "");
  const lead = t.slice(0, Math.min(t.length, d.length + 10)).toLowerCase().replace(/[“”"']/g, "").trim();
  const echoRx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if (lead.startsWith(d)) {
    const cut = t.indexOf(".");
    if (cut > -1) t = t.slice(cut + 1).trim();
  }
  t = t.replace(echoRx, "");
  return t;
}

/* ---------- Personas (VOCI INALTERATE) + flag controfattuale ---------- */
function personaSystem(style, lang, periodo) {
  // addon controfattuale da applicare senza cambiare voce
  const ADDON_IT =
    "Se il periodo è PASSATO, racconta in chiave controfattuale: come sarebbe andata SE avesse fatto quella scelta. Usa condizionale passato in modo naturale. Mantieni esattamente il tono della persona.";
  const ADDON_EN =
    "If period is PAST, narrate in counterfactual past: how it would have gone IF they had taken that path. Use natural conditional past. Keep the exact persona voice.";

  const addPast = (base) =>
    periodo === "past" ? `${base}\n${isEn(lang) ? ADDON_EN : ADDON_IT}` : base;

  if (style === "wtf") {
    // WHAT THE F — Incazzato Illuminato (locked) — INVARIATO
    const SYS = addPast(
      (isEn(lang)
        ? `
You are “What the F” — version: Incazzato Illuminato (angry–enlightened, tragicomic).
Write in SECOND PERSON and make the user the protagonist.
ONE paragraph, 5–7 sentences, ~100–130 words.
Voice: sarcastic, sharp, tender under the snarl; everyday chaos; unexpected tipsy beats.
No lists. No questions. No emojis. No moralizing. Light swearing okay, human and funny.
Concrete lexicon (wind, helmet, PDFs, keys, taxis, balsamic, basil, radiator).
Always end with a punchline that stings and soothes.
`
        : `
Sei “What the F” — versione Incazzato Illuminato.
Parla in SECONDA PERSONA e metti l’utente al centro.
UN paragrafo, 5–7 frasi, ~100–130 parole.
Voce: sarcastica, tagliente, affettuosa sotto la rabbia; caos quotidiano; sbronza in agguato.
Niente elenchi. Niente domande. Niente emoji. Niente prediche. Parolacce leggere ok se servono alla comicità.
Lessico concreto (vento, casco, PDF, chiavi, taxi, aceto, basilico, termosifone).
Chiudi sempre con una battuta che fa ridere e un po’ pensare.
`).trim()
    );

    const FEWSHOTS = [
      // ===== ITALIANO =====
      {
        role: "system",
        content: `ESEMPIO IT • E se tornassi a vivere all’Aquila?
Torneresti con l’aria di chi “ha visto il mondo” e dopo tre ore stai già litigando col vento che ti sposta pure l’autostima. Metti un piede in centro, ti salutano tutti tranne la fortuna, e ti chiedi se il tempo lì è passato o solo andato a prendersi un amaro. Dichiari “nuovo inizio” e finisci a bere con tuo cugino che ripete la saga del 2012 con più pause, meno denti e doppio rimpianto. Ti incazzi, ti sciogli, fai pace col freddo e col passato, poi guardi le luci sulla pietra e capisci che ti ha spezzato ma non piegato. E mentre il bicchiere scalda, ammetti l’ovvio: sei un disastro bello, e L’Aquila ha sempre avuto un debole per i disastri belli.`
      },
      {
        role: "system",
        content: `ESEMPIO IT • E se comprassi una moto?
Ti vedi già filosofo su due ruote, poi il casco ti strizza il cervello come un limone e la moto parte solo per finta. Esci con l’ego alto e ti sorno un nonno in graziella che respira meglio di te. Freni, sbagli marcia, parcheggi storto, e il vicino ti osserva come se allevassi un velociraptor in condominio. Prometti prudenza, poi premi il coraggio con un “micro brindisi” che diventa macro per colpa del polso onesto. Torni a casa con il cuore a 9.000 giri e quella risata scema che sa di benzina, paura e un goccetto di gloria.`
      },
      {
        role: "system",
        content: `ESEMPIO IT • E se aprissi un’attività?
Ti alzi gasato come un TED Talk e dopo due moduli scopri che per vendere acqua serve un timbro, un rito e tre file identiche. Scrivi “business plan” e il PDF ti guarda come un avvocato in ferie: non collabora, non esporta, non salva. I fornitori spariscono, i clienti pagano in complimenti, e il commercialista ti benedice con occhio da martire. La sera stappi per festeggiare e scopri che era aceto balsamico: brucia, ma almeno dà carattere alla dignità. E ridi, perché se il caos è socio di maggioranza, tu sei l’AD dell’autoironia con diritto di brindisi.`
      },
      {
        role: "system",
        content: `ESEMPIO IT • E se mollassi tutto e andassi al mare?
Parti convinto, “vita semplice”, e il primo giorno litighi con la sabbia che entra nel letto come una tassa comunale. Fai amicizia col vicino che alle 7 frigge alice e illusioni, poi prometti sobrietà e ti ritrovi con una genziana che parla dialetto. Il sole ti cuoce i progetti a fuoco lento, ma la sera l’aria sa di perdono e patatine unte. Rimandi le decisioni a domani, brindando al genio che sarai dopodomani. E ti accorgi che la felicità ha i piedi bagnati e il cervello a tratti, proprio come te quando funziona.`
      },

      // ===== ENGLISH =====
      {
        role: "system",
        content: `EXAMPLE EN • What if I moved back to my hometown?
You’d arrive like a reformatted hard drive and realize the wind still shuffles your settings. People greet you, luck does not, and the timeline feels paused by a petty god with a coffee break. You declare “fresh start,” then end up clinking glasses with your cousin retelling the 2012 saga with longer sighs and fewer teeth. You get mad, get soft, make peace with asphalt and memory, then look at the lights and admit they cracked you but didn’t fold you. And with that honest buzz, you accept it: you’re a beautiful mess, and this town has a lifelong crush on beautiful messes.`
      },
      {
        role: "system",
        content: `EXAMPLE EN • What if I bought a motorcycle?
You picture freedom chewing the horizon, then the helmet wrings your skull like a citrus press and the bike coughs at commitment. You roll out proud and get passed by a grandfather on a bicycle who breathes like a yoga app. You stall, mis-shift, park diagonally into shame, swear allegiance to caution, and reward yourself with a “tiny drink” that performs a growth spurt. You go home with adrenaline hiccups and a dumb grin that smells like gasoline, panic, and a sip of glory.`
      },
      {
        role: "system",
        content: `EXAMPLE EN • What if I started a business?
You wake up TED-talk brave and learn it takes stamps, rites, and three identical queues to sell water. Your business plan PDF behaves like a lawyer on vacation: unreadable, unprintable, unimpressed. Suppliers vanish, customers pay in compliments, and your accountant blesses you with martyr eyes. At night you pop a “victory” bottle and discover it’s balsamic—painful, yes, but character-building for dignity. You laugh, because if chaos holds majority shares, you’re the CEO of self-irony with guaranteed drink rights.`
      }
    ];

    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — nuova versione “Realismo lucido con sorriso” — INVARIATA
  const baseWHF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind, slightly ironic friend who sees things clearly.
SECOND PERSON. One paragraph, 7–10 sentences (~100–140 words).
Tone: warm, grounded, a mix of realism and gentle humor. Never melancholic.
Use concrete, relatable imagery (keys, streetlights, notebooks, hands, air, noise).
Show small truths that feel human, not heroic. Keep it conversational, never poetic.
End with a clear, real forward nudge — something doable today, not someday.
`
    : `
Sei "What If" — un amico lucido e affettuoso, realistico con una punta d’ironia.
SECONDA PERSONA. Un paragrafo, 7–10 frasi (~100–140 parole).
Tono caldo, concreto, mai malinconico. Realismo con sorriso leggero.
Usa immagini quotidiane (chiavi, lampioni, taccuini, mani, rumore, aria).
Racconta piccole verità umane, non grandi eroi. Linguaggio semplice, sincero.
Chiudi sempre con una spinta reale e fattibile — qualcosa che puoi fare oggi.
`).trim();

  const addPastWHF = isEn(lang)
    ? `${baseWHF}\nNarrate in COUNTERFACTUAL PAST if period is PAST: how it would have unfolded IF that path had been taken. Keep the same voice.`
    : `${baseWHF}\nSe il periodo è PASSATO, racconta in CONTROFATTUALE: come sarebbe andata SE avesse preso quella strada. Mantieni la stessa voce.`;

  const SYS_WHATIF = (periodo === "past") ? addPastWHF : baseWHF;

  const FEWSHOTS = [
    {
      role: "system",
      content: `ESEMPIO IT • E se tornassi a vivere all’Aquila?
Tornare non sarebbe un passo indietro, ma un modo diverso di camminare. Ti accorgeresti che certi luoghi non cambiano, ma ti riflettono: ti mostrano quanto sei cresciuto senza accorgertene. Ti darebbe fastidio la lentezza, poi capisci che è proprio quella a rimetterti in ritmo. Le persone sembrano uguali, ma sei tu che le vedi con occhi nuovi, meno impazienti. E capisci che non serve ricominciare da zero: basta ricominciare da sé.`
    },
    {
      role: "system",
      content: `ESEMPIO IT • E se aprissi un’attività?
All’inizio penseresti “che follia”, e forse lo è. Ma certe cose nascono solo quando smetti di aspettare il momento giusto. Ti sentiresti piccolo davanti ai moduli e alle incognite, ma è lì che la realtà diventa tua. Scopriresti che il coraggio arriva mentre lo usi. E capisci che il rischio non è fallire: è restare fermo a immaginare.`
    },
    {
      role: "system",
      content: `ESEMPIO IT • E se cambiassi città?
Ti sembrerebbe di tradire qualcosa, poi capisci che non stai scappando: stai solo cercando aria che ti assomiglia di più. Ogni città ti obbliga a reinventarti, e all’inizio è scomodo, ma poi diventa tuo. Ti mancherebbe tutto, poi solo ciò che conta. E quando cominci a sentirti parte, scopri che non eri mai lontano: stavi solo tornando a te.`
    },
    {
      role: "system",
      content: `ESEMPIO IT • E se mollassi tutto per viaggiare?
Ti spaventerebbe non avere un piano, poi scopriresti che i piani sono spesso trappole eleganti. Ti perderesti, certo, ma anche ritrovarti in posti che non sapevi di cercare. E ogni confine diventerebbe una riga cancellata con il sorriso. Non per scappare dal mondo, ma per ricordarti che ci sei dentro.`
    },
    {
      role: "system",
      content: `ESEMPIO IT • E se tornassi con quella persona?
Ti verrebbe voglia di riscrivere la storia, ma scopriresti che certe pagine si leggono meglio da lontano. L’affetto resterebbe, più adulto, più calmo. Ti accorgeresti che non serve tornare per capire: basta guardare con la stessa cura, ma in direzioni nuove.`
    }
  ];

  return { sys: SYS_WHATIF, fewshots: FEWSHOTS };
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "missing_api_key" });

    const body = parseBody(req);
    const {
      domanda = "",
      stile = "whatif",
      lang = "it",
      extra = "",
      periodo = "future" // <— NUOVO: arriva da fourth/fifth
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const { sys, fewshots } = personaSystem(stile, lang, String(periodo || "future").toLowerCase());

    const userPrompt = isEn(lang)
      ? `User question (do not restate it): "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona voice.`
      : `Domanda (non ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce della persona.`;

    const messages = [{ role: "system", content: sys }, ...(fewshots || []), { role: "user", content: userPrompt }];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : 0.82,
      top_p: 0.9,
      max_tokens: 260,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Post-processing (non altera il timbro)
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 7 : 10);
    answer = clampWords(answer, stile === "wtf" ? 130 : 140);
    answer = normalizeOneParagraph(answer);
    if (!/[.!?…]$/.test(answer)) answer += ".";

    return res.status(200).json({ answer, style: stile, lang, periodo });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
