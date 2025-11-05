// /api/ask.js — What?f Engine (WhatIf naturale + WTF demenziale — MULTILINGUA)

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { randomBytes, createHash } from "node:crypto";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Rate limit ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

/* ========= CORS ========= */
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

/* ========= Helpers ========= */
const SUP_LANGS = ["it","en","es","fr","de"];
const normLang = (l="it") => SUP_LANGS.includes(String(l||"it").toLowerCase().slice(0,2)) ? String(l).toLowerCase().slice(0,2) : "it";

const normLine = (s="") => String(s).toLowerCase()
  .replace(/[“”"']/g,"").replace(/\s+/g," ")
  .replace(/[.,;:!?()[\]\-—]+$/g,"").trim();

function tightenSentences(text, maxSentences){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; out.push(p); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text, maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" "); const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){ return String(s).replace(/\s*\n+\s*/g," ").replace(/\s{2,}/g," ").replace(/\.\.\.+/g,"…").replace(/\s+([.,;:!?])/g,"$1").trim(); }
function stripQuestionEcho(domanda,text){
  let t=String(text||"");
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();
  if(d.length>=8){
    const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
    if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  }
  const rx=/^(?:\s*(?:e\s*se|what\s*if|domanda:|q:)\s*[^.!?…]*[.!?…]\s+)/i;
  return t.replace(rx,"").trim();
}
const sentenceCaseAll = (s="") => s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/gu,(m,p,c)=>p+c.toUpperCase());
const finalPunct = (s="") => /[.!?…]$/.test(s)?s:s+".";

/* ========= WHAT IF ========= */
const WHATIF_RULES = {
  it: `Sei "What If": voce calma, empatica, concreta. Scrivi in ITALIANO.
Paragrafo unico, 8–11 frasi, no elenchi né emoji, NON ripetere la domanda.
Sequenza: (1) radice emotiva; (2) perché conta ora; (3) prime settimane;
(4) outlook 3–6 mesi (pro + sfida); (5) realtà pratica (costi/tempo/energia/contesto);
(6) da dove nasce il desiderio; (7) micro-test; (8) criterio interno per decidere.
Stile naturale, immagini quotidiane brevi. Adatta al tema (città/lavoro/relazioni/soldi/crescita).`.trim(),
  en: `You are "What If": calm, empathetic, practical. Write in ENGLISH.
Single paragraph, 8–11 sentences, no bullets or emojis, do NOT restate the question.
Sequence: (1) emotional root; (2) why now; (3) first weeks; (4) 3–6 month outlook (upsides + challenge);
(5) practical reality (cost/time/energy/context); (6) origin of desire; (7) micro-test; (8) inner criterion. Keep it natural.`.trim(),
  es: `Eres "What If": voz calmada, empática y práctica. Escribe en ESPAÑOL.
Un solo párrafo, 8–11 frases, sin listas ni emojis, NO repitas la pregunta.
Secuencia: raíz emocional → por qué ahora → primeras semanas → 3–6 meses (pro + desafío) → realidad práctica → origen del deseo → micro-prueba → criterio interno.`.trim(),
  fr: `Tu es "What If" : voix calme, empathique et concrète. Écris en FRANÇAIS.
Un seul paragraphe, 8–11 phrases, pas de listes ni d’emojis, ne répète pas la question. Suis la séquence et reste naturel.`.trim(),
  de: `Du bist "What If": ruhig, empathisch, pragmatisch. Schreibe auf DEUTSCH.
Ein Absatz, 8–11 Sätze, keine Listen/Emojis, Frage NICHT wiederholen. Folge der Sequenz, alltagsnah.`.trim()
};
const WHATIF_EXAMPLES = {
  it:`Questa domanda nasce quando una parte di te chiede un ritmo più tuo. Le prime settimane avrebbero un sapore familiare e strano insieme: luoghi che riconosci e la testa che corre meno. Dopo un mese arriva la prova vera: confrontarti con chi eri e chi sei adesso, capire se quella differenza ti allarga o ti stringe. Nel concreto guadagni spazio mentale e routine più sane, ma perdi un po’ di vibrazione quotidiana. Se lo vivi come passo in avanti e non ritorno al passato, in sei mesi puoi sentirti più stabile e presente; se ti sembra di rientrare in una versione più piccola di te, tornerà presto voglia di ripartire. Fai un test di due settimane “come se fosse già così”: orari, luoghi, lavoro. Se ti svegli più leggero e non senti di mettere la vita in pausa, non stai tornando: stai iniziando da lì.`,
  en:`This question appears when part of you asks for a rhythm that feels more like you. The first weeks feel familiar and odd at once; a month in, the real test is who you were vs who you are now. You gain mental space and steadier routines, but lose some everyday buzz. If it’s a step forward (not a return), in six months you feel more stable and present; if it shrinks you, the urge to move on returns. Run a two-week “as if already true” test: hours, places, work. If you wake up lighter and don’t feel on pause, you’re not going back — you’re starting from there.`,
  es:`Esta pregunta aparece cuando una parte de ti pide un ritmo más tuyo…`,
  fr:`Cette question arrive quand une part de toi demande un rythme plus à toi…`,
  de:`Diese Frage taucht auf, wenn ein Teil von dir nach einem eigenen Rhythmus ruft…`
};

