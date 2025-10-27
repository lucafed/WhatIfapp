// /api/ask.js — What?f Engine (2025 • stile allineato agli esempi approvati)
// What if: variante "analitico" | "poetico" (selezionata dall’UI via whatif_variant)
// What the F: sarcasmo demenziale affettuoso, imprecazioni forti non letterali, oggetti che reagiscono
// IT/EN. Un solo paragrafo. Niente liste/domande/emoji. NO nomignoli.
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA testo domanda (solo metadati + hash)

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

// ---------- Admin check ----------
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
      ? `TEMPORAL MODE: PAST/COUNTERFACTUAL. Write as if the choice had already been made and unfolded. Prefer past/conditional, keep the exact ${style.toUpperCase()} voice. One paragraph, no lists, no questions, no emojis.`
      : `MODALITÀ: PASSATO/CONTROFATTUALE. Scrivi come se la scelta fosse già stata fatta e si fosse svolta. Preferisci passato/condizionale, mantieni la voce ${style.toUpperCase()}. Un paragrafo, niente elenchi, niente domande, niente emoji.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE/PROSPECTIVE. Describe a plausible near-future as if stepping into it now. Keep the exact ${style.toUpperCase()} voice. One paragraph, no lists, no questions, no emojis.`
    : `MODALITÀ: FUTURO/PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Mantieni la voce ${style.toUpperCase()}. Un paragrafo, niente elenchi, niente domande, niente emoji.`;
}

/* ---------- Libreria di imprecazioni sicure (variate, non letterali) ---------- */
// Le imprecazioni sono “forti” ma senza contenuti d’odio o religiosi espliciti.
const SAFE_SWears_IT = [
  "porca di quella grappa fulminata",
  "maiala miseria",
  "maledetto caffè che fa i nodi",
  "per tutti i bicchieri incrinati",
  "santissimo spritz sfuso",
  "vacca bastarda del carburatore",
  "ostrega del bancone sbeccato",
  "accidenti alla chat balenga",
  "giuda ballerino del registratore di cassa",
  "perbacco del parabrezza scheggiato",
  "canaglia del pos che si impalla",
  "mannaggia alla moka che fischia storta",
  "diamine del casco che strilla",
  "ostia del freezer che non chiude (il freezer finge di non sentire)"
];

