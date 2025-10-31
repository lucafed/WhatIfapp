// /api/ask.js — What?f Engine (IT) — Poetic hard-guard + WTF 3 demenziali
import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Redis & Rate ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
});

/* ========= CORS ========= */
const ALLOWED_ORIGINS = [
  "https://what-ifapp.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
function cors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.includes(origin))
    res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-token, x-pro"
  );
}

/* ========= Helpers ========= */
const S = (x) => String(x || "");
function normLine(s = "") {
  return S(s)
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "")
    .trim();
}
function tightenSentences(text, maxSentences) {
  const parts = S(text)
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const out = [],
    seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n || seen.has(n)) continue;
    if (p.split(/\s+/).length <= 3 && !/[.!?]$/.test(p)) continue;
    out.push(p);
    seen.add(n);
    if (out.length >= maxSentences) break;
  }
  let t = out.join(" ");
  if (!/[.!?…]$/.test(t)) t += ".";
  return t;
}
function clampWords(text, maxWords) {
  const w = S(text).split(/\s+/);
  if (w.length <= maxWords) return text;
  const slice = w.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m ? m[1] : slice + "…";
}
function normalizeOneParagraph(s = "") {
  return S(s)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}
function ensureSentenceCase(s = "") {
  const t = s.trim();
  return t ? t[0].toUpperCase() + t.slice(1) : s;
}
function finalPunct(s = "") {
  return /[.!?…]$/.test(s) ? s : s + ".";
}
function stripQuestionEcho(domanda, text) {
  const d = S(domanda).replace(/[“”"']/g, "").trim().toLowerCase();
  let t = S(text);
  const lead = t
    .slice(0, Math.min(t.length, d.length + 12))
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .trim();
  const rx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if (lead.startsWith(d)) {
    const cut = t.indexOf(".");
    if (cut > -1) t = t.slice(cut + 1).trim();
  }
  return t.replace(rx, "");
}

/* ========= Temporal ========= */
function temporalInstruction(periodo = "future") {
  if (S(periodo).toLowerCase() === "past") {
    return "Scrivi come se fosse già successo (passato/condizionale consentiti).";
  }
  return "Scrivi come un prossimo futuro che inizia ora.";
}

/* ========= WHAT IF — esempi fissi (TUOI) ========= */
const WHATIF_ANALITICO_RX = `Sai Luca, tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;

const WHATIF_POETICO_RX = `Bella questa, Luca. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

/* ========= WTF — few-shots tuoi ========= */
const FEWSHOT_WTF = [
  `Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale. La macchina del caffè sputa vendetta, il frigorifero tossisce e una vecchietta in fila mormora che al confessionale ti tengono in riserva. Ti versi un goccio di liquore, rimetti in riga il bancone e giuri che domani apri solo per matti. Alla chiusura, ti guardi intorno e sussurri che oggi hai bestemmiato più del prete quando finisce il vino — ma almeno hai servito verità calde.`,
  `Oh, eccoci, centauro dell’inferno. Casco lucido, cuore impavido, orgoglio pronto all’incidente. Accendi, parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino. Ti scappa un “bestemmione che spacca l’aria!” così netto che il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma quasi con affetto, come un rito che rimette a fuoco. Al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio con un sorrisetto complice. Torni a casa con l’eco del motore e della tua voce, fuse in una sinfonia di libertà e bestemmie ben calibrate.`,
  `Ah, Luisa… ci risiamo. Ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e la pressione ti sale come se stessi pagando interessi sull’illusione. Ti parte una “bestemmia della miseria impestata” talmente sincera che la lampada sfarfalla e il bicchiere applaude da solo. Il gatto scappa, Alexa finge un aggiornamento, tu respiri e lasci cadere un’altra imprecazione a mezza voce, quasi fosse una preghiera storta. Bevi un sorso di rosso e ammetti che ogni storia finisce con una bestemmia e un brindisi — ma almeno bevi meglio di come ami. Fuori, la luna pare annuire.`,
];

/* ========= Reazioni demenziali per temi (max 3) ========= */
const REACT = {
  money: [
    "il POS prova a dettare l’IBAN con accento bolognese",
    "il salvadanaio starnutisce monete e dice «salute»",
    "l’app della banca ti manda una gif di un prete che conta",
    "lo scontrino si arrotola come sushi e chiede la soia",
    "il portafoglio scappa sotto il divano facendo finta di essere un topo"
  ],
  work: [
    "Excel crea una colonna chiamata «speranze» e la nasconde",
    "la stampante tossisce fogli e ti dà del «lei»",
    "il badge lampeggia «entra pure, ma pianissimo»",
    "la sedia girevole fa tre giri e poi chiede lo spritz",
    "Teams attiva da solo il filtro ‘mi fingo competente’"
  ],
  travel: [
    "il trolley accelera da solo come se avesse il volano",
    "il tabellone partenze cambia idea e poi ti manda un cuore",
    "il navigatore ricalcola la vita e consiglia gelato",
    "la valigia si chiude a chiave e dice «non oggi»",
    "il finestrino fa l’occhiolino in modalità aereo"
  ],
  love: [
    "il telefono vibra in Morse «non scrivergli»",
    "Spotify mette apposta la canzone sbagliata e ti applaude",
    "lo specchio appanna e ti fa i baffi col vapore",
    "le notifiche fanno la ola e si vergognano subito",
    "il cuscino ti manda richiesta d’amicizia"
  ],
  home: [
    "la tapparella scende, risale e poi ti fa ciao",
    "la moka firma autografi col vapore",
    "il citofono suona in do minore e poi si pente",
    "il tappeto rotola via e dice «non ero qui»",
    "il frigorifero sospira e diventa minimalista"
  ],
  tech: [
    "il router lampeggia come una discoteca del ’98",
    "la tastiera batte le mani in CAPS LOCK",
    "il cloud si schiarisce la voce e fa partire un tuono finto",
    "il caricabatterie si offre volontario come martire",
    "il monitor apre da solo Paint e disegna un cuore storto"
  ],
  motor: [
    "il casco ti guarda come una zia in processione",
    "il semaforo diventa rosso per darti la scena",
    "lo specchietto fa la smorfia da fotografo di matrimoni",
    "la targa prova a ricordarsi il tuo nome",
    "la frizione fischietta «Azzurro» fuori tempo"
  ],
  study: [
    "l’evidenziatore si accende da solo e ti illumina la fronte",
    "il post-it sussurra «ripassa» con voce da zia",
    "il quaderno si mette in riga meglio di te",
    "la penna scatta per firmare il destino",
    "il mouse fa doppio click sulla voglia"
  ],
  nature: [
    "le foglie fanno un applauso sordo come guanti da forno",
    "il vento stira la giacca come la nonna",
    "le nuvole aprono il sipario e tossiscono",
    "il fiume tossisce per richiamare l’attenzione",
    "il sentiero ti allunga la mano e poi la ritira"
  ],
};
function classifyTopic(q){
  const s=S(q).toLowerCase();
  const has=(rx)=>rx.test(s);
  if(has(/affitto|bollett|soldi|budget|mutuo|debito|conto|banca|prezzo/)) return "money";
  if(has(/lavor|ufficio|collega|azienda|cv|colloquio|aumento/)) return "work";
  if(has(/viagg|trasfer|partire|trasloco|cambiare citt/)) return "travel";
  if(has(/amore|relazione|partner|fidanz|cuore|appuntamento/)) return "love";
  if(has(/casa|divano|letto|cucina|balcone|pulire/)) return "home";
  if(has(/app|telefono|smart|internet|pc|computer|router|cloud|software/)) return "tech";
  if(has(/moto|motore|casco|auto|macchina|scooter/)) return "motor";
  if(has(/studio|esame|universit|laurea|scuola|corso/)) return "study";
  if(has(/montagna|bosco|mare|vento|sentiero|natura|parco/)) return "nature";
  return "home";
}
function pick3(list){
  const arr=[...list]; const out=[];
  while(out.length<3 && arr.length){
    out.push(arr.splice(Math.floor(Math.random()*arr.length),1)[0]);
  }
  return out;
}

/* ========= Regole di stile ========= */
function baseRules(){
  return `REGOLE: un solo paragrafo, niente elenchi, niente emoji, NON ripetere la domanda. Solo seconda persona. Mantieni ESATTAMENTE lo stile degli esempi utente.`;
}
function whatIfAnaliticoRule(){
  return `WHAT IF Analitico: tono concreto (costi/benefici/routine/qualità della vita). 8–10 frasi; chiusura calma come nell'esempio.`;
}
function whatIfPoeticoRule(){
  return `WHAT IF Poetico/Reale: DEVI iniziare con “Bella questa, Luca.” Frasi brevi (6–12 parole). Immagini sensoriali (luce, aria, vicoli, mani, caffè). VIETATO lessico analitico: niente prezzi, costi, percentuali, budget, affitti, stipendi, economia, contesto, iniziative. Presente o futuro vicino. Chiusura riconciliata, umana.`;
}
function wtfRule(domanda){
  const topic=classifyTopic(domanda);
  const reacts=pick3(REACT[topic]||REACT.home);
  return `WHAT THE F (amichevole). Fai ridere, mai aggressivo. 6–8 frasi. Apri con stoccata affettuosa / soprannome. Inserisci UNA sola “bestemmia” teatrale (mai contro persone). Metti esattamente queste 3 reazioni ASSURDE a metà racconto, una dopo l’altra: "${reacts[0]}"; "${reacts[1]}"; "${reacts[2]}". Bevi alcol (grappa/vino/amaro), non acqua. Aggiungi 1–2 righe che rispondono davvero alla domanda. Chiudi caldo e sarcastico.`;
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, periodo, stile, mode }){
  const msgs = [
    { role: "system", content: baseRules() },
    { role: "system", content: temporalInstruction(periodo) },
  ];
  if (stile === "wtf") {
    msgs.push(
      { role: "system", content: wtfRule(domanda) },
      { role: "system", content: `ESEMPI VINCOLANTI (tono/ritmo):\n- ${FEWSHOT_WTF[0]}\n- ${FEWSHOT_WTF[1]}\n- ${FEWSHOT_WTF[2]}` }
    );
  } else {
    if (mode === "analitico") {
      msgs.push(
        { role: "system", content: whatIfAnaliticoRule() },
        { role: "system", content: `ESEMPIO:\n${WHATIF_ANALITICO_RX}` },
      );
    } else {
      msgs.push(
        { role: "system", content: whatIfPoeticoRule() },
        { role: "system", content: `ESEMPIO:\n${WHATIF_POETICO_RX}` },
      );
    }
  }
  msgs.push({
    role: "user",
    content: `Domanda (non ripeterla): "${domanda}". Genera UNA risposta in ITALIANO a paragrafo unico.`,
  });
  return msgs;
}

/* ========= Guardie poetiche ========= */
const ANALYTIC_RX = /\b(costi|benefici|costo|beneficio|budget|percentuali?|margini?|economia|pil|inflazione|affitt[i|o]|stipend[i|o]|benchmark|metriche|analisi|trade[- ]?off|contesto|iniziativ[ae]|prezzi?|spesa|risparmi|spese|kpi|roi)\b/gi;
function softenAnalyticLexicon(s){
  // rimpiazzi morbidi per far suonare quotidiano
  return s.replace(ANALYTIC_RX, (m) => ({
    costi:"spigoli", benefici:"comodità", costo:"spigolo", beneficio:"comodità",
    budget:"misura", percentuale:"parte", percentuali:"parti",
    margini:"bordi", economia:"ritmo", pil:"ritmo", inflazione:"fiato corto",
    affitti:"case", affitto:"casa", stipendi:"paghe", stipendio:"paga",
    benchmark:"paragoni", metriche:"misure", analisi:"sguardo",
    "trade off":"scambio", "trade-off":"scambio", contesto:"intorno",
    iniziativa:"gesto", iniziative:"gesti", prezzo:"prezzo", prezzi:"prezzi",
    spesa:"spesa", spese:"spese", risparmi:"di lato", kpi:"misure", roi:"ritorno"
  }[m.toLowerCase()] || "respiro"));
}
function enforcePoeticForm(text){
  // frasi più corte e musicali
  let t = text.replace(/,\s+/g, ". ").replace(/\s{2,}/g, " ");
  // togli eventuale eco analitica residua
  t = softenAnalyticLexicon(t);
  // incipit garantito
  if (!/^ *Bella questa, Luca\./i.test(t)) t = "Bella questa, Luca. " + t;
  return t;
}

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "missing_api_key" });

    const ip = (
      req.headers["x-forwarded-for"] ||
      req.socket?.remoteAddress ||
      "unknown"
    )
      .toString()
      .split(",")[0]
      .trim();
    const { success } = await rl.limit(`ask:${ip}`);
    if (!success) return res.status(429).json({ error: "rate_limited_minute" });

    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const {
      domanda = "",
      stile = "whatif",         // "whatif" | "wtf"
      mode = "analitico",       // per whatif: "analitico" | "reale"
      periodo = "future",
    } = body;

    if (!domanda || typeof domanda !== "string")
      return res
        .status(400)
        .json({ error: "bad_request", detail: "domanda_required" });

    const messages = buildMessages({ domanda, periodo, stile, mode });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : (mode === "analitico" ? 0.82 : 0.86),
      top_p: 0.92,
      max_tokens: 520,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // Post-process comune
    answer = stripQuestionEcho(domanda, answer);
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 10);
    answer = clampWords(answer, stile === "wtf" ? 170 : 165);
    answer = normalizeOneParagraph(answer);

    if (stile === "wtf") {
      // no insulti hard; max due !!
      answer = answer
        .replace(/!{3,}/g, "!!")
        .replace(/\b(cazzo|cazzata|stronzo|idiota|cretino|imbecille)\b/gi, "accidente");
      // se manca alcol, aggiungi sorso
      if (!/\b(grappa|amaro|rosso|vino|spritz|negroni|whisky|rum|birra|calice|goccio|dito|brindisi)\b/i.test(answer)) {
        answer = finalPunct(answer) + " Ti versi un goccio di amaro e il mondo si rimette in riga.";
      }
    } else if (mode !== "analitico") {
      // Poetico/Reale guardie
      answer = enforcePoeticForm(answer);
    }

    // No prima persona forte (leggera) per coerenza tono
    answer = answer.replace(/\b(io|sono|mi|noi|me|ho|abbiamo)\b/gi, "");

    // Evita nomi non presenti nella domanda (solo parole proprie)
    (function () {
      const d = S(domanda);
      const nameRx = /\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion = new Set(d.match(nameRx) || []);
      answer = answer.replace(nameRx, (m) =>
        inQuestion.has(m)
          ? m
          : ["Ah", "Oh", "Ehi", "Bella", "Sai"].includes(m)
          ? m
          : m.toLowerCase()
      );
    })();

    answer = ensureSentenceCase(answer);
    answer = finalPunct(answer);

    return res
      .status(200)
      .json({ answer, style: stile, mode, periodo, model: MODEL });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res
      .status(500)
      .json({ error: "server_error", detail: String(err?.message || err) });
  }
}
