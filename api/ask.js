// /api/ask.js — What?f Engine (2025 FINAL)
// Stili: whatif (realismo lucido) · wtf (sarcasmo affettuoso, alcol, oggetti, “bestemmia” narrata SU EVENTO)
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

// ——— WTF post-guard (mantiene tono e chiusura; NB: “bestemmie” sempre narrate, non letterali)
function ensureSpicyButSafeWTF(t) {
  let out = String(t || "").trim();
  // Sigilla la chiusura
  if (!/[.!?…]$/.test(out)) out += ".";
  return out;
}

// ——— What If: scrub robusto di parolacce (server-side, per evitare volgarità in WHF)
const BAD_RX = /\b(cazz[oi]|stronz[oa]|vaffan\w*|merd[ae]|fott\w*|puttan[ao]|fuck|shit|bitch|asshole|bastard|damn)\b/gi;
function scrubWhatIf(text) {
  return String(text||"").replace(BAD_RX, s => "*".repeat(Math.min(3, s.length)));
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
    const data = await redis.hgetall(`admin:token:${token}`);
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
    // ======== NUOVA VOCE WTF (uguale alla tua, ma con bestemmie narrate multiple e su evento) ========
    const SYS = (isEn(lang)
      ? `
You are “What the F” — the loud, loving friend who roasts with affection.
SECOND PERSON. ONE paragraph, 7–9 sentences (~130–170 words). Simple, colloquial.
OPEN only with a nickname (no verbs). Use alcohol beats and “reacting objects” only when relevant.
CRUCIAL: Add 2–3 short narrated-blasphemy beats, NEVER literal slurs. Each must be triggered by a concrete event (e.g., you miss the bus → a narrated blasphemy bursts; you spill coffee → a narrated blasphemy detonates). Keep them inside the flow; make nearby people/objects react.
Vary the phrasing (examples, do NOT repeat verbatim): “you let out a theatrical blasphemy that rattles the glasses”; “a timed blasphemy goes off and the shop freezes”; “a backfire blasphemy pops and the streetlight pretends not to hear”.
No lists, no questions, no emojis, no moralizing. Respect TEMPORAL MODE. Close warm and funny.
Nicknames (EN): ${genderNickEN.join(", ")}.
`.trim()
      : `
Sei “What the F” — l’amico rumoroso ma affettuoso, che prende in giro con amore.
SECONDA PERSONA. UN paragrafo, 7–9 frasi (~130–170 parole). Linguaggio semplice, colloquiale.
APERTURA: solo un nomignolo (senza verbi). Alcol e “oggetti che reagiscono” solo quando servono.
FONDAMENTALE: inserisci 2–3 brevi “bestemmie” narrate (mai letterali). Ognuna nasce da un evento concreto (es.: buchi la gomma → ti scappa una bestemmia teatrale; rovesci il caffè → parte una bestemmia a orologeria). Devono stare dentro la scena, con reazioni dei presenti/oggetti.
Varia le formulazioni (esempi, NON copiare alla lettera): “ti scappa una bestemmia teatrale che fa tremare i bicchieri”; “parte una bestemmia a orologeria e il negozio si gela”; “ti esplode una bestemmia di rimbalzo e il lampione fa finta di niente”.
RIGIDO: niente elenchi, niente domande, niente emoji, niente prediche. Rispetta la MODALITÀ TEMPORALE. Chiudi caldo e divertente.
Nomignoli (IT): ${genderNickIT.join(", ")}.
`.trim());

    // Fewshots: restano fedeli al tuo gusto (con micro-evento -> reazione -> risata)
    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila (futuro)
Pellegrino del ritorno, scendi con la valigia che scricchiola dignità e il vento ti mette in fila i pensieri; inciampi sul marciapiede rifatto e, mentre due signori spostano il cane, ti scappa una bestemmia teatrale che fa tremare i bicchieri del bar e il lampione finge di non sentire; parcheggi male come rito d’inizio e parte una bestemmia a orologeria, la saracinesca fa shhh come per zittirti; al bancone la tazzina ti guarda “di nuovo?”, prendi fiato, il barista ride, e capisci che non stai tornando indietro: stai rientrando in te, con le crepe lucidate a festa.` },
      { role: "system", content:
`ESEMPIO IT • Mettersi in proprio (futuro)
Capitano del caos, apri con l’insegna storta e il registratore di cassa tossisce; rovesci il resto e ti esplode una bestemmia di rimbalzo, gli zuccheri sul bancone fanno onda; il fornitore ti buca e sgancia una fattura sbagliata: ti scappa un’altra bestemmia scenica, le sedie si raddrizzano per educazione; poi entrano tre facce che non vedevi da anni, comprano poco ma restano tanto, e ti accorgi che oggi non hai vinto il mondo: hai vinto te, che è più remunerativo del previsto.` },
      { role: "system", content:
`EXAMPLE EN • Moving city (future)
Champ, you miss the first bus on purpose and your shoe laughs; coffee slips over your sleeve and a theatrical blasphemy pops, the cups clink like witnesses; the buzzer plays shy, a timed blasphemy clicks and the hallway freezes; by grocery three you’re already someone they nod to, and that’s how a place stops being a test and starts being yours.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // ======== WHAT IF (immutato nel tono, ma senza volgarità) ========
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind, slightly ironic friend.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words).
Warm, grounded, simple. Small truths; no heroics, no melancholy.
No lists, no questions, no emojis. End with a short reflective line (not advice).
`.trim()
    : `
