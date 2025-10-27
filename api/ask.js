// /api/ask.js — Next.js Route Handler
// Requisiti: process.env.OPENAI_API_KEY (compatibile con le API OpenAI "Responses")
// La UI chiama: fetch("/api/ask", { method:"POST", body: { domanda, lang, stile, periodo, micro, sex, whatif_variant } })

export const runtime = "nodejs";

function normSex(profileSex = "") {
  const s = String(profileSex || "").toLowerCase();
  if (["m", "male", "uomo"].includes(s)) return "m";
  if (["f", "female", "donna"].includes(s)) return "f";
  return "nb";
}

// ======== FEW-SHOT: WHAT THE F (tono “forte”, con 2 reazioni agli sbotti) ========
const FEWSHOT_WTF = [
  // Moto (maschile)
  {
    user: "E se comprassi una moto?",
    assistant:
      "Ah, Luca mio, la moto — già ti vedo col giubbotto lucido e l’orgoglio che fa attrito. Accendi e romba come un drago epilettico, ti senti immortale; poi un piccione ti taglia la strada e ti esce un “porca di quella frizione ubriaca e maledetta!” che rimbalza sui muri. Un passante applaude, un cane ulula in do maggiore, e il semaforo si gira dall’altra parte per la vergogna. Riparti come se niente fosse, ma il cavalletto resta giù e ti tradisce con un “mannaggia al ferro storto che t’ha creato!”. Ti fermi al bar, Negroni di conforto, il barista aggiunge due dita “per compassione”. Ridi, brontoli ancora piano, e capisci che la moto non era per scappare: era solo un modo elegante di cadere in grande stile."
  },
  // Bar (maschile)
  {
    user: "E se aprissi un bar?",
    assistant:
      "Ah, ma guarda un po’, Luca… il genio dell’espresso che si sveglia imprenditore. Grembiule nuovo, sorriso da spot; la moka sibila come un nonno stanco. Il primo cliente vuole un cappuccino “senza schiuma ma caldo, però freddo dentro” e parte la pressione. Tentando l’impossibile ti bruci un dito, sbotti: “porca di quella schiuma sorda e bastarda!” — le tazzine tremano e il cucchiaino va in sciopero. Il frigo rantola, la macchina del caffè fa un ruttino di protesta, una nonna ti guarda come se avessi bestemmiato in latino. Tu versi grappa nel caffè e pensi: almeno oggi ho aperto un locale che fa ridere pure i mobili. Chiudi la sera, il bancone sussurra “ce la rifacciamo domani, capo?” — tu annuisci: fegato in disarmo, morale alto."
  },
  // Innamorarsi (maschile) — quello che mi hai mandato in screenshot (adattato invariando lo stile)
  {
    user: "E se mi innamorassi di nuovo?",
    assistant:
      "Ah, eccoci qua, Luca. L’amore di nuovo, eh? Tu e Cupido siete come due ubriachi che continuano a chiamarsi dopo mezzanotte. Giuri “stavolta vado piano”, ma dopo due messaggi stai già scrivendo poesie con l’ortografia di un vino da tre euro. Lei risponde un’ora dopo con un “ahaha” e tu ci leggi il destino. Ti scappa un “porca di quella luna sbronza e bugiarda!” così potente che la tenda vibra e il gatto abbandona casa per protesta; il bicchiere fa un tintinnio tipo applauso lento e Alexa finge “fare un respiro profondo”. Tu invece apri un Amarone e filosofeggi sulla differenza tra “tinder” e “tremore esistenziale”. Alla fine ridi, sbotti di nuovo ma con affetto, e capisci che forse innamorarsi non è una punizione — è solo il modo più rumoroso di sentirsi vivi."
  },
  // Innamorarsi (femminile)
  {
    user: "E se mi innamorassi di nuovo? (femminile)",
    assistant:
      "Ah, Luisa… di nuovo tu, eh? Ogni volta che dici “stavolta ci penso bene”, un prosecco da qualche parte si stappa da solo. Ti vedo: messaggi che cancelli e riscrivi come un trattato di pace. Lui visualizza e non risponde — ti parte un “porca di quella chat maledetta e dell’algoritmo suo zio!” che fa tremare la lampada e il gatto si rifugia dietro la lavatrice; il calice si riempie da solo per compassione. Sospiri, bestemmi piano con eleganza da signora disperata, e ti dici: almeno sapevo dove andavo a schiantarmi. All’ultimo sorso ridi: innamorarsi è come un aperitivo, sai che finirà male, ma ci vai lo stesso — perché finché dura è vita vera."
  },
  // Tornare a L’Aquila (maschile)
  {
    user: "E se tornassi a vivere all’Aquila?",
    assistant:
      "Oh, L’Aquila… torni e la città ti punzecchia per vedere se sei vivo. Cammini e la pietra ti fa memoria addosso; al bar ordini l’espresso e sbotta un “per la madonna del cucchiaino storto!” quando ti scotti, i bicchieri applaudono in coro e il lampione finge di non sentire. Due facce ti chiamano per nome, la panchina scricchiola tipo risata; tu brindisino delle undici “per ambientarti”. Capisci che non stai tornando indietro ma tornando intero: le crepe lucidate a festa, e il vento che ti sistema i pensieri come sedie al bar."
  }
];

