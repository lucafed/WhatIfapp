// ============================
// /api/ask.js — What?f Engine (Incazzato Illuminato + Realismo Lucido con Sorriso)
// Stili supportati: whatif, wtf
// IT/EN — singolo paragrafo, ritmo fisso, niente emoji/liste/domande
// ============================

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

// ---------- OpenAI ----------
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

// ---------- Upstash ----------
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// rate limit: 10 req/min per IP (bypassabile SOLO per admin)
const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
});

// ---------- CORS ----------
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
function cors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token");
}

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

// Rimozione eco della domanda
function stripQuestionEcho(domanda, text) {
  const d = String(domanda || "").replace(/[“”"']/g, "").trim().toLowerCase();
  let t = String(text || "");
  const lead = t
    .slice(0, Math.min(t.length, d.length + 12))
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .trim();
  const echoRx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if (lead.startsWith(d)) {
    const cut = t.indexOf(".");
    if (cut > -1) t = t.slice(cut + 1).trim();
  }
  t = t.replace(echoRx, "");
  return t;
}

// Admin check (mapping token->ip gestito da /api/admin-token)
async function isAdmin(req, requesterIp) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const ip = await redis.get(`admin:token:${token}`);
    return ip && ip === requesterIp;
  } catch {
    return false;
  }
}