/* ========= WTF ========= */
/* --- Banks to dynamically compose unique openers & object reactions each request --- */
const BANK = {
  it: {
    teasers: [
      "Ok, respira: sembri pronto a negoziare con il destino usando uno scontrino.",
      "Ehi, tranquillo: oggi facciamo pace con il caos e gli rubiamo pure il telecomando.",
      "Allora campione, hai portato il coraggio o l’hai lasciato in lavatrice con i calzini spaiati?",
      "D’accordo, genio del fine settimana: proviamo a non incendiare anche il lunedì.",
      "Respira: si può sbagliare forte, ma almeno fallo con stile e ricevuta fiscale."
    ],
    scenes: [
      "il salotto che fa l’eco ai pensieri",
      "il frigorifero che giudica in silenzio",
      "la scrivania che crede di essere un altare",
      "la pianta che ti osserva come un revisore dei conti",
      "il citofono che suona solo quando stai per capire qualcosa"
    ],
    objects: ["moka","ventilatore","tapparella","lampada","Alexa","frigorifero","campanello","pianta","citofono","microonde","stampante","telecomando","aspirapolvere"],
    verbs: ["applaude","fischia","si ribella","ti fa il tifo","ti mette in muto","ti manda una PEC","si mette in modalità aereo","va in sciopero","si autodiagnostica","fa ghosting"],
    twists: ["perché sa già come va a finire","per solidarietà sindacale","‘per rispetto’","per non vedere il disastro annunciato","perché anche lui ha dei limiti"],
    impre: ["bestemmione corazzato","imprecazionona a detonazione","sacramentata a ciel sereno","vulcano d’anatemi","tromba d’aria di improperi"],
    booze: [
      "negroni apocalittici serviti in secchio",
      "tequila orbitale a secchiate",
      "rum interstellare in tanica da campeggio",
      "grappa quantistica a litri",
      "spritz oceanici formato vasca",
      "birra a idrante, luci blu comprese",
      "vino a cascata con standing ovation del parquet"
    ],
    morals: [
      "Morale: il caos ride se ridi prima tu.",
      "Morale: le scuse scadono, l’azione no.",
      "Morale: fai pace col casino e usalo come benzina."
    ],
    dumbTips: [
      "Consiglio scemo: metti il timer nel freezer, almeno lo apri per qualcosa.",
      "Consiglio scemo: scrivi il piano su uno scontrino e timbralo.",
      "Consiglio scemo: prometti alla moka un aumento se parte al primo colpo."
    ]
  },
  en: {
    teasers: [
      "Alright, breathe: you look ready to bargain with fate using a parking ticket.",
      "Easy, champ: today we tame chaos and steal its remote.",
      "Okay wizard, let’s try not to set Monday on fire again.",
      "Deep breath: failing loudly is allowed, just do it with taste.",
      "Cool your jets: even your to-do list needs a helmet."
    ],
    scenes: [
      "the couch echoing your thoughts","the fridge silently judging",
      "a desk that thinks it’s a shrine","the plant auditing your soul",
      "the doorbell ringing only when epiphanies appear"
    ],
    objects: ["coffee maker","fan","blind","lamp","Alexa","fridge","doorbell","plant","microwave","printer","remote","vacuum"],
    verbs: ["cheers","boo","goes on strike","puts you on mute","files a complaint","switches to airplane mode","ghosts you","self-diagnoses"],
    twists: ["because it knows how this ends","out of professional courtesy","‘out of respect’","to avoid witnessing the mess","because even it has limits"],
    impre: ["armored expletive","detonating cuss","thunderous gasp of blasphemy","volcano of curses","tornado of swears"],
    booze: [
      "apocalyptic Negronis by the bucket","orbital tequila by the gallon",
      "interstellar rum in a jerrycan","quantum grappa by the liter",
      "oceanic spritzes served in a tub","hydrant beer with sirens",
      "waterfalls of wine applauded by the floorboards"
    ],
    morals: [
      "Moral: laugh first, chaos follows.",
      "Moral: excuses expire, action doesn’t.",
      "Moral: make peace with mess and spend it like fuel."
    ],
    dumbTips: [
      "Dumb tip: put your timer in the freezer so you open it for a reason.",
      "Dumb tip: write the plan on a receipt and stamp it.",
      "Dumb tip: promise the coffee maker a raise if it starts at first try."
    ]
  },
  es: {
    teasers: [
      "Vale, respira: vas a regatear con el destino usando un ticket del súper.",
      "Tranki, crack: hoy domamos el caos y le robamos el mando.",
      "Oye genio: intentemos no incendiar el lunes otra vez.",
      "Inhala: fallar fuerte se permite, pero con estilo.",
      "Calma: tu lista de tareas pide casco."
    ],
    scenes: ["el sofá que hace eco","la nevera que juzga","el escritorio-altar","la planta auditora","el timbre oportunista"],
    objects: ["cafetera","ventilador","persiana","lámpara","Alexa","nevera","timbre","planta","microondas","impresora","mando","aspiradora"],
    verbs: ["aplaude","abuchea","se pone en huelga","te pone en silencio","te manda una queja","activa modo avión","te hace ghosting","se autodiagnostica"],
    twists: ["porque ya sabe cómo acaba","por cortesía profesional","“por respeto”","para no ver el desastre","porque también tiene límites"],
    impre: ["blasfemia blindada","improperio detonante","sacramentazo a cielo abierto","volcán de maldiciones","tromba de juramentos"],
    booze: ["negronis apocalípticos en cubo","tequila orbital a lo bestia","ron interestelar en bidón","grappa cuántica a litros","spritz oceánicos en bañera","cerveza a hidrante","cascadas de vino con ovación"],
    morals: ["Moral: ríe tú primero y manda el caos a la banca.","Moral: las excusas caducan, el movimiento no.","Moral: hazte amigo del lío y úsalo de combustible."],
    dumbTips: ["Tip tonto: mete el temporizador en el congelador.","Tip tonto: escríbelo en un ticket y ponle sello.","Tip tonto: prométele a la cafetera un bonus."]
  },
  fr: {
    teasers: [
      "Ok, respire : tu veux marchander avec le destin avec un ticket de caisse.",
      "Doucement, champion : on dresse le chaos et on lui pique la télécommande.",
      "D’accord, magicien : évitons d’incendier le lundi encore une fois.",
      "Inspire : rater fort est autorisé, mais avec panache.",
      "Calme : même ta to-do exige un casque."
    ],
    scenes: ["le canapé qui résonne","le frigo juge muet","le bureau-autel","la plante commissaire aux comptes","la sonnette prophétique"],
    objects: ["cafetière","ventilateur","store","lampe","Alexa","frigo","sonnette","plante","micro-ondes","imprimante","télécommande","aspirateur"],
    verbs: ["applaudit","hue","se met en grève","te met en silencieux","dépose une plainte","passe en mode avion","te ghoste","s’auto-diagnostique"],
    twists: ["parce qu’il sait déjà la fin","par courtoisie pro","« par respect »","pour ne pas voir le bazar","car lui aussi a des limites"],
    impre: ["gros juron blindé","imprécation détonante","sacre en plein ciel","volcan de jurons","tornade d’insultes"],
    booze: ["Negronis apocalyptiques au seau","tequila orbitale à la louche","rhum interstellaire en jerrican","grappa quantique au litre","spritz océaniques dans la baignoire","bière à l’hydrant","cascades de vin applaudies par le parquet"],
    morals: ["Morale : ris d’abord, le chaos suit.","Morale : les excuses périment, l’action non.","Morale : fais la paix avec le bazar et brûle-le comme carburant."],
    dumbTips: ["Astuce bête : mets le minuteur au congélo.","Astuce bête : écris le plan sur un ticket et tamponne.","Astuce bête : promets une prime à la cafetière."]
  },
  de: {
    teasers: [
      "Okay, atme: du willst mit dem Schicksal mit einem Kassenbon feilschen.",
      "Locker, Chef: wir zähmen heute das Chaos und klauen die Fernbedienung.",
      "Alles klar, Zauberer: bitte heute kein Montagsfeuer.",
      "Tief einatmen: laut scheitern ist erlaubt, aber mit Stil.",
      "Beruhig dich: selbst deine To-do will einen Helm."
    ],
    scenes: ["das Sofa mit Echo","der still urteilende Kühlschrank","der Schreibtisch-Altar","die prüfende Pflanze","die hellsehende Klingel"],
    objects: ["Kaffeemaschine","Ventilator","Rollladen","Lampe","Alexa","Kühlschrank","Klingel","Pflanze","Mikrowelle","Drucker","Fernbedienung","Staubsauger"],
    verbs: ["applaudiert","buht","streikt","schaltet dich stumm","reicht Beschwerde ein","schaltet in Flugmodus","ghostet dich","selbstdiagnostiziert"],
    twists: ["weil es das Ende kennt","aus Kollegialität","„aus Respekt“","um das Chaos nicht ansehen zu müssen","weil auch es Grenzen hat"],
    impre: ["gepanzertes Fluchen","detonierender Fluch","Sakralschrei aus heiterem Himmel","Vulkan der Schimpfwörter","Tornado der Verwünschungen"],
    booze: ["apokalyptische Negronis im Eimer","orbitale Tequila-Ladungen","interstellarer Rum im Kanister","Quantengrappa literweise","ozeanische Spritz in der Wanne","Hydranten-Bier mit Sirenen","Weinwasserfälle mit Parkett-Ovationen"],
    morals: ["Moral: lach zuerst, dann stolpert das Chaos.","Moral: Ausreden verfallen, Aktion nicht.","Moral: friede mit dem Durcheinander, nutz es als Treibstoff."],
    dumbTips: ["Blöder Tipp: Timer ins Gefrierfach.","Blöder Tipp: Plan auf Bon schreiben und stempeln.","Blöder Tipp: Kaffeemaschine auf Prämie setzen."]
  }
};

