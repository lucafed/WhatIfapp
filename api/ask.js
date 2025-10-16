// ============================
// /api/ask.js — The Life Cliffhanger Engine™
// versione stabile e completa (IT/EN) con contesto reale automatico
// ============================

import OpenAI from "openai";

// ====== Setup ======
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini"; // affidabile e rapido

// News: opzionale — metti una key (GNews o simile) in NEWS_API_KEY
const NEWS_API = process.env.NEWS_API_KEY || "";

// ====== Utilities ======
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const clamp = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");
const withTimeout = (p, ms = 2500) =>
  Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("timeout")), ms))]);

function detectLang(text = "") {
  const enHits = (text.match(/\b(what|if|you|move|work|city|buy|should|back|life)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|vivere|tornare|aquila|verona|lugano|roma)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

function guessCityFromQuestion(q = "") {
  const m = q.match(/\b(l['’]aquila|aquila|roma|milano|verona|lugano|napoli|torino|bologna|londra|zurigo)\b/i);
  return m ? m[1] : "";
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

// ====== Real-world context (all optional; degrade gracefully) ======
async function fetchWeather(city = "", lang = "it") {
  // Open-Meteo via geocoding (no key). If geocoding fails, skip.
  try {
    const geo = await withTimeout(
      fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=${lang}`)
    );
    const gj = await geo.json();
    if (!gj?.results?.[0]) return null;
    const { latitude, longitude, name, country } = gj.results[0];
    const w = await withTimeout(
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,precipitation&timezone=auto`
      )
    );
    const wj = await w.json();
    const cur = wj?.current || {};
    return {
      label: `${name}${country ? ", " + country : ""}`,
      temp: cur.temperature_2m,
      precipitation: cur.precipitation,
    };
  } catch {
    return null;
  }
}

async function fetchHoliday(lang = "it") {
  // Nager.Date supports many countries; we’ll default to IT.
  try {
    const year = new Date().getFullYear();
    const country = isEn(lang) ? "GB" : "IT";
    const res = await withTimeout(fetch(`https://date.nager.at/api/v3/publicholidays/${year}/${country}`));
    const arr = await res.json();
    const today = todayISO();
    const h = arr.find((x) => x.date === today);
    if (!h) return null;
    return { name: h.localName || h.name };
  } catch {
    return null;
  }
}

async function fetchOnThisDay(lang = "it") {
  // Wikipedia "On this day" summary
  try {
    const d = new Date();
    const url = `https://byabbe.se/on-this-day/${d.getMonth() + 1}/${d.getDate()}/events.json`;
    const r = await withTimeout(fetch(url));
    const j = await r.json();
    const pick = (j?.events || [])[0];
    if (!pick) return null;
    const txt = isEn(lang)
      ? `${pick.year}: ${pick.description}`
      : `${pick.year}: ${pick.description}`;
    return { text: clamp(txt, 200) };
  } catch {
    return null;
  }
}

async function fetchNews(city = "", lang = "it") {
  if (!NEWS_API) return null;
  try {
    const q = city || (isEn(lang) ? "city life" : "cronaca locale");
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=${isEn(lang) ? "en" : "it"}&max=3&apikey=${NEWS_API}`;
    const r = await withTimeout(fetch(url));
    const j = await r.json();
    if (!j?.articles?.length) return null;
    const titles = j.articles.map((a) => a.title).slice(0, 3);
    return { titles };
  } catch {
    return null;
  }
}

// ====== Personas ======
const Whatif_IT = `
Tu sei "What?f": voce lucida, realistica e predittiva; conosci bene l'utente.
Niente poesia o retorica: visivo, umano, profetico. 7–10 frasi complete, non spezzate.
Varia l’incipit (“Presto ti accorgi…”, “Ti conosco…”, “Succede che…”, “Tra poco…”).
Contesto reale consentito: puoi usare solo ciò che ricevi dentro CONTEXT_REAL (meteo/festività/notizie/oggi nella storia).
Mai inventare fatti; collega la risposta alla domanda dell’utente e al micro-profilo (mood, cosa ti tiene, come decidi, segno).
Chiudi con un gancio morbido che faccia venire voglia di tornare domani.
Rispondi SOLO in Italiano.
`;

const Whatif_EN = `
You are "What?f": clear, realistic, predictive; you know the user well.
No purple prose: visual, human, quietly prophetic. 7–10 full sentences.
Vary openings (“Soon you notice…”, “You always do this…”, “It turns out…”).
Real-world context allowed ONLY from CONTEXT_REAL (weather/holiday/news/on-this-day). Never invent events.
Tie the answer to the user's question and micro-profile (mood, anchor, decisions, zodiac).
End with a soft hook that invites tomorrow. Reply ONLY in English.
`;

const Wtf_IT = `
Tu sei "What the F": amico brillante da fine serata, sarcastico e un po' alticcio.
Racconto continuo, divertente, 8–10 frasi, almeno un riferimento all’alcol.
Puoi usare fatti reali SOLO da CONTEXT_REAL; niente invenzioni di notizie.
Sii pungente ma affettuoso; sembra che conosci l’utente da anni.
Chiudi con una battuta in sospeso. Rispondi SOLO in Italiano.
`;

const Wtf_EN = `
You are "What the F": drunk-brilliant, sarcastic friend at 2AM.
Continuous mini-story, 8–10 sentences, at least one alcohol gag.
Real facts allowed ONLY from CONTEXT_REAL; no fabrication.
Affectionate sarcasm, like you’ve known the user for years.
End with a playful cliffhanger. Reply ONLY in English.
`;

function personaSystem(stile, lang) {
  if (stile === "wtf") return isEn(lang) ? Wtf_EN : Wtf_IT;
  return isEn(lang) ? Whatif_EN : Whatif_IT;
}

// ====== Handler ======
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
      stile = "whatif",
      lang: langIn = "auto",
      extra = "",
      // micro-profilo dal client:
      micro = {}, // { mood, anchor, decide, zodiac }
      // follow: genera suggerimenti coerenti post-risposta
      follow = false,
      answer = "",
      // facts
      fantasy_mode = false,
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    const lang = langIn === "auto" ? detectLang(domanda) : langIn;

    // ====== Build CONTEXT_REAL (if not fantasy_mode) ======
    let CONTEXT_REAL = "";
    if (!fantasy_mode) {
      const cityHint = guessCityFromQuestion(domanda);
      const [w, h, otd, nw] = await Promise.all([
        cityHint ? fetchWeather(cityHint, lang) : Promise.resolve(null),
        fetchHoliday(lang),
        fetchOnThisDay(lang),
        fetchNews(cityHint, lang),
      ]);

      const parts = [];
      if (w) parts.push(`Weather: ${w.label}: ${w.temp}°C, precipitation ${w.precipitation}mm`);
      if (h) parts.push(`Holiday: ${h.name}`);
      if (otd) parts.push(`OnThisDay: ${otd.text}`);
      if (nw) parts.push(`News: ${nw.titles.join(" | ")}`);
      if (parts.length) CONTEXT_REAL = parts.join("\n");
    }

    // ====== FOLLOW-UPS branch ======
    if (follow) {
      const system = `
Generate exactly two short follow-up prompts for TOMORROW.
They must be clearly connected to the user's question AND today's answer tone (${stile}).
Return STRICT JSON: {"followups":["Q1","Q2"]}. Language: ${isEn(lang) ? "English" : "Italiano"}.
`.trim();

      const user = `
QUESTION: "${domanda}"
ANSWER_TODAY: "${clamp(answer, 1200)}"
MICRO_PROFILE: ${JSON.stringify(micro)}
CONTEXT_REAL:
${CONTEXT_REAL || "(none)"}
`.trim();

      const r = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.7,
        max_tokens: 200,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      let out = {};
      try {
        out = JSON.parse(r.choices?.[0]?.message?.content || "{}");
      } catch {}
      if (!Array.isArray(out.followups) || out.followups.length < 2) {
        out.followups = isEn(lang)
          ? ["What small sign tomorrow would prove this is right?", "Which detail should we watch first?"]
          : ["Quale piccolo segnale domani ti direbbe che è giusto?", "Da quale dettaglio partiamo davvero?"];
      }
      return res.status(200).json(out);
    }

    // ====== EPISODIO branch ======
    const system = personaSystem(stile, lang);
    const closing = isEn(lang)
      ? (stile === "wtf"
          ? "Keep the glass; the rest pours tomorrow."
          : "Let’s see where this leads next.")
      : (stile === "wtf"
          ? "Tieni il bicchiere: il resto si versa domani."
          : "Vediamo dove ti porta il seguito.");

    const user = `
QUESTION: "${domanda.trim()}"${extra ? ` (${String(extra).trim()})` : ""}
MICRO_PROFILE: ${JSON.stringify(micro)}
CONTEXT_REAL (do NOT invent facts; use only these if relevant):
${CONTEXT_REAL || "(none)"}

Write a single episode in style "${stile}" with a gentle cliffhanger.
End EXACTLY with: "${closing}"
`.trim();

    const c = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.95 : 0.85,
      max_tokens: 700,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const text = c.choices?.[0]?.message?.content?.trim() || "";
    if (!text) throw new Error("empty_model_response");

    return res.status(200).json({
      answer: text,
      used_context: Boolean(CONTEXT_REAL),
    });
  } catch (err) {
    console.error("[/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
