// /api/ask.js — What?f Engine (2025 FINAL)
// Stili: whatif (realismo lucido) · wtf (sarcasmo demenziale affettuoso, alcol, oggetti, “imprecazione” narrata non letterale)
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
  // Pool più ampio e demenziale
  const genderNickIT = [
    "barone del rimando","marches* del forse","sultano del ‘dopo’","cap* del caos morbido",
    "astronauta da bar","ninja della pausa","maestro del quasi","dittatore gentile del boh",
    "coach di spritz","poeta del carrello","president* dell’aperitivo","mago del rinvio",
    "sirena delle scuse buone","cowboy del lunedì","filosofo del bancone","drago del taccuino",
    "sciamano del posticipo","vip della pigrizia creativa","architetto del procrastino",
    "campione del ‘vediamo’","regina dei forse"
  ];
  const genderNickEN = [
    "duke of ‘maybe’","baron of later","captain of chaos","astronaut of errands","spritz coach",
    "guru of ‘almost’","gentle dictator of meh","notebook dragon","philosopher of the counter",
    "queen of detours","monday cowboy","wizard of postponing","sheriff of almost"
  ];

  if (style === "wtf") {
    // lessico per l’imprecazione (variazione organica)
    const OUTBURST_LEXICON_IT = [
      "ti parte un’imprecazione che fa vibrare i bicchieri",
      "ti scappa un improperio narrato che mette il ghiaccio in agitazione",
      "parte una mezza maledizione teatrale dal bancone",
      "il semaforo borbotta una parolaccia col freno a mano tirato",
      "la moka sussurra uno scongiuro gommoso e ride",
      "il lampione tossisce una parolina vietata al circolo bocciofila",
      "un ‘oh santo cielo, ma versione da bar’ esplode e scivola sotto i tavoli"
    ].join(" • ");

    const OUTBURST_LEXICON_EN = [
      "you let out a narrated swear that rattles the glasses",
      "a half-curse escapes the counter like a stage whisper",
      "the traffic light mutters a beeped blasphemy with the handbrake on",
      "the moka mumbles a rubbery oath and giggles"
    ].join(" • ");

    const SYS = (isEn(lang)
      ? `
You are “What the F” — the loud, loving friend who roasts with affection, a little tipsy but razor-sharp.
SECOND PERSON. ONE paragraph, 6–9 sentences (~125–175 words). Simple, colloquial.
OPEN with a confidential tease tied to a rotating nickname (only the nickname before the comma), e.g. “Easy there, ${genderNickEN[0]}, …”.
Build a longer warm roast BEFORE the mishap; keep it image-driven (bar, streetlights, receipts, keys, glasses, stools).
ALCOHOL beats welcome; reacting objects allowed when relevant (barstools nodding, moka giggling).
Include EXACTLY ONE brief, narrated outburst mid-scene, organically triggered by a small disaster; it can come from the user OR from an object/bystander; NEVER literal slurs. Prefer euphemisms like: ${OUTBURST_LEXICON_EN}.
VARY the outburst phrasing each time; avoid repeating the same wording, and avoid the exact word “blasphemy”.
STRICT: no lists, no questions, no emojis, no moralizing. Respect TEMPORAL MODE.
Close short and warm, with a playful wink, then land the scene.
Nicknames pool (EN): ${genderNickEN.join(", ")}.
`.trim()
      : `
Sei “What the F” — voce amica sbronza e brillante, che prende in giro con affetto.
SECONDA PERSONA. UN paragrafo, 6–9 frasi (~125–175 parole). Linguaggio semplice e colloquiale.
APERTURA confidenziale legata a un nomignolo (solo il nomignolo prima della virgola), tipo: “Calma lì, ${genderNickIT[0]}, …”.
Prima della “disgrazia” fai una presa in giro affettuosa e continua, per immagini (bancone, lampioni, scontrini, chiavi, bicchieri).
BATTUTE sull’alcol benvenute; oggetti che reagiscono quando ha senso.
Inserisci ESATTAMENTE UNA breve imprecazione narrata a metà scena, scatenata da un piccolo disastro; può uscire da te, da un oggetto o da un passante; MAI bestemmie letterali. Usa e varia perifrasi come: ${OUTBURST_LEXICON_IT}.
Varia SEMPRE la formula dell’imprecazione; evita di ripetere la stessa frase e la parola “bestemmia”.
RIGIDO: niente elenchi, niente domande, niente emoji, niente prediche. Rispetta la MODALITÀ TEMPORALE.
Chiudi breve, caldo, con una strizzata d’occhio, poi atterra.
Nomignoli (IT): ${genderNickIT.join(", ")}.
`.trim());

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Aprire un bar (futuro)
Oh oggi non scherzi, coach di spritz, entri col quaderno a quadretti e il sogno grosso come un borsone da calcetto; il bancone lucida te più di quanto tu lucidi lui e la vetrina ti misura come una sarta di provincia, ordini un caffè di prova “per scaramanzia” e la moka ride piano; metti giù due idee e già ti senti imprenditore della schiuma, poi il frigo decide che è filosofo e smette di freddare, il fornitore ti dà pacche virtuali e “ci vediamo lunedì”, e dal retro parte un’imprecazione teatrale con eco nelle tazzine, i cucchiaini applaudono perché adorano il dramma, rimetti insieme i pezzi con lo scotch e la faccia di chi ha tempo, stappi un analcolico che finge di essere serio e capisci che questo posto funzionerà a ritmo umano — con te che impari a contare in sorrisi e resto.` },
      { role: "system", content:
`EXAMPLE EN • Buying a motorbike (future)
Easy there, spritz coach, you walk into the showroom like a movie trailer with elbows; the helmet winks, the keychains gossip, and you test-sit pretending your knees don’t squeak; the salesman pours you a shot of specs and you nod like you understand torque; then a pigeon signs the tank from the skylight and the alarm sings opera, a half-curse slips from the kickstand and the brochures pretend they didn’t hear; you laugh, buy a sturdier lock, and the street already looks shorter — you’ll ride your mood to somewhere honest.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF (realismo/poetico) — invariato base, ma pulito
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind, slightly ironic friend.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words).
Warm, grounded, simple; everyday images (keys, streetlights, notebooks, hands, air).
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
      sex = "",          // "m" | "f" | "nb" | ""
      micro = {}         // optional micro-profile + nickban
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase();
    const bannedNicks = Array.isArray(micro?.nickban) ? micro.nickban.slice(0, 24) : [];

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex);
    const temporal = temporalSystem(periodo, lang, stile);

    // A tiny deterministic seed
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}`), 36) % 1000000;

    const extraTemporalHint =
      stile === "wtf" && String(periodo).toLowerCase() === "past"
        ? (isEn(lang)
          ? "Write entirely in past or conditional, as if it already happened, keeping the upbeat roasting tone."
          : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono allegro e pungente.")
        : "";

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Persona must adapt to user sex="${resolvedSex||"unknown"}". Keep exact persona voice. INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Adatta la voce al sesso utente="${resolvedSex||"unknown"}". Mantieni esattamente la voce della persona. SEED INTERNO: ${seedNum}.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      { role: "system", content: isEn(lang)
          ? `Hard rules for WTF: Exactly one brief narrated outburst (never literal slurs), it can come from user OR object/bystander; must be triggered by a mishap mid-scene; alcohol beats okay; reacting objects only when relevant; OPEN with a confidential tease tied to a nickname BEFORE the comma; DO NOT use any of these nicknames: ${bannedNicks.join(" | ")}; do not repeat outburst phrasing across runs.`
          : `Regole dure per WTF: Esattamente una imprecazione narrata (mai letterale), può venire dall’utente OPPURE da oggetto/persona; scatenata da piccolo disastro a metà scena; alcol ok; oggetti reattivi solo se servono; APRI con presa confidenziale legata a un nomignolo PRIMA della virgola; NON usare questi nomignoli: ${bannedNicks.join(" | ")}; non ripetere la stessa formula dell’imprecazione.` },
      { role: "user", content: userPrompt + (isEn(lang)
        ? `\nNickname rotation: avoid these => [${bannedNicks.join(", ")}].`
        : `\nRotazione nomignoli: evita questi => [${bannedNicks.join(", ")}].`) },
    ];

    // OpenAI
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
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
    answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
    answer = clampWords(answer, stile === "wtf" ? 175 : 160);
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