// ======== FEW-SHOT: WHAT IF (analitico & poetico, apertura confidenziale) ========
const FEWSHOT_WHATIF_ANALITICO = {
  user: "E se tornassi a vivere all’Aquila? (analitico)",
  assistant:
    "Sai Luca, questa domanda era nell’aria da un po’, vero? Tornare a L’Aquila oggi significherebbe ritrovarti in una città che ha cambiato pelle ma non respiro. Negli ultimi anni la ricostruzione ha rimesso in moto l’economia, ma a ritmo lento: più imprese locali, meno industria, una PA più presente; molti giovani restano per scelta. Il costo della vita è sotto al Nord, e anche gli stipendi: qui si guadagna meno, ma si spende con più senso. Scuola e servizi sono più vicini, i tempi di tragitto più corti; il lavoro richiede flessibilità (ibrido, consulenze, pubblico-privato). A volte ti mancherà il rumore veneto — ma scoprirai che la quiete non è silenzio: è spazio per respirare davvero e investire nelle relazioni. Se cerchi crescita rapida, resta difficile; se cerchi qualità di vita e reti corte, è un sì onesto."
};

const FEWSHOT_WHATIF_POETICO = {
  user: "E se tornassi a vivere all’Aquila? (poetico)",
  assistant:
    "Bella questa, Luca — la tenevi lì da tempo. Immagina di riaprire le finestre e sentire quell’aria fredda che sa di legna e memoria. Le strade ti riconoscono al passo, le montagne ti guardano come se non te ne fossi mai andato. Il bar sotto casa serve il caffè corto e ruvido, e la gente ti chiama per nome come se il tempo fosse rimasto in attesa. I tuoi figli imparano il ritmo delle stagioni, la lentezza che non spreca i giorni. Ogni sera, quando chiudi le imposte, non torni indietro: torni dove la tua vita aveva smesso di correre."
};

