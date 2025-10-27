// /api/ask.js
// Handler a singolo endpoint che costruisce prompt few-shot "bloccato"
// per far parlare l'AI ESATTAMENTE come negli esempi concordati.
// Compatibile con la tua UI (fourth/fifth). Nessuna dipendenza extra.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ detail: "Method not allowed" });
  }

  try {
    // ===== INPUT DALLA UI =====
    const {
      domanda = "",
      lang = "it",
      stile = "whatif",         // 'whatif' | 'wtf'
      periodo = "future",       // 'past' | 'future' (solo meta)
      micro = {},               // micro-profile (umore, ancore, ecc.)
      extra = {},               // in fourth passa whatif_mode qui dentro
      sex = "",                 // 'm' | 'f' | 'nb' | ''
      whatif_mode,              // opzionale: 'analitico' | 'poetico'
      profile = {}              // opzionale: { name }
    } = safeParse(req.body);

    // Deduce il nome utente (solo se presente)
    const rawName =
      (profile && (profile.name || profile.firstName)) ||
      (micro && micro.name) ||
      "";
    const firstName = String(rawName || "").trim().split(" ")[0] || "";

    // Fourth: può passare il mode dentro extra o a livello root.
    const mode =
      (extra && (extra.whatif_mode || extra.mode)) ||
      whatif_mode ||
      "analitico";

    // ===== FEW-SHOT BANK (ITALIANO) =====
    // NOTA: niente regole astratte; solo ESEMPI.
    // Il modello viene istruito a "continuare la serie con la stessa voce".
    const FEWSHOT_WHATIF_ANALITICO = [
      {
        role: "system",
        content:
          "Stai per rispondere in stile WHAT IF (analitico, realistico, sociale). Parla in un paragrafo, tono confidente e concreto. Niente elenchi, niente emoji. Se è presente un nome, puoi salutarlo all'inizio. Continua esattamente questa voce."
      },
      {
        role: "user",
        content: "E se tornassi a vivere all’Aquila?"
      },
      {
        role: "assistant",
        content:
          "Sai Luca, questa domanda era nell’aria da un po’, vero? Tornare a L’Aquila oggi significherebbe ritrovarti in una città che ha cambiato pelle ma non respiro. Negli ultimi anni la ricostruzione ha rimesso in moto l’economia, ma a ritmo lento: più imprese locali, meno industria, molti giovani che restano per scelta, non più per mancanza di alternative. Il costo della vita è più basso del Nord, e anche gli stipendi lo sono: qui si guadagna meno, ma si spende con più senso. Il tempo si dilata, le relazioni contano più dei contatti, e la montagna torna bussola. A volte ti mancherebbe il rumore del Veneto — ma scoprirai che la quiete non è silenzio: è spazio per respirare davvero."
      }
    ];

    const FEWSHOT_WHATIF_POETICO = [
      {
        role: "system",
        content:
          "Stai per rispondere in stile WHAT IF (poetico, emotivo). Parla in un paragrafo, immagini quotidiane, chiusura morbida. Niente elenchi, niente emoji. Se è presente un nome, puoi salutarlo all'inizio. Continua esattamente questa voce."
      },
      {
        role: "user",
        content: "E se tornassi a vivere all’Aquila?"
      },
      {
        role: "assistant",
        content:
          "Bella questa, Luca — lo sentivi da tempo, vero? Riapri le finestre e ti viene incontro un’aria fredda che sa di legna e memoria. Le strade ti riconoscono al passo, le montagne ti guardano come se non te ne fossi mai andato. Il bar sotto casa serve ancora un caffè corto e ruvido, e la gente ti chiama per nome come se il tempo fosse rimasto ad aspettare. I tuoi figli imparano il ritmo delle stagioni, la lentezza che non spreca i giorni. Ogni sera, quando chiudi le imposte, non stai tornando indietro: stai tornando dove la tua vita aveva smesso di correre."
      }
    ];

    // WHAT THE F: sarcasmo da bar, immagini fisiche, imprecazioni comiche organiche
    // (senza termini offensivi verso gruppi/credenze; solo “sacramenti” laici & coloriti)
    const FEWSHOT_WTF = [
      {
        role: "system",
        content:
          "Stai per rispondere in stile WHAT THE F (demenziale, sarcastico da bar, ritmo alto). Un paragrafo unico, presa in giro affettuosa dell’utente e della domanda, oggetti che reagiscono, 1–2 imprecazioni colorite integrate nella narrazione (mai gratuite), con reazioni comiche dell’ambiente. Niente elenchi, niente emoji. Continua esattamente questa voce."
      },
      {
        role: "user",
        content: "E se comprassi una moto?"
      },
      {
        role: "assistant",
        content:
          "Ah, la moto: già ti vedo filosofo della velocità con la giacca nuova e la paura di graffiarla. Parti fiero, curva stretta, sorriso largo… poi un moscerino sceglie il tuo incisivo come pista d’atterraggio e ti scappa un “porca di quella grappa fulminata”, il casco vibra offeso e il semaforo ride con tre rossi di fila. Al bar ordini un Negroni per lavare l’orgoglio, il conto ti guarda storto e tu annuisci come chi ha capito la vita a rate. Torni a casa con più vento che chilometri e pensi che forse non serviva scappare: bastava ricordarsi come si respira forte."
      },
      {
        role: "user",
        content: "E se mi innamorassi di nuovo?"
      },
      {
        role: "assistant",
        content:
          "Certo che sì, romantico di professione: dici “vado piano” e già al secondo sguardo sei telenovela ambulante. Scrivi, cancelli, inoltri sul gruppo sbagliato e ti parte un “maledetta la porcaccia dell’ansia” così rotondo che il bicchiere vibra e fa l’applauso. Il barista sospira, ti raddrizza il cuore con un giro della casa e ti placa con due olive come se fossero terapia. Finisce che ridi di te stesso, e in quella risata capisci che tornare a rischiare è l’unica rivoluzione che funziona."
      }
    ];

    // ===== COSTRUZIONE MESSAGGI =====
    const userHeader =
      lang === "it"
        ? [
            firstName
              ? `Ciao ${firstName}.`
              : "Ciao.",
            "Continua nella stessa voce degli esempi.",
            "Rispondi in un solo paragrafo."
          ].join(" ")
        : [
            firstName ? `Hi ${firstName}.` : "Hi.",
            "Continue in the exact voice of the examples.",
            "One single paragraph."
          ].join(" ");

    const messages = [];

    // Scegli il blocco few-shot
    if (stile === "whatif") {
      const bank =
        (mode || "").toLowerCase() === "poetico"
          ? FEWSHOT_WHATIF_POETICO
          : FEWSHOT_WHATIF_ANALITICO;
      messages.push(...bank);
    } else {
      messages.push(...FEWSHOT_WTF);
    }

    // Prompt utente effettivo (con meta utili ma leggere)
    const metaBits = [];
    if (periodo) metaBits.push(`periodo:${periodo}`);
    if (sex) metaBits.push(`sex:${sex}`);
    if (micro && typeof micro === "object") {
      try {
        const mview = summarizeMicro(micro);
        if (mview) metaBits.push(`micro:${mview}`);
      } catch {}
    }

    const finalUserPrompt =
      `${userHeader} Domanda: ${normalize(domanda)}.` +
      (metaBits.length ? ` [${metaBits.join(" · ")}]` : "");

    messages.push({ role: "user", content: finalUserPrompt });

    // ===== CHIAMATA MODELLO =====
    const answer = await callOpenAI(messages, stile);

    // Normalizza a un paragrafo e chiudi il punto.
    const clean = oneParagraph(answer);

    return res.status(200).json({ answer: clean });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ detail: "server_error" });
  }
}