/* ---------- Modalità temporale (Passato/Futuro) ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if (String(periodo || "").toLowerCase() === "past") {
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it would likely have unfolded. Prefer past/conditional forms and present-narrative flashes. Do NOT give advice, do NOT ask questions, and do NOT restate the user's question. Keep the exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale con lampi di presente narrativo. NON dare consigli, NON fare domande, NON ripetere la domanda. Mantieni esattamente la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if the user were stepping into it now. No advice lists, no questions, no restating the question. Keep the exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi uno svolgimento plausibile del prossimo futuro come se ci entrassi adesso. Niente liste/consigli, niente domande, niente eco della domanda. Mantieni esattamente la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (immutate) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — Incazzato Illuminato (locked)
    const SYS = (isEn(lang)
      ? `
 You are “What the F” — version: Incazzato Illuminato (angry–enlightened, tragicomic). Write in SECOND PERSON and make the user the protagonist. ONE paragraph, 5–7 sentences, ~100–130 words. Voice: sarcastic, sharp, tender under the snarl; everyday chaos; unexpected tipsy beats. No lists. No questions. No emojis. No moralizing. Light swearing okay, human and funny. Concrete lexicon (wind, helmet, PDFs, keys, taxis, balsamic, basil, radiator). Always end with a punchline that stings and soothes.
`.trim()
      : `
 Sei “What the F” — versione Incazzato Illuminato. Parla in SECONDA PERSONA e metti l’utente al centro. UN paragrafo, 5–7 frasi, ~100–130 parole. Voce: sarcastica, tagliente, affettuosa sotto la rabbia; caos quotidiano; sbronza in agguato. Niente elenchi. Niente domande. Niente emoji. Niente prediche. Parolacce leggere ok se servono alla comicità. Lessico concreto (vento, casco, PDF, chiavi, taxi, aceto, basilico, termosifone). Chiudi sempre con una battuta che fa ridere e un po’ pensare.
`.trim());

    const FEWSHOTS = [
      // ===== ITALIANO =====
      {
        role: "system",
        content: `ESEMPIO IT • E se tornassi a vivere all’Aquila? Torneresti con l’aria di chi “ha visto il mondo” e dopo tre ore stai già litigando col vento che ti sposta pure l’autostima. Metti un piede in centro, ti salutano tutti tranne la fortuna, e ti chiedi se il tempo lì è passato o solo andato a prendersi un amaro. Dichiari “nuovo inizio” e finisci a bere con tuo cugino che ripete la saga del 2012 con più pause, meno denti e doppio rimpianto. Ti incazzi, ti sciogli, fai pace col freddo e col passato, poi guardi le luci sulla pietra e capisci che ti ha spezzato ma non piegato. E mentre il bicchiere scalda, ammetti l’ovvio: sei un disastro bello, e L’Aquila ha sempre avuto un debole per i disastri belli.`
      },
      {
        role: "system",
        content: `ESEMPIO IT • E se comprassi una moto? Ti vedi già filosofo su due ruote, poi il casco ti strizza il cervello come un limone e la moto parte solo per finta. Esci con l’ego alto e ti sorno un nonno in graziella che respira meglio di te. Freni, sbagli marcia, parcheggi storto, e il vicino ti osserva come se allevassi un velociraptor in condominio. Prometti prudenza, poi premi il coraggio con un “micro brindisi” che diventa macro per colpa del polso onesto. Torni a casa con il cuore a 9.000 giri e quella risata scema che sa di benzina, paura e un goccetto di gloria.`
      },
      {
        role: "system",
        content: `ESEMPIO IT • E se aprissi un’attività? Ti alzi gasato come un TED Talk e dopo due moduli scopri che per vendere acqua serve un timbro, un rito e tre file identiche. Scrivi “business plan” e il PDF ti guarda come un avvocato in ferie: non collabora, non esporta, non salva. I fornitori spariscono, i clienti pagano in complimenti, e il commercialista ti benedice con occhio da martire. La sera stappi per festeggiare e scopri che era aceto balsamico: brucia, ma almeno dà carattere alla dignità. E ridi, perché se il caos è socio di maggioranza, tu sei l’AD dell’autoironia con diritto di brindisi.`
      },
      {
        role: "system",
        content: `ESEMPIO IT • E se mollassi tutto e andassi al mare? Parti convinto, “vita semplice”, e il primo giorno litighi con la sabbia che entra nel letto come una tassa comunale. Fai amicizia col vicino che alle 7 frigge alice e illusioni, poi prometti sobrietà e ti ritrovi con una genziana che parla dialetto. Il sole ti cuoce i progetti a fuoco lento, ma la sera l’aria sa di perdono e patatine unte. Rimandi le decisioni a domani, brindando al genio che sarai dopodomani. E ti accorgi che la felicità ha i piedi bagnati e il cervello a tratti, proprio come te quando funziona.`
      },
      // ===== ENGLISH =====
      {
        role: "system",
        content: `EXAMPLE EN • What if I moved back to my hometown? You’d arrive like a reformatted hard drive and realize the wind still shuffles your settings. People greet you, luck does not, and the timeline feels paused by a petty god with a coffee break. You declare “fresh start,” then end up clinking glasses with your cousin retelling the 2012 saga with longer sighs and fewer teeth. You get mad, get soft, make peace with asphalt and memory, then look at the lights and admit they cracked you but didn’t fold you. And with that honest buzz, you accept it: you’re a beautiful mess, and this town has a lifelong crush on beautiful messes.`
      },
      {
        role: "system",
        content: `EXAMPLE EN • What if I bought a motorcycle? You picture freedom chewing the horizon, then the helmet wrings your skull like a citrus press and the bike coughs at commitment. You roll out proud and get passed by a grandfather on a bicycle who breathes like a yoga app. You stall, mis-shift, park diagonally into shame, swear allegiance to caution, and reward yourself with a “tiny drink” that performs a growth spurt. You go home with adrenaline hiccups and a dumb grin that smells like gasoline, panic, and a sip of glory.`
      },
      {
        role: "system",
        content: `EXAMPLE EN • What if I started a business? You wake up TED-talk brave and learn it takes stamps, rites, and three identical queues to sell water. Your business plan PDF behaves like a lawyer on vacation: unreadable, unprintable, unimpressed. Suppliers vanish, customers pay in compliments, and your accountant blesses you with martyr eyes. At night you pop a “victory” bottle and discover it’s balsamic—painful, yes, but character-building for dignity. You laugh, because if chaos holds majority shares, you’re the CEO of self-irony with guaranteed drink rights.`
      }
    ];

    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — nuova versione “Realismo lucido con sorriso”
  const SYS_WHATIF = (isEn(lang)
    ? `
 You are "What If" — a lucid, kind, slightly ironic friend who sees things clearly. SECOND PERSON. One paragraph, 7–10 sentences (~100–140 words). Tone: warm, grounded, a mix of realism and gentle humor. Never melancholic. Use concrete, relatable imagery (keys, streetlights, notebooks, hands, air, noise). Show small truths that feel human, not heroic. Keep it conversational, never poetic. End with a clear, real forward nudge — something doable today, not someday.
`.trim()
    : `
 Sei "What If" — un amico lucido e affettuoso, realistico con una punta d’ironia. SECONDA PERSONA. Un paragrafo, 7–10 frasi (~100–140 parole). Tono caldo, concreto, mai malinconico. Realismo con sorriso leggero. Usa immagini quotidiane (chiavi, lampioni, taccuini, mani, rumore, aria). Racconta piccole verità umane, non grandi eroi. Linguaggio semplice, sincero. Chiudi sempre con una spinta reale e fattibile — qualcosa che puoi fare oggi.
`.trim());

  const FEWSHOTS = [
    {
      role: "system",
      content: `ESEMPIO IT • E se tornassi a vivere all’Aquila? Tornare non sarebbe un passo indietro, ma un modo diverso di camminare. Ti accorgeresti che certi luoghi non cambiano, ma ti riflettono: ti mostrano quanto sei cresciuto senza accorgertene. Ti darebbe fastidio la lentezza, poi capisci che è proprio quella a rimetterti in ritmo. Le persone sembrano uguali, ma sei tu che le vedi con occhi nuovi, meno impazienti. E capisci che non serve ricominciare da zero: basta ricominciare da sé.`
    },
    {
      role: "system",
      content: `ESEMPIO IT • E se aprissi un’attività? All’inizio penseresti “che follia”, e forse lo è. Ma certe cose nascono solo quando smetti di aspettare il momento giusto. Ti sentiresti piccolo davanti ai moduli e alle incognite, ma è lì che la realtà diventa tua. Scopriresti che il coraggio arriva mentre lo usi. E capisci che il rischio non è fallire: è restare fermo a immaginare.`
    },
    {
      role: "system",
      content: `ESEMPIO IT • E se cambiassi città? Ti sembrerebbe di tradire qualcosa, poi capisci che non stai scappando: stai solo cercando aria che ti assomiglia di più. Ogni città ti obbliga a reinventarti, e all’inizio è scomodo, ma poi diventa tuo. Ti mancherebbe tutto, poi solo ciò che conta. E quando cominci a sentirti parte, scopri che non eri mai lontano: stavi solo tornando a te.`
    },
    {
      role: "system",
      content: `ESEMPIO IT • E se mollassi tutto per viaggiare? Ti spaventerebbe non avere un piano, poi scopriresti che i piani sono spesso trappole eleganti. Ti perderesti, certo, ma anche ritrovarti in posti che non sapevi di cercare. E ogni confine diventerebbe una riga cancellata con il sorriso. Non per scappare dal mondo, ma per ricordarti che ci sei dentro.`
    },
    {
      role: "system",
      content: `ESEMPIO IT • E se tornassi con quella persona? Ti verrebbe voglia di riscrivere la storia, ma scopriresti che certe pagine si leggono meglio da lontano. L’affetto resterebbe, più adulto, più calmo. Ti accorgeresti che non serve tornare per capire: basta guardare con la stessa cura, ma in direzioni nuove.`
    }
  ];

  return { sys: SYS_WHATIF, fewshots: FEWSHOTS };
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "missing_api_key" });

    // IP del richiedente (primo IP in XFF o remoteAddress)
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    // Admin bypass (rate+crediti)
    const admin = await isAdmin(req, ip);
    const bypass = admin === true;

    // Rate limit 10/min (se non bypass)
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // ---------- Gestione crediti giornalieri ----------
let used = 0;
let dailyCap = 3; // default: utente free

// bypass = admin → infinito (nessun limite)
if (bypass) {
  used = 0;
  dailyCap = Infinity;
} else {
  // utente PRO (inviato dal frontend)
  const isProUser = String(req.headers["x-user-tier"] || "").toLowerCase() === "pro";
  if (isProUser) dailyCap = 10;

  const today = new Date().toISOString().slice(0,10);
  const key = `credits:${ip}:${today}`;

  used = (await redis.incr(key)) ?? 1;
  if (used === 1) await redis.expire(key, 60*60*24);

  if (used > dailyCap) {
    return res.status(402).json({ error: "daily_credits_exhausted", used, dailyCap });
  }
}

    // Body
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",
      lang = "it",
      extra = "",
      periodo = "future"
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    // Personas (immutate)
    const { sys, fewshots } = personaSystem(stile, lang);

    // Modalità temporale add-on
    const temporal = temporalSystem(periodo, lang, stile);

    // Hint extra: forzare davvero il passato nel WTF controfattuale
    let extraTemporalHint = "";
    if (stile === "wtf" && String(periodo).toLowerCase() === "past") {
      extraTemporalHint = isEn(lang)
        ? "Write entirely in past or conditional tense, as if it already happened, keeping the same sarcastic tragicomic tone."
        : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono sarcastico e tragicomico.";
    }

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona voice.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce della persona.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      { role: "user", content: userPrompt }
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : 0.82,
      top_p: 0.9,
      max_tokens: 320,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Niente eco della domanda
    answer = stripQuestionEcho(domanda, answer);

    // Forma/lunghezze coerenti con le voci che hai definito
    answer = tightenSentences(answer, stile === "wtf" ? 7 : 10);
    answer = clampWords(answer, stile === "wtf" ? 130 : 140);
    answer = normalizeOneParagraph(answer);
    if (!/[.!?…]$/.test(answer)) answer += ".";

    // --- LOG persistente per dashboard admin ---
    try {
      const logKey = "logs:ask";
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
        domanda,
        answer_chars: (answer || "").length,
        admin: !!admin
      };
      await redis.lpush(logKey, JSON.stringify(entry));
      await redis.ltrim(logKey, 0, 4999); // ultimi 5000
      await redis.incr("stats:total");
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo || "future"), 1);
    } catch (e) {
      console.warn("log failure (non-bloccante)", e);
    }

    return res.status(200).json({
      answer,
      style: stile,
      lang,
      periodo,
      model: MODEL,
      admin,
      credits: bypass ? null : { used, dailyCap }
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
