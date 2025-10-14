// /api/ask.js
// API Route (Vercel/Node). Restituisce JSON { answer, style, lang, episode }.
// Non usa streaming. Sostituisci "fakeLLM" con la tua integrazione LLM quando vuoi.

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Parse body
    const {
      domanda = "",
      lang = "it",
      stile = "whatif",          // 'whatif' | 'wtf'
      periodo = "future",
      episode = 1,               // 1..3
      profile = {},              // { name, city_now, role ... }
      micro = {}                 // micro-risposte (facoltative)
    } = req.body || {};

    // Lingua
    const L = String(lang || "it").toLowerCase() === "en" ? "en" : "it";

    // Nome (pulito e mai forzato)
    const name = cleanName(profile?.name);

    // Toni IT/EN
    const WHATIF_TONE_IT = `
Scrivi un episodio breve (8–12 righe), asciutto e positivo, da amico brillante che conosce chi legge.
Ritmo parlato, zero malinconia, zero poesia, zero coaching. Linguaggio concreto.
Usa il nome (${name || "se presente"}) in modo naturale al massimo 1 volta (o non usarlo).
`;

    const WTF_TONE_IT = `
Scrivi un episodio breve (7–10 righe) da bancone: ironico, “ubriaco ma lucido”, mai cattivo.
Battute intelligenti, ritmo secco, calore. Accenni all'alcol ok, senza eccessi.
Usa il nome (${name || "se presente"}) in modo confidenziale, massimo 1 volta (o non usarlo).
`;

    const WHATIF_TONE_EN = `
Write a short episode (8–12 lines), bright and realistic, like a clever friend.
No poetry, no coaching, no gloom. Concrete language. Use the name (${name || "if present"}) at most once, naturally.
`;

    const WTF_TONE_EN = `
Write a short bar-counter episode (7–10 lines): witty, tipsy-but-sharp, never mean.
Smart jokes, friendly heat, snappy rhythm. One casual name (${name || "if present"}) max (or none).
`;

    // Hook finale per episodio/stile
    const hook = buildHook(stile, episode, L);

    // Prompt base
    const BASE_PROMPT = (L === "en" ? basePromptEN : basePromptIT)({
      domanda,
      stile,
      episode,
      profile,
      micro,
      hook
    });

    const TONE = (L === "en")
      ? (stile === "wtf" ? WTF_TONE_EN : WHATIF_TONE_EN)
      : (stile === "wtf" ? WTF_TONE_IT : WHATIF_TONE_IT);

    // --------------- CHIAMATA AL LLM ---------------
    // Sostituisci fakeLLM con la tua integrazione: passagli TONE (system) e BASE_PROMPT (user).
    const raw = await fakeLLM({ tone: TONE, base: BASE_PROMPT, stile, episode, domanda, name, hook, lang: L });
    // ------------------------------------------------

    const answer = sanitize(raw);
    return res.status(200).json({ answer, style: stile, lang: L, episode });
  } catch (err) {
    console.error("[/api/ask] error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

/* =======================
   UTILITY FUNZIONI
   ======================= */

function cleanName(n) {
  if (!n) return "";
  return String(n).trim().split(/\s+/)[0].replace(/[“”«»"']/g, "");
}

function sanitize(text = "") {
  return String(text)
    .replace(/[“”«»]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "");
}

function buildHook(style, episode, lang) {
  const it = {
    whatif: {
      1: "Domani sblocchiamo l’Episodio 2 alle 09:00. Continua a conoscerci e ti dico dove va la storia.",
      2: "Domani chiudiamo il cerchio con l’Episodio 3. Stessa domanda, un passo più avanti.",
      3: "Se vuoi, domani apriamo un nuovo capitolo sulla stessa domanda. Ci sei?"
    },
    wtf: {
      1: "Domani ti verso l’Episodio 2. Stessa sedia, giro nuovo.",
      2: "Domani arriviamo all’Episodio 3. Portati il ghiaccio.",
      3: "Se ti va, domani facciamo un altro giro sulla stessa domanda. Al bancone ci sei sempre."
    }
  };
  const en = {
    whatif: {
      1: "Tomorrow we unlock Episode 2 at 09:00. Keep sharing and I’ll show where this goes.",
      2: "Tomorrow we close the loop with Episode 3. Same question, one step ahead.",
      3: "If you want, tomorrow we open a new chapter on the same question. Deal?"
    },
    wtf: {
      1: "Tomorrow I’ll pour Episode 2. Same stool, new round.",
      2: "Tomorrow we hit Episode 3. Bring ice.",
      3: "If you’re in, tomorrow we spin it again on the same question. Bar’s open."
    }
  };
  const tbl = (lang === "en" ? en : it);
  const key = style === "wtf" ? "wtf" : "whatif";
  const e = Math.max(1, Math.min(3, Number(episode) || 1));
  return tbl[key][e];
}

function basePromptIT({ domanda, stile, episode, profile, micro, hook }) {
  return `
Sei l'AI di What?f. L'utente chiede: "${domanda}".
Profilo (se presente): ${JSON.stringify(profile)}.
Micro-risposte (se presenti): ${JSON.stringify(micro)}.
Stile: ${stile === "wtf" ? "What the F (bar, ironico, ubriaco ma lucido)" : "What?f (amico brillante, realistico, positivo)"}.
Episodio ${episode} di 3.

Regole:
- Frasi brevi, una per riga. Niente bullet/markdown/parentesi. No citazioni decorative.
- Tono precisamente sullo stile scelto. No moralismi, no coaching, no tristezza.
- Linguaggio concreto, quotidiano. Evita vaghezze e frasi generiche.
- Se profile.name esiste, puoi usarlo una sola volta in modo naturale (o non usarlo).
- Chiudi con questa riga ESATTA: ${hook}

Ora scrivi SOLO il testo dell’episodio, senza preamboli e senza titoli.
`;
}

function basePromptEN({ domanda, stile, episode, profile, micro, hook }) {
  return `
You are What?f's AI. The user asks: "${domanda}".
Profile (if any): ${JSON.stringify(profile)}.
Micro-answers (if any): ${JSON.stringify(micro)}.
Style: ${stile === "wtf" ? "What the F (bar-like, witty, tipsy-but-sharp)" : "What?f (bright, realistic, positive friend)"}.
Episode ${episode} of 3.

Rules:
- Short sentences, one per line. No bullets/markdown/parentheses. No decorative quotes.
- Keep the tone strictly on the chosen style. No coaching, no gloom.
- Concrete, daily-life language. Avoid vagueness.
- If profile.name exists, you MAY use it once naturally (or not at all).
- End with this EXACT line: ${hook}

Output ONLY the episode text. No headings, no preface.
`;
}

// Fallback: sostituisci con la tua integrazione OpenAI/Anthropic ecc.
async function fakeLLM({ tone, base, stile, episode, domanda, name, hook, lang }) {
  // Output coerente e immediato per far funzionare l'app anche senza credenziali.
  if (stile === "wtf") {
    return [
      name ? `Oh ${name}, ${domanda.toLowerCase()}?` : `Oh amico, ${domanda.toLowerCase()}?`,
      `Ottima mossa: qui il vento ha l’abbonamento mensile e il barista la laurea in psicologia spiccia.`,
      `Due battute, tre brindisi, e i dubbi scivolano come ghiaccio nel bicchiere.`,
      `Zero cinismo, solo ironia con vista montagne.`,
      `Si riparte ridendo, non correndo.`,
      hook
    ].join("\n");
  }

  return [
    (name ? `E se ${name} ${domanda.toLowerCase()}?` : `E se ${domanda.toLowerCase()}?`),
    `Non per nostalgia, per equilibrio.`,
    `Ritrovi il passo giusto: meno rumore, più aria.`,
    `All’inizio dirai “che ci faccio qui?”, poi la testa si raddrizza.`,
    `Certi posti funzionano come specchi: ti riflettono senza giudicare.`,
    `Questo può essere uno di quelli, se gli lasci spazio.`,
    hook
  ].join("\n");
}
