// /pages/api/ask.js
// Endpoint unico per generare risposte What if / What the F
// Dipendenze: una variabile d'ambiente OPENAI_API_KEY (o compatibile con il tuo provider)

import fetch from "node-fetch";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini"; // usa quello che preferisci

// ---------- Helpers ----------
function sanitize(s = "") {
  return String(s || "").trim();
}
function firstNonEmpty(...arr) {
  for (const v of arr) if (v && String(v).trim().length) return String(v).trim();
  return "";
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function shortNameFromProfile(profile = {}) {
  const n = firstNonEmpty(profile.firstName, profile.name);
  if (!n) return ""; // niente nomignoli
  // restituisce solo il nome proprio, senza cognome
  const parts = n.split(/\s+/).filter(Boolean);
  return parts[0] || "";
}
function leadConfidenziale(name, lang, mode) {
  // Aperture brevi, intime, senza nomignoli
  const it = {
    analitico: [
      name ? `Sai ${name}, questa domanda era nell’aria da un po’, vero?` :
             `Sai, questa domanda era nell’aria da un po’, vero?`,
      name ? `Ok ${name}, andiamo dritti: cosa cambierebbe davvero?` :
             `Ok, andiamo dritti: cosa cambierebbe davvero?`,
    ],
    poetico: [
      name ? `Bella questa, ${name} — te la tenevi da un po’, eh?` :
              `Bella questa — te la tenevi da un po’, eh?`,
      name ? `${name}, facciamo che apri la finestra e lasci entrare l’aria giusta.` :
              `Facciamo che apri la finestra e lasci entrare l’aria giusta.`,
    ],
  };
  const en = {
    analitico: [
      name ? `You know, ${name}, this question has been in the air for a while.` :
              `You know, this question has been in the air for a while.`,
    ],
    poetico: [
      name ? `Nice one, ${name} — been saving this, huh?` :
              `Nice one — been saving this, huh?`,
    ],
  };
  const bank = lang === "en" ? en : it;
  const bucket = bank[mode === "analitico" ? "analitico" : "poetico"];
  return pick(bucket);
}

const IMPRECATIONS_IT = [
  "porca di quella grappa fulminata",
  "maiala miseria",
  "per tutte le gomme sgonfie",
  "santa chiave inglese",
  "maledizione del carburatore",
  "acci del parabrezza",
  "per la miseria frizzante",
  "santi passanti",
  "per le patenti stracciate",
  "diamine del semaforo testardo",
];

function wtfStyleGuard(lang = "it") {
  // Istruzioni forti per fissare tono, ritmo e “mondo reattivo”
  const baseIT = `
PARLA COSÌ, SENZA DIVERGERE DAL TONO:
- Sarcastico, da barista/filosofo con mezzo bicchiere di troppo, ma affettuoso.
- Frasi vive, cinematografiche, in un solo paragrafo; ritmo medio-veloce.
- Inserisci 1–2 imprecazioni colorite (non offensive verso fedi o identità) scelte dal set fornito.
- L'imprecazione nasce DENTRO l'azione, non come parentesi a parte.
- Gli oggetti e le persone reagiscono: casco che vibra, bicchiere che ride, semaforo che trema, panchina che sbuffa, barista che commenta.
- Chiudi con una doppia mini-punchline: prima autoironica, poi tenera/pragmatica.

VIETATO:
- Nomignoli gratuiti per l’utente.
- Moralismi, spiegoni tecnici, liste puntate, emoji.
- Volgarità gratuite contro gruppi/fedi (usa solo imprecazioni creative “da bar”).
`;

  const baseEN = `
SPEAK LIKE THIS — DO NOT DIVERGE:
- Goofy-sarcastic, bar philosopher with one drink too many, but warm.
- Cinematic, single paragraph, medium-fast rhythm.
- 1–2 colorful exclamations (non-offensive), integrated INTO the action.
- Make objects react: helmet hums, glass laughs, traffic light shivers, bench grumbles, bartender comments.
- Close with a double mini-punchline: self-deprecating, then tender/pragmatic.
- No nicknames for the user, no moralizing, no bullet points, no emojis.
`;

  return lang === "en" ? baseEN : baseIT;
}

// Few-shot IT — fissano lo stile “perfetto”
const FEWSHOT_WTF_IT = [
  {
    role: "user",
    content: "E se comprassi una moto?",
  },
  {
    role: "assistant",
    content:
      "Ah, la moto, eh? Già ti vedo, casco lucido e petto gonfio come se stessi per salvare il mondo da solo. Parti fiero, il vento ti canta l’inno della libertà… finché un moscerino decide che il tuo dente è la pista d’atterraggio del secolo e ti scappa un “" +
      pick(IMPRECATIONS_IT) +
      "!”, così rotondo che il casco vibra indignato e il semaforo trema per la paura; ti fermi al bar per riprendere fiato, ordini un Negroni per lavare la dignità e il bicchiere ride, mentre il barista ti fa: “Campione, oggi la strada ti ha menato come un tamburo”; tu bevi, sospiri, e capisci che non serve correre per sentirti vivo — basta ridere, forte, come il motore quando finge di essere te.",
  },
  {
    role: "user",
    content: "E se mi innamorassi di nuovo?",
  },
  {
    role: "assistant",
    content:
      "Sicuro di volerci ricascare? All’inizio fai il saggio: passi lenti, messaggi pensati; al secondo sguardo sei già in telenovela, scrivi e cancelli fino a mandare tutto nel gruppo di calcetto; ti parte un “" +
      pick(IMPRECATIONS_IT) +
      "!” che fa vibrare il bicchiere e la sedia ride di te; il barista sospira, ti versa un altro giro “per il bene dell’arte”, e tu firmi: va come va, ma almeno qui si brinda — e non ti prendi troppo sul serio.",
  },
  {
    role: "user",
    content: "E se tornassi a vivere all’Aquila?",
  },
  {
    role: "assistant",
    content:
      "Torni e la pietra ti fa l’occhiolino, i vicoli ti riconoscono al passo; ordini un caffè, lo versi mezzo addosso, ti scappa un “" +
      pick(IMPRECATIONS_IT) +
      "!” e la tazzina applaude sfrontata; due volti ti chiamano per nome, una panchina sbuffa per farti spazio, e capisci che non stai andando indietro: ti stai rimontando addosso — crepe lucidate, cuore in pari, e la città che punge solo per sentire se sei vivo.",
  },
];

// Few-shot What if (IT) — analitico & poetico
const FEWSHOT_WHATIF_ANALITICO_IT = [
  {
    role: "user",
    content: "E se tornassi a vivere all’Aquila?",
  },
  {
    role: "assistant",
    content:
      "Sai, questa domanda era nell’aria da un po’, vero? Tornare oggi significherebbe rientrare in una città che ha cambiato pelle ma non respiro: ricostruzione avanzata ma lenta, tessuto economico più locale che industriale, opportunità crescenti in servizi, PA, ricerca e micro-impresa; costo della vita più basso del Nord ma stipendi mediamente inferiori; tempi più lunghi, relazioni più dense. Ti mancherebbe la velocità veneta, ma ritroveresti prossimità: nonni a portata, montagna come bussola, comunità concreta. In sintesi: meno corsa, più continuità — a patto di accettare ritmo e salari del territorio.",
  },
];

const FEWSHOT_WHATIF_POETICO_IT = [
  {
    role: "user",
    content: "E se tornassi a vivere all’Aquila?",
  },
  {
    role: "assistant",
    content:
      "Bella questa — te la tenevi da un po’, eh? Immagina di riaprire le imposte e far entrare l’aria fredda che sa di legna e memoria; le strade ti riconoscono al passo, le montagne ti guardano come se non fossi mai partito; il bar sotto casa serve ancora il caffè corto e ruvido, qualcuno ti chiama per nome come se il tempo avesse aspettato lì; i figli imparano il ritmo delle stagioni; e ogni sera, chiudendo piano, non ti sembra di tornare indietro ma di tornare dove la tua vita aveva smesso di correre.",
  },
];

// Inglese (ridotto) per compatibilità lingua
const FEWSHOT_WTF_EN = [
  {
    role: "user",
    content: "What if I bought a motorbike?",
  },
  {
    role: "assistant",
    content:
      "Helmet shining, chest heroic — you take off like a savior until a bug lands on your tooth and you blurt a colorful oath that makes the traffic light shiver; the glass laughs, bartender sighs, and you find out speed isn’t the point — laughing is.",
  },
];

const FEWSHOT_WHATIF_EN = [
  {
    role: "user",
    content: "What if I moved back to L’Aquila?",
  },
  {
    role: "assistant",
    content:
      "You know, this has been in the air for a while. Back there you’d trade pace for proximity: lower costs, lower wages, slower rhythm, closer people; mountains as a compass, family within reach — less rush, more belonging.",
  },
];

// Costruisce il prompt completo
function buildMessages({
  domanda,
  lang = "it",
  stile = "whatif",
  periodo = "future",
  micro = {},
  profile = {},
  whatif_mode = "poetico",
}) {
  const name = shortNameFromProfile(profile);
  const sysCommon =
    lang === "en"
      ? `You are a warm, precise writer. Answer in ${lang.toUpperCase()}.`
      : `Sei una voce calda e precisa. Rispondi in ${lang.toUpperCase()}.`;

  if (stile === "wtf") {
    const system = sysCommon + "\n" + wtfStyleGuard(lang);
    const few = lang === "en" ? FEWSHOT_WTF_EN : FEWSHOT_WTF_IT;
    const user = `${sanitize(domanda)}`
      .replace(/\s+/g, " ")
      .trim();

    return [
      { role: "system", content: system },
      ...few,
      {
        role: "user",
        content: user,
      },
    ];
  }

  // WHAT IF
  const opener = leadConfidenziale(name, lang, whatif_mode);
  const modeIsAnalitico = whatif_mode === "analitico";
  const systemWhatIf =
    sysCommon +
    (lang === "en"
      ? `\nFor WHAT IF: single paragraph, ${modeIsAnalitico ? "analytic and concrete" : "poetic and intimate"}, no bullet points, no emojis.`
      : `\nPer WHAT IF: paragrafo unico, ${modeIsAnalitico ? "analitico e concreto" : "poetico e intimo"}, niente elenchi, niente emoji.`);

  const few =
    lang === "en"
      ? FEWSHOT_WHATIF_EN
      : modeIsAnalitico
      ? FEWSHOT_WHATIF_ANALITICO_IT
      : FEWSHOT_WHATIF_POETICO_IT;

  const suffix =
    lang === "en"
      ? `${opener} ${sanitize(domanda)}`
      : `${opener} ${sanitize(domanda)}`;

  return [
    { role: "system", content: systemWhatIf },
    ...few,
    { role: "user", content: suffix },
  ];
}

// ---------- Handler ----------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ detail: "Method not allowed" });
    return;
  }
  try {
    const body = await req.body
      ? typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body
      : {};

    const {
      domanda = "",
      lang = "it",
      stile = "whatif",
      periodo = "future",
      micro = {},
      sex = "",
      profile = {},
      whatif_mode, // "analitico" | "poetico" (UI fourth)
    } = body || {};

    if (!OPENAI_API_KEY) {
      res
        .status(500)
        .json({ detail: "Missing OPENAI_API_KEY on server." });
      return;
    }
    const messages = buildMessages({
      domanda,
      lang,
      stile,
      periodo,
      micro,
      profile,
      whatif_mode: whatif_mode || "poetico",
    });

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: stile === "wtf" ? 0.9 : 0.7,
        max_tokens: 520,
      }),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      res.status(r.status).json(err);
      return;
    }
    const data = await r.json();
    const answer =
      data?.choices?.[0]?.message?.content?.trim() ||
      (lang === "en" ? "[no answer]" : "[nessuna risposta]");

    res.status(200).json({ answer });
  } catch (e) {
    res.status(500).json({ detail: String(e?.message || e) });
  }
}
