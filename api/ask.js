// /api/ask.js — Vercel Edge (Node 18+). INCOLLA TUTTO.
//
// ENV:
// - OPENAI_API_KEY = "sk-..." / "sk-proj-..."
// Opzionale:
// - APP_ENV="dev" per log più verbosi (console.warn)

export const config = { runtime: "edge" };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// -------------------- utils ---------------------------------------------------
const J = (s, d=200)=>new Response(JSON.stringify(s),{status:d,headers:{
  "content-type":"application/json; charset=utf-8","cache-control":"no-store"}});

const S = x => typeof x==="string"?x:JSON.stringify(x||"");
const nowISO = ()=>new Date().toISOString().replace(/\.\d+Z$/,"Z");

function clampLines(txt="", max=14){
  const parts=S(txt).replace(/[“”«»]/g,'"')
    .split(/\n+|(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean).slice(0,max);
  return parts.join("\n").trim();
}
function safeJSON(s){ try{ return JSON.parse(s); }catch{ return null; } }

// -------------------- style & prompts ----------------------------------------
const STYLE = {
  whatif: `Sei un amico brillante, empatico e asciutto.
Parli con ritmo, zero malinconia e senza coachate. Ironia leggera, elegante.
Scrivi frasi brevi, concrete. Obiettivo: dare slancio e chiarezza a chi chiede “e se...?”.`,
  wtf: `Sei un narratore da bar: sarcastico, ironico, ubriaco ma lucido.
Battute intelligenti, calore, ritmo. Fai ridere senza essere cattivo.
Evita acidità o tristezza. Chiudi con una battuta da bancone.`
};

const WTF_ENDINGS = [
  "Clink. Stesso bancone, domani rimescoliamo.",
  "Giro offerto: domani brindiamo sul seguito.",
  "Conto aperto, amico: domani si brinda al resto."
];

function systemFor(style="whatif", lang="it"){
  const base = STYLE[style==="wtf"?"wtf":"whatif"];
  const locale = (lang||"it").toLowerCase()==="en"
    ? "Scrivi in inglese semplice e naturale."
    : "Scrivi in italiano semplice e naturale.";
  return `${base}\n${locale}\nMassimo 12–14 frasi, una per riga.`;
}

function epFooter(ep, lang){
  const it = (lang||"it").toLowerCase()!=="en";
  if(ep===1) return it?"Domani sblocchiamo l’Episodio 2 alle 09:00.":"Tomorrow we unlock Episode 2 at 09:00.";
  if(ep===2) return it?"Domani sblocchiamo l’Episodio 3 alle 09:00.":"Tomorrow we unlock Episode 3 at 09:00.";
  return it?"Finale sbloccato: oggi chiudiamo la storia.":"Final unlocked: we close the story today.";
}

function promptEpisode({domanda, episodio=1, periodo="future", stile="whatif", profilo={}, lang="it"}){
  const it = (lang||"it").toLowerCase()!=="en";
  const hints = [];
  if(profilo?.name) hints.push(`name: ${profilo.name}`);
  if(profilo?.city_now||profilo?.city) hints.push(`city: ${profilo.city_now||profilo.city}`);
  if(profilo?.work_role||profilo?.role) hints.push(`role: ${profilo.work_role||profilo.role}`);
  const sig = hints.length?(it?`Segnali utente: ${hints.join(" · ")}`:`User hints: ${hints.join(" · ")}`):"";

  const close = stile==="wtf"
    ? (it?`Chiudi con UNA battuta da bancone.`:`End with ONE witty bar line.`)
    : (it?`Chiudi con UNA riga asciutta e motivante (no coaching).`:`End with ONE brisk motivating line (no coaching).`);

  const jsonInstr = it ? `Dopo il testo episodio, STAMPA SOLO questo JSON:
{"answer":"ripeti qui l'episodio, pulito e completo","followups":["domanda breve pertinente","altra domanda breve pertinente"]}`
    : `After the episode text, PRINT ONLY this JSON:
{"answer":"repeat here the episode, cleaned and complete","followups":["short relevant question","another short relevant question"]}`;

  const epLab = it?"Episodio":"Episode";
  const per = periodo==="past" ? (it?"Passato":"Past") : (it?"Futuro":"Future");

  return `${it?"Domanda":"Question"}: ${S(domanda)}
${epLab} ${episodio} · ${per}.
${close}
${sig}

${jsonInstr}`;
}

function promptEpisodeNoJSON({domanda, episodio=1, periodo="future", stile="whatif", lang="it"}){
  const it = (lang||"it").toLowerCase()!=="en";
  const close = stile==="wtf"
    ? (it?`Chiudi con UNA battuta da bancone.`:`End with ONE witty bar line.`)
    : (it?`Chiudi con UNA riga asciutta e motivante (no coaching).`:`End with ONE brisk motivating line (no coaching).`);
  const epLab = it?"Episodio":"Episode";
  const per = periodo==="past" ? (it?"Passato":"Past") : (it?"Futuro":"Future");
  return `${it?"Scrivi solo il testo, niente JSON.": "Write only the text, no JSON."}
${it?"Domanda":"Question"}: ${S(domanda)}
${epLab} ${episodio} · ${per}.
${close}`;
}

function promptFollowups({domanda, testo, lang="it"}){
  const it = (lang||"it").toLowerCase()!=="en";
  return (it?`Genera due domande di follow-up brevi (max 12 parole), pertinenti alla domanda e a questo testo:\nQ: ${S(domanda)}\nTesto:\n${S(testo)}\nRispondi JSON puro: {"followups":["...","..."]}`
           :`Generate two short follow-ups (max 12 words) relevant to the question and this text:\nQ: ${S(domanda)}\nText:\n${S(testo)}\nReply raw JSON: {"followups":["...","..."]}`);
}

function promptClarify({domanda, lang="it"}){
  const it = (lang||"it").toLowerCase()!=="en";
  return it
    ? `Proponi 2–3 domande mirate, brevi (<=8 parole), per chiarire meglio:\nDomanda: ${S(domanda)}\nRispondi JSON puro: {"questions":["...","...","..."]}`
    : `Propose 2–3 short (<=8 words) targeted questions to clarify:\nQuestion: ${S(domanda)}\nReply raw JSON: {"questions":["...","...","..."]}`;
}

// -------------------- OpenAI --------------------------------------------------
async function callOpenAI({messages, temperature=0.7, model="gpt-4o-mini"}){
  if(!OPENAI_API_KEY) return {ok:false, error:"OPENAI_API_KEY missing"};
  const r = await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{ "authorization":`Bearer ${OPENAI_API_KEY}`, "content-type":"application/json" },
    body:JSON.stringify({model, messages, temperature})
  });
  if(!r.ok){
    const txt=await r.text().catch(()=> "");
    return {ok:false, error:`OpenAI ${r.status}: ${txt.slice(0,400)}`};
  }
  const j=await r.json();
  const content=j?.choices?.[0]?.message?.content||"";
  return {ok:true, content};
}

