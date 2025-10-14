// api/ask.js (CommonJS) — VERSIONE ROBUSTA
// Funziona su Node 14/16/18+ (no ESM necessario).
// Se OPENAI_API_KEY manca o fallisce la chiamata → fallback locale (niente errori).

const express = require("express");
const { Readable } = require("stream");

// fetch on-demand (compatibile Node <18)
const fetchCompat = async (...args) => {
  try {
    const mod = await import("node-fetch");
    return mod.default(...args);
  } catch {
    // Se node-fetch non è installato, l'IA salta ma il server NON esplode
    throw new Error("NO_FETCH");
  }
};

// ====== Utils ======
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const safeStr = (s) => (s || "").toString();

const pick = (obj = {}, keys = []) =>
  keys.reduce((o, k) => (obj[k] !== undefined ? ((o[k] = obj[k]), o) : o), {});

function firstName(profilo = {}) {
  const n = safeStr(profilo.name || "").trim();
  if (!n) return "";
  return n.split(/\s+/)[0];
}

function extractKeywords(q) {
  const s = safeStr(q).toLowerCase();
  return s
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 6);
}

function buildFollowups(q, ans, lang = "it") {
  const base = safeStr(q);
  const a = safeStr(ans);
  const brief = a.replace(/\s+/g, " ").slice(0, 220);

  const it = lang !== "en";
  const f1 = it
    ? `Vuoi che esplori il prossimo passo pratico legato a “${base}”?`
    : `Want me to explore the next practical step for “${base}”?`;
  const f2 = it
    ? `Preferisci un episodio 2 che continui esattamente da qui (${brief}…)?`
    : `Prefer Episode 2 that continues right from here (${brief}…)?`;

  return [f1, f2];
}

function sanitizeLines(style, raw) {
  let out = safeStr(raw).replace(/[“”«»]/g, '"').trim();
  const banned = /\b(nostalgia|sussurr\w*|liric\w*|fiab\w*|cuore infranto|destino crudele)\b/gi;
  out = out.replace(banned, "");

  let lines = out
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (style === "wtf") {
    lines = lines.slice(0, 11);
    while (lines.length < 7) lines.push(".");
  } else {
    lines = lines.slice(0, 13);
    while (lines.length < 9) lines.push(".");
  }

  const last = lines[lines.length - 1] || "";
  if (!/domani|prossim|continua|segu/i.test(last)) {
    if (style === "wtf") {
      lines.push("Ok amico, domani ti do il seguito — porta il ghiaccio.");
    } else {
      lines.push("Continuiamo a conoscerci: domani ti chiedo due cose e portiamo avanti la storia.");
    }
  }

  return lines.join("\n").replace(/\n\./g, "");
}

function localClarify(q, lang = "it", periodo = "future") {
  const it = lang !== "en";
  const kw = extractKeywords(q);
  const topic = kw[0] || (it ? "il tema" : "the topic");

  if (periodo === "past") {
    return [
      {
        id: "pivot_year",
        label: it ? "In che anno avresti davvero cambiato rotta?" : "Which year was the real turning point?",
        placeholder: it ? "es. 2015 (trasferimento) / 2010 (offerta)" : "e.g., 2015 move / 2010 offer",
      },
      {
        id: "context_then",
        label: it ? "Dove e con chi eri allora?" : "Where and with whom back then?",
        placeholder: it ? "città, squadra, famiglia" : "city, team, family",
      },
      {
        id: "signal",
        label: it ? "Che segnale ti direbbe che ha funzionato?" : "What signal would say it worked?",
        placeholder: it ? "persona, cifra, risultato" : "person, metric, outcome",
      },
    ];
  }

  return [
    {
      id: "time_window",
      label: it ? "Qual è la tua finestra decisionale reale?" : "What is your real decision window?",
      placeholder: it ? "questo mese / 3–6 mesi" : "this month / 3–6 months",
    },
    {
      id: "success_indicator",
      label: it ? `Un indicatore di successo su ${topic}?` : `One success indicator about ${topic}?`,
      placeholder: it ? "€ risparmiati, ore, primo cliente" : "€ saved, hours, first client",
    },
    {
      id: "constraint",
      label: it ? "Vincolo concreto da non ignorare?" : "Concrete constraint you can’t ignore?",
      placeholder: it ? "budget, tempo, energia" : "budget, time, energy",
    },
  ];
}

