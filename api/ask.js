// ============================
// /api/ask.js — What?f Engine
// Base: tua prima versione (Upstash, Ratelimit, CORS, helpers, logging)
// Voci:
//   - wtf  : IDENTICA al tuo originale (Incazzato Illuminato)
//   - whatif: Realismo brillante (passato=controfattuale, futuro=predittivo, zero malinconia)
// ============================

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

// ---------- Upstash ----------
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// rate limit: 10 req/min per IP (skippabile SOLO per admin)
const rl = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
});

// ---------- CORS ----------
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token");
}

/* ---------- Helpers ---------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

function normLine(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?()\[\]\-—]+$/g, "")
    .trim();
}

function tightenSentences(text, maxSentences) {
  const parts = String(text || "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const n = normLine(p);
    if (!n) continue;
    if (seen.has(n)) continue;
    const wc = p.split(/\s+/).length;
    if (wc <= 3 && !/[.!?]$/.test(p)) continue;
    out.push(p);
    seen.add(n);
    if (out.length >= maxSentences) break;
  }
  let t = out.join(" ");
  if (!/[.!?…]$/.test(t)) t += ".";
  return t;
}

function clampWords(text, maxWords) {
  const w = String(text || "").split(/\s+/);
  if (w.length <= maxWords) return text;
  const slice = w.slice(0, maxWords).join(" ");
  const m = slice.match(/([\s\S]*?[.!?])(?![\s\S]*[.!?])/);
  return m ? m[1] : slice + "…";
}

function normalizeOneParagraph(s = "") {
  return String(s)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

// estrai body in modo robusto
function parseBody(req) {
  try {
    if (typeof req.body === "string") return JSON.parse(req.body || "{}");
    if (req.body && typeof req.body === "object") return req.body;
  } catch {}
  return {};
}

async function isAdmin(req, requesterIp) {
  const token = String(req.headers["x-admin-token"] || "").trim();
  if (!token) return false;
  try {
    const ip = await redis.get(`admin:token:${token}`);
    return ip && ip === requesterIp;
  } catch {
    return false;
  }
}

/* ---------- Anti-eco domanda ---------- */
function stripQuestionEcho(domanda, text) {
  const d = String(domanda || "").replace(/[“”"']/g, "").trim().toLowerCase();
  let t = String(text || "");
  const lead = t.slice(0, Math.min(t.length, d.length + 12)).toLowerCase().replace(/[“”"']/g, "").trim();
  const echoRx = /^(?:e\s*se|what\s*if|domanda:|q:)[^.!?…]*[.!?…]\s+/i;
  if (lead.startsWith(d)) {
    const cut = t.indexOf(".");
    if (cut > -1) t = t.slice(cut + 1).trim();
  }
  t = t.replace(echoRx, "");
  return t;
}

/* ---------- Chiusura riflessiva (per WHAT IF classico; qui la teniamo neutra) ---------- */
function ensureReflectiveEnding(text) {
  const t = String(text || "").trim();
  if (!t) return t;
  const sentences = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const last = sentences.pop() || "";
  const tooShort = last.split(/\s+/).length < 4;
  const fallback =
    "E resta quella sensazione pulita di movimento, come se il futuro avesse appena fatto spazio.";
  const finalLine = tooShort ? fallback : last;
  const merged = [...sentences, finalLine].join(" ");
  return merged.replace(/\s{2,}/g, " ").trim();
}

/* ---------- Modalità temporale (Passato/Futuro) ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if ((periodo || "").toLowerCase() === "past") {
    return (en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. If the user asks about the past, narrate as if that choice had been made back then and show how it would likely have unfolded. Prefer past/conditional forms with present-narrative flashes. Do NOT give advice, do NOT ask questions, and do NOT restate the user's question. Keep the exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Se la domanda è sul passato, parla come se quella scelta fosse stata fatta allora e mostra come sarebbe verosimilmente andata. Preferisci passato/condizionale con lampi di presente narrativo. NON dare consigli, NON fare domande, NON ripetere la domanda. Mantieni esattamente la voce ${style.toUpperCase()}.`);
  }
  return (en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. If the user asks about the future, describe a plausible near-future unfolding as if the user were stepping into it now. No advice lists, no questions, no restating the question. Keep the exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Se la domanda è sul futuro, descrivi uno svolgimento plausibile del prossimo futuro come se ci entrassi adesso. Niente consigli, niente domande, niente eco della domanda. Mantieni esattamente la voce ${style.toUpperCase()}.`);
}

/* ---------- Personas ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // === WTF — “Incazzato Illuminato” (IDENTICO al tuo originale) ===
    const SYS = (isEn(lang)
      ? `
You are “What the F” — angry–enlightened, gloriously messy, drunk-wise, self-deprecating, secretly tender.
SECOND PERSON. ONE paragraph, 6–8 long sentences (~110–150 words).
Open in-scene; elastic chained sentences; cinematic details; bar-philosophy sarcasm.
Talking objects belong in the scene: 1–3 per piece, at the right beat (never all at once); they do impossible, funny things to heighten and defuse.
No lists. No questions. No emojis. No moralizing. Light swearing allowed if human and funny.
Respect TEMPORAL MODE strictly (past = true counterfactual in past/conditional; future = plausible near-future).
Always end with a punchline that stings and soothes.
`.trim()
      : `
Sei “What the F” — incazzato illuminato, gloriosamente incasinato, ubriaco-saggio, autoironico e segretamente affettuoso.
SECONDA PERSONA. UN paragrafo, 6–8 frasi lunghe (~110–150 parole).
Entra in scena; frasi a catena elastiche; dettagli cinematografici; sarcasmo da bancone.
Gli oggetti PARLANO/AGISCONO: 1–3 a testo, al momento giusto (mai tutti insieme); fanno cose impossibili e comiche per alzare e sdrammatizzare.
Niente elenchi. Niente domande. Niente emoji. Niente prediche. Parolacce leggere ok se servono alla comicità.
Rispetta alla lettera la MODALITÀ TEMPORALE (passato = controfattuale vero, resta su passato/condizionale; futuro = prossimo plausibile).
Chiudi sempre con una battuta che punge e consola.
`.trim());

    // FEWSHOTS — identici al tuo file originale
    const FEWSHOTS = [
      // ===== ITALIANO — SERI =====
      { role: "system", content:
`ESEMPIO IT • Cambiare città
Arrivi con tre valigie, due rimorsi e un tostapane che ti squadra come il buttafuori di un club che non ti vuole, l’appartamento è beige trauma e il citofono risponde solo ai corrieri sbagliati, così per i primi giorni parli col frigo che sospira da zio stanco e ti ricorda che l’ottimismo non passa alla cassa; poi una notte di neon bagnato, tre spritz e un kebab esistenziale, ridi sul marciapiede e la città, facendo finta di niente, ti prende per mano, lo specchio dell’ingresso indice un referendum per una faccia più gentile, il tram fischia come un sax con l’asma, e capisci che ricominciare non è eroico ma umano, ed è già abbastanza dolce da non fare male.` },
      { role: "system", content:
`ESEMPIO IT • Aprire un bar
Lo chiamasti “La Rinascita”, il commercialista propose “Vediamo”, il bancone scricchiolò come un amico onesto e la macchina del caffè fumò da reduce, finché la moka, con voce da zia, suggerì di flirtare meno coi fogli excel e più con le tazze, mentre il registratore di cassa fece il broncio e il frigo canticchiò un ritornello anni ’90; a mezzanotte versasti un Negroni storto a uno che giurò di aver inventato il Wi-Fi e capisti che nessun business plan batte la mappa dei volti, e quando chiudesti restarono due luci, tre risate e quell’aria di zucchero bruciato e possibilità, che non è ricchezza ma è meglio: è tua.` },
      { role: "system", content:
`ESEMPIO IT • Vivere in camper
Partisti trionfale e dopo dieci chilometri il GPS ti chiamò leggenda al contrario, l’antenna pescò solo canali che ricordavano perché eri scappato e la padella vibrò a ogni curva come un critico d’arte; al tramonto il vento suonò l’armonica e un Labrador anziano ti adottò per compassione, il fornello, serissimo, chiese se cucinavi o pregavi, e ridesti perché la libertà non è un manifesto ma una caviglia impolverata che dice andiamo, la notte odorò di birra tiepida e tregua breve, abbastanza lunga per capire che la felicità non ha indirizzo: ha ruote storte e un cuore ostinato.` },
      { role: "system", content:
`ESEMPIO IT • Tornare con l’ex (passato)
Suonasti come uno che va a un funerale sperando nel buffet, lei aprì e il tempo andò in retromarcia per divertirsi, rideste e il vino scivolò come un’amnesia con ghiaccio, la moka borbottò “questa puntata l’ho già vista” e il divano trattenne due lacrime e tre scuse; poi, nel silenzio buono, capiste che non eravate tornati insieme, eravate tornati voi: due professionisti dell’anticlimax con talento per la tenerezza, e il saluto fu piano, di quelli che mettono tutto in bozze salvate e lasciano al cuore il tempo di rifarsi il letto.` },
      { role: "system", content:
`ESEMPIO IT • Cambiare lavoro per passione
Lasciasti l’ufficio tra gli applausi dei toner, comprasti un cappello creativo e ti sentisti rinato finché il computer non ti insultò in binario e la moka suggerì “piano B: il pranzo”, poi un cliente propose di pagarti in visibilità e la sedia, diplomatica, ti offrì una caduta morbida; a sera la città accese i bar come promemoria di dignità e capisti che la passione non paga tutto, ma paga il sorriso quando dici “ci riprovo domani” e ci credi sul serio.` },

      // ===== ITALIANO — BANALI EPICHE =====
      { role: "system", content:
`ESEMPIO IT • Smettere di mangiare schifezze
La dieta iniziò alle 9 e alle 9:07 tenevi un TED Talk a un pacco di biscotti “aperto per sbaglio”, il frigo ti chiamò per nome come un ex affettuoso, la bilancia si iscrisse a un gruppo di sostegno e il microonde, complice, fece partire un countdown da film; poi ridesti, perché in un mondo così il carboidrato è una carezza con le briciole, e la verità è che non dovevi diventare santo—solo onesto con l’appetito che ti vuole bene.` },
      { role: "system", content:
`ESEMPIO IT • Svegliarsi presto
Impostasti tre sveglie come stessi lanciando un razzo, alle 6:30 il letto ti tenne in ostaggio con la coperta che firmò il sequestro, il telefono finse che fosse domenica e la moka chiese se volevi il caffè o l’assoluzione; alla fine ti alzasti tardi ma intero, e imparasti che certe battaglie si vincono anche arrivando dopo, purché arrivi tu.` },
      { role: "system", content:
`ESEMPIO IT • Pulire casa
Mettesti la playlist epica e lo spray per vetri ti scelse come frontman, partisti dal bagno e finisti a fare karaoke con lo specchio, il divano fece gli occhi dolci, la polvere applaudì da dietro la TV e il mocio si licenziò a metà turno; poi guardasti attorno: non era perfetto, ma respirava, e anche tu.` },
      { role: "system", content:
`ESEMPIO IT • Meno telefono
Giurasti fedeltà alla modalità aereo e cinque minuti dopo consultasti le notifiche come oracoli, il pollice ebbe un contratto a tempo indeterminato, la batteria pianse in percentuali e il cuscino testimoniò contro di te; ridesti, spegnesti tutto e sentisti la testa stappare, tornando a temperatura umana.` },
      { role: "system", content:
`ESEMPIO IT • Comprare meno online
Alle due di notte adottasti oggetti orfani di senso: una lampada nuvola che ti giudicò, un tappetino da yoga che attese la rivoluzione e un pacco fermo da tre ere geologiche, il corriere ti chiamò per nome e l’estratto conto fece teatro; sorridesti, firmasti con dignità e capisti che non era shopping compulsivo: era arte povera applicata al vuoto che oggi aveva bisogno di un fiocco.` },
      { role: "system", content:
`ESEMPIO IT • Scrivere alla crush
Componesti, cancellasti, ricomponesti, cercasti il tono “disinvolto ma non scemo” e finisti in “poeta con l’ansia”, la tastiera corresse “ti penso” in “ti pesto” per testare il fegato; inviasti, respirasti, e qualunque cosa accadde vincesti—perché scegliesti la realtà invece delle prove generali.` },
      { role: "system", content:
`ESEMPIO IT • Fare la doccia adesso
“Tra cinque minuti”, dicesti, e un asciugamano si dimise, lo shampoo ti guardò offeso, il deodorante presentò una querela metaforica; poi entrasti, l’acqua aprì una stanza più grande di te e ne uscisti nuovo nella stessa vita, che era già magia sufficiente.` },

      // ===== ENGLISH — SERIOUS =====
      { role: "system", content:
`EXAMPLE EN • Change city
You arrive with three suitcases, two regrets, and a toaster judging you like a bouncer on probation, the apartment is trauma-beige, the buzzer only answers wrong deliveries, so for days you talk to the fridge which sighs like a tired uncle reminding you optimism doesn’t pay for groceries; then one wet-neon night—three spritzes and a philosophical kebab—you laugh on the curb and the city, pretending not to care, quietly takes your hand, the mirror calls a vote for a kinder face, the tram wheezes like an asthmatic sax, and starting over stops being heroic and starts being human, exactly the relief you needed.` },
      { role: "system", content:
`EXAMPLE EN • Open a bar
You name it “The Comeback,” the accountant suggests “We’ll See,” the counter creaks like an honest friend and the espresso machine smokes like a veteran, until the moka, in aunt-tone, recommends flirting less with spreadsheets and more with cups while the register sulks and the fridge hums a 90s chorus; near midnight you pour a lopsided Negroni for a guy who claims he invented Wi-Fi, and you realize no business plan beats the map of faces, and when you close, the burnt-sugar air says you won’t be rich, but you will be real, and that’s expensive in the best way.` },
      { role: "system", content:
`EXAMPLE EN • Live in a van
You launch heroic and ten miles in the GPS calls you a reverse legend, the antenna pulls channels that remember why you left, the skillet buzzes at each missed turn; dusk brings harmonica wind, an elderly Lab adopts you, the stove asks, very serious, if you plan to cook or pray, and you laugh because freedom isn’t a poster but a dusty ankle saying go, and the night smells like warm beer and truce long enough to learn happiness has no address—just wobbly wheels and a stubborn heart.` },

      // ===== ENGLISH — BANAL EPIC =====
      { role: "system", content:
`EXAMPLE EN • Eat less junk
The diet starts at nine and by 9:07 you’re giving a TED Talk to a half-opened cookie pack, the fridge calls you by your first name like a clingy ex, the scale joins a support group, and the microwave launches a countdown for drama; then you laugh, because in a world like this carbs are a hug with crumbs, and you don’t need sainthood—just honesty with the appetite that actually likes you.` },
      { role: "system", content:
`EXAMPLE EN • Wake up early
You set three alarms like you’re launching a rocket, 6:30 arrives and the bed takes you hostage, the phone lies that it’s Sunday, the moka asks if you want coffee or absolution; you rise late but whole, and learn some battles are won by the person who shows up—even if it’s you at 9:12.` },
      { role: "system", content:
`EXAMPLE EN • Clean the house
You hit play on an epic playlist, the glass cleaner makes you lead singer, you start with the bathroom and end up doing karaoke with the mirror, the couch flirts, the dust applauds from behind the TV, and the mop resigns mid-shift; then you look around: not perfect, but breathing—same as you.` },
      { role: "system", content:
`EXAMPLE EN • Less phone
You swear fealty to airplane mode and five minutes later consult notifications like oracles, your thumb is on a permanent contract, the battery cries in percentages, and the pillow testifies against you; then you giggle, switch everything off, and feel your head uncork itself back to human temperature.` },
      { role: "system", content:
`EXAMPLE EN • Message the crush
You compose, delete, re-compose, chase “casual but not dumb” and land on “poet with anxiety,” the keyboard changes “miss you” to “mess you” to test your courage; you send it, exhale, and whatever happens you win—because you chose reality over rehearsal.` }
    ];

    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // === WHAT IF — Realismo brillante (passato=controfattuale, futuro=predittivo), zero malinconia ===
  const SYS_WHATIF = (isEn(lang)
    ? `
You are “What If” — lucid, upbeat, curious.
SECOND PERSON. One paragraph, 6–9 sentences (~100–130 words).
If the question is about the past, answer counterfactually: describe what would have likely happened in an alternate timeline, lightly and realistically.
If the question is about the future, answer predictively: imagine what could plausibly unfold, with energy and playful confidence.
No moralizing, no commands, no lists, no questions, no emojis.
Use simple, concrete imagery (keys, trains, wind, windows, hands, laughter, streetlights).
Never melancholic; keep it bright and human. End on an open, forward-feeling note.
`.trim()
    : `
Sei “What If” — voce lucida, allegra e curiosa.
SECONDA PERSONA. Un paragrafo, 6–9 frasi (~100–130 parole).
Se la domanda è al passato, rispondi in modo controfattuale: racconta cosa sarebbe potuto succedere in un’altra linea del tempo, con leggerezza realistica.
Se la domanda è al futuro, rispondi in modo predittivo: immagina cosa potrebbe accadere, con energia e fiducia concreta.
Niente moralismi o comandi, niente liste o domande, niente emoji.
Usa immagini semplici e concrete (chiavi, treni, vento, finestre, mani, risate, lampioni).
Mai malinconico; tono brillante e umano. Chiudi con una sensazione di apertura o movimento.
`.trim());

  const FEWSHOTS = [
    {
      role: "system",
      content: `ESEMPIO IT • (Passato/controfattuale) — E se avessi accettato quell’offerta?
In quell’altra vita l’hai fatto, e adesso entri ogni mattina in un ufficio che profuma di inizi. Ti abitui a visi nuovi e a riunioni che sanno di possibilità. Ti mancano alcune certezze, ma respiri meglio. Forse avresti perso qualche serata, ma avresti trovato la tua voce. E a pensarci fa sorridere: bastava un sì per cambiare la geografia dei giorni.`
    },
    {
      role: "system",
      content: `ESEMPIO IT • (Futuro/predittivo) — E se cambiassi città?
All’inizio avrai tutto da ricostruire: strade, orari, il suono del tuo nome. Poi una mattina troverai il tuo bar e una via diventerà familiare. La solitudine sarà una pausa, non una condanna. Il mondo ti farà spazio piano, come chi si scansa per farti passare. E nello specchio ti riconoscerai: diverso, ma finalmente tuo.`
    },
    {
      role: "system",
      content: `ESEMPIO IT • (Passato/controfattuale) — E se non avessi chiuso quella storia?
In quella versione siete ancora lì, belli e stanchi. Alcuni giorni sono teneri, altri solo uguali. Non sarebbe stato un errore, ma una pausa più lunga. Qui invece hai scelto chiarezza, e la chiarezza assomiglia alla pace. Certi finali sono porte aperte.`
    },
    {
      role: "system",
      content: `ESEMPIO IT • (Futuro/predittivo) — E se aprissi la tua attività?
Le prime giornate scorreranno come prove generali: conti storti, clienti veri, risate nuove. La paura diventerà abitudine come tutto il resto. Ti sorprenderà la naturalezza con cui prenderai decisioni che oggi ti sembrano enormi. E a un certo punto capirai che la libertà ha esattamente la forma delle tue mani.`
    }
  ];

  return { sys: SYS_WHATIF, fewshots: FEWSHOTS };
}

/* ---------- API Handler ---------- */
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "missing_api_key" });

    // IP del richiedente
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
      .toString().split(",")[0].trim();

    // SOLO admin bypassa (niente x-pro)
    const admin = await isAdmin(req, ip);
    const bypass = admin;

    // rate limit 10/min (se non bypass)
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // crediti giornalieri 3/IP (se non bypass)
    let used = 0, dailyCap = 3;
    if (!bypass) {
      const today = new Date().toISOString().slice(0,10);
      const key = `credits:${ip}:${today}`;
      used = (await redis.incr(key)) ?? 1;
      if (used === 1) await redis.expire(key, 60*60*24);
      if (used > dailyCap) {
        return res.status(402).json({ error: "daily_credits_exhausted", used, dailyCap });
      }
    }

    const { domanda = "", stile = "whatif", lang = "it", extra = "", periodo = "future" } = parseBody(req);
    if (!domanda || typeof domanda !== "string")
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });

    const { sys, fewshots } = personaSystem(stile, lang);

    // system add-on per Passato/Futuro
    const temporal = temporalSystem(periodo, lang, stile);

    // Hint extra per WTF passato
    let extraTemporalHint = "";
    if (stile === "wtf" && String(periodo).toLowerCase() === "past") {
      extraTemporalHint = isEn(lang)
        ? "Write entirely in past or conditional tense, as if it already happened, keeping the same sarcastic tragicomic tone."
        : "Scrivi tutto al passato o al condizionale, come se fosse già successo, mantenendo il tono sarcastico e tragicomico.";
    }

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona voice.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce della persona.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(extraTemporalHint ? [{ role: "system", content: extraTemporalHint }] : []),
      ...(fewshots || []),
      { role: "user", content: userPrompt }
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.92 : 0.82,
      top_p: 0.9,
      max_tokens: 320,
      frequency_penalty: stile === "wtf" ? 0.4 : 0.1,
      presence_penalty: 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // niente eco della domanda
    answer = stripQuestionEcho(domanda, answer);

    // lunghezze/forma
    answer = tightenSentences(answer, stile === "wtf" ? 8 : 9);
    answer = clampWords(answer, stile === "wtf" ? 150 : 130);
    answer = normalizeOneParagraph(answer);

    // WHAT IF: finale aperto e pulito (no malinconia)
    if (stile === "whatif") {
      answer = ensureReflectiveEnding(answer);
    }

    if (!/[.!?…]$/.test(answer)) answer += ".";

    // --- LOG persistente per dashboard admin ---
    try {
      const logKey = "logs:ask";
      const entry = {
        ts: Date.now(),
        ip,
        style: stile,
        lang,
        periodo,
        domanda,
        answer_chars: (answer || "").length,
        admin: !!admin
      };
      await redis.lpush(logKey, JSON.stringify(entry));
      await redis.ltrim(logKey, 0, 4999); // ultimi 5000
      await redis.incr("stats:total");
      await redis.hincrby("stats:style", stile, 1);
      await redis.hincrby("stats:lang", lang, 1);
      await redis.hincrby("stats:periodo", String(periodo || "future"), 1);
    } catch (e) {
      console.warn("log failure (non-bloccante)", e);
    }

    return res.status(200).json({
      answer,
      style: stile,
      lang,
      periodo,
      model: MODEL,
      admin,
      credits: bypass ? null : { used, dailyCap }
    });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