Sei "What If" — un amico lucido e affettuoso, col sorriso pratico.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole).
Semplice, concreto, con immagini quotidiane solo se spontanee.
Niente elenchi o domande o emoji. Chiudi con una riga riflessiva breve (non un consiglio).
`.trim());

  const FEWSHOTS = [
    { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila
Tornare non sarebbe un passo indietro ma un passo fatto meglio. All’inizio la lentezza graffia, poi ti rimette in orario. I volti sembrano uguali, ma tu li guardi con occhi più larghi. La spesa torna nel negozio che sa il tuo nome. Le nonne non sono solo aiuti: sono memoria che ti allunga il respiro. Non ricominci da zero: ricominci da te.` },
    { role: "system", content:
`EXAMPLE EN • Move city
You’ll feel like a guest, then your hands learn the new keys. You walk to tire the noise. By the third grocery you know your aisle. Evenings ask less proof. You miss some things, not all at once. The rest finds its place. Under the noise, something of yours was already there.` },
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
      micro = {},        // micro-profile
      tone = ""          // opzionale (whatif: real/analytical/poetic) — già passthrough
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex);
    const temporal = temporalSystem(periodo, lang, stile);

    // Seed deterministico
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}`), 36) % 1000000;

    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in past or conditional, as if it already happened, keeping the upbeat roasting tone."
          : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono allegro e pungente.")
        : "";

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Persona must adapt to user sex="${resolvedSex||"unknown"}". Keep the exact persona voice. INTERNAL SEED: ${seedNum}. Tone hint: ${tone||"narrative"}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Adatta la voce al sesso utente="${resolvedSex||"unknown"}". Mantieni esattamente la voce della persona. SEED INTERNO: ${seedNum}. Tono suggerito: ${tone||"narrativo"}.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      { role: "system", content: isEn(lang)
          ? `Hard rules for WTF: 2–3 narrated blasphemy beats, never literal; each caused by a concrete event; keep them inside the scene with reactions; opening is ONLY a nickname.`
          : `Regole dure per WTF: 2–3 “bestemmie” narrate, mai letterali; ciascuna causata da un evento concreto; sempre dentro la scena con reazioni; apertura SOLO con nomignolo.` },
      { role: "user", content: userPrompt },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 380,
      frequency_penalty: stile === "wtf" ? 0.35 : 0.1,
      presence_penalty: stile === "wtf" ? 0.25 : 0.0,
      messages,
    });

    // Post-process
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 170 : 160);
    answer = normalizeOneParagraph(answer);

    if (stile === "wtf") {
      answer = ensureSpicyButSafeWTF(answer);
    } else {
      // WHF: no volgarità
      answer = scrubWhatIf(answer);
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
      };
      await redis.lpush("logs:ask", JSON.stringify(entry));
      await redis.ltrim("logs:ask", 0, 9999);
      await redis.incr("stats:total");
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo || "future"), 1);
      if (resolvedSex) await redis.hincrby("stats:sex", resolvedSex, 1);
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
      credits: bypass ? null : { used, dailyCap },
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
