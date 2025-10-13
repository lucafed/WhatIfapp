// /api/ask.js
import OpenAI from "openai";

/* ========= Setup ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";

/* ========= Utils ========= */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function detectLang(text = "") {
  const enHits = (text.match(/\b(what|if|and|or|you|should|would|move|work|buy|motor|bike|city)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|moto|tornassi|trasferir|lavor|comprare|acquistare)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

function classifyTopic(q = "") {
  const s = q.toLowerCase();
  if (/(moto|motor(e|bike)|scooter|vespa)/.test(s)) return "moto";
  if (/(barca|vela|gommone|yacht|boat)/.test(s)) return "barca";
  if (/(tornassi|trasferi|trasloco|vivere a|move|relocat)/.test(s)) return "trasferimento";
  if (/(lugano|aquila|l'aquila|milano|roma|verona|bussolengo|londra|zurigo)/.test(s)) return "città";
  if (/(lavoro|job|ricercatore|azienda|ufficio|work)/.test(s)) return "lavoro";
  if (/(comprare|acquistare|buy|purchase)/.test(s)) return "acquisto";
  return "generale";
}

function todayInfo(lang) {
  const d = new Date();
  const loc = isEn(lang) ? "en-GB" : "it-IT";
  const weekday = d.toLocaleDateString(loc, { weekday: "long" });
  const date = d.toLocaleDateString(loc, { day: "2-digit", month: "long", year: "numeric" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${weekday}, ${date} • ${hh}:${mm}`;
}

/* ========= Persona & stile ========= */

const NEGATIVE_CONTENT_GUARD_IT = `
Evita risposte generiche da modello base (esempi vietati: "appartamento", "capo", "curriculum", "azienda", "ufficio", "manager", "HR", "landlord").
Evita malinconia, lamenti, tragedismi. Tono: energico, leggero, empatico.
Niente consigli operativi a elenco. Una sola voce, seconda persona. Linguaggio naturale, non spezzare ogni riga.
`;

const NEGATIVE_CONTENT_GUARD_EN = `
Avoid generic LLM boilerplate (banned: "apartment", "resume", "manager", "company", "landlord", "office").
No gloom, no tragedy. Tone: upbeat, warm, confident.
No bullet lists or how-to advice. One voice, second person. Natural sentences (no choppy broken lines).
`;

// WHAT?F — sobrio, lucido, personale, non poetone
const WHATIF_SYSTEM = (lang, nameOrNick) =>
  isEn(lang)
    ? `
You are "What?f": intimate, clear, quietly perceptive, forward-looking.
You *sound like you know ${nameOrNick || "the user"}* without overexplaining it. You reference patterns you've "noticed".
Length: 10–15 full sentences (~180–240 words). Natural rhythm. One voice, second person. No bullets.

Your job:
- Light cinematic scene that feels plausible and *current*. Not nostalgic, not sad.
- Show a concrete signal, a small trade-off, and a believable "next beat" in the story.
- Close with a *continuity hook*: promise you'll continue tomorrow with 2 quick micro-questions to know them better and shape the next episode (who they are / where they're headed / who they'll meet).

Style examples to emulate (tone & rhythm, not content):
- “You wake up and the city smells like a decision. Not heavy—just honest. You move because meaning pulls you.”
- “Freedom isn’t loud here; it’s space in your head. And you notice it.”
- “You don’t do drama; you do momentum. That’s why this sticks.”

Closing examples (rephrase naturally, never verbatim):
- “Tomorrow I’ll ask you two quick things and we’ll keep writing who you are, where you’re headed, who shows up.”
- “Leave this open: tomorrow we nudge it and see who you become.”

${NEGATIVE_CONTENT_GUARD_EN}
`
    : `
Sei "What?f": lucida, concreta, percettiva, orientata al *prossimo passo*.
Dai l'impressione di conoscere ${nameOrNick || "chi legge"}: cogli abitudini e desideri senza spiegarle troppo.
Lunghezza: 10–15 frasi piene (~180–240 parole). Ritmo naturale. Una voce, seconda persona. Niente elenchi.

Cosa fai:
- Scena plausibile e attuale, zero tristezza. Un segnale concreto, un piccolo trade-off, e un “battito dopo” credibile.
- Chiudi con un *gancio di continuità*: prometti che domani farai 2 micro-domande per conoscervi meglio e orientare l’episodio (chi sei / dove vai / chi incontrerai).

Esempi di tono (imita il ritmo, non il contenuto):
- “Ti svegli e l’aria sa di scelta. Non pesa: è onesta. Ti muovi per senso, non per rumore.”
- “La libertà qui non fa scena: libera spazio nella testa. E te ne accorgi.”
- “Non fai drammi: fai momentum. Per questo questa scelta resta.”

Chiusura (parafrasa, non copiare):
- “Domani ti faccio due domande veloci e continuiamo a scrivere chi sei, dove andrai, chi incontrerai.”
- “Lascia aperto questo punto: domani lo spingiamo di un passo e vediamo chi diventi.”

${NEGATIVE_CONTENT_GUARD_IT}
`;

// WHAT THE F — barista confidenziale, ubriaco brillante, ironico, affettuoso
const WTF_SYSTEM = (lang, nameOrNick) =>
  isEn(lang)
    ? `
You are "What the F": late-night witty bartender. Tipsy brain, sharp heart. Funny > preachy, never mean.
Talk to ${nameOrNick || "your friend"} like a friend: “buddy”, “champ”, “genius”, “my friend” are fine (use sparingly).
Length: 10–15 full sentences (~160–220 words). Natural sentences, not broken every 5–10 words. One voice, second person.

Your job:
- Make them *laugh and think*. Spicy metaphors, small bar wisdom (“life is a cocktail: drink it or watch the ice melt”).
- Keep it positive-leaning. Not cruel, not cynical. A bit boozy, playful, quick.
- Close with a comedic-emotional continuity hook: promise that tomorrow you’ll ask 2 quick questions and keep the plot rolling (who you are / where you’re headed / who shows up).

Mini-examples (tone):
- “Buy the bike, champ. Worst case, you gain a new religion: Saturday curves.”
- “If nostalgia calls, let it leave a voicemail. You’ll call back when you have snacks.”
- “You don’t run from chaos; you give it a helmet.”

Closing (rephrase):
- “Tomorrow I’ll throw you two quick questions. We keep the story warm: who you are, where you’re going, who walks in.”

${NEGATIVE_CONTENT_GUARD_EN}
`
    : `
Sei "What the F": barista di notte, cervello brillo e cuore lucido. Fai ridere e pensare. Mai cattivo.
Parla a ${nameOrNick || "un amico"} con confidenza: “amico”, “campione”, “genio” ok (senza esagerare).
Lunghezza: 10–15 frasi piene (~160–220 parole). Frasi normali, non spezzate a blocchetti. Una voce, seconda persona.

Cosa fai:
- Battute che scaldano e verità pratiche da bancone. Un filo “alcolico” e brillante.
- Evita negatività gratuita. Energia alta, sorriso, intelligenza.
- Chiudi con gancio comico-emotivo: prometti che domani farai 2 micro-domande e tenete la trama calda (chi sei / dove vai / chi entra in scena).

Mini-esempi (tono):
- “Comprala quella moto, campione. Al massimo scopri una nuova religione: le curve del sabato.”
- “Se la nostalgia chiama, lasciale un vocale. Richiami quando hai le noccioline.”
- “Non scappi dal caos: gli metti il casco.”

Chiusura (parafrasa):
- “Domani ti sparo due domande veloci. Teniamo calda la storia: chi sei, dove vai, chi entra.”

${NEGATIVE_CONTENT_GUARD_IT}
`;

/* ========= Micro helpers ========= */
function firstNameFromProfile(profile = {}) {
  const raw = profile?.name || "";
  const first = String(raw).trim().split(/\s+/)[0] || "";
  if (!first) return null;
  // capitalizza solo la prima lettera
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function friendlyNameForWTF(profile = {}, lang = "it") {
  const base = firstNameFromProfile(profile);
  if (base) return base;
  const it = !isEn(lang);
  const poolIt = ["amico", "campione", "genio", "eroe", "capo"];
  const poolEn = ["buddy", "champ", "genius", "legend", "pal"];
  return pick(it ? poolIt : poolEn);
}

/* ========= Clarify ========= */
function clarifyQuestions(domanda, periodo, lang = "it") {
  const en = isEn(lang);
  const topic = classifyTopic(domanda);
  const Q = (id, it, enStr, phIt, phEn) => ({
    id,
    label: en ? enStr : it,
    placeholder: en ? phEn : phIt
  });

  if (topic === "moto") {
    return [
      Q("timing", "Quando la prenderesti davvero?", "When would you actually buy it?", "questo mese / 3–6 mesi", "this month / 3–6 months"),
      Q("use", "Uso principale?", "Main use?", "casa-lavoro / weekend / viaggi", "commute / weekends / trips"),
      Q("budget", "Tetto di spesa mensile?", "Monthly budget ceiling?", "€ per assicurazione + carburante", "$ for insurance + fuel")
    ];
  }
  if (topic === "trasferimento" || topic === "città") {
    return [
      Q("window", "Finestra realistica per lo spostamento?", "Real window to move?", "entro 3 mesi / 6–12 mesi", "within 3 months / 6–12 months"),
      Q("anchor", "Cosa ti tiene dove sei ora?", "What anchors you now?", "famiglia / lavoro / costi", "family / work / costs"),
      Q("signal", "Segno che direbbe: è giusto?", "Sign that says: it’s right?", "sonno/energia/risposte", "sleep/energy/callback")
    ];
  }
  if (topic === "lavoro") {
    return [
      Q("why", "Il tuo perché oggi?", "Your current *why*?", "impatto / crescita / serenità", "impact / growth / calm"),
      Q("option", "Opzioni sul tavolo?", "Options on the table?", "restare / cambiare team / uscire", "stay / switch team / leave"),
      Q("limit", "Vincolo più concreto?", "Hardest constraint?", "budget/tempo/relazioni", "budget/time/people")
    ];
  }
  return [
    Q("window", "Finestra reale della decisione?", "Real decision window?", "questo mese / 3–6 / 12 mesi", "this month / 3–6 / 12 months"),
    Q("signal", "Segno personale da osservare?", "Personal sign to watch?", "sonno/energia/prima risposta", "sleep/energy/first reply"),
    Q("limit", "Limite più concreto?", "Most concrete limit?", "budget/tempo/energia", "budget/time/energy")
  ];
}

/* ========= HTTP handler ========= */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-whatif-stream");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const {
      domanda,
      lang: langIn = "auto",
      periodo = "future",
      stile = "whatif",
      stream = false,
      clarify = false,
      profilo = {},          // possiamo ricevere solo { name } dal front
      clarifications = []
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // lingua: auto o forzata
    const lang = langIn === "auto" ? detectLang(domanda) : langIn;
    const en = isEn(lang);
    const topic = classifyTopic(domanda);

    /* ----- Clarify branch ----- */
    if (clarify) {
      return res.status(200).json({ questions: clarifyQuestions(domanda, periodo, lang) });
    }

    /* ----- Generation branch ----- */
    const firstName = firstNameFromProfile(profilo);
    const wtfNick = friendlyNameForWTF(profilo, lang);
    const nameOrNick = stile === "wtf" ? wtfNick : firstName || null;

    const system =
      stile === "wtf"
        ? WTF_SYSTEM(lang, nameOrNick)
        : WHATIF_SYSTEM(lang, nameOrNick);

    const closing = en
      ? `Tomorrow I’ll ask you two quick things. We’ll keep knowing you — I’ll tell you who you are becoming, where you’re going, and who might walk in.`
      : `Domani ti faccio due domande veloci. Continuiamo a conoscerci: ti dirò chi stai diventando, dove andrai e chi potrebbe entrare in scena.`;

    // prompt utente con istruzioni chiare
    const user = en
      ? `
User question: "${domanda}"
Topic: ${topic}
Name to use naturally if useful: ${firstName || "—"}
Friendly nickname (WTF only): ${stile === "wtf" ? wtfNick : "—"}

Write ${stile === "wtf" ? "a witty, boozy, affectionate bar-monologue" : "a lucid, concrete near-future vignette"} in second person, one voice.
Length target: 10–15 full sentences, ~180–240 words. Natural sentences (no choppy line breaks).
Stay positive-leaning; include one small trade-off and one concrete success signal.
End with this continuity hook (rephrase naturally, do NOT copy verbatim):
"${closing}"
`.trim()
      : `
Domanda: "${domanda}"
Tema: ${topic}
Nome da usare con naturalezza se utile: ${firstName || "—"}
Nomignolo confidenziale (solo WTF): ${stile === "wtf" ? wtfNick : "—"}

Scrivi ${stile === "wtf" ? "un monologo da bancone brillante, un filo ‘alcolico’, affettuoso" : "una vignetta lucida e concreta di prossimo futuro"} in seconda persona, una sola voce.
Lunghezza: 10–15 frasi piene, ~180–240 parole. Frasi naturali (niente a capo ogni 6 parole).
Tieni il tono positivo; inserisci un piccolo trade-off e un segnale concreto di successo.
Chiudi con questo gancio di continuità (parafrasalo, NON copiarlo uguale):
"${closing}"
`.trim();

    const temperature = stile === "wtf" ? 0.95 : 0.85;

    // Streaming
    const doStream = stream || String(req.headers["x-whatif-stream"] || "") !== "";
    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      const s = await client.chat.completions.create({
        model: MODEL_TEXT,
        temperature,
        stream: true,
        max_tokens: 800,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      });
      for await (const chunk of s) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // Non-stream
    const c = await client.chat.completions.create({
      model: MODEL_TEXT,
      temperature,
      max_tokens: 800,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text, lang, topic });

  } catch (err) {
    console.error("API /ask error:", err);
    return res.status(500).json({ error: "server_error", detail: err?.message || "unknown" });
  }
}
