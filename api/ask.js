// /api/ask.js — What?f Engine (FINAL BALANCED EDITION • FIXED WTF SEQUENCE) // Stili: whatif (analitico | reale) · wtf — Un paragrafo, seconda persona, niente elenchi, niente nomi inventati. import OpenAI from "openai"; import { Redis } from "@upstash/redis"; import { Ratelimit } from "@upstash/ratelimit";

/* ========= OpenAI ========= */ const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis & Rate ========= */ const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, }); const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m"), });

/* ========= CORS ========= */ const ALLOWED_ORIGINS = [ "https://what-ifapp.vercel.app", "http://localhost:3000", "http://127.0.0.1:5500", ]; function cors(req, res) { const origin = String(req.headers.origin || ""); if (ALLOWED_ORIGINS.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro"); }

/* ========= Helpers ========= / const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en"); function normLine(s=""){ return String(s).toLowerCase().replace(/[“”"']/g,"").replace(/\s+/g," ").replace(/[.,;:!?()-—]+$/g,"").trim(); } function tightenSentences(text, maxSentences){ const parts = String(text||"").replace(/\n+/g," ").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean); const out=[], seen=new Set(); for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; if(p.split(/\s+/).length<=3 && !/[.!?]$/.test(p)) continue; out.push(p); seen.add(n); if(out.length>=maxSentences) break; } let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t; } function clampWords(text,maxWords){ const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text; const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]?[.!?])(?![\s\S][.!?])/); return m?m[1]:slice+"…"; } function normalizeOneParagraph(s=""){ return String(s).replace(/\s\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\s+([.,;:!?])/g,"$1").trim(); } function stripQuestionEcho(domanda,text){ const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase(); let t=String(text||""); const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim(); const rx=/^(?:e\sse|what\sif|domanda:|q:)[^.!?…]*[.!?…]\s+/i; if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); } t=t.replace(rx,""); return t; }

/* ========= Modalità temporale ========= */ function temporalInstruction(periodo="future", lang="it"){ const en = isEn(lang); if(String(periodo).toLowerCase()==="past"){ return en ? "Write as if it already happened (past/conditional allowed)." : "Scrivi come se fosse già successo (passato/condizionale consentiti)."; } return en ? "Write as a near-future unfolding starting now." : "Scrivi come un prossimo futuro che inizia ora."; }

/* ========= WHAT IF — esempi e stile (INCIPIT FISSI) ========= */ const EX_WHATIF_ANALITICO_IT = Sai, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.; const EX_WHATIF_REALE_IT = Bella questa — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.;

// Istruzioni WHAT IF (niente personalità, solo forma + incipit) const WHATIF_ANALITICO_STYLE_IT = `WHAT IF Analitico:

Inizia nello stile di “Sai, questa domanda girava nell’aria da un po’.” (o variante coerente).

Tono concreto: scambi reali, costi/benefici, routine, qualità della vita.

Chiudi con una sintesi calma nello stile dell’esempio.

135–155 parole. Seconda persona soltanto.; const WHATIF_REALE_STYLE_IT = WHAT IF Reale/Poetico:

Inizia nello stile di “Bella questa — me l’aspettavo da te.” (o variante coerente).

Tono sensoriale asciutto, immagini quotidiane.

Chiudi riconoscendo luogo e tempo come alleati.

135–155 parole. Seconda persona soltanto.`;


/* ========= WTF — vincoli SEQUENZA + banche lessicali ========= */ // Aggiornato: include esplicitamente il lemma "bestemmia" e derivati; scegli UNO soltanto. const WTF_SFOGO_BANK = [ "bestemmione corazzato", "bestemmia santa ben assestata", "bestemmiata liberatoria", "bestemmiando a valanga", "para-bestemmia esplosiva", "madonna della miseria urlata", "imprecazionona a detonazione", "sacramentata a ciel sereno", "urlo liturgico strozzato", "vulcano d’anatemi", "tromba d’aria di improperi", "scoppio teologico a catena" ];

const WTF_REACTIONS_BANK = [ "la lampada sfarfalla in Morse come se capisse tutto", "il campanile tossisce un amen stonato", "i bicchieri applaudono in cristallo e chiedono il bis", "la tapparella si abbassa per imbarazzo e poi risale curiosa", "Alexa finge un aggiornamento e scappa in ‘non disturbare’", "il POS recita un rosario di errori e si benedice da solo", "la moka fischia una standing ovation", "il ventilatore gira al contrario per reverenza", "la statua all’angolo si copre gli occhi e sbircia tra le dita", "il citofono fa uno squillo di solidarietà e poi si pente", "il frigorifero si spegne per compassione", "la porta automatica si apre da sola e poi si vergogna" ];

// Istruzione WTF: forma rigida + GARANZIA LEMMA "BESTEMMIA" + esattamente due reazioni const WTF_STRICT_IT = `WHAT THE F (demenziale, ma rispondi davvero): Sequenza OBBLIGATORIA in un solo paragrafo (145–165 parole):

1. Presa in giro affettuosa del protagonista (2 frasi).


2. 4 micro-imprevisti realistici legati al contesto della domanda.


3. “Ti trattieni… provi… riprovi…” e POI esplode UNO sfogo viscerale (scegline UNO, non più di uno) dai seguenti: ${WTF_SFOGO_BANK.join(", ")}. ⚠️ Deve contenere esplicitamente il lemma “bestemmia” o un suo derivato (bestemmione, bestemmiata, bestemmiando, "bestemmia santa"). Trattalo come narrazione, non insulto diretto.


4. SUBITO DOPO inserisci esattamente 2 reazioni esilaranti coerenti al contesto, scelte da: ${WTF_REACTIONS_BANK.join(" · ")}.


5. Accenno di alcol (sip/doppio amaro/sbronza elegante).


6. Rispondi davvero alla domanda con una previsione/controfattuale concreta (1–2 frasi).


7. Chiudi con una riga ironica (“morale”) che richiama l’apertura. Vincoli: seconda persona soltanto; niente nomi inventati; non ripetere la domanda.`;



/* ========= Prompt builder ========= */ function buildMessages({ domanda, lang, periodo, stile, mode }){ const msgs = [ { role: "system", content: isEn(lang) ? RULES: one paragraph, no bullets, no emojis, do NOT restate the question. Near-future. Second person only. No invented names. Length: WHATIF 135–155, WTF 145–165. : REGOLE: un solo paragrafo, niente elenchi, niente emoji, NON ripetere la domanda. Prossimo futuro. Solo seconda persona. Niente nomi inventati. Lunghezza: WHATIF 135–155, WTF 145–165. }, { role: "system", content: temporalInstruction(periodo, lang) }, ];

if (stile === "wtf") { msgs.push( { role: "system", content: WTF_STRICT_IT }, { role: "system", content: ESEMPIO · WTF (forma guida, tono e sequenza) + \nAh ma guarda te… sempre convinto che la moka risolva i traumi. Ti vedi già al bancone, musica jazz, sorrisi, caffè perfetti.  + Poi arrivano quattro colpi bassi: il macinino tossisce, il latte impazzisce, il POS fa una novena e il vicino ordina “cappuccino tiepido che non sa di latte”.  + Ti imponi di stare calmo, ci provi, riprovi… poi ti parte una bestemmia santa ben assestata che fa vibrare i cucchiaini.  + La lampada sfarfalla in Morse e la moka fa standing ovation.  + Bevi un amaro di servizio e, mentre rimetti in riga il bancone, ammetti che sì: aprire questo bar domani sarà identico, ma con più mestiere.  + Morale: il caos non si doma, gli si offre un caffè e paga lui. } ); } else { if (mode === "analitico") { msgs.push( { role: "system", content: WHATIF_ANALITICO_STYLE_IT }, { role: "system", content: ESEMPIO · WHAT IF (Analitico)\n${EX_WHATIF_ANALITICO_IT} }, ); } else { msgs.push( { role: "system", content: WHATIF_REALE_STYLE_IT }, { role: "system", content: ESEMPIO · WHAT IF (Reale/Poetico)\n${EX_WHATIF_REALE_IT} }, ); } }

msgs.push({ role: "user", content: Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ${lang.toUpperCase()} a paragrafo unico. }); return msgs; }

/* ========= HANDLER ========= */ export default async function handler(req, res){ cors(req, res); if (req.method === "OPTIONS") return res.status(200).end(); if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

try{ if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
const { success } = await rl.limit(`ask:${ip}`);
if(!success) return res.status(429).json({ error:"rate_limited_minute" });

const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
const {
  domanda = "",
  stile = "whatif",   // "whatif" | "wtf"
  mode  = "reale",    // per whatif: "analitico" | "reale"
  lang  = "it",
  periodo = "future"
} = body;

if(!domanda || typeof domanda !== "string")
  return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

const messages = buildMessages({ domanda, lang, periodo, stile, mode });

const completion = await client.chat.completions.create({
  model: MODEL,
  temperature: stile === "wtf" ? 0.98 : 0.82,
  top_p: 0.92,
  max_tokens: 480,
  frequency_penalty: 0.1,
  presence_penalty: 0.0,
  messages,
});

let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
if(!answer) throw new Error("empty_model_response");

// Post-process
answer = stripQuestionEcho(domanda, answer);
answer = tightenSentences(answer, stile === "wtf" ? 9 : 11);
answer = clampWords(answer, stile === "wtf" ? 168 : 160);
answer = normalizeOneParagraph(answer);
if(!/[.!?…]$/.test(answer)) answer += ".";

// Guard-rail lingua: niente prima persona
answer = answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi, "");

// Guard-rail nomi: non introdurre nomi non presenti nella domanda
(function(){
  const d = String(domanda||"");
  const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
  const inQuestion = new Set((d.match(nameRx)||[]));
  answer = answer.replace(nameRx, (m)=>{
    return inQuestion.has(m) ? m : (["Ah","Oh","Ehi","Bella","Sai"].includes(m) ? m : m.toLowerCase());
  });
})();

// GARANZIA: nel WTF ci dev'essere almeno un lemma "bestemmia"/derivato e **esattamente due** reazioni.
if(stile === "wtf"){
  // 1) Enforce lemma
  if(!/bestemmi\w*/i.test(answer)){
    // Inserisci una clausola breve prima della chiusura.
    answer = answer.replace(/(\s*Morale:)/i, " con una bestemmia santa che ti libera il diaframma. $1");
  }
  // 2) Se compaiono più di 2 reazioni del nostro set, riducile a 2 mantenendo le prime due occorrenze
  const rxReacts = new RegExp(
    `(?:${WTF_REACTIONS_BANK.map(r=>r.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&')).join('|')})`,
    'gi'
  );
  const found = [...answer.matchAll(rxReacts)].map(m=>m[0]);
  if(found.length>2){
    let kept = 0;
    answer = answer.replace(rxReacts, (m)=> (++kept<=2 ? m : ""));
    // normalizza doppie virgole lasciate da tagli
    answer = answer.replace(/,\s*,+/g, ", ").replace(/\s+\./g, ".");
  }
}

return res.status(200).json({
  answer,
  style: stile,
  mode,
  lang,
  periodo,
  model: MODEL
});

}catch(err){ console.error("❌ [/api/ask] error:", err); return res.status(500).json({ error:"server_error", detail:String(err?.message||err) }); } }

<!-- ========================= --><!-- FOURTH (Domanda)          --><!-- ========================= --><!-- File: fourth.html --><!doctype html>

<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>What?f – Domanda</title>
  <meta name="theme-color" content="#0B0B0C" />
  <style>
    :root{ --bg:#0C0F14; --bg2:#0E1724; --fg:#E6F2F5; --muted:#A0B2BA; --card:#121820; --line:#1b2a34; --accent:#1C57A0; --accent2:#FFEC01; --ink:#001f26 }
    html[data-theme="wtf"]{ --bg:#0B0B0C; --bg2:#101414; --fg:#EEF5F0; --muted:#A6B6AD; --card:#111713; --line:#21322A; --accent:#3A6B56; --accent2:#5A8C75; --ink:#06110B }
    *{box-sizing:border-box} html,body{height:100%;margin:0;background:radial-gradient(900px 700px at 25% 20%, var(--bg2) 0%, var(--bg) 60%);color:var(--fg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
    main{min-height:100%;display:flex;flex-direction:column;gap:16px;max-width:860px;margin:0 auto;padding:20px}
    h1{margin:4px 0 0;font-size:clamp(22px,5vw,34px);color:var(--accent)}
    .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px}
    .row{display:grid;gap:10px}
    @media(min-width:680px){ .row.two{grid-template-columns:1fr 1fr} .row.three{grid-template-columns:1fr 1fr 1fr} }
    label{font-weight:700;margin:6px 0;display:block}
    select,textarea,input{width:100%;background:#0f1820;color:var(--fg);border:1px solid var(--line);border-radius:12px;padding:12px;font-size:16px}
    .muted{color:var(--muted);font-size:13px}
    .actions{display:flex;gap:10px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap}
    .btn{appearance:none;border:1px solid var(--line);background:#0f1820;color:var(--fg);border-radius:12px;padding:12px 16px;font-weight:900;cursor:pointer}
    .btn.primary{border:none;background:linear-gradient(180deg,var(--accent),var(--accent2));color:var(--ink)}
    .pill{display:inline-flex;gap:6px;align-items:center}
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Chiedi il tuo What?f</h1>
      <p class="muted">Un paragrafo, seconda persona, niente elenchi: ci pensa il motore. Qui scegli solo stile e contesto.</p>
    </header><section class="card">
  <div class="row two">
    <div>
      <label for="stile">Stile</label>
      <select id="stile">
        <option value="whatif">What if</option>
        <option value="wtf">What the F</option>
      </select>
    </div>
    <div>
      <label for="mode">Timbro (solo What if)</label>
      <select id="mode">
        <option value="analitico">Analitico</option>
        <option value="reale">Reale/Poetico</option>
      </select>
    </div>
  </div>
  <div class="row two" style="margin-top:10px">
    <div>
      <label for="periodo">Tempo</label>
      <select id="periodo">
        <option value="future">Futuro</option>
        <option value="past">Passato</option>
      </select>
    </div>
    <div>
      <label for="lang">Lingua</label>
      <select id="lang">
        <option value="it">Italiano</option>
        <option value="en">English</option>
      </select>
    </div>
  </div>
  <div style="margin-top:10px">
    <label for="domanda">La tua domanda</label>
    <textarea id="domanda" rows="5" placeholder="Es. E se tornassi a vivere all’Aquila?"></textarea>
    <p class="muted">Suggerimento: formula la domanda con “E se…”. Il motore eviterà di ripeterla nella risposta.</p>
  </div>
  <div class="actions">
    <button id="back" class="btn" type="button">← Indietro</button>
    <button id="go" class="btn primary" type="button">Genera</button>
  </div>
</section>

  </main>  <script>
    // Theme from prefs
    (function(){
      try{ const prefs=JSON.parse(localStorage.getItem('whatif_prefs')||'{}'); document.documentElement.setAttribute('data-theme', prefs.stile==='wtf'?'wtf':'whatif'); }catch{ document.documentElement.setAttribute('data-theme','whatif'); }
    })();

    const $=s=>document.querySelector(s);
    const stile=$('#stile'), mode=$('#mode'), periodo=$('#periodo'), lang=$('#lang'), domanda=$('#domanda');

    // Prefill from previous choices
    (function(){
      try{
        const prefs=JSON.parse(localStorage.getItem('whatif_prefs')||'{}');
        if(prefs.stile) stile.value=prefs.stile;
        if(prefs.periodo) periodo.value=prefs.periodo;
        // Keep mode if present
        if(prefs.mode) mode.value=prefs.mode;
        if(prefs.lang) lang.value=prefs.lang;
        // Toggle mode visibility on stile
        toggleMode();
      }catch{}
    })();

    function toggleMode(){ mode.disabled = (stile.value!=="whatif"); mode.parentElement.style.opacity = mode.disabled?0.5:1; }
    stile.addEventListener('change', ()=>{ toggleMode(); savePrefs(); document.documentElement.setAttribute('data-theme', stile.value==='wtf'?'wtf':'whatif'); });
    periodo.addEventListener('change', savePrefs); mode.addEventListener('change', savePrefs); lang.addEventListener('change', savePrefs);
    function savePrefs(){ const p={ stile:stile.value, periodo:periodo.value, mode:mode.value, lang:lang.value }; localStorage.setItem('whatif_prefs', JSON.stringify(p)); }

    $('#back').addEventListener('click', ()=>{ location.href='second.html'; });
    $('#go').addEventListener('click', async ()=>{
      const q = (domanda.value||'').trim();
      if(!q){ domanda.focus(); domanda.setAttribute('aria-invalid','true'); return; }
      // stash payload and go to results
      const payload = { domanda:q, stile:stile.value, mode:stile.value==='whatif'?mode.value:'reale', periodo:periodo.value, lang:lang.value };
      sessionStorage.setItem('whatif_last_payload', JSON.stringify(payload));
      location.href='fifth.html';
    });
  </script></body>
</html><!-- ========================= --><!-- FIFTH (Risultato)         --><!-- ========================= --><!-- File: fifth.html --><!doctype html>

<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>What?f – Risultato</title>
  <meta name="theme-color" content="#0B0B0C" />
  <style>
    :root{ --bg:#0C0F14; --bg2:#0E1724; --fg:#E6F2F5; --muted:#A0B2BA; --card:#121820; --line:#1b2a34; --accent:#1C57A0; --accent2:#FFEC01; --ink:#001f26 }
    html[data-theme="wtf"]{ --bg:#0B0B0C; --bg2:#101414; --fg:#EEF5F0; --muted:#A6B6AD; --card:#111713; --line:#21322A; --accent:#3A6B56; --accent2:#5A8C75; --ink:#06110B }
    *{box-sizing:border-box} html,body{height:100%;margin:0;background:radial-gradient(900px 700px at 25% 20%, var(--bg2) 0%, var(--bg) 60%);color:var(--fg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
    main{min-height:100%;display:flex;flex-direction:column;gap:16px;max-width:860px;margin:0 auto;padding:20px}
    h1{margin:4px 0 0;font-size:clamp(22px,5vw,34px);color:var(--accent)}
    .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
    .muted{color:var(--muted)}
    .answer{font-size:clamp(16px,3.8vw,20px);line-height:1.6;white-space:pre-wrap}
    .row{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}
    .btn{appearance:none;border:1px solid var(--line);background:#0f1820;color:var(--fg);border-radius:12px;padding:10px 14px;font-weight:900;cursor:pointer}
    .btn.primary{border:none;background:linear-gradient(180deg,var(--accent),var(--accent2));color:var(--ink)}
    .small{font-size:12px}
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Risultato</h1>
      <p id="meta" class="muted small"></p>
    </header><section id="box" class="card">
  <div id="answer" class="answer">Carico…</div>
  <div class="row" style="margin-top:12px">
    <button id="again" class="btn">Rigenera</button>
    <button id="copy" class="btn">Copia</button>
    <button id="new" class="btn primary">Nuova domanda</button>
  </div>
</section>

  </main>  <script>
    (function(){
      try{ const prefs=JSON.parse(localStorage.getItem('whatif_prefs')||'{}'); document.documentElement.setAttribute('data-theme', prefs.stile==='wtf'?'wtf':'whatif'); }catch{ document.documentElement.setAttribute('data-theme','whatif'); }
    })();

    const $=s=>document.querySelector(s);
    const meta=$('#meta'), out=$('#answer');

    async function call(payload){
      const res = await fetch('/api/ask', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      if(!res.ok) throw new Error('API error '+res.status);
      const data = await res.json();
      return data?.answer || '';
    }

    async function run(gen=false){
      const payload = JSON.parse(sessionStorage.getItem('whatif_last_payload')||'{}');
      if(!payload.domanda){ location.href='fourth.html'; return; }
      meta.textContent = `${payload.stile.toUpperCase()} · ${payload.lang.toUpperCase()} · ${payload.periodo}` + (payload.stile==='whatif'?` · ${payload.mode}`:'');
      out.textContent = 'Carico…';
      try{ const txt = await call(payload); out.textContent = txt; }
      catch(e){ out.textContent = 'Errore nel generare la risposta. Riprova.'; console.error(e); }
    }

    $('#again').addEventListener('click', ()=> run(true));
    $('#copy').addEventListener('click', async ()=>{ try{ await navigator.clipboard.writeText(out.textContent||''); }catch{} });
    $('#new').addEventListener('click', ()=>{ location.href='fourth.html'; });

    run();
  </script></body>
</html>
