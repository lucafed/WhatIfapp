// server.js
// Backend leggero per /api/ask con stili, clarify e stream episodi.

import express from "express";
import cors from "cors";

// === Config base ===
const PORT = process.env.PORT || 8787;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // obbligatoria
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini"; // puoi cambiarlo

if (!OPENAI_API_KEY) {
  console.error("❌ Missing OPENAI_API_KEY");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// === Util ===
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const safe = (s) => (typeof s === "string" ? s : "");
const firstName = (name) => safe(name).trim().split(/\s+/)[0] || "";
const nowISO = () => new Date().toISOString();

// lingua semplice
function detectLang(text = "") {
  const enHits = (text.match(/\b(what|if|and|or|you|would|move|work|buy|motor|bike|city)\b/gi) || []).length;
  const itHits = (text.match(/\b(e|se|quando|perché|moto|tornassi|trasferir|lavor|comprare|acquistare)\b/gi) || []).length;
  return enHits > itHits ? "en" : "it";
}

// === Stili: system prompt + esempi decisi ===
function systemForStyle({ stile = "whatif", nome = "", lang = "it" }) {
  const you = nome ? firstName(nome) : (lang === "en" ? "friend" : "amico");
  if (stile === "wtf") {
    // WHAT THE F — sarcastico allegro, da bar, “lucidamente ubriaco”, mai cattivo, niente malinconia
    return {
      role: "system",
      content: `
Parla come un barista brillante, ironico, "lucidamente ubriaco", ma buono. Fai ridere senza essere cattivo.
Zero malinconia, zero acidità. Ritmo parlato, confidenziale, con calore. Frasi piene, non spezzettate a caso.
Se conosci il nome, usalo in modo naturale (tipo: "Oh ${you}, senti qui").
Chiudi sempre con un gancio che promette il seguito, es: "Tieniti libero, ${you}: domani continuo il pezzo buono."

Tono da seguire (italiano):
Esempio 1 (Aquila):
"Tornare all’Aquila? Grande mossa: aria fresca, montagne gratis e caffè che sa di chiacchiera vera.
Qui anche il traffico ha la decenza di salutarti prima di bloccarti. Ti siedi al bancone,
il barista ti riconosce e finge di non sapere quante ne hai bevute. Parli, ridi, qualcuno ti offre un giro
e all’improvviso il tempo smette di correre. Non c’è cinismo, solo quel tipo di confusione che fa bene al fegato e alla testa.
Dai, non sei scappato: hai solo cambiato musica. Clink."
(Finale: "Tieniti libero, ${you}: domani continuo il pezzo buono.")

Esempio 2 (Moto):
"Comprare una moto? Certo, ${you}. Due ruote, tre scuse e quel sorriso da casco.
Primi giorni: tu felice, conti così-così, e tua madre che accende ceri ai santi delle sospensioni.
Poi trovi il tuo giro: niente code, più vento, e una playlist di curve che risolve anche i lunedì.
Se piove? Ti prendi un cappuccino in più e ti senti un esploratore urbano.
E comunque il bar ti rispetta: con la moto arrivi e tutti fanno finta di non guardare, ma guardano eccome."
(Finale: "Tieniti libero, ${you}: domani continuo il pezzo buono.")

Regole:
- Niente tristezza, niente moralismi.
- Battute intelligenti, ritmo e calore.
- Sembra che tu conosca l'utente da tempo.
- Lunghezza 8-12 frasi piene.
`.trim()
    };
  }

  // WHAT?F — empatico, asciutto, positivo, amico che ti conosce, zero poesia zuccherosa
  return {
    role: "system",
    content: `
Parla come un amico che conosce bene ${you}: empatico, asciutto, positivo.
Zero poesia smielata, zero malinconia. Linguaggio concreto, visivo quanto basta.
Sembra sempre che tu abbia già visto un pezzetto del seguito (ma senza spoiler larghi).
Chiudi con una promessa morbida, es: "Continuiamo a conoscerci, ${you}: domani ti dico chi incontri e dove ti porta."

Tono da seguire (italiano):
Esempio 1 (Aquila):
"Non lo faresti per scappare, ma per respirare meglio. Ti serve ogni tanto: tornare dove le giornate hanno il ritmo giusto,
dove ti basta poco per stare bene. All’Aquila potresti ricominciare senza dover ricominciare da zero — solo con un passo più tuo.
La gente giusta, il caffè di sempre, e quella sensazione di 'ok, adesso va bene così'. Quando succede lo riconosci subito:
non è nostalgia, è equilibrio che torna."
(Finale: "Continuiamo a conoscerci, ${you}: domani ti dico chi incontri e dove ti porta.")

Esempio 2 (Moto):
"La compreresti per muoverti più libero, non per correre. I primi giorni ti cambiano l’umore:
meno attese, più strada tua. Ti accorgi che non ti serve fare il ‘tipo da moto’: ti basta usarla per quello che ti serve davvero.
Se piove, la prendi con calma. Se è sole, allunghi il giro di cinque minuti e stai meglio di mezz’ora di palestra."
(Finale: "Continuiamo a conoscerci, ${you}: domani ti dico chi incontri e dove ti porta.")

Regole:
- Parlato naturale, positivo, concreto.
- Mostra una scena vera, corta.
- Lunghezza 9-12 frasi piene.
`.trim()
  };
}

// === Episodi: sfumature per episode:1/2 ===
function episodeNudge(extra = "", lang = "it") {
  const ep2 = /episode:\s*2/i.test(extra || "");
  if (lang === "en") {
    return ep2
      ? "This is episode 2: continue naturally from where episode 1 would have ended. Keep the tone and promise a gentle tomorrow hook."
      : "This is episode 1: set the scene and end with a soft promise to continue tomorrow.";
  }
  return ep2
    ? "Questo è l'episodio 2: continua in modo naturale da dove l'episodio 1 avrebbe chiuso. Mantieni il tono e la promessa di domani."
    : "Questo è l'episodio 1: imposta la scena e chiudi con una promessa morbida di continuare domani.";
}

// === Prompt utente (include domanda + micro/clarifications + profilo) ===
function userPrompt({ domanda, profilo = {}, clarifications = {}, periodo = "future", extra = "" }) {
  const lang = detectLang(domanda || "");
  const p = profilo || {};
  const name = p.name || p.nome || p.first_name || "";
  const role = p.work_role || p.role || "";
  const city = p.city_now || p.city || "";
  const clar = clarifications || {};

  const lines = [];
  lines.push(lang === "en" ? `Question: ${safe(domanda)}` : `Domanda: ${safe(domanda)}`);
  lines.push(lang === "en" ? `Timeframe: ${periodo}` : `Periodo: ${periodo}`);

  // profilo lean (solo se presente)
  const tags = [];
  if (name) tags.push((lang === "en" ? "name" : "nome") + `:${firstName(name)}`);
  if (role) tags.push((lang === "en" ? "role" : "ruolo") + `:${role}`);
  if (city) tags.push((lang === "en" ? "city" : "città") + `:${city}`);
  if (tags.length) lines.push((lang === "en" ? "Profile" : "Profilo") + ": " + tags.join(" · "));

  // chiarimenti micro
  const clarKeys = Object.keys(clar).filter(k => safe(clar[k]).trim());
  if (clarKeys.length) {
    lines.push((lang === "en" ? "Clarifications" : "Chiarimenti") + ":");
    clarKeys.forEach(k => lines.push(`- ${k}: ${clar[k]}`));
  }

  // episodio
  lines.push(episodeNudge(extra, lang));

  // chiusura guida sugli hook (ridondanza minima)
  if (lang === "en") {
    lines.push("End with a gentle tomorrow-hook. No sadness, no bitterness.");
  } else {
    lines.push("Chiudi con un gancio per domani. Niente tristezza, niente acidità.");
  }

  return lines.join("\n");
}

// === Prompt Clarify (chiedi 2–3 domande mirate sul topic + persona) ===
function clarifyPrompt({ domanda, profilo = {}, periodo = "future" }) {
  const lang = detectLang(domanda || "");
  const p = profilo || {};
  const name = firstName(p.name || p.nome || "");

  if (lang === "en") {
    return `
Given the user question, ask 2–3 SHORT, on-topic clarification questions in JSON:
[{ "id": "string", "label": "short question", "placeholder": "short hint" }, ...]
Mix 1–2 contextual questions about the topic and 1 about the person (to personalize tone).

Constraints:
- Be specific to the question.
- No poetry, no generic “tell me more”.
- Keep it one-line each.
- If user name "${name}" exists, you may mention it once naturally.

User question: ${safe(domanda)}
Timeframe: ${periodo}
Return ONLY JSON.
`.trim();
  }

  return `
In base alla domanda dell’utente, proponi 2–3 domande di chiarimento MIRATE in JSON:
[{ "id": "string", "label": "domanda breve", "placeholder": "suggerimento breve" }, ...]
Mescola 1–2 domande contestuali sul tema e 1 sulla persona (per personalizzare il tono).

Vincoli:
- Specifiche rispetto alla domanda.
- Niente poesia, niente “dimmi di più” generici.
- Una riga ciascuna.
- Se esiste il nome "${name}", puoi citarlo una volta in modo naturale.

Domanda utente: ${safe(domanda)}
Periodo: ${periodo}
Restituisci SOLO JSON.
`.trim();
}

// === Call OpenAI (non-stream) ===
async function openAIChat({ messages, temperature = 0.8, max_tokens = 600 }) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: clamp(temperature, 0, 2),
      max_tokens: clamp(max_tokens, 1, 4096)
    })
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`OpenAI error ${r.status}: ${t}`);
  }
  return r.json();
}

