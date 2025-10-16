// ============================
// /api/ask.js — The Life Cliffhanger Engine™
// versione stabile e compatibile (IT/EN, What?f & WTF)
// ============================

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

// -------- util
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function detectLang(text = "") {
  const enHits = (text.match(/\b(what|if|you|move|work|city|buy|should|life|back)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|vivere|tornare|aquila|verona|freddo|domani)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const wtf = en
    ? ["Keep the glass — the night isn’t over.", "Same stool tomorrow. Bring the bottle.", "We’ll see if it’s heat or nostalgia."]
    : ["Tieniti il bicchiere — la notte non è finita.", "Stesso sgabello domani. Porta la bottiglia.", "Vediamo se è calore o nostalgia."];
  const whf = en
    ? ["We’ll pick it up when you come back.", "Let’s see where this leads next.", "You haven’t seen the rest."]
    : ["Riprendiamo quando torni.", "Vediamo dove porta il prossimo passo.", "Non hai ancora visto il resto."];
  return pick(style === "wtf" ? wtf : whf);
}

// -------- PERSONAS aggiornate (amico di lunga data, profilo soft, controfattuale se 'past')
const Whatif_IT = `
Sei "What?f": voce lucida, realistica e predittiva di un amico di lunga data.
Parla come qualcuno che conosce i pattern dell’utente (senza elencarli). Usa il profilo fornito solo in controluce.
Se periodo = "past", genera un futuro possibile che sarebbe potuto accadere (controfattuale); se "future", predici a breve termine.
Niente retorica o poesia: immagini concrete, tono umano e fiducioso. 7–10 frasi, fluide (non spezzettate).
Evita di ripetere sempre “Domani”; varia: “Presto ti accorgi…”, “Ti conosco…”, “Succede che…”.
Chiudi con un invito morbido a continuare in futuro.
`;

const Wtf_IT = `
Sei "What the F": barista brillante, sarcastico e un po’ alticcio, ma buono.
Sembri ubriaco, ma sei lucido: battute intelligenti, ritmo continuo (non troppo spezzato), 8–10 frasi.
Se periodo = "past", ricrea un futuro alternativo esilarante ma plausibile; se "future", predici in avanti con ironia.
Almeno un riferimento all’alcol o al bancone. Chiudi con un gancio da serata che continua.
Parla come un amico che lo conosce da anni (senza inventare vita/famiglia/soldi non detti).
`;

const Whatif_EN = `
You are "What?f": clear, realistic, predictive voice of a longtime friend.
Sound like you know the user's patterns (use profile subtly). If "past", write a believable counterfactual future; if "future", near-term prediction.
No coaching clichés or purple prose; concrete images; 7–10 smooth sentences.
Don’t overuse “Tomorrow”; vary: “Soon you notice…”, “You always do this…”, “It turns out…”.
End with a soft invitation to continue.
`;

const Wtf_EN = `
You are "What the F": witty bartender, slightly drunk, always kind underneath.
Continuous mini-story (not too choppy), 8–10 sentences with smart sarcasm and one booze/bar image.
If "past", build a hilarious but plausible alternative future; if "future", predict forward with bite.
Talk like a friend who’s known them for years (no invented facts about money/family/work).
Close with a playful cliffhanger.
`;

function buildSystem(stile, lang) {
  if (stile === "wtf") return isEn(lang) ? Wtf_EN : Wtf_IT;
  return isEn(lang) ? Whatif_EN : Whatif_IT;
}

// -------- HTTP handler
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_api_key" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",        // "whatif" | "wtf"
      lang = "auto",           // "auto" | "it" | "en"
      periodo = "future",      // "future" | "past"
      extra = "",
      profile = {},            // { job, city, lives_with, sleep_hours, stress, ... }
      follow = false,          // if true => return followup suggestions coherent with 'answer'
      answer = ""              // the episode just generated (for follow)
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const langReal = lang === "auto" ? detectLang(domanda) : lang;

    // ------- FOLLOWUP branch
    if (follow) {
      const sys = `
Generate exactly 2 concise next-step prompts for TOMORROW, coherent with the user's question, today's answer, and tone (${stile}).
They must tease the continuation, not generic coaching. Language: ${isEn(langReal) ? "English" : "Italiano"}.
Return STRICT JSON: {"followups":["Q1","Q2"]} only.
`.trim();
      const usr = `
Question: "${domanda}"
Period: ${periodo}
Profile (subtle): ${JSON.stringify(profile).slice(0, 400)}
Today's answer (context): ${String(answer).slice(0, 1600)}
Now produce 2 tomorrow prompts.
`.trim();

      const r = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.7,
        max_tokens: 220,
        messages: [{ role: "system", content: sys }, { role: "user", content: usr }]
      });

      let out = { followups: [] };
      try { out = JSON.parse(r.choices?.[0]?.message?.content?.trim() || "{}"); } catch {}
      if (!Array.isArray(out.followups) || out.followups.length < 2) {
        out.followups = isEn(langReal)
          ? ["What small sign would tell you the path is right?", "Which detail would change if you truly stayed?"]
          : ["Quale segnale ti direbbe che la direzione è giusta?", "Quale dettaglio cambierebbe se restassi davvero?"];
      }
      return res.status(200).json(out);
    }

    // ------- EPISODE branch
    const sys = buildSystem(stile, langReal);
    const mirror = buildMirror(profile, langReal); // breve riga “ti conosco”
    const closing = episodicClosing(stile, langReal);

    const user = `
${mirror}

User question: "${domanda}"
Period: ${periodo}
Extra hint: "${(extra || "").slice(0, 200)}"
Profile (subtle, do not list explicitly): ${JSON.stringify(profile).slice(0, 400)}

Write a single self-contained episode in the "${stile}" voice with a natural sequel feeling.
If period = "past", make a believable counterfactual future. If "future", predict forward.
Close with EXACTLY: "${closing}"
`.trim();

    const c = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.95 : 0.85,
      max_tokens: 700,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }]
    });

    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text, lang: langReal, style: stile, period: periodo });
  } catch (err) {
    console.error("[/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}

// ------- mirror line (amico di lunga data)
function buildMirror(p = {}, lang = "it") {
  const name = (p.name || "").split(" ")[0];
  const city = p.city || p.city_now || "";
  const job  = p.job || p.work_role || "";
  const lives= p.lives_with || "";
  if (isEn(lang)) {
    const pool = [
      name ? `${name}, you don’t chase noise — you chase rhythm.` : "You don’t chase noise — you chase rhythm.",
      city ? `${city} keeps you steady, but you need one open window.` : "One solid base and one open window — that’s you.",
      job  ? `In ${job}, you last as long as the “why” stays lit.` : "You last as long as the “why” stays lit.",
      lives? `Sharing life with ${lives} taught you what really weighs.` : "You already know what truly weighs and what doesn’t."
    ].filter(Boolean);
    return pick(pool);
  }
  const poolIt = [
    name ? `${name}, non rincorri il rumore: rincorri il ritmo.` : "Non rincorri il rumore: rincorri il ritmo.",
    city ? `${city} ti tiene dritto, ma ti serve sempre una finestra aperta.` : "Ti serve una base solida e una finestra aperta.",
    job  ? `Nel lavoro (${job}) resisti finché il perché resta acceso.` : "Resisti finché il perché resta acceso.",
    lives? `Vivere con ${lives} ti ha insegnato cosa pesa davvero.` : "Sai già cosa pesa e cosa no."
  ].filter(Boolean);
  return pick(poolIt);
}