// -------------------- sanitizers ---------------------------------------------
function finalizeAnswer(txt, {stile="whatif", lang="it", episodio=1}={}){
  let out = clampLines(txt, 14);
  if(stile==="wtf"){
    if(!/bancone|giro|conto|brind/i.test(out)) out += (out.endsWith("\n")?"":"\n")+WTF_ENDINGS[Math.floor(Math.random()*WTF_ENDINGS.length)];
  }else{
    const it=(lang||"it").toLowerCase()!=="en";
    const line = it? "Ok: domani spingiamo un passo oltre." : "Alright: tomorrow we push one step further.";
    if(!/domani|tomorrow|passo/i.test(out)) out += (out.endsWith("\n")?"":"\n")+line;
  }
  out += "\n\n"+epFooter(episodio,lang);
  return out.trim();
}

// -------------------- handler -------------------------------------------------
export default async function handler(req){
  try{
    // ping debug
    const {searchParams}=new URL(req.url);
    if(req.method==="GET" && searchParams.get("ping")){
      return J({ok:true,keyExists:!!OPENAI_API_KEY,keyPrefix:OPENAI_API_KEY?OPENAI_API_KEY.slice(0,7)+"...":null,ts:nowISO()},200);
    }
    if(req.method!=="POST") return J({error:"Method not allowed"},405);

    const body=await req.json().catch(()=> ({}));
    const {
      domanda="", lang="it", periodo="future", stile="whatif",
      episodio=1, clarify=false, profilo={}
    } = body||{};

    if(!domanda || typeof domanda!=="string") return J({error:"Missing 'domanda' string"},400);

    // ---------- CLARIFY ----------
    if(clarify){
      const sys = systemFor(stile,lang);
      const usr = promptClarify({domanda,lang});
      const out = await callOpenAI({messages:[{role:"system",content:sys},{role:"user",content:usr}], temperature:0.3});
      if(!out.ok) return J({error:out.error},500);
      const parsed = safeJSON(out.content.trim());
      let qs = Array.isArray(parsed?.questions) ? parsed.questions.filter(Boolean) : [];
      if(!qs.length){
        // fallback sicuro
        const it=(lang||"it").toLowerCase()!=="en";
        qs = it
          ? ["In che finestra di tempo decidi?","Primo segnale che sta funzionando?","Vincolo concreto da rispettare?"]
          : ["Decision window?","First signal it’s working?","One concrete constraint?"];
      }
      return J({questions: qs.slice(0,3)},200);
    }

    // ---------- EPISODIO ----------
    const sys = systemFor(stile,lang);
    const usr = promptEpisode({domanda,episodio:Number(episodio)||1,periodo,stile,profilo,lang});
    const out = await callOpenAI({messages:[{role:"system",content:sys},{role:"user",content:usr}], temperature:stile==="wtf"?0.85:0.6});
    if(!out.ok) return J({error:out.error},500);

    // Estraggo JSON alla fine
    let answerText = "";
    let followups = [];
    const content = out.content || "";

    const jsonStart = content.lastIndexOf("{");
    if(jsonStart>=0 && /"followups"\s*:/.test(content)){
      const jsonPart = content.slice(jsonStart);
      const parsed = safeJSON(jsonPart);
      if(parsed && typeof parsed==="object"){
        answerText = S(parsed.answer||"");
        followups = Array.isArray(parsed.followups)?parsed.followups.filter(Boolean).slice(0,2):[];
      }
      // Se pre-JSON contiene testo episodio, usalo come priorità (spesso è più ricco)
      const pre = content.slice(0,jsonStart).trim();
      if(pre && answerText.length<60) answerText = pre;
    }else{
      // nessun JSON → prendo tutto
      answerText = content;
    }

    // Se ancora troppo corto, faccio UN secondo tentativo SOLO TESTO
    if(!answerText || answerText.split(/\s+/).length < 12){
      if(process.env.APP_ENV==="dev") console.warn("Retry: episode text too short, second pass without JSON");
      const usr2 = promptEpisodeNoJSON({domanda,episodio:Number(episodio)||1,periodo,stile,lang});
      const out2 = await callOpenAI({messages:[{role:"system",content:sys},{role:"user",content:usr2}], temperature:stile==="wtf"?0.9:0.65});
      if(out2.ok && out2.content) answerText = out2.content;
    }

    // Followups mancanti? Generaliamo in un pass rapido sul testo ottenuto
    if(!followups.length){
      const fu = await callOpenAI({
        messages:[{role:"system",content:systemFor("whatif",lang)},{role:"user",content:promptFollowups({domanda,testo:answerText,lang})}],
        temperature:0.4, model:"gpt-4o-mini"
      });
      if(fu.ok){
        const pj = safeJSON(fu.content.trim());
        if(Array.isArray(pj?.followups)) followups = pj.followups.filter(Boolean).slice(0,2);
      }
    }
    // Ancora vuoti? fallback definitivo
    if(!followups.length){
      const it=(lang||"it").toLowerCase()!=="en";
      followups = it
        ? ["Qual è il primo segnale che ti direbbe che sta funzionando?","Cosa potresti fare entro 7 giorni per provarci senza rischiare?"]
        : ["What’s the first signal it’s working?","What could you try within 7 days with low risk?"];
    }

    // Sanitize & chiusure
    const final = finalizeAnswer(answerText||"", {stile,lang,episodio:Number(episodio)||1});

    return J({ok:true, answer:final, followups, meta:{stile,periodo,episodio:Number(episodio)||1,ts:nowISO()}},200);

  }catch(err){
    return J({error:`Server error: ${err?.message||String(err)}`},500);
  }
}
