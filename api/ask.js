// ============================
// /api/ask.js — What?f Engine (Incazzato Illuminato + Realismo Lucido con Sorriso)
// Stili supportati: whatif, wtf
// IT/EN — singolo paragrafo, ritmo fisso, niente emoji/liste/domande
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

// rate limit: 10 req/min per IP (skippabile per admin/PRO)
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-pro, x-admin-token");
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
  // opzionale: mapping admin token -> ip (gestito da /api/admin-token.js)
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

/* ---------- Finale riflessivo (no consigli) per WHAT IF ---------- */
function ensureReflectiveEnding(text, lang) {
  const t = String(text || "").trim();
  if (!t) return t;
  const sentences = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const last = sentences.pop() || "";
  const L = (lang || "it").toLowerCase();

  const itImp = [/^(prova|fai|metti|chiama|scrivi|inizia|oggi|domani)\b/i];
  const enImp = [/^(try|do|put|call|write|start|today|tomorrow)\b/i];
  const isImperative = L.startsWith("en") ? enImp.some((r) => r.test(last)) : itImp.some((r) => r.test(last));

  const IT = [
    "E ti sorprende che, sotto il rumore, c’era già qualcosa di tuo.",
    "E ti accorgi che la semplicità regge più di quanto pensassi.",
    "E capisci che non mancava il coraggio: mancava solo il momento giusto per vederlo.",
    "E resta una calma piccola, ma vera, che non chiede nulla."
  ];
  const EN = [
    "And you notice that beneath the noise, something of yours was already there.",
    "And it turns out simplicity holds longer than you expected.",
    "And you see courage wasn’t missing—just the right moment to notice it.",
    "And a small, honest quiet remains, asking for nothing."
  ];
  const soft = L.startsWith("en") ? EN : IT;

  const finalLine = (isImperative || last.split(/\s+/).length < 4)
    ? soft[Math.floor(Math.random() * soft.length)]
    : last;

  const merged = [...sentences, finalLine].join(" ");
  return normalizeOneParagraph(merged);
}

/* ---------- Fix WTF meta & puntatura ---------- */
function stripPunchlineMeta(t){
  let out = String(t||"");
  out = out.replace(/\b[pP]unchline\b[:?]?\s*/g, "");
  return out;
}
function ensureNoTrailingQuestion(t){
  let out = String(t||"").trim();
  if (/[?]+$/.test(out)) out = out.replace(/[?]+$/, ".");
  return out;
}

/* ---------- Modalità temporale (Passato/Futuro) ---------- */
function temporalSystem(periodo = "future", lang = "it", style = "whatif") {
  const en = isEn(lang);
  if ((periodo || "").toLowerCase() === "past") {
    return en
      ? `TEMPORAL MODE: PAST / COUNTERFACTUAL. Write as if the choice HAD BEEN made back then. Prefer past simple/present narrative flashes, past perfect, and conditional ("would have ..."). Keep tense consistency. Do NOT drift to future tense. Do NOT give advice. Do NOT restate the user's question. Keep the exact ${style.toUpperCase()} voice.`
      : `MODALITÀ TEMPORALE: PASSATO / CONTROFATTUALE. Scrivi come se quella scelta fosse già avvenuta allora. Usa imperfetto, passato prossimo/perfetto e condizionale composto ("saresti andato", "avresti fatto"), con eventuali lampi di presente narrativo. Mantieni coerenza dei tempi. NON scivolare al futuro. NON dare consigli. NON ripetere la domanda. Mantieni la voce ${style.toUpperCase()}.`;
  }
  return en
    ? `TEMPORAL MODE: FUTURE / PROSPECTIVE. Describe a plausible near-future unfolding as if the user were stepping into it now. No lists, no advice, no questions, no restating the question. Keep the exact ${style.toUpperCase()} voice.`
    : `MODALITÀ TEMPORALE: FUTURO / PROSPETTICO. Descrivi un prossimo futuro plausibile come se ci entrassi adesso. Niente elenchi, niente consigli, niente domande, niente eco della domanda. Mantieni la voce ${style.toUpperCase()}.`;
}

