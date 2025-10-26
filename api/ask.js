// /api/ask.js — What?f Engine (2025 FINAL)
// Stili: whatif (realismo lucido/poetic/analytical) · wtf (sarcasmo affettuoso, alcol, oggetti, “bestemmia” narrata)
// IT/EN — paragrafo singolo, niente liste/domande/emoji
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA contenuto della domanda (solo metadati + hash non reversibile)

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
    .split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter(Boolean);
  const out = []; const seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n || seen.has(n)) continue;
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
  const m = slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
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
// Fonde l’intercalare “bestemmia narrata” dentro la frase (mai frase a sé, mai letterale)
function fuseWtfSwearInside(text) {
  let t = String(text || "");
  // IT
  t = t.replace(
    /(?:^|\.\s+)(ti\s+scappa\s+una\s+bestemmia[^.?!]*)(?=\.\s+|$)/i,
    (m) => `, ${m.trim().replace(/^[Tt]/,'t')} `
  );
  // EN
  t = t.replace(
    /(?:^|\.\s+)(you\s+let\s+out\s+a\s+blasphemy[^.?!]*)(?=\.\s+|$)/i,
    (m) => `, ${m.trim().replace(/^[Yy]/,'y')} `
  );
  return t.replace(/\s+,/g, ",").replace(/,\s+[.]/g, ". ").replace(/\s{2,}/g, " ").trim();
}
function ensureSpicyButSafeWTF(t) {
  let out = String(t || "").trim();
  if (!/[.!?…]$/.test(out)) out += ".";
  return out;
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
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional, with quick present flashes. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale con lampi di presente. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. No lists, no questions, no echo. Keep exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente liste, niente domande, niente eco. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex = "", tone = "real") {
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""
  const genderNickIT = (SEX === "f")
    ? ["regina del casino", "fenomena", "asso di briscola", "capitana del caos", "sirena urbana", "signora dei forse", "rockstar con tacchi comodi"]
    : (SEX === "m")
      ? ["campione", "fenomeno", "asso", "capitano del caos", "sumo dei forse", "rockstar con le tasche vuote", "poeta del bar"]
      : ["leggenda", "fenomen*", "asso universale", "cap* del caos", "rockstar del forse", "astronauta del dubbio"];
  const genderNickEN = (SEX === "f")
    ? ["queen of chaos","ace of ‘maybe’","legend in sneakers","captain of detours"]
    : (SEX === "m")
      ? ["champ","legend","captain of chaos","rocket scientist of ‘maybe’"]
      : ["icon","legend","ace","captain of chaos"];

  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — the loud, loving friend who roasts with affection.
SECOND PERSON. ONE paragraph, 6–8 sentences (~125–165 words). Simple, colloquial language.
OPEN with ONLY a rotating nickname (no verbs around it).
Use alcohol beats and “reacting objects” only if relevant (never random).
Include exactly one brief, narrated blasphemy tied to a concrete mishap *inside the sentence* (e.g., “you let out a theatrical blasphemy that rattles the glasses”) — never literal.
Insults must be earned by context and end up affectionate; tone upbeat and human.
STRICT: no lists, no questions, no emojis, no moralizing. Respect TEMPORAL MODE.
Close warm and funny, like a shoulder-laugh.
Nicknames (EN): ${genderNickEN.join(", ")}.
`.trim()
      : `
Sei “What the F” — l’amico rumoroso ma affettuoso che ti prende in giro col cuore.
SECONDA PERSONA. UN paragrafo, 6–8 frasi (~125–165 parole). Linguaggio semplice e colloquiale.
APERTURA SOLO con un nomignolo (senza verbi).
Usa alcol e “oggetti che reagiscono” solo quando servono (mai a caso).
Inserisci esattamente una bestemmia narrata, legata a un piccolo incidente, *dentro la frase* (es. “ti scappa una bestemmia teatrale che fa tremare i bicchieri”); mai letterale.
Niente elenchi, niente domande, niente emoji, niente prediche. Rispetta la MODALITÀ TEMPORALE.
Chiudi caldo e divertente.
Nomignoli (IT): ${genderNickIT.join(", ")}.
`.trim());

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila (futuro)
Pellegrino del ritorno, scendi con la valigia che scricchiola dignità; il marciapiede riconosce il passo e al bar la tazzina ti squadra “di nuovo?”, parcheggi al contrario con la sicurezza di chi vuole soffrire bene e — ti scappa una bestemmia teatrale che fa tremare i bicchieri — il lampione si aggiusta da solo per non fare scena, poi due facce ti chiamano per nome e capisci che qui non torni indietro: torni intero.` },
      { role: "system", content:
`ESEMPIO IT • Mettersi in proprio (futuro)
Capitano del caos, arrivi col business plan sul tovagliolo; il registratore tossisce come uno scooter, tre clienti tornano, stappi la bottiglia “buona” ed è aceto: brucia onesto, benedice l’errore e — ti scappa una bestemmia che fa vibrare i cucchiaini — il bancone ride “anche oggi imprenditore”, a sera conti spicci e soddisfazioni e capisci che stai reggendo te, che rende più del previsto.` },
      { role: "system", content:
`EXAMPLE EN • Moving city (future)
Champ, you show up like a limited-series pilot; the buzzer rolls its eyes, coffee baptizes your sleeve and — you let out a theatrical blasphemy that rattles the glasses — the mailbox pretends it didn’t hear, by grocery three you find your aisle and your pace and the map stops asking for proof.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — tre toni distinti
  const baseGuard = isEn(lang)
    ? `SECOND PERSON. Single paragraph. No lists, no questions, no emojis. Vary cadence; avoid clichés.`
    : `SECONDA PERSONA. Paragrafo unico. Niente elenchi, niente domande, niente emoji. Varia ritmo; evita cliché.`;

  if (tone === "poetic") {
    const SYS = (isEn(lang)
      ? `You are "What If" — poetic but grounded, intimate images, light irony. 8–11 sentences (~115–160 words). End with a soft reflective line. ${baseGuard}`
      : `Sei "What If" — poetico ma concreto, immagini leggere, ironia lieve. 8–11 frasi (~115–160 parole). Chiudi con una riga riflessiva. ${baseGuard}`);
    return { sys: SYS, fewshots: [] };
  }

  if (tone === "analytical") {
    const SYS = (isEn(lang)
      ? `You are "What If" — analytical and dry. 8–11 sentences, one paragraph. Lay out criteria & trade-offs in clean prose; point to likely outcomes; finish with a one-line takeaway. ${baseGuard}`
      : `Sei "What If" — analitico e asciutto. 8–11 frasi, paragrafo unico. Esplicita criteri e trade-off in prosa pulita; indica esiti probabili; chiudi con un takeaway in una riga. ${baseGuard}`);
    return { sys: SYS, fewshots: [] };
  }

  // REAL (il “reale” che vuoi tu — niente pattern fissi tipo “chiavi/lampioni”)
  const SYS_WHATIF_REAL = (isEn(lang)
    ? `
You are "What If" — realistic, lucid, warm. 8–11 sentences (~115–160 words).
Write in plain, human prose; concrete details; no stock imagery; no heroics or melancholy.
Keep the voice intimate and practical; end with a short reflective line (not advice).
${baseGuard}`.trim()
    : `
Sei "What If" — realistico, lucido, caldo. 8–11 frasi (~115–160 parole).
Prosa semplice e umana; dettagli concreti; niente immagini stereotipate; zero eroismi o malinconia.
Voce intima e pratica; chiudi con una riga riflessiva (non un consiglio).
${baseGuard}`.trim());

  return { sys: SYS_WHATIF_REAL, fewshots: [] };
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
      micro = {},        // micro-profile
      tone = "real"      // NEW: "real" | "poetic" | "analytical"
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase(); // prefer top-level

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex, tone);
    const temporal = temporalSystem(periodo, lang, stile);

    // Seed deterministico
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${tone}`), 36) % 1000000;

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". User sex="${resolvedSex||"unknown"}". TONE="${tone}". INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Sesso utente="${resolvedSex||"unknown"}". TONO="${tone}". SEED INTERNO: ${seedNum}.`;

    const wtfRule = isEn(lang)
      ? `WTF rule: narrated blasphemy must be tied to a small mishap and fused inside the sentence (comma or em-dash), never as a separate sentence, never literal.`
      : `Regola WTF: la bestemmia narrata va legata a un piccolo incidente e fusa dentro la frase (virgole o trattino), mai frase a sé, mai letterale.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(fewshots || []),
      { role: "system", content: wtfRule },
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : (tone === "analytical" ? 0.62 : tone === "poetic" ? 0.88 : 0.82),
      top_p: 0.92,
      max_tokens: 360,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
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
      answer = fuseWtfSwearInside(answer);
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
        tone,
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
      await redis.hincrby("stats:tone", tone, 1);
      if (resolvedSex) await redis.hincrby("stats:sex", resolvedSex, 1);
      await redis.hincrby("stats:user_type", entry.user_type, 1);
      const dayKey = `stats:day:${new Date().toISOString().slice(0, 10)}`;
      await redis.hincrby(dayKey, `${stile}:${periodo}:${tone}`, 1);
      await redis.expire(dayKey, 90 * 24 * 60 * 60);
    } catch (e) {
      console.warn("log failure (non-bloccante)", e);
    }

    return res.status(200).json({
      answer,
      style: stile,
      lang,
      periodo,
      tone,
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
