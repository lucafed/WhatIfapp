// /api/ask.js — What?f Engine (TONI ESEMPLI-DRIVEN)
// Stili: whatif(analitico|poetico) · wtf (sarcasmo demenziale con imprecazioni non-religiose)
// IT/EN support; un paragrafo; niente elenchi/emoji/domande; niente eco della domanda
// Ratelimit: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA contenuto domanda (solo metadati + hash)

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

// rate limit: 10 req/min per IP (bypass SOLO per admin)
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro");
}

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

function normLine(s = "") {
  return String(s).toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "").trim();
}
function tightenSentences(text, maxSentences) {
  const parts = String(text || "").replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const out = []; const seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n || seen.has(n)) continue;
    const wc = p.split(/\s+/).length;
    if (wc <= 3 && !/[.!?]$/.test(p)) continue;
    out.push(p); seen.add(n);
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
  return String(s).replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1").trim();
}
function stripQuestionEcho(domanda, text) {
  const d = String(domanda || "").replace(/[“”"']/g, "").trim().toLowerCase();
  let t = String(text || "");
  const lead = t.slice(0, Math.min(t.length, d.length + 12)).toLowerCase().replace(/[“”"']/g, "").trim();
  const echoRx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if (lead.startsWith(d)) { const cut = t.indexOf("."); if (cut > -1) t = t.slice(cut + 1).trim(); }
  t = t.replace(echoRx, "");
  return t;
}
function tinyHash(s = "") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/* ---------- Sicurezza WTF (niente blasfemie religiose esplicite) ---------- */
const IMPRECATIONS_IT = [
  "porca di quella grappa fulminata",
  "maiala miseria",
  "porcaccia la vacca in retromarcia",
  "maledetto cavaturaccioli dell’inferno domestico",
  "accidenti al tostapane vendicativo",
  "sciagurata moka sorda e bastarda",
  "santo spritz sversato",
  "perbacco del parabrezza incrinato",
  "diamine del bancone traballante",
  "maremma del miscelatore impazzito",
  "per tutti i bicchieri incrinati",
  "mannaggia al bullone ballerino",
  "o che malora di cassa registratrice starnutita",
  "santissima guarnizione sfatta",
  "stramaledetta manopola che scotta",
];
function ensureOneImprecationItalian(out) {
  // se manca un’imprecazione, infilane una (discreta) dopo la prima o seconda frase
  const hasImp = IMPRECATIONS_IT.some(x => out.toLowerCase().includes(x.split(" ")[0]));
  if (hasImp) return out;
  const pick = IMPRECATIONS_IT[Math.floor(Math.random()*IMPRECATIONS_IT.length)];
  const parts = out.split(/(?<=[.!?…])\s+/);
  if (parts.length > 1) {
    parts[0] = parts[0] + ", " + pick + ".";
    return parts.join(" ");
  } else {
    return out + " " + pick + ".";
  }
}

/* ---------- Admin check ---------- */
async function isAdmin(req, requesterIp) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const data = await redis.hgetall(`admin:token:${token}`); // { ip, ua }
    if (!data) return false;
    const LOCK_IP = String(process.env.ADMIN_LOCK_IP || "false").toLowerCase() === "true";
    if (LOCK_IP) {
      if (!data.ip) return false;
      return data.ip === requesterIp;
    }
    return true;
  } catch {
    return false;
  }
}

/* ---------- Modalità temporale ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if (String(periodo || "").toLowerCase() === "past") {
    return en
      ? `TEMPORAL MODE: PAST/COUNTERFACTUAL. Narrate as if it HAD happened already; prefer past/conditional, with coherent grammar. One paragraph. No lists/questions/emojis.`
      : `MODALITÀ TEMPORALE: PASSATO/CONTROFATTUALE. Narra come se fosse già successo; preferisci passato/condizionale, grammatica coerente. Un paragrafo. Niente elenchi/domande/emoji.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE/PROSPECTIVE. Narrate a plausible near future in present/future tense. One paragraph. No lists/questions/emojis.`
    : `MODALITÀ TEMPORALE: FUTURO/PROSPETTICO. Narra un prossimo futuro plausibile in presente/futuro. Un paragrafo. Niente elenchi/domande/emoji.`;
}

/* ---------- Few-shots: imparare dagli ESEMPI ---------- */
const FEWSHOTS_IT = {
  whatif_analitico: `
Sai Luca, questa domanda era nell’aria da un po’, vero?
Tornare a L’Aquila oggi significherebbe ritrovarti in una città che ha cambiato pelle ma non respiro.
Negli ultimi anni la ricostruzione ha rimesso in moto l’economia, ma a ritmo lento: più imprese locali, meno industria, molti giovani che restano per scelta, non più per mancanza di alternative.
Il costo della vita è ancora più basso del Nord, ma anche gli stipendi lo sono: qui si guadagna meno, ma si spende con più senso.
Il tempo si dilata, le relazioni contano più dei contatti, e la montagna diventa di nuovo bussola.
Certo, a volte ti mancherebbe il rumore del Veneto — ma scopriresti che la quiete non è silenzio: è solo spazio per respirare davvero.`.trim(),

  whatif_poetico: `
Bella questa, Luca — ti conosco, lo sapevo che prima o poi te la saresti fatta.
Immagina di riaprire le finestre e sentire quell’aria fredda che sa di legna e memoria.
Le strade ti riconoscono al passo, le montagne ti guardano come se non te ne fossi mai andato.
Il bar sotto casa serve ancora il caffè corto e ruvido, e la gente ti chiama per nome come se il tempo fosse rimasto in attesa.
I tuoi figli scoprirebbero il ritmo delle stagioni, la lentezza che insegna a non sprecare i giorni.
Ogni sera, quando chiudi le imposte, pensi che non stai tornando indietro: stai solo tornando dove la tua vita aveva smesso di correre.`.trim(),

  wtf_bar: `
Ah, ma certo Luca, il bar! Già ti vedo con l’aria da imprenditore e la moka che fuma come un vecchio zio in pensione.
La gente entra, tu sorridi, ti senti un dio del caffè — finché uno non ti chiede un “cappuccino decaffeinato tiepido ma con schiuma fredda”.
Tu tenti, fallisci, e dal vapore esce un “porca di quella moka sorda e bastarda!” così spontaneo che il cornetto sul bancone si piega dalle risate.
Un signore ti applaude, la macchina del caffè sputa un getto di vapore vendicativo, e tu ti versi da bere alle nove e venti, per pareggiare i conti.
Alla fine della giornata conti pochi spicci e un’ora di vita in più.
E pensi che sì, forse non hai aperto un bar: hai aperto una commedia con te come protagonista e il bancone come pubblico.`.trim(),

  wtf_amore: `
Ah, eccoci Luca. Di nuovo amore, eh? Il coraggio (o la grappa) non ti manca mai.
Ti dici “questa volta vado piano”, ma già al secondo sguardo sei in modalità telenovela.
Scrivi messaggi che cancelli, poi riscrivi, poi mandi al gruppo sbagliato — e quando lo capisci ti scappa un “maiala miseria” così rumoroso che il bicchiere vibra solidale.
Il barista ti guarda con pena, ti offre un altro giro “per il dolore”, e tu lo accetti con la dignità di un eroe tragico in ciabatte.
Ma in fondo lo sai: sei nato per perderti nelle risate e nei brindisi, mica per stare fermo.
E anche se va male, oh — almeno ci avrai riso sopra.`.trim(),

  wtf_moto: `
Ah, la moto — già ti vedo a fare il filosofo della velocità con la giacca di pelle e la paura di graffiarla.
Parti fiero, curva stretta, sorriso largo… poi un moscerino decide che il tuo dente è il suo destino e ti parte un “porcaccia la vacca in retromarcia!” che fa sobbalzare il casco.
Ti fermi al bar, ordini un Negroni per dimenticare la figuraccia, e il barista ti serve un conto che fa più paura della velocità.
Ma mentre torni a casa col vento addosso e l’odore di benzina nei pensieri, ti senti di nuovo vivo.
E pensi che in fondo non serviva la moto per scappare: bastava un po’ di coraggio e un pizzico di follia lucida.`.trim(),
};

/* ---------- Persona system (guidato da esempi, non da regole astratte) ---------- */
function personaSystem(style, lang, tone, nameOpt = "") {
  const en = isEn(lang);
  const NAME_HINT = nameOpt ? (en ? `If it feels natural, use the first name "${nameOpt}" once.` : `Se viene naturale, usa il nome "${nameOpt}" una volta.`) : (en ? `Name optional.` : `Nome facoltativo.`);
  if (style === "wtf") {
    const sys = (en
      ? `WHAT THE F: friendly roast, bar sarcasm, lively images. Open with a brief confidant jab tied to the question (no nicknames), often with a playful alcohol beat. ONE paragraph, 6–9 sentences, colloquial, coherent with TEMPORAL MODE. Do NOT restate the question. Use exactly ONE non-religious Italian-style imprecation from the list, woven naturally into the scene, and include a short reaction from an object/person. No lists/questions/emojis. Close with a quick, warm, funny beat. ${NAME_HINT}`
      : `WHAT THE F: presa in giro amichevole, sarcasmo da bar, immagini vive. Apri con una battuta confidenziale legata alla domanda (niente nomignoli), spesso con alcol. UN paragrafo, 6–9 frasi, colloquiale, coerente con la MODALITÀ TEMPORALE. NON ripetere la domanda. Usa esattamente UNA imprecazione italiana non-religiosa dall’elenco, integrata nella scena, e metti una breve reazione di oggetto/persona. Niente elenchi/domande/emoji. Chiudi con un tocco caldo e divertente. ${NAME_HINT}`);
    const listImp = `Imprecations (choose one, vary over time): ${IMPRECATIONS_IT.join(" · ")}.`;
    const few = [
      { role: "system", content: sys },
      { role: "system", content: listImp },
      { role: "system", content: FEWSHOTS_IT.wtf_bar },
      { role: "system", content: FEWSHOTS_IT.wtf_amore },
      { role: "system", content: FEWSHOTS_IT.wtf_moto },
    ];
    return { sys, fewshots: few };
  }

  // whatif
  const t = String(tone || "").toLowerCase(); // "analitico" | "poetico"
  const base = (en
    ? `WHAT IF: warm, grounded, intimate. Open with a soft confidant line. ONE paragraph, 8–11 sentences. No lists/questions/emojis. Do NOT restate the question. ${NAME_HINT}`
    : `WHAT IF: caldo, concreto, confidenziale. Apri con una riga morbida e vicina. UN paragrafo, 8–11 frasi. Niente elenchi/domande/emoji. NON ripetere la domanda. ${NAME_HINT}`);

  if (t === "analitico") {
    const sys = base + (en
      ? ` Focus on realistic social/economic quality-of-life context; grounded, non-technical.`
      : ` Focalizza su contesto realistico socio/economico e qualità della vita; concreto, non tecnico.`);
    const few = [{ role: "system", content: FEWSHOTS_IT.whatif_analitico }];
    return { sys, fewshots: few };
  } else {
    const sys = base + (en
      ? ` Poetic variant: everyday images, gentle movement, reflective closing line.`
      : ` Variante poetica: immagini quotidiane, movimento gentile, chiusa riflessiva breve.`);
    const few = [{ role: "system", content: FEWSHOTS_IT.whatif_poetico }];
    return { sys, fewshots: few };
  }
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });

    // IP richiedente
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    // Admin bypass (rate+crediti)
    const admin = await isAdmin(req, ip);
    const bypass = admin === true;

    // PRO header (UI locale): x-pro: "1"
    const isPro = String(req.headers["x-pro"] || "").trim() === "1";

    // Rate limit 10/min (se non bypass)
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // Crediti giornalieri: Admin ∞, PRO 10, Free 3
    let used = 0, dailyCap = isPro ? 10 : 3;
    if (!bypass) {
      const today = new Date().toISOString().slice(0, 10);
      const key = `credits:${ip}:${today}`;
      used = (await redis.incr(key)) ?? 1;
      if (used === 1) await redis.expire(key, 60 * 60 * 24);
      if (used > dailyCap) {
        return res.status(402).json({ error: "daily_credits_exhausted", used, dailyCap });
      }
    }

    // Body
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",        // "whatif" | "wtf"
      lang = "it",
      extra = "",
      periodo = "future",      // "future" | "past"
      sex = "",                // "m" | "f" | "nb" | ""
      tone = "",               // SOLO per whatif: "analitico" | "poetico" (default poetico)
      name = "",               // facoltativo: nome utente per saluto confidenziale
      micro = {}               // profilo micro (può contenere micro.name)
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();
    const resolvedName = String(name || micro?.name || "").split(" ")[0].trim(); // solo nome

    const { sys, fewshots } = personaSystem(stile, lang, tone, resolvedName);
    const temporal = temporalSystem(periodo, lang, stile);

    // seed deterministico (varietà controllata)
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${periodo}|${tone}`), 36) % 1000000;

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Style="${stile}" Tone="${tone||"auto"}". Sex="${resolvedSex||"unknown"}". Name="${resolvedName||""}". INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Stile="${stile}" Tono="${tone||"auto"}". Sesso="${resolvedSex||"unknown"}". Nome="${resolvedName||""}". SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...fewshots,
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 360,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: stile === "wtf" ? 0.25 : 0.0,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);
    if (stile === "wtf" && !isEn(lang)) {
      // rinforza presenza di UNA imprecazione italiana non religiosa (se assente)
      answer = ensureOneImprecationItalian(answer);
    }
    if (!/[.!?…]$/.test(answer)) answer += ".";

    // --- LOG persistente (privacy-safe: niente testo domanda) ---
    try {
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
        sex: resolvedSex || null,
        tone: tone || null,
        name_used: !!resolvedName,
        domanda_len: String(domanda || "").length,
        domanda_hash: tinyHash(domanda || ""),
        answer_chars: (answer || "").length,
        admin: !!admin,
        user_type: bypass ? "admin" : (isPro ? "pro" : "free"),
      };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", 0, 9999);
      await redis.incr("stats:total");
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo || "future"), 1);
      if (tone) await redis.hincrby("stats:tone", tone, 1);
      if (resolvedSex) await redis.hincrby("stats:sex", resolvedSex, 1);
      await redis.hincrby("stats:user_type", entry.user_type, 1);
      const dayKey = `stats:day:${new Date().toISOString().slice(0, 10)}`;
      await redis.hincrby(dayKey, `${stile}:${periodo}:${tone||"auto"}`, 1);
      await redis.expire(dayKey, 90 * 24 * 60 * 60);
    } catch (e) {
      console.warn("log failure (non-bloccante)", e);
    }

    return res.status(200).json({
      answer,
      style: stile,
      tone: tone || (stile === "whatif" ? "poetico" : null),
      lang,
      periodo,
      model: MODEL,
      admin,
      pro: isPro,
      credits: bypass ? null : { used, dailyCap },
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