/* small utilities for variability */
function hash32(s){ return createHash("sha1").update(s).digest().readUInt32BE(0); }
function makePRNG(seed){
  let x = seed >>> 0;
  return ()=>{ x = (x*1664525+1013904223)>>>0; return x/2**32; };
}
function pick(prng, arr){ return arr[Math.floor(prng()*arr.length)] }
function pickMany(prng, arr, k){
  const a=[...arr]; const out=[];
  for(let i=0;i<Math.max(0,Math.min(k,a.length));i++){
    const idx=Math.floor(prng()*a.length); out.push(a.splice(idx,1)[0]);
  }
  return out;
}
function buildOpener(L, domanda){
  const b=BANK[L]||BANK.it;
  const prng = makePRNG(hash32(domanda) ^ randomBytes(4).readUInt32BE(0));
  const t = pick(prng,b.teasers);
  const s = pick(prng,b.scenes);
  return `${t} Qui intorno ${s}.`;
}
function buildObjectReactions(L, domanda, prng, n=3){
  const b=BANK[L]||BANK.it;
  const objs = pickMany(prng, b.objects, n);
  const lines = objs.map(o=>{
    const v = pick(prng, b.verbs);
    const tw = pick(prng, b.twists);
    return `${o} ${v} ${tw}`;
  });
  return lines;
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile }){
  const L = normLang(lang);

  const baseRules = L==="en"
    ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;
  const temporal = String(periodo).toLowerCase()==="past"
    ? (L==="en" ? "Write as if it already happened." :
       L==="es" ? "Escribe como si ya hubiera pasado." :
       L==="fr" ? "Écris comme si c’était déjà arrivé." :
       L==="de" ? "Schreibe, als wäre es bereits geschehen." :
                  "Scrivi come se fosse già successo.")
    : (L==="en" ? "Write as a near-future unfolding starting now." :
       L==="es" ? "Escribe como un futuro cercano que empieza ahora." :
       L==="fr" ? "Écris comme un futur proche qui commence maintenant." :
       L==="de" ? "Schreibe als nahe Zukunft, die jetzt beginnt." :
                  "Scrivi come un prossimo futuro che inizia ora.");

  const msgs = [
    { role: "system", content: baseRules },
    { role: "system", content: temporal },
  ];

  if(stile==="wtf"){
    // per-request variability with salt
    const seed = hash32(domanda) ^ randomBytes(4).readUInt32BE(0);
    const rnd = makePRNG(seed);
    const b = BANK[L] || BANK.it;

    const opener = buildOpener(L, domanda);
    const impre = pick(rnd, b.impre);
    const reactLines = buildObjectReactions(L, domanda, rnd, 2 + Math.floor(rnd()*2)); // 2–3 oggetti
    const drinks = pickMany(rnd, b.booze, 2 + (rnd()<0.5?1:0)); // 2–3 giri
    const moral = pick(rnd, b.morals);
    const dumb = pick(rnd, b.dumbTips);

    const wtfRule =
      L==="en" ? `WHAT THE F (friendly, light sarcasm, useful). ALWAYS start with a personalized tease. Keep 4–6 sentences total. Flow: tease → 2–3 tiny mishaps → ONE theatrical outburst (“${impre}”, never at people) → ${reactLines.length} talking-object reactions → ${drinks.length} GALACTIC BOOZE rounds (${drinks.join(" + ")}) → **2–3 sentences that actually answer the question** → ultra-short end: ironic moral + silly on-topic tip. Sarcasm in EVERY sentence, never mean.`
      : L==="es" ? `WHAT THE F (amable, sarcasmo ligero, útil). Empieza SIEMPRE con burla cariñosa. 4–6 frases. Flujo: burla → 2–3 contratiempos → UN estallido («${impre}») → ${reactLines.length} objetos parlantes → ${drinks.length} RONDAS GALÁCTICAS (${drinks.join(" + ")}) → **2–3 frases que responden** → cierre ultra-corto: moraleja irónica + consejo tonto. Sarcasmo en TODAS las frases, sin mala leche.`
      : L==="fr" ? `WHAT THE F (amical, sarcasme léger, utile). Commence TOUJOURS par une taquinerie perso. 4–6 phrases. Enchaînement : taquinerie → 2–3 couacs → UNE explosion (« ${impre} ») → ${reactLines.length} objets parlants → ${drinks.length} TOURNÉES GALACTIQUES (${drinks.join(" + ")}) → **2–3 phrases qui répondent vraiment** → fin ultra-courte : morale ironique + conseil idiot. Sarcasme partout, jamais méchant.`
      : L==="de" ? `WHAT THE F (freundlich, leichter Sarkasmus, hilfreich). Starte IMMER mit persönlichem Necken. 4–6 Sätze. Ablauf: Necken → 2–3 Pannen → EINE theatralische Entladung („${impre}“) → ${reactLines.length} sprechende Objekte → ${drinks.length} GALAKTISCHE RUNDEN (${drinks.join(" + ")}) → **2–3 echte Antwortsätze** → ultrakurzes Ende: ironische Moral + dummer Tipp. Leichter Sarkasmus in jedem Satz, nie gemein.`
      : `WHAT THE F (amichevole, sarcasmo leggero, utile). APRI SEMPRE con presa in giro personale. Totale 4–6 frasi. Flusso: presa in giro → 2–3 micro-imprevisti → UNO sfogo teatrale (“${impre}”) → ${reactLines.length} oggetti parlanti → ${drinks.length} GIRI DI SBRONZA GALATTICA (${drinks.join(" + ")}) → **2–3 frasi che rispondono davvero** → chiusura lampo: morale ironica + consiglio scemo. Sarcasmo in OGNI frase, mai cattivo.`;

    msgs.push(
      { role:"system", content: wtfRule },
      { role:"system", content:`OPENING_EXAMPLE: ${opener}` },
      { role:"system", content:`OBJECT_REACTIONS:\n- ${reactLines.join("\n- ")}` },
      { role:"system", content:`MORAL: ${moral}` },
      { role:"system", content:`SILLY_TIP: ${dumb}` }
    );
  } else {
    msgs.push(
      { role:"system", content: WHATIF_RULES[L] || WHATIF_RULES.it },
      { role:"system", content: `Esempio/Example:\n${WHATIF_EXAMPLES[L] || WHATIF_EXAMPLES.it}` },
      { role:"system", content: `ADATTAMENTO PER TEMA: città/lavoro/relazioni/soldi/crescita.` }
    );
  }

  const ask =
    L==="en" ? `Question (do NOT repeat it). ONE SINGLE PARAGRAPH (8–11 sentences). Keep it natural and concise. "${domanda}"`
  : L==="es" ? `No repitas la pregunta. Un solo párrafo (8–11 frases), natural y conciso. "${domanda}"`
  : L==="fr" ? `Ne répète pas la question. Un seul paragraphe (8–11 phrases), naturel et concis. « ${domanda} »`
  : L==="de" ? `Wiederhole die Frage nicht. Ein einziger Absatz (8–11 Sätze), natürlich und knapp. „${domanda}“`
  :           `Non ripetere la domanda. Scrivi UN SOLO PARAGRAFO (8–11 frasi), naturale e conciso. "${domanda}"`;
  msgs.push({ role: "user", content: ask });

  return msgs;
}

