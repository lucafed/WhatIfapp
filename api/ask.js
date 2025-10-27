// /api/ask.js — FEW-SHOT ONLY DRIVER (2025-10)
// Replica lo stile ESATTO degli esempi; niente istruzioni lunghe.
// Tieni solo il minimo tecnico: rate, crediti, CORS.

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

// ---------- infra ----------
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

const ORIGINS = ["http://localhost:3000","http://127.0.0.1:5500","https://what-ifapp.vercel.app"];
function cors(req,res){
  const o = String(req.headers.origin||"");
  if (ORIGINS.includes(o)) res.setHeader("Access-Control-Allow-Origin", o);
  res.setHeader("Vary","Origin");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, x-admin-token, x-pro");
}

// ---------- tiny utils ----------
const isEn = (lang) => String(lang||"it").toLowerCase().startsWith("en");
const onePara = s => String(s||"").replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").trim();
const tinyHash = (s="") => { let h=2166136261>>>0; for (let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return (h>>>0).toString(36); };

// ---------- STYLE EXAMPLES (THE SOURCE OF TRUTH) ----------
/** What If — ANALITICO (IT) */
const WI_ANAL_IT = `Sai Luca, questa domanda era nell’aria da un po’, vero? Tornare a L’Aquila oggi significherebbe ritrovarti in una città che ha cambiato pelle ma non respiro. La ricostruzione ha rimesso in moto l’economia, a ritmo lento ma tenace: più imprese locali, meno industria pesante, servizi che crescono intorno all’università e alla sanità. Il costo della vita rimane più basso del Nord, ma anche gli stipendi lo sono: qui si guadagna meno, si spende con più senso, ci si appoggia di più alla rete di persone. Il tempo si dilata, le relazioni contano più dei contatti, e la montagna torna bussola quotidiana. Ci sono giorni in cui ti mancherà l’efficienza veneta; in cambio troverai una qualità di vita fatta di distanze brevi, volti noti, bambini che crescono tra stagioni vere. Non è un passo indietro: è un ritmo diverso. E nella quiete scopri che non è silenzio — è spazio per respirare davvero.`;

/** What If — POETICO (IT) */
const WI_POET_IT = `Bella questa, Luca — lo sapevo che prima o poi te la saresti fatta. Riapri le finestre e l’aria fredda sa di legna e memoria; le strade ti riconoscono al passo e le montagne ti guardano come se non fossi mai andato via. Il bar sotto casa serve ancora il caffè corto e ruvido, e qualcuno ti chiama per nome come se il tempo fosse rimasto in attesa davanti alla porta. I tuoi figli imparano il calendario dalle nuvole: neve, erba alta, vento buono. La sera chiudi le imposte e senti il silenzio che non fa rumore ma compagnia. Non stai tornando indietro: stai tornando dove la vita aveva smesso di correre, con un pezzo di te che finalmente rientra al suo posto.`;

/** What the F — Esempio “moto” (IT) */
const WTF_MOTO_IT = `Eh Luca, la moto eh? Arrivi con coraggio da bancone e il casco che si crede cinema; l’aria applaude e ti senti gigante, poi un moscerino sceglie il tuo dente come pista e ti scappa un “porca grappa fulminata” che fa clac al visierino. Il semaforo finge innocenza, la sedia del bar sbuffa di risatina, tu ordini un Negroni “per rimettere la dignità in bolla” e il conto ti guarda come un giudice severo. Riparti più piano ma più largo di sorriso: non sei diventato veloce, sei diventato vivo — che alla fine è molto più svelto.`;

/** What the F — Esempio “bar” (IT) */
const WTF_BAR_IT = `Va bene, campione di schiuma: te lo immagini lucido e tuo. Primo cliente chiede un cappuccino tiepido con schiuma fredda e il vapore ti risponde male; ti scappa un “maledetta moka isterica” così sincero che il cucchiaino batte l’applauso e la cassa tossisce da scooter. Alle nove e venti versi “controllo qualità” per pareggiare i conti col destino, un vecchietto annuisce come arbitro imparziale, e a fine giornata sei ricco di storie e corto di spicci — che, guarda caso, è esattamente il punto di un bar fatto bene.`;

// (Volendo, puoi aggiungere anche esempi EN qui sotto)
const EX = {
  it: {
    whatif: { analitico: WI_ANAL_IT, poetico: WI_POET_IT },
    wtf: { moto: WTF_MOTO_IT, bar: WTF_BAR_IT }
  }
};

// ---------- PROMPT BUILDER (few-shot only) ----------
function buildMessages({stile, whatifFlavor, domanda, lang, periodo, userName, micro}){
  const en = isEn(lang);
  const nameNote = userName ? (en?`Use their first name “${userName}” in the opening if natural.`:`Se naturale, usa il nome “${userName}” all’apertura.`) : "";
  const temporal = (String(periodo).toLowerCase()==="past")
    ? (en?`Write as if it already happened.`:`Scrivi come se fosse già successo.`)
    : (en?`Write as a near future unfolding.`:`Scrivi come un prossimo futuro plausibile.`);

  // System rule minimalissima
  const SYS = en
    ? `Replicate the style, rhythm and voice of the EXAMPLES EXACTLY. One single paragraph. No lists. No emojis. Keep it inside the narration of the user's question. ${temporal} ${nameNote}`
    : `Replica ESATTAMENTE stile, ritmo e voce degli ESEMPI. Un solo paragrafo. Niente elenchi. Niente emoji. Tieni tutto dentro la narrazione della domanda. ${temporal} ${nameNote}`;

  const few = [];

  if (stile === "whatif"){
    const sample = (EX.it.whatif[whatifFlavor] || WI_POET_IT);
    few.push({ role:"system", content: `ESEMPIO WHAT IF (${whatifFlavor.toUpperCase()} IT):\n${sample}` });
  } else {
    // WTF: forziamo due esempi per imitazione forte
    few.push({ role:"system", content: `ESEMPIO WHAT THE F (IT — Moto):\n${WTF_MOTO_IT}` });
    few.push({ role:"system", content: `ESEMPIO WHAT THE F (IT — Bar):\n${WTF_BAR_IT}` });
    // Nota brevissima sulle imprecazioni non religiose
    few.push({ role:"system", content: `Usa una sola imprecazione forte ma NON religiosa in mezzo alla scena (es. “porca grappa fulminata”, “maledetta moka isterica”, “maremma bullone storto”). Oggetti/persone possono reagire (tazzina trema, panchina sbuffa).` });
  }

  const context = en
    ? `Question: "${domanda}". Micro-profile: ${JSON.stringify(micro||{})}.`
    : `Domanda: "${domanda}". Micro-prof.: ${JSON.stringify(micro||{})}.`;

  return [
    { role:"system", content: SYS },
    ...few,
    { role:"user", content: context }
  ];
}

// ---------- handler ----------
export default async function handler(req,res){
  cors(req,res);
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({ error:"method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip=(req.headers["x-forwarded-for"]||req.socket?.remoteAddress||"").toString().split(",")[0].trim();
    const adminToken=String(req.headers["x-admin-token"]||"");
    const admin = !!adminToken && !!(await redis.hgetall(`admin:token:${adminToken}`));

    if(!admin){
      const { success } = await rl.limit(`ask:${ip}`);
      if(!success) return res.status(429).json({ error:"rate_limited_minute" });
    }

    const isPro = String(req.headers["x-pro"]||"") === "1";
    let used=0, dailyCap=isPro?10:3;
    if(!admin){
      const today=new Date().toISOString().slice(0,10);
      const key=`credits:${ip}:${today}`;
      used=(await redis.incr(key))??1;
      if(used===1) await redis.expire(key,86400);
      if(used>dailyCap) return res.status(402).json({ error:"daily_credits_exhausted", used, dailyCap });
    }

    const body = typeof req.body==="string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const {
      domanda="", stile="whatif", lang="it", periodo="future",
      whatifFlavor="poetico", userName="", micro={}
    } = body;
    if(!domanda) return res.status(400).json({ error:"domanda_required" });

    const messages = buildMessages({stile, whatifFlavor, domanda, lang, periodo, userName, micro});

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages,
      temperature: stile==="wtf" ? 0.98 : 0.85,
      top_p: 0.92,
      max_tokens: 380,
      presence_penalty: 0.1,
      frequency_penalty: 0.3,
      user: tinyHash(ip)
    });

    let answer = onePara(completion?.choices?.[0]?.message?.content || "");
    if(!/[.!?…]$/.test(answer)) answer+=".";

    // log leggero
    try{
      await redis.lpush("logs:ask", JSON.stringify({
        ts:Date.now(), iphash: tinyHash(ip), stile, lang, periodo, whatifFlavor,
        qh: tinyHash(domanda), len: answer.length
      }));
      await redis.ltrim("logs:ask",0,5000);
    }catch{}

    return res.status(200).json({
      answer, style:stile, lang, periodo, whatifFlavor,
      model: MODEL,
      credits: admin? null : { used, dailyCap }
    });

  }catch(e){
    console.error("api/ask error", e);
    return res.status(500).json({ error:"server_error", detail:String(e?.message||e) });
  }
}
