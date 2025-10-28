// /api/ask.js — CLEAN COPY MODE (no personas, only example-templates)
// IT/EN — singolo paragrafo. Vietato eco della domanda.
// What If: incipit obbligatori. WTF: nickname secco + 1 sola bestemmia narrata (non letterale).

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ------------------ Utils ------------------ */
function oneParagraph(s=""){
  return String(s).replace(/\s*\n+\s*/g," ")
    .replace(/\s{2,}/g," ").replace(/\s+([.,;:!?…])/g,"$1").trim();
}
function stripEcho(q, t){
  const dq = String(q||"").toLowerCase().replace(/[“”"']/g,"").trim();
  let out = String(t||"");
  const lead = out.slice(0, Math.min(out.length, dq.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
  if (lead.startsWith(dq)) {
    const cut = out.indexOf(".");
    if (cut>-1) out = out.slice(cut+1).trim();
  }
  out = out.replace(/^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i,"");
  return out;
}
function clampSentences(t, minS, maxS){
  const parts = t.split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
  const sliced = parts.slice(0, Math.max(minS, Math.min(maxS, parts.length)));
  let out = sliced.join(" ");
  if(!/[.!?…]$/.test(out)) out += ".";
  return out;
}
function ensureOneBlasphemyNarrated(text){
  // inserisce SE MANCANTE una “bestemmia” narrata non letterale
  const has = /\b(bestemmi\w*|bestemmia|bestemmiata|bestemmione)\b/i.test(text);
  if (has) return text;
  const add = " ti scappa una bestemmiata che fa vibrare i bicchieri";
  // prova a inserirla verso la 3ª–4ª frase
  const parts = text.split(/(?<=[.!?…])\s+/);
  const idx = Math.min(3, Math.max(1, parts.length-2));
  parts[idx] = (parts[idx]||"").replace(/[.!?…]$/, "") + "," + add + ".";
  return parts.join(" ");
}
function forceWhatIfOpening(text, mode, lang){
  const incipitIT = mode==="analitico"
    ? ["Sai Luca, questa domanda girava nell’aria da un po’.",
       "Te la stavi chiedendo da tempo, e ora ci metti ordine.",
       "Messa così, è semplice: guardi i fatti e ti ascolti."]
    : ["Bella questa, Luca — me l’aspettavo da te.",
       "Riapri le finestre e l’aria ti saluta come una vecchia conoscenza.",
       "Ti fermi un attimo: la città ti riconosce dal passo."];
  const incipitEN = mode==="analitico"
    ? ["You’ve been circling this for a while.",
       "Put it plainly: look at facts and listen to yourself.",
       "It’s been in the air; now you line it up."]
    : ["Nice one — I saw this coming.",
       "You open the windows and the air nods back.",
       "You pause: the city remembers your step."];
  const bank = (lang||"it").startsWith("en") ? incipitEN : incipitIT;
  const first = bank[(Math.random()*bank.length)|0];
  // se già inizia bene, lascia; altrimenti premetti
  const startsGood = new RegExp("^(" + bank.map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|") + ")").test(text);
  return startsGood ? text : `${first} ${text}`;
}
function forceWTFOpeningWithNickname(text, lang){
  const poolIT = ["campione", "leggenda", "capitano del caos", "fenomeno", "poeta del bar", "asso"];
  const poolEN = ["champ", "legend", "captain of chaos", "ace", "icon"];
  const nick = (lang||"it").startsWith("en")
    ? poolEN[(Math.random()*poolEN.length)|0]
    : poolIT[(Math.random()*poolIT.length)|0];
  // se già inizia con parola singola + virgola, lascia
  const ok = /^[A-Za-zÀ-ÿ'’`]+(?:\s+[A-Za-zÀ-ÿ'’`]+)*,/.test(text);
  return ok ? text : `${nick}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}
function reactingObjectsHint(lang){
  return (lang||"it").startsWith("en")
    ? "Add 1–2 quick ‘reacting objects’ beats only if they fit the scene (e.g., the lamp flickers, the glasses rattle)."
    : "Aggiungi 1–2 ‘oggetti che reagiscono’ solo se servono davvero alla scena (es. il lampione sfarfalla, i bicchieri tremano).";
}

/* ------------------ Few-shot packs (SOLO esempi) ------------------ */
// What If — Analitico (il tuo)
const WHF_ANALITICO_IT = `Domanda: E se tornassi a vivere all’Aquila?
Sai Luca, questa domanda girava nell’aria da un po’. Tornare a L’Aquila oggi vorrebbe dire rimetterti in una città che ha ricostruito più di muri: ha ricucito abitudini. L’economia si muove piano ma tiene, più artigiani che industrie, più reti locali che multinazionali. Gli stipendi sono più bassi, ma la vita costa meno e il tempo vale di più. Le scuole funzionano, la montagna torna complice nelle domeniche lente, e i bambini crescono con un orizzonte vero invece di uno schermo. Il Veneto ti mancherebbe per il ritmo e le occasioni, ma qui ritroveresti spazio, fiato e relazioni che non devono correre per esistere. In fondo non sarebbe un passo indietro — solo un modo diverso di avanzare, più lento, ma più tuo.`;

// What If — Reale/Poetico (il tuo definitivo)
const WHF_REALE_IT = `Domanda: E se tornassi a vivere all’Aquila?
Bella questa, Luca — me l’aspettavo da te. Riapri le finestre e l’aria fredda ti saluta come una vecchia conoscenza. I vicoli ti riconoscono dal passo, le montagne ti guardano come un’amante che non ha mai smesso di aspettare. Il bar sotto casa serve ancora il caffè corto e ruvido, e le voci per strada sanno di pane e di inverno. I bambini giocano con l’eco, non con il rumore, e le serate finiscono con una risata che rimbalza nei portoni. Ogni giorno è più semplice del precedente, ogni sera più tua. Non stai tornando indietro: stai solo tornando dove il tempo ti riconosce per nome.`;

// WTF — tre esempi tuoi (bar/moto/amore)
const WTF_IT = [
`☕ E se aprissi un bar?
Ah ma guarda te, Luca… quello che crede che la moka porti la pace nel mondo. Ti svegli col grembiule stirato e il sorriso da imprenditore, poi arriva il primo cliente e ti chiede un “latte tiepido con schiuma che non sa di latte”. Ti parte un “porca di quella bestemmia santa del vapore infame!” che fa tremare i bicchieri come in un terremoto spirituale, la macchina del caffè sputa vendetta e il frigorifero tossisce. Ti versi un goccio di liquore per calmare i santi e giuri che domani apri un bar solo per matti; alla chiusura il bancone ti guarda e tu sussurri: oggi ho bestemmiato più del prete quando finisce il vino — ma almeno ho servito verità calde.`,
`🏍️ E se comprassi una moto?
Oh, eccoci, centauro dell’inferno! Casco lucido, cuore impavido, orgoglio pronto all’incidente. Parti, la libertà ti accarezza… poi un’ape decide che il tuo collo è il suo destino, e ti scappa un “bestemmione che spacca l’aria!”; il semaforo passa al rosso per rispetto e un cane cambia marciapiede da solo. Ti fermi, respiri, bestemmi di nuovo ma con affetto, rito purificatore; al bar ordini da bere “per lavare via la bestemmia” e il barista ti serve doppio, complice. Torni a casa con l’eco del motore e della tua voce — sinfonia di libertà e bestemmie ben calibrate.`,
`💘 E se mi innamorassi di nuovo?
Ah, Luisa… ti butti nel cuore come in un pozzo vuoto e poi ti lamenti dell’eco. Lui ti visualizza, poi sparisce, e ti sale un “madonna della miseria impestata!” che fa sfarfallare la lampada e applaudire il bicchiere. Il gatto scappa, Alexa finge un aggiornamento, e tu bestemmi a mezza voce come fosse una preghiera sbagliata. Poi un sorso di rosso e la confessione: ogni storia finisce con una bestemmia e un brindisi — ma almeno bevo meglio di come amo.`
];

/* ------------------ Handler ------------------ */
export default async function handler(req,res){
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error:"method_not_allowed" });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

  try{
    const body = typeof req.body === "string" ? JSON.parse(req.body||"{}") : (req.body||{});
    const { domanda="", stile="whatif", mode="reale", periodo="future", lang="it", micro={} } = body;
    if (!domanda) return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    // Selezione pacchetto esempi
    const messages = [];
    const baseRule = (lang||"it").startsWith("en")
      ? `COPY THE EXAMPLES’ SHAPE ONLY. Start like the examples, develop like them, end like them. One paragraph. No lists, no questions, no emojis. Do NOT restate the question. Use fresh wording.`
      : `COPIA SOLO LA FORMA DEGLI ESEMPI. Inizia come negli esempi, sviluppa come negli esempi, chiudi come negli esempi. Un solo paragrafo. Niente elenchi, niente domande, niente emoji. NON ripetere la domanda. Usa parole/frasi nuove.`;
    messages.push({ role:"system", content: baseRule });

    if (stile === "whatif") {
      // carica few-shot giusto in base al sotto-stile
      if (mode === "analitico") {
        messages.push({ role:"system", content: WHF_ANALITICO_IT });
      } else {
        messages.push({ role:"system", content: WHF_REALE_IT });
      }
    } else {
      // WTF: mettiamo tutti e tre gli esempi
      WTF_IT.forEach(ex => messages.push({ role:"system", content: ex }));
      messages.push({ role:"system", content: reactingObjectsHint(lang) });
      messages.push({ role:"system", content:
        (lang||"it").startsWith("en")
          ? `Include exactly one brief, narrated blasphemy (never literal), with playful morphology (e.g., "mini-blasphemy").`
          : `Inserisci esattamente UNA breve bestemmia narrata (mai letterale), con morfologia giocosa (“bestemmietta”, “bestemmiata”, “bestemmione”).`
      });
      messages.push({ role:"system", content:
        (lang||"it").startsWith("en")
          ? `OPENING MUST BE ONLY a short nickname (e.g., "champ, …").`
          : `L'APERTURA DEVE ESSERE SOLO un soprannome secco (es. "campione, …").`
      });
    }

    // Prompt utente “vuoto” (non chiediamo tono o ruoli)
    const up = (lang||"it").startsWith("en")
      ? `Question (do not restate): "${domanda}". Context (you may use lightly): ${JSON.stringify(micro)}.`
      : `Domanda (non ripeterla): "${domanda}". Contesto (usalo se serve): ${JSON.stringify(micro)}.`;
    messages.push({ role:"user", content: up });

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile==="wtf" ? 0.95 : 0.75,
      top_p: 0.9,
      max_tokens: 360,
      messages
    });

    let out = completion?.choices?.[0]?.message?.content || "";
    out = stripEcho(domanda, out);
    out = oneParagraph(out);

    if (stile === "whatif") {
      // incipit obbligatorio + 8–11 frasi
      out = forceWhatIfOpening(out, mode, lang);
      out = clampSentences(out, 8, 11);
      if(!/[.!?…]$/.test(out)) out += ".";
    } else {
      // nickname secco + 6–8 frasi + una sola bestemmia narrata
      out = forceWTFOpeningWithNickname(out, lang);
      out = ensureOneBlasphemyNarrated(out);
      // rimuovi eventuali seconde bestemmie
      out = out.replace(/\b(bestemmi\w*|bestemmia|bestemmiata|bestemmione)\b/ig, (m, offset, str) => {
        // mantiene SOLO la prima occorrenza
        const first = str.toLowerCase().indexOf(m.toLowerCase());
        return (offset===first) ? m : "sospirone";
      });
      out = clampSentences(out, 6, 8);
      if(!/[.!?…]$/.test(out)) out += ".";
    }

    return res.status(200).json({
      answer: out,
      style: stile,
      mode,
      lang,
      periodo,
      model: MODEL
    });

  }catch(err){
    console.error("ask error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
}