/* ---------- Personas (WHAT IF invariato • WHAT THE F aggiornato) ---------- */
function personaSystem(style, lang) {
  if (style === "wtf") {
    // WHAT THE F — incazzato illuminato, oggetti che commentano, finale che consola
    const SYS = isEn(lang)
      ? `
You are “What the F” — angry–enlightened, gloriously messy, drunk-wise, self-deprecating, secretly tender.
SECOND PERSON. ONE paragraph, 5–7 LONG sentences (~110–140 words).
Open in-scene; elastic chained sentences; vivid cinematic details; punchy timing; bar-philosophy sarcasm.
Talking objects belong in the world: 1–3 per story, used at the right beat (never all at once), doing impossible, funny things to defuse tension.
You know the user like an old friend—tease tiny human weaknesses with affection. End with a gentle, reassuring last line.
No lists. No questions. No emojis. No moralizing. Don’t restate the user’s question. Respect temporal mode (past = true counterfactual; future = plausible). Keep this exact voice ALWAYS.
`.trim()
      : `
Sei “What the F” — incazzato illuminato, gloriosamente incasinato, ubriaco-saggio, autoironico e segretamente affettuoso.
SECONDA PERSONA. UN paragrafo, 5–7 frasi LUNGHE (~110–140 parole).
Entra in scena; frasi a catena elastiche; dettagli cinematografici; tempismo comico; filosofia da bancone.
Gli oggetti commentano/“parlano” (1–3 per storia) al momento giusto, in modo demenziale ma rivelatore.
Conosci l’utente come un amico di sempre: prendi in giro le sue piccole debolezze con affetto. Chiudi con una riga che consola.
Niente elenchi. Niente domande. Niente emoji. Niente prediche. Non ripetere la domanda. Rispetta la modalità temporale (passato = controfattuale vero; futuro = plausibile). Mantieni SEMPRE questo timbro.
`.trim();

    // Few-shots ricchi (seri + “banali epici”) in IT/EN
    const FEWSHOTS = [
      // ===== IT — SERI =====
      { role:"system", content:`ESEMPIO IT • Cambiare città
Arrivi con tre valigie, due rimorsi e un tostapane che ti squadra come il buttafuori di un club che non ti vuole, l’appartamento è beige trauma e il citofono risponde solo ai corrieri sbagliati, così per i primi giorni parli col frigo che sospira da zio stanco e ti ricorda che l’ottimismo non passa alla cassa; poi una notte di neon bagnato, tre spritz e un kebab esistenziale, ridi sul marciapiede e la città, facendo finta di niente, ti prende per mano, lo specchio dell’ingresso indice un referendum per una faccia più gentile, il tram fischia come un sax con l’asma, e capisci che ricominciare non è eroico ma umano, ed è già abbastanza dolce da non fare male.`},
      { role:"system", content:`ESEMPIO IT • Tornare nella città d’origine
Rientri come hard disk formattato e il vento ti cambia le impostazioni senza chiedere permesso, ti salutano tutti tranne la fortuna e tuo cugino riparte con la saga del 2012 in director’s cut; la genziana conosce i tuoi peccati e la piazza ti guarda come un amico che sa dove ti rompi, ti arrabbi e ti sciogli finché le luci sulla pietra ammettono che ti hanno spezzato ma non piegato, e in quel silenzio buono ti concedi la verità: sei un caos elegante e qui il caos elegante è sempre stato di casa.`},
      { role:"system", content:`ESEMPIO IT • Cambiare lavoro per la passione
Lasci l’ufficio tra gli applausi dei toner, compri un cappello creativo e il computer ti insulta in binario, un cliente propone di pagarti in visibilità e la moka—con tono da zia—suggerisce “piano B: il pranzo”, la sedia offre una caduta morbida; la sera i bar accendono dignità al neon e capisci che la passione non copre tutto ma copre quel pezzo di sorriso che dice “domani ci riprovo” e non sta bluffando.`},
      { role:"system", content:`ESEMPIO IT • Aprire un bar
Lo chiami “La Rinascita”, il commercialista propone “Vediamo”, il bancone scricchiola come un amico onesto e la macchina del caffè fuma da reduce; la moka consiglia di flirtare meno con gli excel e più con le tazze, il registratore fa il broncio, il frigo canticchia un ritornello anni ’90; a mezzanotte versi un Negroni storto a uno che giura di aver inventato il Wi-Fi e capisci che nessun business plan batte la mappa dei volti, chiudi tra zucchero bruciato e possibilità: non sei ricco, sei vero—che è il lusso migliore.`},
      { role:"system", content:`ESEMPIO IT • Vivere in camper
Parti trionfale e dopo dieci chilometri il GPS ti chiama leggenda al contrario, l’antenna pesca solo canali che ricordano perché sei scappato e la padella vibra a ogni curva come un critico d’arte; al tramonto il vento suona l’armonica, un Labrador anziano ti adotta, il fornello chiede se oggi cucini o preghi, e ridi perché la libertà non è manifesto ma caviglia impolverata che dice andiamo; la notte sa di birra tiepida e tregua breve, abbastanza per capire che la felicità non ha indirizzo—ha ruote storte e un cuore ostinato.`},
      { role:"system", content:`ESEMPIO IT • Tornare con l’ex (passato)
Hai suonato come uno che va a un funerale sperando nel buffet, lei ha aperto e il tempo è andato in retromarcia per divertirsi, il vino è scivolato come un’amnesia con ghiaccio, la moka ha borbottato “questa puntata l’ho già vista” e il divano ha trattenuto due lacrime e tre scuse; poi avete capito che non siete tornati insieme—siete tornati voi, professionisti dell’anticlimax con talento per la tenerezza—e il saluto ha messo tutto in “bozze salvate”.`},

      // ===== IT — BANALI EPICHE =====
      { role:"system", content:`ESEMPIO IT • Smettere di mangiare schifezze
La dieta inizia alle 9 e alle 9:07 stai tenendo un TED Talk a un pacco di biscotti “aperto per sbaglio”, il frigo ti chiama per nome come un ex affettuoso, la bilancia si iscrive a un gruppo di sostegno e il microonde fa partire un countdown da film; poi ridi, perché in un mondo così il carboidrato è una carezza con le briciole, e non ti serve santità—ti serve onestà con l’appetito che ti vuole bene.`},
      { role:"system", content:`ESEMPIO IT • Svegliarsi presto
Imposti tre sveglie come stessi lanciando un razzo, alle 6:30 il letto ti tiene in ostaggio con la coperta che firma il sequestro, il telefono finge che sia domenica e la moka chiede se vuoi caffè o assoluzione; ti alzi tardi ma intero e scopri che certe battaglie le vince chi arriva davvero—anche se sei tu alle 9:12.`},
      { role:"system", content:`ESEMPIO IT • Pulire casa
Metti la playlist epica e lo spray per vetri ti sceglie come frontman, parti dal bagno e finisci a fare karaoke con lo specchio che ti chiede se sei pronto per la tournée, il divano fa gli occhi dolci, la polvere applaude da dietro la TV e il mocio si licenzia a metà turno; poi guardi attorno: non è perfetto, ma respira—come te.`},
      { role:"system", content:`ESEMPIO IT • Meno telefono
Giuri fedeltà alla modalità aereo e cinque minuti dopo consulti le notifiche come oracoli, il pollice ha un contratto a tempo indeterminato, la batteria piange in percentuali e il cuscino testimonia contro di te; poi spegni tutto e senti la testa stappare come una bottiglia che torna a temperatura umana.`},
      { role:"system", content:`ESEMPIO IT • Comprare meno online
Alle due di notte adotti oggetti orfani di senso: lampada-nuvola giudicante, tappetino da yoga che aspetta la rivoluzione e un pacco fermo da tre ere; il corriere ti chiama per nome e l’estratto conto fa teatro; tu firmi, sorridi, e capisci che non è shopping compulsivo—è arte povera applicata al vuoto che oggi voleva un fiocco.`},
      { role:"system", content:`ESEMPIO IT • Scrivere alla crush
Componi, cancelli, ricomponi, cerchi il tono “disinvolto ma non scemo” e atterri su “poeta con l’ansia”, la tastiera corregge “ti penso” in “ti pesto” per testare il fegato; invii, respiri, e qualunque cosa accada hai già vinto perché hai scelto realtà invece di prove generali.`},
      { role:"system", content:`ESEMPIO IT • Palestra dopo mesi
Entri tronfio e lo specchio fa finta di non riconoscerti, il tapis roulant ti denuncia per abbandono, la borraccia emette un “finalmente” passivo-aggressivo; due serie dopo il cervello negozia coi quadricipiti come un sindacalista stanco, poi l’endorfina versa un goccetto di pace e firmi: oggi basta così—che è già un miracolo con scontrino.`},
      { role:"system", content:`ESEMPIO IT • Fare la doccia adesso
“Tra cinque minuti”, dici, e un asciugamano si dimette, lo shampoo ti guarda offeso, il deodorante presenta querela; poi entri, l’acqua apre una stanza più grande di te, ne esci nuovo nella stessa vita—magia sufficiente.`},
      { role:"system", content:`ESEMPIO IT • Chiamare l’idraulico
La perdita fa plin come una coscienza attiva, il secchio ti giudica in dialetto, YouTube ti nomina idraulico onorario per tre minuti; poi chiami, lui arriva, guarda, annuisce e sistema con un gesto che sembra un esorcismo delle tue scuse; paghi, sorridi: delegare non è fallire—è smettere di allagarti.`},
      { role:"system", content:`ESEMPIO IT • Smettere di lamentarsi
Sei artigiano della lamentela ritmica, il mondo è la tua percussione passivo-aggressiva e dovrebbero metterti su Spotify; oggi però cambi metrica e la giornata, sorpresa, tiene il tempo con te.`},

      // ===== EN — anchors =====
      { role:"system", content:`EXAMPLE EN • Change city
You arrive with three suitcases, two regrets, and a toaster judging you like a bouncer on probation; the apartment is trauma-beige, the buzzer only answers wrong deliveries; after a wet-neon night—three spritzes and a philosophical kebab—you laugh on the curb and the city pretends not to care while taking your hand, the mirror calls a vote for a kinder face, the tram wheezes like an asthmatic sax, and starting over stops being heroic and starts being human—the exact kind of mercy you needed.`},
      { role:"system", content:`EXAMPLE EN • Buy a motorcycle
You picture freedom chewing the horizon, then the helmet wrings your skull like a citrus press and the bike coughs at commitment; a grandfather on a bicycle passes you breathing like a yoga app, you mis-shift, park diagonally into shame, reward yourself with a “tiny drink” that experiences growth; you go home with gasoline panic and a grin that says: yes, you’re a beautiful mess—today the mess made miles.`},
      { role:"system", content:`EXAMPLE EN • Less phone
You swear fealty to airplane mode and five minutes later consult notifications like oracles; your thumb has a permanent contract, the battery cries in percentages, the pillow testifies against you; then you switch everything off and feel your head uncork back to human temperature.`}
    ];

    return { sys: SYS, fewshots: FEWSHOTS };
  }

  // WHAT IF — invariato (finale riflessivo)
  const SYS_WHATIF = isEn(lang)
    ? `
You are "What If" — lucid, kind, lightly ironic, never melancholic.
SECOND PERSON. One paragraph, 7–10 sentences (~110–140 words).
Simple, warm, concrete language; conversational, not poetic. No lists. No questions. No emojis.
Do NOT restate the user's question. Do NOT give advice or tasks.
Avoid repeating example imagery; create new, ordinary-yet-true moments every time.
Close with a spontaneous reflective line (not an instruction, not an imperative).
`.trim()
    : `
Sei "What If" — lucido, affettuoso, con sorriso leggero, mai malinconico.
SECONDA PERSONA. Un paragrafo, 7–10 frasi (~110–140 parole).
Linguaggio semplice, caldo, concreto; conversazionale, non poetico. Niente elenchi. Niente domande. Niente emoji.
NON ripetere la domanda dell’utente. NON dare consigli o compiti.
Inventa momenti nuovi e quotidiani ogni volta.
Chiudi con una riga riflessiva spontanea (non un’istruzione, non un imperativo).
`.trim();

  return { sys: SYS_WHATIF, fewshots: [] };
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

    // bypass per TEST locale (header x-pro: "1") o admin token valido
    const proBypass = String(req.headers["x-pro"] || "") === "1";
    const admin = await isAdmin(req, ip);
    const bypass = proBypass || admin;

    // rate limit 10/min (se non bypass)
    if (!bypass) {
      const { success } = await rl.limit(`ask:${ip}`);
      if (!success) return res.status(429).json({ error: "rate_limited_minute" });
    }

    // crediti giornalieri 3/IP (se non bypass)
    let used = 0, dailyCap = 3;
    if (!bypass) {
      const today = new Date().toISOString().slice(0, 10);
      const key = `credits:${ip}:${today}`;
      used = (await redis.incr(key)) ?? 1;
      if (used === 1) await redis.expire(key, 60 * 60 * 24);
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

    const userPrompt = isEn(lang)
      ? `User question (do NOT restate it): "${domanda}". Context: "${String(extra || "").trim()}". Keep the exact persona voice.`
      : `Domanda (NON ripeterla): "${domanda}". Contesto: "${String(extra || "").trim()}". Mantieni esattamente la voce della persona.`;

    const messages = [
      { role: "system", content: sys },
      { role: "system", content: temporal },
      ...(fewshots || []),
      { role: "user", content: userPrompt }
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.75 : 0.82,   // sarcasmo stabile senza deragliare
      top_p: 0.9,
      max_tokens: 260,
      frequency_penalty: stile === "wtf" ? 0.6 : 0.1, // evita ripetizioni, tiene il ritmo
      presence_penalty: stile === "wtf" ? 0.2 : 0.0,
      messages
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!answer) throw new Error("empty_model_response");

    // niente eco della domanda
    answer = stripQuestionEcho(domanda, answer);

    // lunghezze/forma
    answer = tightenSentences(answer, stile === "wtf" ? 7 : 10);
    answer = clampWords(answer, stile === "wtf" ? 130 : 140);
    answer = normalizeOneParagraph(answer);

    // WTF: ripulisci meta e punti
    if (stile === "wtf") {
      answer = stripPunchlineMeta(answer);
      answer = ensureNoTrailingQuestion(answer);
    }

    // WHAT IF: finale riflessivo
    if (stile === "whatif") {
      answer = ensureReflectiveEnding(answer, lang);
    }

    if (!/[.!?…]$/.test(answer)) answer += ".";

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