/* ================== UTILS ================== */

function safeParse(body) {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body || {};
}

function normalize(s = "") {
  return String(s).trim().replace(/\s+/g, " ");
}

function oneParagraph(s = "") {
  const t = normalize(s).replace(/\s*\n+\s*/g, " ");
  return /[.!?…]$/.test(t) ? t : t + ".";
}

function summarizeMicro(m = {}) {
  const keys = ["mood", "anchor", "decide", "zodiac"];
  const parts = [];
  keys.forEach((k) => {
    if (m[k]) parts.push(`${k}:${String(m[k]).trim()}`);
  });
  return parts.join(",");
}

/**
 * Chiama OpenAI con impostazioni diverse per stile:
 * - whatif: temperatura bassa, più coesione
 * - wtf: temperatura medio-alta, più verve
 */
async function callOpenAI(messages, stile) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_AZURE;
  if (!apiKey) {
    // Fallback per sviluppo offline
    return "(Dev) Nessuna chiave API configurata.";
  }

  const temperature = stile === "wtf" ? 0.9 : 0.5;
  const max_tokens = 380; // sufficiente per un paragrafo pieno

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature,
      max_tokens,
      messages
    })
  });

  const data = await r.json();
  if (!r.ok) {
    console.error("OpenAI error:", data);
    throw new Error(data?.error?.message || "openai_error");
  }
  const txt =
    data?.choices?.[0]?.message?.content?.trim() ||
    "[errore generazione testo]";
  return txt;
}