function localGenerate({ domanda, stile, lang, profilo }) {
  const it = lang !== "en";
  const name = firstName(profilo);
  const you = name ? (it ? name : name) : it ? "Ehi" : "Hey";

  const q = safeStr(domanda);
  const baseWho = it
    ? `${you}, ti conosco: non stai scappando, stai scegliendo aria più tua.`
    : `${you}, I know you: you’re not running away—you’re choosing air that fits.`;

  if (stile === "wtf") {
    const t = it
      ? `${baseWho}
${q}? Ma sì, cosa può andare storto: due decisioni impulsive e tre brindisi ben piazzati.
Qui anche il vento ha l’abbonamento mensile e il barista ti saluta per nome (pure quando fingi sobrietà).
Ti vedo: fai il serio per dieci minuti, poi ordini “l’ultimo” e diventa penultimo.
Il bello? Ti senti vivo senza dover fare finta di esserlo.
Promemoria: non sei pazzo, sei in manutenzione con ghiaccio.
Se serve, domani attacco io il racconto — tu porta i cubetti.`
      : `${baseWho}
${q}? Sure, what could possibly go wrong: two impulsive choices and three perfectly timed drinks.
Even the wind here pays a monthly subscription and the bartender knows your name (especially when you fake sobriety).
I see you: serious for ten minutes, then you order “the last one” which becomes the second to last.
The good part? You feel alive without pretending.
Reminder: you’re not crazy; you’re under maintenance, on the rocks.
If needed, I’ll pick up the story tomorrow — you bring the ice.`;

    return sanitizeLines("wtf", t);
  }

  const t = it
    ? `${baseWho}
${q}. Non per ricominciare da zero: per ricominciare da te.
Ti bastano ritmo giusto, facce giuste, obiettivi chiari.
Le cose serie arrivano quando smetti di farle sembrare importanti.
Oggi scegli il passo che puoi fare; domani scegli quello che ti fa bene.
È così che si ricostruisce senza romanzare niente.
Continuiamo a conoscerci: domani ti chiedo due cose e portiamo avanti la storia.`
    : `${baseWho}
${q}. Not to start from zero — to start from you.
You need the right rhythm, the right faces, and clear goals.
Serious things happen when you stop making them sound important.
Today pick the step you can take; tomorrow the one that feels right.
That’s how you rebuild without romanticizing it.
Let’s keep getting to know you: tomorrow I’ll ask two things and we’ll move the story forward.`;

  return sanitizeLines("whatif", t);
}

// ====== OpenAI (opzionale) ======
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function openAIClarify({ domanda, lang, periodo, stile, profilo }) {
  if (!OPENAI_API_KEY) return null;

  const sys = `
You are "What?f", a lean clarifier.
Task: ask 2–3 SHORT, concrete questions that reduce ambiguity about the user's "what if" prompt.
Language: ${lang}.
Constraints:
- Tie each question DIRECTLY to the user's prompt.
- No poetry, no coaching clichés.
- Keep it friendly and concise.
Return as an array ONLY: [{id,label,placeholder}], max 3.
`;

  const user = JSON.stringify({
    prompt: domanda,
    period: periodo,
    style: stile,
    profile: pick(profilo, ["name", "city_now", "work_role"]),
  });

  try {
    const r = await fetchCompat("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!r.ok) throw new Error("OPENAI_BAD_STATUS");
    const j = await r.json();
    const txt = j?.choices?.[0]?.message?.content || "{}";
    let parsed = {};
    try {
      parsed = JSON.parse(txt);
    } catch {
      parsed = {};
    }
    if (Array.isArray(parsed)) {
      return parsed.slice(0, 3).map((q, i) => ({
        id: q.id || `c${i + 1}`,
        label: safeStr(q.label || q.text || "—"),
        placeholder: safeStr(q.placeholder || ""),
      }));
    }
    if (Array.isArray(parsed.questions)) {
      return parsed.questions.slice(0, 3).map((q, i) => ({
        id: q.id || `c${i + 1}`,
        label: safeStr(q.label || q.text || "—"),
        placeholder: safeStr(q.placeholder || ""),
      }));
    }
    return null;
  } catch {
    return null;
  }
}

async function* openAIStreamGenerate({ domanda, lang, periodo, stile, profilo }) {
  if (!OPENAI_API_KEY) return null;

  const name = firstName(profilo);
  const it = lang !== "en";

  const sys =
    stile === "wtf"
      ? `You are "What the F": sarcastic, bar-humor, tipsy but kind. Make the user LAUGH, never cruel. No melancholy. No poetry.
- Language: ${lang}
- Length: 7–11 short lines.
- If you know the user's name, weave it once naturally (${name || "no name"}).
- End with a playful forward hook like: "${it ? "Ok amico, domani ti do il seguito — porta il ghiaccio." : "Alright pal, I’ll spill the sequel tomorrow — bring ice."}"
- No lists, no disclaimers.`
      : `You are "What?f": empathetic, dry, positive. Not a coach. No sadness, no poetry.
- Language: ${lang}
- Length: 9–13 short lines.
- If you know the user's name, weave it once naturally (${name || "no name"}).
- End with a forward hook like: "${it ? "Continuiamo a conoscerci: domani ti chiedo due cose e portiamo avanti la storia." : "Let’s keep getting to know you: tomorrow I’ll ask two things and we’ll move the story forward."}"
- No lists, no disclaimers.`;

  const user = `${domanda}\n\nPeriod: ${periodo}. Style: ${stile}. Name: ${name || "-"}.\nTone rules strictly enforced.`;

  let resp;
  try {
    resp = await fetchCompat("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.9,
        stream: true,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      }),
    });
  } catch {
    return null;
  }

  if (!resp || !resp.ok || !resp.body) return null;

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      if (!part.startsWith("data:")) continue;
      const json = part.slice(5).trim();
      if (json === "[DONE]") return;
      try {
        const delta = JSON.parse(json);
        const tok = delta?.choices?.[0]?.delta?.content;
        if (tok) yield tok;
      } catch {
        /* ignore chunk */
      }
    }
  }
}