// === Call OpenAI (stream) → forward SSE minimalista ===
async function openAIStream({ messages, temperature = 0.9, max_tokens = 800, res }) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: clamp(temperature, 0, 2),
      max_tokens: clamp(max_tokens, 1, 4096),
      stream: true
    })
  });
  if (!r.ok || !r.body) {
    const t = await r.text().catch(() => "");
    throw new Error(`OpenAI stream error ${r.status}: ${t}`);
  }

  // Setup SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  let done = false;
  let full = "";

  const reader = r.body.getReader();
  const decoder = new TextDecoder();

  function send(dataObj) {
    res.write(`data: ${JSON.stringify(dataObj)}\n\n`);
  }

  try {
    while (true) {
      const { value, done: doneRead } = await reader.read();
      if (doneRead) break;
      const chunk = decoder.decode(value, { stream: true });

      // OpenAI SSE: split in righe "data: ..."
      const lines = chunk.split("\n");
      for (const line of lines) {
        const m = line.match(/^data:\s*(.*)$/);
        if (!m) continue;
        const payload = m[1].trim();
        if (payload === "[DONE]") {
          done = true;
          break;
        }
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content || "";
          if (delta) {
            full += delta;
            send({ token: delta, done: false });
          }
        } catch {
          // ignora heartbeat o linee non JSON
        }
      }
      if (done) break;
    }
  } catch (err) {
    send({ error: "stream_error", detail: String(err?.message || err) });
  } finally {
    send({ done: true });
    res.end();
  }
}

