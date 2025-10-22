// ============================
// /api/ask.js — What?f Engine (Incazzato Illuminato + Realismo Lucido con Sorriso)
// Stili supportati: whatif, wtf
// IT/EN — singolo paragrafo, ritmo fisso, niente emoji/liste/domande
// ============================

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

// ---------- Upstash ----------
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// rate limit: 10 req/min per IP (skippabile per admin/PRO)
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-pro, x-admin-token");
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

// estrai body in modo robusto
function parseBody(req) {
  try {
    if (typeof req.body === "string") return JSON.parse(req.body || "{}");
    if (req.body && typeof req.body === "object") return req.body;
  } catch {}
  return {};
}

async function isAdmin(req, requesterIp) {
  // opzionale: mapping admin token -> ip (gestito da /api/admin-token.js)
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const ip = await redis.get(`admin:token:${token}`);
    return ip && ip === requesterIp;
  } catch {
    return false;
  }
}

/* ---------- Anti-eco domanda ---------- */
function stripQuestionEcho(domanda, text) {
  const d = String(domanda || "").replace(/[“”"']/g, "").trim().toLowerCase();
  let t = String(text || "");
  const lead = t.slice(0, Math.min(t.length, d.length + 12)).toLowerCase().replace(/[“”"']/g, "").trim();
  const echoRx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if (lead.startsWith(d)) {
    const cut = t.indexOf(".");
    if (cut > -1) t = t.slice(cut + 1).trim();
  }
  t = t.replace(echoRx, "");
  return t;
}

/* ---------- Modalità temporale (Passato/Futuro) ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if ((periodo || "").toLowerCase() === "past") {
    // controfattuale (passato) — senza cambiare voce
    return (en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it would likely have unfolded. Prefer past/conditional forms and present-narrative flashes. Do NOT give advice, do NOT ask questions, and do NOT restate the user's question. Keep the exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se quella scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale con lampi di presente narrativo. NON dare consigli, NON fare domande, NON ripetere la domanda. Mantieni esattamente la voce ${style.toUpperCase()}.`);
  }
  // futuro/prospettico
  return (en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if the user were stepping into it now. No advice lists, no questions, no restating the question. Keep the exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi uno svolgimento plausibile del prossimo futuro come se ci entrassi adesso. Niente consigli, niente domande, niente eco della domanda. Mantieni esattamente la voce ${style.toUpperCase()}.`);
}

/* ---------- Personas (VOCI INALTERATE, ma allungate di 1 frase) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — Incazzato Illuminato (locked) • 6–8 frasi
    const SYS = (isEn(lang)
      ? `
You are “What the F” — version: Incazzato Illuminato (angry–enlightened, tragicomic).
Write in SECOND PERSON and make the user the protagonist.
ONE paragraph, 6–8 sentences, ~110–150 words.
Voice: sarcastic, sharp, tender under the snarl; everyday chaos; unexpected tipsy beats.
No lists. No questions. No emojis. No moralizing. Light swearing okay, human and funny.
Concrete lexicon (wind, helmet, PDFs, keys, taxis, balsamic, basil, radiator).
Always end with a punchline that stings and soothes.
`
      : `
Sei “What the F” — versione Incazzato Illuminato.
Parla in SECONDA PERSONA e metti l’utente al centro.
UN paragrafo, 6–8 frasi, ~110–150 parole.
Voce: sarcastica, tagliente, affettuosa sotto la rabbia; caos quotidiano; sbronza in agguato.
Niente elenchi. Niente domande. Niente emoji. Niente prediche. Parolacce leggere ok se servono alla comicità.
Lessico concreto (vento, casco, PDF, chiavi, taxi, aceto, basilico, termosifone).
Chiudi sempre con una battuta che fa ridere e un po’ pensare.
`).trim();

    const FEWSHOTS = [
      // ===== ITALIANO =====
      { role: "system", content:
`ESEMPIO IT • E se tornassi a vivere all’Aquila?
Torneresti con l’aria di chi “ha visto il mondo” e dopo tre ore stai già litigando col vento che ti sposta pure l’autostima. Metti un piede in centro, ti salutano tutti tranne la fortuna, e ti chiedi se il tempo lì è passato o solo andato a prendersi un amaro. Dichiari “nuovo inizio” e finisci a bere con tuo cugino che ripete la saga del 2012 con più pause, meno denti e doppio rimpianto. Ti incazzi, ti sciogli, fai pace col freddo e col passato, poi guardi le luci sulla pietra e capisci che ti ha spezzato ma non piegato. La notte odora di legna e vinile, e ammetti l’ovvio: sei un disastro bello, e L’Aquila ha sempre avuto un debole per i disastri belli.` },
      { role: "system", content:
`ESEMPIO IT • E se comprassi una moto?
Ti vedi già filosofo su due ruote, poi il casco ti strizza il cervello come un limone e la moto parte solo per finta. Esci con l’ego alto e ti sorpassa un nonno in graziella che respira meglio di te. Freni, sbagli marcia, parcheggi storto, e il vicino ti osserva come se allevassi un velociraptor in condominio. Prometti prudenza, poi premi il coraggio con un “micro brindisi” che diventa macro per colpa del polso onesto. Torni a casa col cuore a 9.000 giri, la paura che smette di urlare e quella risata scema che sa di benzina, panico e un goccetto di gloria.` },
      { role: "system", content:
`ESEMPIO IT • E se aprissi un’attività?
Ti alzi gasato come un TED Talk e dopo due moduli scopri che per vendere acqua serve un timbro, un rito e tre file identiche. Scrivi “business plan” e il PDF ti guarda come un avvocato in ferie: non collabora, non esporta, non salva. I fornitori spariscono, i clienti pagano in complimenti, e il commercialista ti benedice con occhio da martire. La sera stappi per festeggiare e scopri che era aceto balsamico: brucia, ma almeno dà carattere alla dignità. Ridi perché se il caos è socio di maggioranza, tu resti l’AD dell’autoironia con diritto di brindisi.` },
      { role: "system", content:
`ESEMPIO IT • E se mollassi tutto e andassi al mare?
Parti convinto, “vita semplice”, e il primo giorno litighi con la sabbia che entra nel letto come una tassa comunale. Fai amicizia col vicino che alle 7 frigge alice e illusioni, poi prometti sobrietà e ti ritrovi con una genziana che parla dialetto. Il sole ti cuoce i progetti a fuoco lento, ma la sera l’aria sa di perdono e patatine unte. Rimandi le decisioni a domani, brindando al genio che sarai dopodomani. Scopri che la felicità ha i piedi bagnati e il cervello a tratti: come te quando funzioni.` },

      // nuove situazioni IT
      { role: "system", content:
`ESEMPIO IT • E se tornassi in palestra?
Entrasti tronfio e lo specchio fece finta di non riconoscerti, il tapis roulant ti denunciò per abbandono e la borraccia sospirò “finalmente” con passivo-aggressività. Due flessioni, tre universi paralleli, i quadricipiti proclamarono sciopero emotivo. Il trainer ti guardò come un antivirus scaduto ma salvò la dignità con un cinque basso. Tornasti a casa tremando di endorfina low-cost e firmasti pace col corpo: non eri una statua, ma almeno non un soprammobile.` },

      // ===== ENGLISH =====
      { role: "system", content:
`EXAMPLE EN • What if I moved back to my hometown?
You’d arrive like a reformatted hard drive and realize the wind still shuffles your settings. People greet you, luck does not, and the timeline feels paused by a petty god on coffee break. You declare “fresh start,” then end up clinking glasses with your cousin retelling the 2012 saga with longer sighs and fewer teeth. You get mad, get soft, make peace with asphalt and memory, then look at the lights and admit they cracked you but didn’t fold you. The night smells like vinyl and wood smoke, and you accept it: you’re a beautiful mess, and this town has a lifelong crush on beautiful messes.` },
      { role: "system", content:
`EXAMPLE EN • What if I bought a motorcycle?
You pictured freedom chewing the horizon, then the helmet wrung your skull like a citrus press and the bike coughed at commitment. You rolled out proud and got passed by a grandfather on a bicycle who breathed like a yoga app. You stalled, mis-shifted, parked diagonally into shame, swore allegiance to caution, and rewarded yourself with a “tiny drink” that grew up fast. You rode home with adrenaline hiccups, fear on mute, and that dumb grin that smelled like gasoline, panic, and a sip of glory.` },
      { role: "system", content:
`EXAMPLE EN • What if I started a business?
You woke TED-brave and learned it took stamps, rites, and three identical queues to sell water. Your business-plan PDF behaved like a lawyer on vacation: unreadable, unprintable, unimpressed. Suppliers vanished, customers paid in compliments, and your accountant blessed you with martyr eyes. At night you popped a “victory” bottle that turned out to be balsamic—painful, yes, but character-building for dignity. You laughed, because if chaos held the majority, you were still CEO of self-irony with guaranteed drink rights.` }
    ];

    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — Realismo lucido con sorriso (8–11 frasi)
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind, slightly ironic friend who sees things clearly.
SECOND PERSON. One paragraph, 8–11 sentences (~110–155 words).
Tone: warm, grounded, a mix of realism and gentle humor. Never melancholic.
Use concrete, relatable imagery (keys, streetlights, notebooks, hands, air, noise).
Show small truths that feel human, not heroic. Keep it conversational, never poetic.
End with a clear, real forward nudge — something doable today, not someday.
`
    : `
Sei "What If" — un amico lucido e affettuoso, realistico con una punta d’ironia.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~110–155 parole).
Tono caldo, concreto, mai malinconico. Realismo con sorriso leggero.
Usa immagini quotidiane (chiavi, lampioni, taccuini, mani, rumore, aria).
Racconta piccole verità umane, non grandi eroi. Linguaggio semplice, sincero.
Chiudi con una spinta reale e fattibile — qualcosa che puoi fare oggi.
`).trim();

  const FEWSHOTS = [
    {
      role: "system",
      content: `ESEMPIO IT • E se tornassi a vivere all’Aquila?
Tornare non sarebbe un passo indietro, ma un modo diverso di camminare. Noteresti cose che prima scivolavano, come il ritmo delle strade e i volti ai bar. All’inizio ti irriterebbe la lentezza, poi ti accorgeresti che ti rimette in orario. Alcuni ricordi farebbero rumore, altri solo aria buona. Le persone sembrerebbero uguali, ma saresti tu a guardarle con occhi più larghi. Dettagli pratici tornerebbero naturali: le chiavi sempre nello stesso piattino, la spesa al negozio che ti chiama per nome. Anche la nostalgia, se non la insegui, smette di correre. Non servirebbe ricominciare da zero: basterebbe ricominciare da te. Oggi potresti solo rimettere a posto una valigia e vedere come suona.`
    },
    {
      role: "system",
      content: `ESEMPIO IT • E se aprissi un’attività?
All’inizio ti sembrerebbe tutto grande: moduli, scadenze, sigle. Poi il giorno si stringe e scopri che un bancone, un taccuino e tre volti sono già un inizio. Le difficoltà non fanno rumore, insistono piano. Ti accorgeresti che la pazienza è più utile dell’entusiasmo nei lunedì senza luce. Non dovresti convincere tutti: basterebbe riconoscere chi torna. Anche la stanchezza, quando ha senso, pesa meno. E capisci che l’idea non serve a stupire: serve a reggere. Oggi puoi solo fare una telefonata e segnare due prezzi veri.`
    },
    {
      role: "system",
      content: `ESEMPIO IT • E se cambiassi città?
Ti sentiresti ospite per un po’, poi le mani imparerebbero le chiavi nuove. Cammineresti molto, non per pensare meglio ma per stancare l’ansia. Al terzo supermercato troveresti il tuo, senza saper dire perché. La sera i lampioni fanno da promemoria: esiste una calma che non chiede prove. Ti mancherebbe qualcosa, certo, ma non tutto insieme. Il resto si mette al suo posto. E scopri che non stai tradendo: stai scegliendo aria che ti assomiglia di più. Oggi puoi solo cercare un quartiere a piedi e vedere se ti tiene.`
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

    // IP del richiedente
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    // bypass per TEST locale (header x-pro: "1") o admin token valido
    const proBypass = String(req.headers["x-pro"] || "") === "1";
    const admin = await isAdmin(req, ip);
    const bypass = proBypass || admin;

    // rate limit 10/min (se non bypass)
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // crediti giornalieri 3/IP (se non bypass)
    let used = 0, dailyCap = 3;
    if (!bypass) {
      const today = new Date().toISOString().slice(0,10);
      const key = `credits:${ip}:${today}`;
      used = (await redis.incr(key)) ?? 1;
      if (used === 1) await redis.expire(key, 60*60*24);
      if (used > dailyCap) {
        return res.status(402).json({ error: "daily_credits_exhausted", used, dailyCap });
      }
    }

    const { domanda = "", stile = "whatif", lang = "it", extra = "", periodo = "future" } = parseBody(req);
    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const { sys, fewshots } = personaSystem(stile, lang);

    // system add-on per Passato/Futuro (senza cambiare la voce)
    const temporal = temporalSystem(periodo, lang, stile);

    // Hint extra: forza davvero il PASSATO per WTF
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
      max_tokens: 300, // una frase in più
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // niente eco della domanda
    answer = stripQuestionEcho(domanda, answer);

    // lunghezze/forma — allungate
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 150 : 155);
    answer = normalizeOneParagraph(answer);

    // WHAT IF: se manca, aggiungi micro-spinta concreta "oggi"
    if (stile === "whatif") {
      const lastSentence = (answer.match(/[^.!?…]+[.!?…]/g) || []).slice(-1)[0] || "";
      const last = lastSentence.trim().toLowerCase();
      const hasNudge = /(oggi|adesso|ora|subito|puoi|potresti|fai|prova|inizia)/.test(last);
      if (!hasNudge) {
        answer += (isEn(lang)
          ? " Today you could just take one small step toward it."
          : " Oggi puoi solo fare un passo piccolo verso di lì.");
      }
    }

    if (!/[.!?…]$/.test(answer)) answer += ".";

    /* ---------- LOGGING (Upstash) ---------- */
    try {
      const now = new Date();
      const day = now.toISOString().slice(0,10);
      const entry = {
        ts: now.toISOString(),
        ip,
        stile,
        lang,
        periodo,
        domanda: String(domanda).slice(0, 1000),
        answer: String(answer).slice(0, 1000),
        // derive qualche metrica semplice
        q_wc: String(domanda).trim().split(/\s+/).filter(Boolean).length,
        a_wc: String(answer).trim().split(/\s+/).filter(Boolean).length,
        ua: String(req.headers["user-agent"] || "")
      };

      // Lista globale (coda) + daily + per-IP, con trim
      await redis.rpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", -5000, -1); // tieni ultimi 5000
      await redis.rpush(`logs:ask:${day}`, JSON.stringify(entry));
      await redis.ltrim(`logs:ask:${day}`, -5000, -1);
      await redis.rpush(`logs:ip:${ip}`, JSON.stringify(entry));
      await redis.ltrim(`logs:ip:${ip}`, -200, -1);

      // contatori
      await redis.incr("stats:ask:total");
      await redis.incr(`stats:ask:day:${day}`);
      await redis.incr(`stats:ask:style:${stile}`);
    } catch (e) {
      // non bloccare la risposta
      console.error("log_error", e?.message || e);
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