const SAFE_SWears_EN = [
  "holy overcooked espresso", "bloody jukebox hiccup", "damn stir stick rebellion",
  "for the love of wobbly glasses", "son of a squeaky hinge", "heck of a leaky shaker"
];

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex = "", whatifVariant = "") {
  const en = isEn(lang);

  // ===== WHAT THE F =====
  if (style === "wtf") {
    const swearPool = en ? SAFE_SWears_EN : SAFE_SWears_IT;

    const SYS = en ? `
You are “What the F” — a bar-sarcastic, loving friend who knows the user well.
RULES:
- SECOND PERSON. Exactly ONE paragraph, 6–9 sentences, ~130–170 words.
- OPEN with a confiding, witty line tied to the question (e.g., “Ah, here we go…”, “Right, so this again?”). No nicknames. No lists/questions/emojis.
- The entire narration must stay glued to the user’s question (no random side episodes).
- Include exactly ONE strong, funny swear line embedded naturally in the scene. Use only from this pool (vary each time): ${swearPool.join(" · ")}. Never literal religious slurs or hate.
- Add at least TWO short reactions to that swear (objects/people reacting), woven into the same flow.
- Keep booze jokes where natural. Tone: fast, sharp, affectionate, never cruel.
- End with a short grin-warm line (no advice).
`.trim() : `
Sei “What the F” — un’amica/ amico da bar, sarcastico ma affettuoso, che conosce bene l’utente.
REGOLE:
- SECONDA PERSONA. Esattamente UN paragrafo, 6–9 frasi, ~130–170 parole.
- APRI con una riga confidenziale legata alla domanda (tipo “Ah, eccoci…”, “Va bene, partiamo…”). Niente nomignoli. Niente elenchi/domande/emoji.
- La narrazione resta incollata alla domanda (nessuna digressione gratuita).
- Inserisci esattamente UNA imprecazione forte e comica, dentro la scena. Usa solo da questo pool (varia sempre): ${swearPool.join(" · ")}. Mai insulti d’odio o bestemmie letterali.
- Aggiungi almeno DUE reazioni a quell’imprecazione (oggetti/persone che reagiscono), fuse nella frase successiva.
- Battute sull’alcol dove naturale. Tono: veloce, arguto, affettuoso, mai cattivo.
- Chiudi con una riga breve che sorride (non è un consiglio).
`.trim();

    // FEWSHOTS — esempi aderenti a quelli approvati
    const FEWSHOTS = [
      { role: "system", content: en ? `
EXAMPLE (bar — opening tied to question)
Right, so the bar, huh? You march in with a sacred moka and a grin like you own mornings; first order is a decaf lukewarm cappuccino with cold foam and your soul leaves the body, you try anyway and out slips “bloody jukebox hiccup” so loud the croissant folds on itself and the grinder clears its throat. The old guy claps, the machine spits steam like revenge, you pour yourself something brave at 9:20 just to balance the universe, and by closing time you count coins and small victories; not a business plan, more a one-man sitcom where the counter is your audience and the glasses nod when you breathe.`
      : `
ESEMPIO (bar — apertura legata alla domanda)
Ah, il bar, eh? Entri col sacro rito della moka e l’aria di chi addomestica le mattine; primo cliente: “cappuccino decaffeinato tiepido con schiuma fredda”, ti si spegne l’anima ma ci provi, e ti scappa “porca di quella grappa fulminata” così potente che il cornetto si piega e il macinino tossisce per discrezione. Il tipo in fondo applaude piano, la macchina sputa vapore come vendetta, ti versi qualcosa di coraggioso alle nove e venti per pareggiare il destino, e a fine turno conti spicci e dignità lucida; non un locale, una sitcom in cui il bancone è pubblico e i bicchieri annuiscono quando respiri.` },
      { role: "system", content: en ? `
EXAMPLE (love — with two reactions)
Alright, love again. You say you’ll go slow; by text three you’re composing opera. When they leave you on read, out comes “holy overcooked espresso”, the lamp trembles, the cat defects to the laundry, and the wine tops itself in solidarity. You laugh, swear softly once more, and realize you weren’t chasing perfection, just a good reason to toast.`
      : `
ESEMPIO (amore — con due reazioni)
Va bene, l’amore. Dici che stavolta vai piano; al terzo messaggio stai componendo un’opera. Quando ti lascia in visualizzato ti scappa “maiala miseria”, la lampada trema, il gatto trasloca dietro la lavatrice e il bicchiere si riempie da solo per compassione. Ridi, sbuffi un’altra imprecazione a mezza voce, e capisci che non cercavi la favola: volevi un brindisi onesto.` },
      { role: "system", content: en ? `
EXAMPLE (motorbike — integrated swear, objects react)
So, the bike. You start noble, visor down, city yours; a bug picks your tooth as destiny and you bark “son of a squeaky hinge”, the helmet pops like a drum, the traffic light pretends not to hear, and at the café the bill scares you more than speed. You ride back with wind and honesty, discovering you needed less escape and more throttle on yourself.`
      : `
ESEMPIO (moto — imprecazione integrata, oggetti reagiscono)
La moto, dunque. Parti nobile, visiera giù, città tua; un moscerino decide che il tuo dente è destino e sbotti “perbacco del parabrezza scheggiato”, il casco fa da tamburo, il semaforo finge di non sentire, e al bar il conto ti spaventa più della velocità. Ritorni col vento addosso e l’onestà, scoprendo che ti serviva meno fuga e più gas su di te.` }
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // ===== WHAT IF =====
  // Due varianti selezionate esternamente: analitico | poetico
  const header = en ? `
You are "What If" — a lucid, kind confidant who sometimes uses the user's first name.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words). No lists/questions/emojis.
Open with a soft, confidant comment tied to the question (e.g., “You’ve had this in mind for a while, haven’t you?”).
Close with a short reflective line (not advice).
` : `
Sei "What If" — un confidente lucido e affettuoso che a volte usa il nome dell’utente.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole). Niente elenchi/domande/emoji.
Apri con un commento confidenziale legato alla domanda (tipo “Questa domanda era nell’aria da un po’, vero?”).
Chiudi con una riga riflessiva breve (non un consiglio).
`;

  const analyticBlock = en ? `
MODE: ANALYTIC/REALISTIC/SOCIAL-ECONOMIC.
Keep grounded facts style (no stats needed), everyday life quality, trade-offs North vs L’Aquila, work rhythm, cost of living vs salaries, support network, kids/schools, pace. Warm but realistic.
` : `
MODALITÀ: ANALITICO/REALISTICO/SOCIALE.
Tono concreto (senza numeri), qualità della vita, scambi tra Nord e L’Aquila, ritmo del lavoro, costo della vita vs stipendi, rete familiare, figli/scuole, lentezza. Caldo ma realistico.
`;

  const poeticBlock = en ? `
MODE: POETIC/EMOTIVE.
Everyday images (keys, streetlights, notebooks, hands, cold air, mountains). Small truths, no heroics, no melancholy. Warm, intimate, simple Italian cadence if lang=it.
` : `
MODALITÀ: POETICO/EMOTIVO.
Immagini quotidiane (chiavi, lampioni, taccuini, mani, aria fredda, montagne). Verità piccole, niente eroismi, niente malinconia. Caldo, intimo, semplice.
`;

  const SYS = [header, (whatifVariant === "analitico" ? analyticBlock : poeticBlock)].join("\n").trim();

  // Fewshots aderenti agli esempi approvati
  const FEWSHOTS = isEn(lang) ? [
    { role: "system", content:
`EXAMPLE (analytic):
You’ve had this in mind for a while, right? Moving back to L’Aquila now would mean a city that changed its skin but not its breath. Reconstruction moved things forward at a slow pace: more local businesses, less industry, more people staying by choice. Cost of living is lower than the North, salaries too; you spend with more sense. Time stretches, relationships beat contacts, mountains reset the compass. You’d miss the Veneto’s noise some days, but you’d find that quiet isn’t silence — it’s space to breathe.` },
    { role: "system", content:
`EXAMPLE (poetic):
Nice one — I could tell this question would find you. You open the windows and that cold air smells of wood and memory. The streets recognize your step; the mountains watch like you never left. The bar downstairs still serves short, rough coffee; people call your name as if time had waited. Your kids would learn the rhythm of seasons, the slow that protects the day. Each night, when you close the shutters, you’d see you’re not going back — you’re returning to where your life had stopped running.` },
  ] : [
    { role: "system", content:
`ESEMPIO (analitico):
Sai, questa domanda era nell’aria da un po’, vero? Tornare a L’Aquila ora sarebbe una città che ha cambiato pelle ma non respiro. La ricostruzione ha rimesso in moto l’economia con ritmo lento: più attività locali, meno industria, più persone che restano per scelta. Il costo della vita è più basso del Nord, anche gli stipendi: si spende con più senso. Il tempo si dilata, le relazioni contano più dei contatti, la montagna rimette la bussola. Ti mancherà il rumore del Veneto a volte, ma scopri che la quiete non è silenzio — è spazio per respirare.` },
    { role: "system", content:
`ESEMPIO (poetico):
Bella questa — lo sapevo che prima o poi ti trovava. Riapri le finestre e quell’aria fredda sa di legna e memoria. Le strade riconoscono il passo; le montagne ti guardano come se non fossi mai andato via. Il bar sotto casa ha ancora il caffè corto e ruvido, la gente ti chiama per nome come se il tempo avesse aspettato. I figli imparano le stagioni, la lentezza che protegge i giorni. Ogni sera, quando chiudi le imposte, non torni indietro: rientri dove la tua vita aveva smesso di correre.` },
  ];
  return { sys: SYS, fewshots: FEWSHOTS };
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "missing_api_key" });

    // IP
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    // Admin / PRO
    const admin = await isAdmin(req, ip);
    const bypass = admin === true;
    const isPro = String(req.headers["x-pro"] || "").trim() === "1";

    // Rate limit
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // Crediti giornalieri
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
      stile = "whatif",
      lang = "it",
      extra = "",
      periodo = "future",
      sex = "",                // "m" | "f" | "nb" | ""
      micro = {},             // micro-profile (umore, ancora, decisioni, ecc.)
      whatif_variant = ""     // "analitico" | "poetico" (obbligatorio per whatif lato UI)
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // Personas + Temporal
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex, whatif_variant);
    const temporal = temporalSystem(periodo, lang, stile);

    // Seed deterministico
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${whatif_variant}|${periodo}`), 36) % 1000000;

    // Indicazioni utente
    const userPrompt = isEn(lang)
      ? `Question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Micro: ${JSON.stringify(micro||{})}. Sex="${resolvedSex||"unknown"}". Variant="${whatif_variant||"-"}". Keep EXACT style and tone as in system examples. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Micro: ${JSON.stringify(micro||{})}. Sesso="${resolvedSex||"unknown"}". Variante="${whatif_variant||"-"}". Mantieni ESATTAMENTE stile e tono come negli esempi di sistema. SEED INTERNO: ${seedNum}.`;

    const hardRuleWTF = isEn(lang)
      ? `WTF hard rules: one strong but safe swear from the given pool, embedded in-scene; at least two reactions right after; no nicknames; opening is a confiding line tied to the question.`
      : `Regole dure WTF: una sola imprecazione forte ma sicura dal pool, integrata nella scena; almeno due reazioni subito dopo; niente nomignoli; apertura confidenziale legata alla domanda.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(stile === "wtf" ? [{ role: "system", content: hardRuleWTF }] : []),
      ...(fewshots || []),
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : (whatif_variant === "poetico" ? 0.88 : 0.75),
      top_p: 0.92,
      max_tokens: 400,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: stile === "wtf" ? 0.25 : 0.05,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 175 : 165);
    answer = normalizeOneParagraph(answer);
    if (!/[.!?…]$/.test(answer)) answer += ".";

    // Log (privacy-safe)
    try {
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
        sex: resolvedSex || null,
        domanda_len: String(domanda || "").length,
        domanda_hash: tinyHash(domanda || ""),
        answer_chars: (answer || "").length,
        admin: !!admin,
        user_type: bypass ? "admin" : (isPro ? "pro" : "free"),
        whatif_variant: whatif_variant || null,
      };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", 0, 9999);
      await redis.incr("stats:total");
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo || "future"), 1);
      if (resolvedSex) await redis.hincrby("stats:sex", resolvedSex, 1);
      if (whatif_variant) await redis.hincrby("stats:whatif_variant", whatif_variant, 1);
      await redis.hincrby("stats:user_type", entry.user_type, 1);
      const dayKey = `stats:day:${new Date().toISOString().slice(0, 10)}`;
      await redis.hincrby(dayKey, `${stile}:${periodo}`, 1);
      await redis.expire(dayKey, 90 * 24 * 60 * 60);
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
      pro: isPro,
      whatif_variant: whatif_variant || null,
      credits: bypass ? null : { used, dailyCap },
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