/* ========= HANDLER ========= */
export default async function handler(req, res){
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const { success } = await rl.limit(`ask:${ip}`);
    if(!success) return res.status(429).json({ error:"rate_limited_minute" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", lang = "it", periodo = "future", micro = {} } = body;
    if(!domanda || typeof domanda !== "string") return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = buildMessages({ domanda, lang, periodo, stile, micro });
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

    // ===== Post-process (WTF ancora più corto) =====
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 6 : 11);   // 4–6 target per WTF
    answer = clampWords(answer, stile === "wtf" ? 120 : 165);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // ===== IT normalizzazioni sicure =====
    if(normLang(lang)==="it"){
      const d=String(domanda||"");
      const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion=new Set((d.match(nameRx)||[]));
      answer = answer.replace(nameRx, (m, _g1, offset, str)=>{
        if(offset===0) return m;
        const before = str.slice(0, offset);
        if(/[.!?…]["'”)\]]?\s*$/.test(before)) return m;
        return inQuestion.has(m) || ["Ah","Oh","Ehi","Sai"].includes(m) ? m : m.toLowerCase();
      });
      answer = answer.replace(/\ball’aquila\b/g, "all’Aquila");
    }

    // ===== Maiuscola iniziale =====
    answer = answer.replace(/^\s*([a-zà-ÿ])/u, (m,c)=>c.toUpperCase());

    return res.status(200).json({ answer, style: stile, lang: normLang(lang), periodo, model: MODEL });

  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
