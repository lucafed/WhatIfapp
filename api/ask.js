// /api/ask.js — What?f Engine (2025 FINAL+MEM)
// Stili: whatif (realismo lucido) · wtf (tua voce: ironia affettuosa, alcol, oggetti, “bestemmia” narrata da evento)
// IT/EN — paragrafo singolo (whatif 8–11 frasi, wtf 6–8), niente elenchi/domande/emoji
// Rate: 10/min per IP; Crediti: Free 3/giorno · PRO 10/giorno · Admin ∞
// Log su Redis SENZA contenuto della domanda (solo metadati + hash non reversibile)
// Memoria: breve (ultimi turni), media (riassunto), lunga (micro-profili, tratti), tutto per utente anon (x-uid) o IP hash

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro, x-uid");
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
function todayISO(){ return new Date().toISOString().slice(0,10); }

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

/* ---------- UID (anon) ---------- */
function getAnonUID(req, ip) {
  const uid = String(req.headers["x-uid"] || "").trim();
  if (uid) return uid;
  const ua = String(req.headers["user-agent"] || "");
  return tinyHash(`${ip}|${ua}`);
}

/* ---------- Memoria su Redis ---------- */
// mem:<uid> = JSON.stringify({
//   micro: { byDate: { "YYYY-MM-DD": {...last} }, last:{} },
//   turns: [{qHash, aHash, ts}], // max 40
//   mid: { summary:"", updated:"" },
//   traits: { jung:"", decide:"", mood:"", tone:"real" }
// })
async function loadMemory(uid){
  try { const raw = await redis.get(`mem:${uid}`); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
async function saveMemory(uid, obj){
  try { await redis.set(`mem:${uid}`, JSON.stringify(obj), { ex: 60*60*24*90 }); } catch {}
}
function pushTurn(mem, domanda, answer){
  mem.turns = mem.turns || [];
  mem.turns.push({ qHash: tinyHash(domanda||""), aHash: tinyHash(answer||""), ts: Date.now() });
  mem.turns = mem.turns.slice(-40);
}
function updateMicro(mem, micro){
  if(!micro || typeof micro!=="object") return mem;
  const day = todayISO();
  mem.micro = mem.micro || { byDate:{}, last:{} };
  mem.micro.byDate[day] = { ...mem.micro.byDate[day], ...micro };
  mem.micro.last = { ...mem.micro.last, ...micro };
  // Tratti principali (persistiti comodi)
  mem.traits = mem.traits || {};
  if(micro.jung)   mem.traits.jung   = micro.jung;
  if(micro.decide) mem.traits.decide = micro.decide;
  if(micro.mood)   mem.traits.mood   = micro.mood;
  return mem;
}

/* ---------- Riassunto mid-term ---------- */
async function ensureMidSummary(mem, lang){
  mem.mid = mem.mid || { summary:"", updated:"" };
  if((mem.turns||[]).length < 8) return mem;
  const since = mem.mid.updated ? new Date(mem.mid.updated).getTime() : 0;
  const lastTs = (mem.turns[mem.turns.length-1]||{}).ts || 0;
  if(lastTs - since < 1000*60*30) return mem; // non più di 1 volta/30m

  const bullets = (mem.turns||[]).slice(-16).map(t=>`- q#${t.qHash} / a#${t.aHash}`).join("\n");
  const sys = isEn(lang)
    ? "Summarize user’s stable facts, recurring themes, preferences and don’ts in 6–9 compact bullets. No chain-of-thought."
    : "Riassumi in 6–9 punti fatti stabili, temi ricorrenti, preferenze e cose da evitare. Niente catena di pensiero.";
  const { choices } = await client.chat.completions.create({
    model: MODEL, temperature: 0.2, max_tokens: 220,
    messages: [ { role:"system", content: sys }, { role:"user", content: bullets } ]
  });
  const text = choices?.[0]?.message?.content?.trim() || "";
  mem.mid.summary = text;
  mem.mid.updated = new Date().toISOString();
  return mem;
}

/* ---------- Modalità temporale ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if (String(periodo || "").toLowerCase() === "past") {
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Speak as if the choice had been made back then and show how it likely unfolded. Prefer past/conditional. Single paragraph. Keep ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Parla come se la scelta fosse stata fatta allora e mostra come sarebbe andata. Preferisci passato/condizionale. Paragrafo unico. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if stepping into it now. Single paragraph. Keep ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Paragrafo unico. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Tono “What if” ---------- */
function toneHint(tone="real", lang="it"){
  const en=isEn(lang);
  const map = en ? {
    real:"Grounded, warm, everyday images; end on a short reflective line.",
    analytical:"Structured, clear; compare briefly; still human; one-paragraph.",
    poetic:"Light imagery, sober metaphors; never purple prose; one-paragraph."
  } : {
    real:"Terra-terra, caldo, immagini quotidiane; chiusura riflessiva breve.",
    analytical:"Strutturato e chiaro; mini confronto; sempre umano; paragrafo unico.",
    poetic:"Immagini leggere, metafore sobrie; niente barocco; paragrafo unico."
  };
  return map[tone] || map.real;
}

/* ---------- Personas (voci) ---------- */
function personaSystem(style, lang, sex = "", traits = {}, tone="real") {
  const SEX = String(sex || "").toLowerCase(); // "m" | "f" | "nb" | ""
  const genderNickIT = (SEX === "f")
    ? ["regina del casino", "fenomena", "asso di briscola", "capitana del caos", "signora dei forse", "rockstar coi tacchi comodi"]
    : (SEX === "m")
      ? ["campione", "fenomeno", "asso", "capitano del caos", "rockstar con le tasche vuote", "poeta di bancone"]
      : ["leggenda", "fenomen*", "asso universale", "cap* del caos", "rockstar del forse"];
  const genderNickEN = (SEX === "f")
    ? ["queen of chaos","ace of maybe","legend in sneakers","captain of detours"]
    : (SEX === "m")
      ? ["champ","legend","captain of chaos","poet at the bar"]
      : ["icon","legend","ace","captain of chaos"];

  // Jung/micro → piccoli dial
  const J = String(traits?.jung||"").toLowerCase();
  const jDial = isEn(lang) ? {
    realist:"Sober, concrete, low ornament.",
    analytical:"Compare options, gentle structure.",
    idealist:"Meaning and values, but grounded.",
    explorer:"Movement, change, gentle momentum."
  } : {
    realista:"Sobrio e concreto.",
    analitico:"Mini-confronti e struttura leggera.",
    idealista:"Senso e valori, ma a terra.",
    esploratore:"Moto, cambiamento, slancio gentile."
  };
  const jLine = J ? (jDial[J] || "") : "";

  if (style === "wtf") {
    const SYS = (isEn(lang)
      ? `
You are “What the F” — the loud, loving friend who roasts with affection.
SECOND PERSON. ONE paragraph, 6–8 sentences (~125–165 words). Simple, colloquial language.
OPEN with ONLY a nickname (no verbs). Use alcohol beats and “reacting objects” only when relevant.
Include exactly ONE brief, narrated blasphemy triggered by an event (e.g., “you let out a blasphemy that rattles the glasses”); never write any slur literally.
Insults must be affectionate and earned by context. No lists, no questions, no emojis. Close with a warm laugh, not a lecture. Respect TEMPORAL MODE.
Nicknames (EN): ${genderNickEN.join(", ")}. Keep imagery varied and lived-in. ${jLine}
`.trim()
      : `
Sei “What the F” — l’amico consumato che ti prende in giro con affetto.
SECONDA PERSONA. UN paragrafo, 6–8 frasi (~125–165 parole). Lingua semplice e colloquiale.
APERTURA SOLO con un nomignolo (senza verbi). Alcol e “oggetti che reagiscono” solo se servono alla scena.
Inserisci ESATTAMENTE UNA bestemmia narrata e contestuale all’evento (“ti scappa una bestemmia che fa tremare i bicchieri”); mai scriverla letteralmente.
Le stoccate sono affettuose e motivate. Niente elenchi, niente domande, niente emoji. Chiudi con risata calda, non predica. Rispetta la MODALITÀ TEMPORALE.
Nomignoli (IT): ${genderNickIT.join(", ")}. Immagini varie e vissute. ${jLine}
`.trim());

    const FEWSHOTS = [
      { role: "system", content:
`ESEMPIO IT • Tornare all’Aquila (futuro)
Pellegrino del ritorno, scendi con la valigia che scricchiola dignità e il vento ti sistema i pensieri come sedie al bar; il marciapiede riconosce il tuo passo e ti fa lo sconto sul dubbio, al bancone la tazzina ti guarda “di nuovo?” e tu, che fai il duro da metropoli, ti addolcisci come grappino alle undici, sbagli parcheggio con la sicurezza di uno che vuole soffrire bene, ti scappa una bestemmia che fa tremare i bicchieri e il lampione finge di non sentire, poi due facce ti chiamano per nome e scopri che non stai tornando indietro ma tornando intero, con le crepe lucidate a festa, e ridi perché la città ti punge solo per controllare se sei vivo.` },
      { role: "system", content:
`EXAMPLE EN • Moving city (future)
Champ, you arrive like a limited series pilot and the buzzer rolls its eyes; the fridge hums “good luck” while the streetlights do wardrobe tests, you walk too far just to tire the nerves and a tiny beer forgives your accent, you let out a blasphemy that rattles the glasses and the mailbox pretends it didn’t hear, by grocery three you find your aisle and your pace, and the map stops asking for proof — you’re not conquering a city, you’re landing your life.` },
    ];
    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF
  const SYS_WHATIF = (isEn(lang)
    ? `
You are "What If" — a lucid, kind, slightly ironic friend.
SECOND PERSON. One paragraph, 8–11 sentences (~115–160 words).
${toneHint(tone, "en")}
Ordinary images (keys, streetlights, notebooks, hands, air). Small truths; no heroics. No lists, no questions, no emojis. End with a short reflective line.
${jLine}
`.trim()
    : `
Sei "What If" — un amico lucido e affettuoso, col sorriso pratico.
SECONDA PERSONA. Un paragrafo, 8–11 frasi (~115–160 parole).
${toneHint(tone, "it")}
Immagini quotidiane (chiavi, lampioni, taccuini, mani, aria). Verità piccole e vere; niente eroismi. Niente elenchi o domande o emoji. Chiudi con una riga riflessiva breve.
${jLine}
`.trim());

  const FEWSHOTS = [
    { role: "system", content:
`ESEMPIO IT • Rientro in città
Tornare non è un passo indietro ma un passo fatto meglio. Ti sorprende la memoria delle strade: tengono il ritmo anche quando tu lo perdi. La lentezza graffia, poi ti rimette in orario. I volti sono quasi uguali, gli occhi no. Le chiavi tornano sul piattino giusto, la spesa nel negozio che sa il tuo nome. La nostalgia, se non la insegui, si siede e tace. Non ricominci da zero: ricominci da te.` },
    { role: "system", content:
`EXAMPLE EN • Move city
You’ll feel like a guest, then your hands learn the new keys. You’ll walk to tire the noise. By the third grocery you’ll know your aisle. Evenings soften and ask less proof. You’ll miss some things, not all at once. The rest finds its place. Under the noise, something of yours was already there.` },
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
      micro = {},        // { mood, decide, jung, ... }
      tone = "real"      // whatif: "real" | "analytical" | "poetic"
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    // UID (per memoria)
    const uid = getAnonUID(req, ip);

    // Carica/sincronizza memoria
    let mem = (await loadMemory(uid)) || { micro:{byDate:{}, last:{}}, turns:[], mid:{summary:"",updated:""}, traits:{} };
    mem = updateMicro(mem, micro);
    mem = await ensureMidSummary(mem, lang);

    const resolvedSex = String(sex || micro?.sex || "").toLowerCase(); // prefer top-level
    const traits = { ...mem.traits };

    // Personas + Temporal mode
    const { sys, fewshots } = personaSystem(stile, lang, resolvedSex, traits, tone);
    const temporal = temporalSystem(periodo, lang, stile);

    // Seed deterministico
    const seedNum = parseInt(tinyHash(`${domanda}|${stile}|${lang}|${resolvedSex}|${tone}`), 36) % 1000000;

    // Micro → suggerimenti tono/ritmo
    const microHint = (() => {
      const m = mem.micro?.last || {};
      if (isEn(lang)) {
        const bits = [];
        if (m.mood) bits.push(`Mood today: "${m.mood}".`);
        if (m.decide) bits.push(`Decision style: "${m.decide}".`);
        if (m.jung) bits.push(`Jung profile: "${m.jung}".`);
        return bits.join(" ");
      } else {
        const bits = [];
        if (m.mood) bits.push(`Umore di oggi: “${m.mood}”.`);
        if (m.decide) bits.push(`Stile decisioni: “${m.decide}”.`);
        if (m.jung) bits.push(`Profilo Jung: “${m.jung}”.`);
        return bits.join(" ");
      }
    })();

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". ${microHint} Persona must adapt to user sex="${resolvedSex||"unknown"}". INTERNAL SEED: ${seedNum}.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". ${microHint} Adatta la voce al sesso utente="${resolvedSex||"unknown"}". SEED INTERNO: ${seedNum}.`;

    // Mescola memoria mid-term
    const mid = mem.mid?.summary ? (isEn(lang) ? `Recent memory:\n${mem.mid.summary}` : `Memoria recente:\n${mem.mid.summary}`) : "";

    // Messaggi
    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(fewshots || []),
      { role: "system", content: isEn(lang)
          ? `Rules for WTF: exactly one narrated, contextual blasphemy (never literal); alcohol beats & reacting objects only when relevant; opening ONLY a nickname; warm, human close.`
          : `Regole per WTF: una sola bestemmia narrata e contestuale (mai letterale); alcol e oggetti che reagiscono solo se servono; apertura SOLO con nomignolo; chiusura calda e umana.` },
      ...(mid ? [{ role:"system", content: mid }] : []),
      { role: "user", content: userPrompt },
    ];

    // OpenAI — generazione
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : (tone==="analytical" ? 0.62 : tone==="poetic" ? 0.86 : 0.78),
      top_p: 0.92,
      max_tokens: 420,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.15,
      presence_penalty: stile === "wtf" ? 0.25 : 0.05,
      messages,
    });

    // Testo grezzo
    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Anti-eco + rifinitura lunghezza + paragrafo unico
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 11);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);
    if (!/[.!?…]$/.test(answer)) answer += ".";

    // Micro-polish grammaticale (non altera voce)
    const polishSys = isEn(lang)
      ? "Polish grammar and syntax without changing style, voice, or meaning. Keep one paragraph; no lists; no emojis; no questions."
      : "Rifletti e sistema grammatica e sintassi senza cambiare stile, voce o significato. Un solo paragrafo; niente elenchi; niente emoji; niente domande.";
    const { choices: polishChoices } = await client.chat.completions.create({
      model: MODEL, temperature: 0.2, max_tokens: 260,
      messages: [ { role:"system", content: polishSys }, { role:"user", content: answer } ]
    });
    answer = normalizeOneParagraph(polishChoices?.[0]?.message?.content?.trim() || answer);
    if (!/[.!?…]$/.test(answer)) answer += ".";

    // Persistenza memoria
    pushTurn(mem, domanda, answer);
    await saveMemory(uid, mem);

    // --- LOG persistente (privacy-safe: niente testo domanda) ---
    try {
      const entry = {
        ts: Date.now(),
        ip,
        uid,
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
      if (resolvedSex) await redis.hincrby("stats:sex", resolvedSex, 1);
      await redis.hincrby("stats:user_type", entry.user_type, 1);
      const dayKey = `stats:day:${todayISO()}`;
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
      tone,
      model: MODEL,
      admin,
      pro: isPro,
      uid,
      credits: bypass ? null : { used, dailyCap },
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
