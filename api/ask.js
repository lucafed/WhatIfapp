// ============================
// /api/ask.js — What?f Engine (REAL auto-context: place OR topic)
// Styles: whatif (empatico), wtf (barista demenziale)
// ============================

import OpenAI from "openai";
import fetch from "node-fetch";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------- Utils ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const clamp = (s, n=220) => String(s||"").replace(/\s+/g," ").trim().slice(0,n);
const WEEKDAY = (lang) => new Date().toLocaleDateString(isEn(lang)?"en-GB":"it-IT",{weekday:"long"});
function SEASON(lang){ const m=new Date().getMonth()+1; const it=(m<=2||m===12)?"inverno":(m<=5?"primavera":(m<=8?"estate":"autunno")); const en=(m<=2||m===12)?"winter":(m<=5?"spring":(m<=8?"summer":"autumn")); return isEn(lang)?en:it; }

/* ---------- City / Topic extraction ---------- */
const CITY_WHITELIST = ["l'aquila","aquila","verona","roma","milano","napoli","firenze","bologna","torino","genova","venezia","trento","trieste","perugia","pescara","bari","palermo","catania","lugano","padova","parma"];
function inferCity({ domanda="", extra="", micro={} }) {
  const t = `${domanda} ${extra} ${micro?.city||micro?.citta||""}`.toLowerCase();
  for (const c of CITY_WHITELIST) if (t.includes(c)) return c.replace("l'aquila","L'Aquila").replace("aquila","L'Aquila");
  const m = t.match(/\b(?:a|in|verso|su)\s+([a-zàèéìòù' ]{2,})/i);
  if (m) return m[1].split(/[,.!?]/)[0].trim();
  return "";
}

// super-semplice: prime parole “forti” come possibile topic
function inferTopic(text="") {
  const stop = new Set(["se","e","ma","di","da","con","per","su","che","the","and","or","a","in","to","mi","io","tu","noi","voi","gli","le","un","una","uno"]);
  const words = String(text).toLowerCase().replace(/[^\p{L}\p{N}\s']/gu," ").split(/\s+/).filter(w=>w.length>3 && !stop.has(w));
  return clamp(words.slice(0,6).join(" "), 60);
}

/* ---------- Data sources (no key) ---------- */
async function wikiSummary(title, lang){
  try{
    const r = await fetch(`https://${isEn(lang)?"en":"it"}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    const j = await r.json();
    return clamp(j?.extract || j?.description || "", 200);
  }catch{return "";}
}

async function geocode(name, lang){
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=${isEn(lang)?"en":"it"}&format=json`);
  const j = await r.json();
  return j?.results?.[0] || null;
}

function wxText(code, lang){
  const it={0:"sereno",1:"poco nuvoloso",2:"variabile",3:"nuvoloso",45:"foschia",48:"brina",51:"pioviggine leggera",53:"pioviggine",55:"pioviggine intensa",61:"pioggia debole",63:"pioggia",65:"pioggia forte",71:"neve debole",73:"neve",75:"neve forte",80:"rovesci",95:"temporali"};
  const en={0:"clear",1:"mostly clear",2:"partly cloudy",3:"cloudy",45:"fog",48:"freezing fog",51:"light drizzle",53:"drizzle",55:"heavy drizzle",61:"light rain",63:"rain",65:"heavy rain",71:"light snow",73:"snow",75:"heavy snow",80:"showers",95:"thunderstorms"};
  return (isEn(lang)?en:it)[code] || (isEn(lang)?"mild weather":"meteo mite");
}

async function currentWeather(lat, lon){
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`);
  const j = await r.json();
  return { t: Math.round(j?.current?.temperature_2m ?? 0), code: j?.current?.weather_code ?? 0 };
}

async function newsTitles(topic, lang){
  try{
    const feed = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=${isEn(lang)?"en":"it"}&gl=${isEn(lang)?"US":"IT"}&ceid=${isEn(lang)?"US:en":"IT:it"}`);
    const xml = await feed.text();
    const titles = Array.from(xml.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g)).map(m=>m[1]).slice(1,4); // skip feed title
    return titles.join(" • ");
  }catch{return "";}
}

/* ---------- Auto context ---------- */
async function buildRealContext({ domanda, extra, micro, lang }){
  const day = WEEKDAY(lang), season = SEASON(lang);
  const city = inferCity({ domanda, extra, micro });
  if (city){
    try{
      const g = await geocode(city, lang);
      if (!g) throw new Error("no_geo");
      const wx = await currentWeather(g.latitude, g.longitude);
      const wxStr = wxText(wx.code, lang);
      const wiki = await wikiSummary(g.name || city, lang);
      return isEn(lang)
        ? `${g.name}, ${g.country}. ${day} in ${season}; ${wxStr.toLowerCase()}, ~${wx.t}°C. City note: ${wiki}`
        : `${g.name}, ${g.country}. ${day} di ${season}; ${wxStr.toLowerCase()}, ~${wx.t}°C. Nota città: ${wiki}`;
    }catch{
      return isEn(lang)
        ? `${city}. ${day} in ${season}; conditions likely mild.`
        : `${city}. ${day} di ${season}; condizioni presumibilmente miti.`;
    }
  }

  // topic branch
  const topic = inferTopic(`${domanda} ${extra}`);
  if (topic){
    const wiki = await wikiSummary(topic, lang);
    const headlines = await newsTitles(topic, lang);
    return isEn(lang)
      ? `Topic: ${topic}. ${day} in ${season}. Wiki note: ${wiki}${headlines?`. News: ${headlines}`:""}`
      : `Argomento: ${topic}. ${day} di ${season}. Nota wiki: ${wiki}${headlines?`. Notizie: ${headlines}`:""}`;
  }

  return isEn(lang)
    ? `Today is ${day} in ${season}. No clear city/topic; keep it universal, grounded.`
    : `Oggi è ${day} di ${season}. Nessuna città/tema chiaro; resta universale ma concreto.`;
}

/* ---------- Personas (stili) ---------- */
function personaSystem(style, lang, context){
  const LANG_ONLY = isEn(lang) ? "Answer ONLY in English." : "Rispondi SOLO in Italiano.";

  if (style === "wtf"){
    return isEn(lang) ? `
You are "What the F" — a witty, tipsy bartender best friend.
Second person; one continuous mini-story (8–10 sentences), chaotic but affectionate.
Use playful nonsense + bar/drink riffs; make it flow (no staccato bullets).
Weave this REAL context only when it helps the joke/story: ${context}
Never cruel; warmth underneath. Keep it punchy and confident.
${LANG_ONLY}
`.trim() : `
Sei "What the F" — barista brillante, alticcio, demenziale ma affettuoso.
Seconda persona; racconto continuo (8–10 frasi), caotico ma caldo.
Nonsense giocoso + riferimenti a bar/alcol; flusso continuo (no frasi telegrafiche).
Intreccia questo contesto REALE solo quando aiuta la gag/storia: ${context}
Mai cattivo; sotto c'è calore. Tieni ritmo e sicurezza.
${LANG_ONLY}
`.trim();
  }

  // whatif
  return isEn(lang) ? `
You are "What If" — a warm, lucid friend who truly knows the user.
Second person; 7–10 smooth sentences in one compact paragraph.
Empathetic, realistic, lightly poetic but grounded; calm optimism.
Show familiarity through small concrete cues; no claims like “I know you”.
Use this REAL context gently; do NOT invent private facts: ${context}
End with a gentle forward nudge.
${LANG_ONLY}
`.trim() : `
Sei "What If" — un amico caldo e lucido che conosce davvero l’utente.
Seconda persona; 7–10 frasi fluide in un unico paragrafo.
Empatico, realistico, leggermente poetico ma concreto; ottimismo calmo.
Familiarità mostrata da piccoli dettagli; mai “ti conosco”.
Usa con tatto questo contesto REALE; non inventare fatti privati: ${context}
Chiudi con una spinta gentile in avanti.
${LANG_ONLY}
`.trim();
}

/* ---------- Handler ---------- */
export default async function handler(req, res){
  // CORS
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST")   return res.status(405).json({error:"method_not_allowed"});

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const { domanda="", stile="whatif", lang="it", extra="", micro={}, contextMode="real" } = body;
    if(!domanda || typeof domanda!=="string") return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const context = contextMode==="clean"
      ? (isEn(lang)?"No external facts requested.":"Nessun fatto esterno richiesto.")
      : await buildRealContext({ domanda, extra, micro, lang });

    const systemPrompt = personaSystem(stile, lang, context);
    const userPrompt = isEn(lang)
      ? `User question: "${domanda}". Personal hints: "${clamp(extra,160)}".`
      : `Domanda utente: "${domanda}". Indizi personali: "${clamp(extra,160)}".`;

    const r = await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf" ? 0.97 : 0.84,
      max_tokens: 650,
      messages: [{role:"system",content:systemPrompt},{role:"user",content:userPrompt}]
    });

    const answer = r?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    return res.status(200).json({ answer, style:stile, lang, contextUsed: context });
  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
