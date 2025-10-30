// /api/ask.js — What?f Engine (2025 FINAL • PROMO BASE + WTF “COSÌ” con varianti A/B)
// Stili: whatif (realismo lucido) · wtf (sarcasmo demenziale affettuoso, alcol, oggetti, “bestemmia” narrata)
// IT/EN — paragrafo singolo, niente liste/domande/emoji
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA contenuto della domanda (solo metadati + hash non reversibile)

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

// ---------- OpenAI ----------
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

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
function ensureSpicyButSafeWTF(t) {
  // Bestemmia solo “narrata”, mai letterale; chiusura garantita.
  let out = String(t || "").trim();
  if (!/[.!?…]$/.test(out)) out += ".";
  return out;
}
function tinyHash(s = "") {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
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
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional, with quick present flashes. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale con lampi di presente. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex = "") {
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""
  const genderNickIT = (SEX === "f")
    ? ["regina del casino","fenomena","asso di briscola","capitana del caos","sirena urbana","signora dei forse","rockstar con tacchi comodi"]
    : (SEX === "m")
      ? ["campione","fenomeno","asso","capitano del caos","sumo dei forse","rockstar con le tasche vuote","poeta del bar"]
      : ["leggenda","fenomen*","asso universale","cap* del caos","rockstar del forse","astronauta del dubbio"];
  const genderNickEN = (SEX === "f")
    ? ["queen of chaos","ace of ‘maybe’","legend in sneakers","captain of detours"]
    : (SEX === "m")
      ? ["champ","legend","captain of chaos","rocket scientist of ‘maybe’"]
      : ["icon","legend","ace","captain of chaos"];

  if (style === "wtf") {
    // ——— WTF “COSÌ” con due varianti interne (A/B) scelte per seed ———
    // A = Roast + oggetti reattivi; B = Eventi a scorrere (imprevisti distribuiti) + sfogo narrato
    const SYS_BASE = (isEn(lang)
      ? `
You are “What the F”: loud, loving roast in SECOND PERSON. ONE paragraph, 6–8 sentences (~125–165 words). Colloquial, punchy, affectionate.
OPEN with ONLY a nickname (no verbs). Include exactly one brief, narrated blasphemy (“you let out a blasphemy that rattles the glasses”) — never literal.
Alcohol beat allowed. “Reacting objects” only when relevant to the scene. No lists, no questions, no emojis, no moralizing. Respect TEMPORAL MODE.
Close warm and funny.
Nicknames (EN): ${genderNickEN.join(", ")}.
`.trim()
      : `
Sei “What the F”: presa in giro affettuosa in SECONDA PERSONA. UN paragrafo, 6–8 frasi (~125–165 parole). Colloquiale, secco, umano.
APERTURA SOLO con un nomignolo (senza verbi). Inserisci una sola bestemmia narrata (“ti esce una bestemmia che fa tremare i bicchieri”) — mai letterale.
Alcol consentito. “Oggetti che reagiscono” solo se servono alla scena. Niente elenchi, niente domande, niente emoji, niente prediche. Rispetta la MODALITÀ TEMPORALE.
Chiudi caldo e divertente.
Nomignoli (IT): ${genderNickIT.join(", ")}.
`.trim());

    // Variante A: roast + oggetti reattivi (quando pertinenti)
    const SYS_WTF_A = (isEn(lang)
      ? `WTF VARIANT A — Roast + reacting objects (use 2–3 reactions max, coherent with place, e.g., moka/POS, streetlights/door).`
      : `WTF VARIANTE A — Roast + oggetti che reagiscono (usa 2–3 reazioni max, coerenti col luogo: moka/POS, lampione/portone, ecc.).`);

    // Variante B: eventi a scorrere (imprevisti distribuiti) + sfogo narrato mid-scene
    const SYS_WTF_B = (isEn(lang)
      ? `WTF VARIANT B — Flowing scene: spread 3–4 tiny mishaps across the paragraph (“meanwhile”, “then”, “as you try…”), then one narrated blasphemy; 1 small alcohol beat; end warm+funny. Keep it tight.`
      : `WTF VARIANTE B — Scena a scorrere: distribuisci 3–4 micro-imprevisti lungo il paragrafo (“intanto”, “poi”, “mentre provi…”), poi una bestemmia narrata; un accenno di alcol; chiusura calda e ironica. Stretto e pulito.`);

    // Few-shots compatti (tono guida)
    const FEWSHOTS = isEn(lang)
      ? [
          { role: "system", content:
`EXAMPLE EN • Moving back (future)
Champ, suitcase squeaking dignity, sidewalk recognizes your step and gives a discount on doubt; at the bar the cup goes “again?” and a tiny beer forgives your accent, you let out a blasphemy that rattles the glasses and the mailbox pretends it didn’t hear, two faces say your name and you realize you’re not going back — you’re landing whole, cracks polished for the party.` },
        ]
      : [
          { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila (futuro)
Pellegrino del ritorno, scendi con la valigia che scricchiola dignità; il marciapiede riconosce il tuo passo e al bancone la tazzina fa “di nuovo?”, addolcisci l’orgoglio con un grappino da undici e ti esce una bestemmia che fa tremare i bicchieri mentre il lampione finge di non sentire; due facce ti chiamano per nome e capisci che non stai tornando indietro ma tornando intero, con le crepe lucidate a festa.` },
        ];

    return { sys: [SYS_BASE, SYS_WTF_A, SYS_WTF_B].join("\n"), fewshots: FEWSHOTS };
  }

  // WHAT IF “promo” base
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind, slightly ironic friend.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words).
Warm, grounded, simple; ordinary images (keys, streetlights, notebooks, hands, air).
Small truths; no heroics, no melancholy. No lists, no questions, no emojis.
End with a short reflective line (not advice).
`.trim()
    : `
Sei "What If" — un amico lucido e affettuoso, col sorriso pratico.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole).
Immagini quotidiane (chiavi, lampioni, taccuini, mani, aria).
Verità piccole e vere; niente eroismi, niente malinconia.
Niente elenchi o domande o emoji. Chiudi con una riga riflessiva breve (non un consiglio).
`.trim());

  const FEWSHOTS = [
    { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila
Tornare non sarebbe un passo indietro ma un passo fatto meglio. Ti stupirebbe la memoria delle strade: tengono il ritmo anche quando tu lo perdi. All’inizio la lentezza graffia, poi capisci che ti rimette in orario. I volti sembrano uguali, ma li guardi con occhi più larghi. Le chiavi tornano sul piattino giusto, la spesa nel negozio che sa il tuo nome. La nostalgia, se non la insegui, si siede accanto e tace. Non serve ricominciare da zero: basta ricominciare da te.` },
    { role: "system", content:
`EXAMPLE EN • Move city
You’ll feel like a guest, then your hands learn the new keys. You’ll walk not to think better but to tire the noise. By the third grocery you’ll know which aisle is yours. Evenings soften and ask less proof. You’ll miss some things, not all at once. The rest finds its place. And you notice that beneath the noise something of yours was already there.` },
  ];

  return { sys: SYS_WHATIF, fewshots: FEWSHOTS };
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
      stile = "whatif",
      lang = "it",
      extra = "",
      periodo = "future",
      sex = "",          // "m" | "f" | "nb"
      micro = {}         // optional micro-profile; may include micro.sex too
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // Personas + Temporal mode
    const persona = personaSystem(stile, lang, resolvedSex);
    const temporal = temporalSystem(periodo, lang, stile);

    // Seed deterministico per varietà e per variant pick A/B su WTF
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}`), 36) % 1000000;
    const wtfVariant = (stile === "wtf") ? (seedNum % 2 === 0 ? "A" : "B") : null;

    // Hint extra per WTF B (eventi a scorrere)
    const extraTemporalHint =
      stile === "wtf" && wtfVariant === "B"
        ? (isEn(lang)
            ? "Flow the scene with 3–4 tiny mishaps spread through the paragraph; mid-scene, one narrated blasphemy; one small alcohol beat; end warm+funny."
            : "Fai scorrere la scena con 3–4 micro-imprevisti distribuiti nel paragrafo; a metà scena una bestemmia narrata; un piccolo accenno di alcol; chiudi caldo e ironico.")
        : (stile === "wtf" && wtfVariant === "A"
            ? (isEn(lang)
                ? "Lean into affectionate roast and 2–3 coherent reacting objects; exactly one narrated blasphemy; keep it punchy and human."
                : "Spingi su roast affettuoso e 2–3 oggetti che reagiscono in modo coerente; una sola bestemmia narrata; resta pungente e umano.")
            : "");

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Persona adapts to user sex="${resolvedSex||"unknown"}". Keep exact persona voice. INTERNAL SEED: ${seedNum}. WTF VARIANT: ${wtfVariant || "-"}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Adatta la voce al sesso utente="${resolvedSex||"unknown"}". Mantieni esattamente la voce. SEED INTERNO: ${seedNum}. VARIANTE WTF: ${wtfVariant || "-"}.`;

    const messages = [
      { role: "system", content: persona.sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(persona.fewshots || []),
      // regole dure extra per WTF
      ...(stile === "wtf" ? [{
        role: "system",
        content: isEn(lang)
          ? `Hard rules for WTF: ONE paragraph, 6–8 sentences, second person only, one narrated blasphemy (never literal), alcohol beat OK, reacting objects only when relevant, opening is ONLY a nickname (no verbs).`
          : `Regole dure per WTF: UN paragrafo, 6–8 frasi, solo seconda persona, una bestemmia narrata (mai letterale), accenno di alcol OK, oggetti che reagiscono solo quando servono, apertura SOLO con nomignolo (senza verbi).`
      }] : []),
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 380,
      frequency_penalty: stile === "wtf" ? 0.35 : 0.1,
      presence_penalty: stile === "wtf" ? 0.2 : 0.0,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 165 : 160);
    answer = normalizeOneParagraph(answer);
    if (stile === "wtf") {
      answer = ensureSpicyButSafeWTF(answer);
    } else {
      if (!/[.!?…]$/.test(answer)) answer += ".";
    }

    // --- LOG persistente (privacy-safe: niente testo domanda) ---
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
        wtf_variant: wtfVariant
      };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", 0, 9999);
      await redis.incr("stats:total");
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo || "future"), 1);
      if (resolvedSex) await redis.hincrby("stats:sex", resolvedSex, 1);
      await redis.hincrby("stats:user_type", entry.user_type, 1);
      if (wtfVariant) await redis.hincrby("stats:wtf_variant", wtfVariant, 1);
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
      credits: bypass ? null : { used, dailyCap },
      variant: wtfVariant || null
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