// ====== Router ======
const router = express.Router();
router.use(express.json({ limit: "1mb" }));

// health/test
router.get("/", (_req, res) => {
  res.json({ ok: true, msg: "What?f /api/ask alive" });
});

// Body: { domanda, lang, periodo, stile, clarify, stream, profilo }
router.post("/", async (req, res) => {
  try {
    const {
      domanda = "",
      lang = "it",
      periodo = "future",
      stile = "whatif",
      clarify = false,
      profilo = {},
    } = req.body || {};

    const wantStream = (req.get("x-whatif-stream") || "").toString() === "1";
    const q = safeStr(domanda).trim();

    if (!q) {
      if (clarify) return res.json({ questions: localClarify("?", lang, periodo) });
      return res.status(400).json({ error: "Missing 'domanda'." });
    }

    // ===== CLARIFY =====
    if (clarify) {
      let questions = await openAIClarify({ domanda: q, lang, periodo, stile, profilo });
      if (!questions || !questions.length) questions = localClarify(q, lang, periodo);
      return res.json({ questions });
    }

    // ===== GENERATE =====
    if (wantStream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      let full = "";
      let usedAI = false;

      try {
        const gen = await openAIStreamGenerate({ domanda: q, lang, periodo, stile, profilo });
        if (gen) {
          usedAI = true;
          for await (const tok of gen) {
            full += tok;
            res.write(`data: ${JSON.stringify({ token: tok })}\n\n`);
          }
        }
      } catch {
        // fallback sotto
      }

      if (!usedAI) {
        const text = localGenerate({ domanda: q, stile, lang, profilo });
        full = text;
        const chunks = text.match(/.{1,60}(\s|$)/g) || [text];
        for (const c of chunks) res.write(`data: ${JSON.stringify({ token: c })}\n\n`);
      }

      const clean = sanitizeLines(stile, full);
      const followups = buildFollowups(q, clean, lang);
      res.write(`data: ${JSON.stringify({ done: true, followups })}\n\n`);
      return res.end();
    }

    // non-stream
    let answer = null;
    if (OPENAI_API_KEY) {
      try {
        const name = firstName(profilo);
        const it = lang !== "en";
        const sys =
          stile === "wtf"
            ? `You are "What the F": sarcastic, bar-humor, tipsy but kind. Make the user LAUGH, never cruel. No melancholy. No poetry.
- Language: ${lang}
- Length: 7–11 short lines.
- If you know the user's name, weave it once naturally (${name || "no name"}).
- End with: "${it ? "Ok amico, domani ti do il seguito — porta il ghiaccio." : "Alright pal, I’ll spill the sequel tomorrow — bring ice."}"`
            : `You are "What?f": empathetic, dry, positive. Not a coach. No sadness, no poetry.
- Language: ${lang}
- Length: 9–13 short lines.
- If you know the user's name, weave it once naturally (${name || "no name"}).
- End with: "${it ? "Continuiamo a conoscerci: domani ti chiedo due cose e portiamo avanti la storia." : "Let’s keep getting to know you: tomorrow I’ll ask two things and we’ll move the story forward."}"`;

        const user = `${q}\n\nPeriod: ${periodo}. Style: ${stile}. Name: ${name || "-"}.\nTone rules strictly enforced.`;

        const r = await fetchCompat("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            temperature: 0.9,
            messages: [
              { role: "system", content: sys },
              { role: "user", content: user },
            ],
          }),
        });

        if (r.ok) {
          const j = await r.json();
          answer = j?.choices?.[0]?.message?.content || null;
        }
      } catch {
        answer = null;
      }
    }

    if (!answer) answer = localGenerate({ domanda: q, stile, lang, profilo });
    else answer = sanitizeLines(stile, answer);

    const followups = buildFollowups(q, answer, lang);
    return res.json({ answer, followups });
  } catch (e) {
    // Qualsiasi errore inatteso → 200 con fallback (mai 500)
    const domanda = safeStr(req.body?.domanda || "");
    const stile = safeStr(req.body?.stile || "whatif");
    const lang = safeStr(req.body?.lang || "it");
    const profilo = req.body?.profilo || {};
    const answer = localGenerate({ domanda, stile, lang, profilo });
    const followups = buildFollowups(domanda, answer, lang);
    return res.status(200).json({ answer, followups, fallback: true });
  }
});

module.exports = router;