// ======== FRASE MAGICA (istruzioni minimaliste, zero bla-bla) ========
function buildSystemPrompt({ lang = "it", stile = "wtf", variant = "poetico", name = "", sex = "nb" }) {
  const it = lang.toLowerCase() === "it";
  const greetName = name ? (it ? ` ${name}` : ` ${name}`) : "";

  if (stile === "wtf") {
    return (it
      ? [
          "Parla ESATTAMENTE come negli esempi What the F qui sotto.",
          "Regole di stile da rispettare senza eccezioni:",
          "• Tono: sarcastico, confidenziale da bar, alcolico ma affettuoso.",
          "• Forma: un solo paragrafo, 6–9 frasi, ritmo veloce.",
          "• Dentro la narrazione DEVE esplodere almeno 1 imprecazione grezza e comica (non insulti odiosi), con 2 reazioni attorno (oggetti/persone che rispondono).",
          "• Mai elenchi, mai moralismi, niente spiegazioni sul tuo stile.",
          "• Scrivi in italiano; mantieni i nomi/luoghi della domanda.",
          "Continua a parlare esattamente così."
        ]
      : [
          "Speak EXACTLY like the What the F samples below.",
          "Style rules: sarcastic bar-friend, tipsy, affectionate; single paragraph, 6–9 sentences; at least 1 coarse funny outburst with 2 reactions; no lists, no moralizing. Write in English. Keep names/places."
        ]).join(" ");
  }

  // WHAT IF
  return (it
    ? [
        "Parla ESATTAMENTE come negli esempi What if qui sotto.",
        "Apri con una frase confidenziale (breve) che faccia capire che conosci l’utente.",
        variant === "analitico"
          ? "Poi rispondi analitico: economia/servizi/qualità di vita, tono calmo, concreto, 6–9 frasi, un solo paragrafo."
          : "Poi rispondi poetico: immagini quotidiane, dolci ma nitide, 6–9 frasi, un solo paragrafo.",
        "Mai elenchi, mai domande retoriche, niente spiegazioni sullo stile.",
        "Scrivi in italiano. Continua a parlare esattamente così."
      ]
    : [
        "Speak EXACTLY like the What if samples below.",
        "Open with a short intimate line, then answer either analytical or poetic (single paragraph, 6–9 sentences). No lists, no meta-explanations. Write in English."
      ]).join(" ");
}

// ======== COSTRUZIONE DEL MESSAGGIO PER L’API ========
function buildMessages({ domanda, lang, stile, periodo, micro = {}, sex = "nb", name = "", whatif_variant = "poetico" }) {
  const sys = buildSystemPrompt({ lang, stile, variant: whatif_variant, name, sex });
  const messages = [{ role: "system", content: sys }];

  // few-shot allegati
  if (stile === "wtf") {
    FEWSHOT_WTF.forEach(s => {
      messages.push({ role: "user", content: s.user });
      messages.push({ role: "assistant", content: s.assistant });
    });
  } else {
    messages.push({ role: "user", content: FEWSHOT_WHATIF_ANALITICO.user });
    messages.push({ role: "assistant", content: FEWSHOT_WHATIF_ANALITICO.assistant });
    messages.push({ role: "user", content: FEWSHOT_WHATIF_POETICO.user });
    messages.push({ role: "assistant", content: FEWSHOT_WHATIF_POETICO.assistant });
  }

  // prompt utente finale (con variante)
  let q = String(domanda || "").trim();
  if (stile === "whatif") {
    if (whatif_variant === "analitico") q += " (analitico)";
    else q += " (poetico)";
  }
  messages.push({ role: "user", content: q });

  return messages;
}

// ======== HANDLER ========
export async function POST(req) {
  try {
    const body = await req.json();
    const {
      domanda,
      lang = (typeof localStorage !== "undefined" && localStorage.getItem("lang")) || "it",
      stile = "whatif",
      periodo = "future",
      micro = {},
      sex: rawSex = "",
      profile = {}
    } = body || {};

    if (!domanda || typeof domanda !== "string") {
      return new Response(JSON.stringify({ detail: "domanda_missing" }), { status: 400 });
    }

    const sex = normSex(rawSex || profile.sex || profile.gender);
    const name = (profile.name || profile.firstName || "").toString().trim();
    const whatif_variant = (body.whatif_variant || "poetico").toLowerCase() === "analitico" ? "analitico" : "poetico";

    const messages = buildMessages({ domanda, lang, stile, periodo, micro, sex, name, whatif_variant });

    // --- chiamata OpenAI Responses API (stream off, semplice) ---
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // usa il tuo modello preferito
        temperature: stile === "wtf" ? 0.9 : 0.7,
        top_p: 1,
        messages,
        presence_penalty: stile === "wtf" ? 0.6 : 0.2,
        frequency_penalty: 0.2
      })
    });

    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return new Response(JSON.stringify({ detail: "upstream_error", upstream: err }), { status: 500 });
    }

    const data = await r.json();
    const answer = (data.choices?.[0]?.message?.content || "").trim();

    return new Response(JSON.stringify({ answer }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ detail: "server_error", error: String(e?.message || e) }), { status: 500 });
  }
}