// === /api/ask ===
app.post("/api/ask", async (req, res) => {
  try {
    const {
      domanda = "",
      lang,
      periodo = "future",
      stile = "whatif",
      clarify = false,
      stream = false,
      profilo = {},
      clarifications = {},
      extra = ""
    } = req.body || {};

    const theLang = lang || detectLang(domanda);
    const system = systemForStyle({
      stile,
      nome: profilo?.name || profilo?.nome || "",
      lang: theLang
    });

    if (clarify) {
      // === CLARIFY MODE ===
      const cp = clarifyPrompt({ domanda, profilo, periodo });
      const messages = [
        system,
        { role: "user", content: cp }
      ];
      const out = await openAIChat({ messages, temperature: 0.5, max_tokens: 300 });
      const text = out.choices?.[0]?.message?.content?.trim() || "[]";

      // prova parse JSON robusto
      let questions = [];
      try {
        // estrai primo JSON valido
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          questions = JSON.parse(jsonMatch[0]);
        } else {
          const objMatch = text.match(/\{[\s\S]*\}/);
          if (objMatch) {
            const single = JSON.parse(objMatch[0]);
            questions = Array.isArray(single) ? single : [single];
          }
        }
      } catch {}
      // fallback se vuoto
      if (!Array.isArray(questions) || !questions.length) {
        const s = domanda.toLowerCase();
        if (/moto|motor/.test(s)) {
          questions = [
            { id: "timing", label: "Quando la compreresti davvero?", placeholder: "questo mese / 3–6 mesi" },
            { id: "use", label: "Uso principale?", placeholder: "casa-lavoro / weekend / viaggi" },
            { id: "budget", label: "Tetto mensile?", placeholder: "€ per assicurazione+benzina" }
          ];
        } else if (/aquila|l'aquila|trasfer/.test(s)) {
          questions = [
            { id: "window", label: "Finestra realistica per spostarti?", placeholder: "entro 3 mesi / 6–12 mesi" },
            { id: "anchor", label: "Cosa ti tiene dove sei ora?", placeholder: "famiglia / lavoro / costi" },
            { id: "signal", label: "Segnale che dice: è la scelta giusta?", placeholder: "sonno / energia / prima risposta" }
          ];
        } else {
          questions = [
            { id: "time_window", label: "Finestra decisione?", placeholder: "questo mese / 3–6 / 12 mesi" },
            { id: "success_indicator", label: "Indicatore verificabile in 30 gg?", placeholder: "€ / ore / primo cliente" },
            { id: "real_constraint", label: "Vincolo concreto?", placeholder: "budget / tempo / energia" }
          ];
        }
      }

      res.json({ ok: true, questions });
      return;
    }

    // === GENERATION MODE ===
    const user = {
      role: "user",
      content: userPrompt({
        domanda,
        profilo,
        clarifications,
        periodo,
        extra
      })
    };

    const messages = [system, user];

    // streaming?
    const wantsStream = stream || (req.get("x-whatif-stream") === "1");
    if (wantsStream) {
      await openAIStream({
        messages,
        temperature: stile === "wtf" ? 0.95 : 0.85,
        max_tokens: 900,
        res
      });
      return;
    }

    // non-stream (fallback)
    const out = await openAIChat({
      messages,
      temperature: stile === "wtf" ? 0.95 : 0.85,
      max_tokens: 900
    });
    const text = out.choices?.[0]?.message?.content?.trim() || "";
    res.json({ ok: true, text });
  } catch (err) {
    console.error("ask error:", err);
    res.status(500).json({ ok: false, error: "server_error", detail: String(err?.message || err) });
  }
});

// === avvio ===
app.listen(PORT, () => {
  console.log(`✅ /api/ask up on http://localhost:${PORT}  (model: ${OPENAI_MODEL})  ${nowISO()}`);
});
