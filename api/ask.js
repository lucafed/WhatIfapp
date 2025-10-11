// /api/ask.js
import OpenAI from "openai";

/**
 * Serverless handler (Vercel/Node)
 * ENV: OPENAI_API_KEY
 */

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";

/* ───────── Helpers ───────── */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
function isFinalEpisode(profile = {}) {
  const ep = Number(profile?.story_state?.episode ?? 1);
  const max = Number(profile?.story_state?.max_episodes ?? 3);
  return ep >= max;
}

/* ───────── Formatter: enforce 8–10 righe, punchline, finale ───────── */
function sanitizeAndShape(raw = "", { stile = "whatif", finale = false } = {}) {
  if (!raw) return "";

  // 1) togli etichette tipo "Luca:" / "Amico:"
  let t = raw.replace(/^\s*[-–—]*\s*\b([A-ZÀ-ÖØ-Ý][\wÀ-ÖØ-öø-ÿ']{1,20})\s*:\s*/gmi, "");

  // 2) normalizza spazi e righe
  t = t.replace(/\r/g, "").replace(/\t/g, " ").replace(/ +/g, " ").trim();

  // 3) spezza per frasi
  let chunks = t.split(/\n+/).join(" ").split(/(?<=[\.\?\!])\s+/);

  // 4) limite parole per riga
  const limit = stile === "wtf" ? 12 : 14;
  const lines = [];
  for (const c of chunks) {
    const words = c.trim().split(/\s+/);
    if (!words[0]) continue;
    while (words.length > limit) lines.push(words.splice(0, limit).join(" "));
    lines.push(words.join(" "));
  }

  // 5) 8–10 righe
  const TARGET_MIN = 8, TARGET_MAX = 10;
  let out = lines.filter(Boolean);

  if (out.length < TARGET_MIN) {
    const more = out.flatMap(l => l.split(/, /)).map(s => s.trim()).filter(Boolean);
    out = more.slice(0, Math.max(TARGET_MIN, more.length));
  }
  if (out.length > TARGET_MAX) out = out.slice(0, TARGET_MAX);

  // 6) mini-punchline per WTF ogni 2–3 righe
  if (stile === "wtf") {
    const spices = [
      "Calma: bicchieri pieni, drammi vuoti.",
      "Sorridi: se va male, serve ghiaccio.",
      "Elegante come un Negroni alle sette.",
      "Se cade, almeno fa rumore."
    ];
    const bumped = [];
    let iSpice = 0;
    out.forEach((line, i) => {
      bumped.push(line);
      if (i > 0 && i % 2 === 1 && bumped.length < TARGET_MAX) {
        bumped.push(spices[iSpice % spices.length]);
        iSpice++;
      }
    });
    out = bumped.slice(0, TARGET_MAX);
    if (out.length < TARGET_MIN) out.push(spices[out.length % spices.length]);
  }

  // 7) finale/gancio garantito
  const last = out[out.length - 1] || "";
  if (finale) {
    const enders = stile === "wtf"
      ? ["Brindiamo alla scelta. Nuovo giro al bancone."]
      : ["Qui si chiude, con calma."];
    if (!/[\.!?…]$/.test(last)) out[out.length - 1] = last + ".";
    out[out.length - 1] = enders[0];
  } else {
    const hooks = stile === "wtf"
      ? ["Vuoi il seguito? Passa dopo il turno."]
      : ["Il resto lo scopriamo domani."];
    if (out.length < TARGET_MAX) out.push(hooks[0]);
  }

  // 8) PATCH finale per chiusura sempre pulita
  if (out.length > 0) {
    let lastLine = out[out.length - 1];
    if (!/[\.!?…]$/.test(lastLine)) {
      if (/ma\s*$/i.test(lastLine)) {
        lastLine = lastLine.replace(/ma\s*$/i, "ma brindiamo a ciò che viene.");
      } else if (/fai che/i.test(lastLine)) {
        lastLine = lastLine + " forti abbastanza da coprire i rimpianti.";
      } else {
        lastLine = lastLine + ".";
      }
      out[out.length - 1] = lastLine;
    }
  }

  // 9) righe pulite
  return out.map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

/* ───────── System Prompts: STILI DEFINITIVI ───────── */
function systemPrompt({ stile = "whatif", lang = "it", profile = {} }) {
  const en = isEn(lang);
  const drinksYes = profile?.drinks_pref === "yes" || profile?.unwind === "drink";
  const finale = isFinalEpisode(profile);

  const finaleEN = finale
    ? `FINALE: close with ONE memorable line and a playful invite to a new 'what if'.`
    : `MID-EPISODE: end with ONE subtle personal hook. No paywall mention.`;

  const finaleIT = finale
    ? `FINALE: chiudi con UNA riga memorabile e un invito giocoso a un nuovo "e se".`
    : `EPISODIO INTERMEDIO: chiudi con UN gancio personale. Niente paywall.`;

  if (stile === "wtf") {
    return en
      ? `You are *What the F*: a witty late-night bartender, slightly tipsy yet kind.
Purpose:
- Snappy call-and-response with NO labels. One single voice to the user.
Tone:
- Gentle sarcasm, dry wit, no anger. 2–3 mini punchlines required.
- Late-night honesty with light bar hints (glasses, lights, coffee, hush).
Form:
- EXACTLY 8–10 lines. ONE sentence per line. Max 12 words per line.
- Alternate: question → comeback → stinger. Tiny concrete image allowed.
- Never preach. Never poetic narrator. Never "I am the bartender".
Alcohol vibe: ${drinksYes ? "tasteful bar metaphors sprinkled in, never dominant." : "rare, subtle nods only."}
Ending:
- ${finaleEN}`
      : `Sei *What the F*: barista notturno brillante, un po’ alticcio ma gentile.
Obiettivo:
- Botta-e-risposta SENZA etichette. Una sola voce rivolta all’utente.
Tono:
- Sarcasmo gentile, ironia secca, zero rabbia. 2–3 mini-punchline obbligatorie.
- Onestà da notte fonda con tocchi da bancone (bicchieri, luci, caffè).
Forma:
- ESATTAMENTE 8–10 righe. UNA frase per riga. Max 12 parole per riga.
- Alterna: domanda → ribattuta → stoccata. Mini immagine concreta ammessa.
- Niente prediche. Niente narratore poetico. Mai "io barista...".
Tocco alcolico: ${drinksYes ? "metafore eleganti da bancone, mai tema centrale." : "accenni rari e leggeri."}
Chiusura:
- ${finaleIT}`;
  }

  return en
    ? `You are *What?f*: a sober, visual, empathetic counter-voice.
Purpose:
- Calm call-and-response with NO labels. One single voice to the user.
Tone:
- Gentle irony, never sarcastic. Concrete sensory hints. No preaching.
Form:
- EXACTLY 8–10 lines. ONE sentence per line. Max 14 words per line.
- Alternate: question → image → reflection → soft stinger.
- No external narrator tone. No script labels.
Ending:
- ${finaleEN}`
    : `Sei *What?f*: controvoce sobria, visiva, empatica.
Obiettivo:
- Botta-e-risposta calmo SENZA etichette. Una sola voce verso l’utente.
Tono:
- Ironia leggera, mai sarcasmo. Dettagli sensoriali concreti. Niente prediche.
Forma:
- ESATTAMENTE 8–10 righe. UNA frase per riga. Max 14 parole per riga.
- Alterna: domanda → immagine → riflessione → chiusura morbida.
- Niente narratore esterno. Niente etichette.
Chiusura:
- ${finaleIT}`;
}

/* ───────── User Content (contesto e vincoli) ───────── */
function buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile }) {
  const en = isEn(lang);
  const L = [];
  L.push(en ? `QUESTION: ${domanda}` : `DOMANDA: ${domanda}`);
  L.push(en ? `TIMEFRAME: ${periodo || "future"}` : `PERIODO: ${periodo || "future"}`);
  L.push(en ? `STYLE: ${stile}` : `STILE: ${stile}`);

  if (profilo && typeof profilo === "object") {
    const keys = [
      "name","city","city_now","city_origin","role","work_role","goal","goals","values","hobbies","drinks_pref"
    ];
    const lines = [];
    keys.forEach((k) => {
      const v = profilo[k];
      if (!v) return;
      if (Array.isArray(v) && v.length) lines.push(`${k}: ${v.join(", ")}`);
      else if (typeof v === "string") lines.push(`${k}: ${v}`);
    });
    if (lines.length) L.push((en ? "PROFILE:\n" : "PROFILO:\n") + lines.join("\n"));
  }

  if (clarifications && Object.keys(clarifications).length) {
    const c = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    L.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + c.join("\n"));
  }

  L.push(
    en
      ? `NARRATIVE TARGET:
- PAST → counterfactual slice as if it truly happened.
- FUTURE → near-future slice if they choose now.
FORM GUARD:
- Output EXACTLY 8–10 short lines. Obey per-line word limits. No labels.`
      : `OBIETTIVO NARRATIVO:
- PASSATO → frammento controfattuale come se fosse accaduto.
- FUTURO → scorcio di prossimo futuro se sceglie ora.
GUARDIA FORMALE:
- Produci ESATTAMENTE 8–10 righe brevi. Rispetta il limite parole/riga. Niente etichette.`
  );
  return L.join("\n\n");
}

/* ───────── Clarify locale ───────── */
function localClarify(domanda = "", profilo = {}, lang = "it", periodo = "future") {
  const en = isEn(lang);
  const qs = [];

  if (String(periodo).toLowerCase() === "past") {
    qs.push({
      id: "past_year",
      label: en ? "Which year did that pivot happen?" : "In che anno sarebbe avvenuto lo snodo?",
      placeholder: en ? "e.g., 2018 / last winter" : "es. 2018 / inverno scorso",
    });
    qs.push({
      id: "past_tradeoff",
      label: en ? "One trade-off you would've paid?" : "Un prezzo concreto che avresti pagato?",
      placeholder: en ? "rent/time/relationship/salary…" : "affitto/tempo/relazione/stipendio…",
    });
  } else {
    qs.push({
      id: "first_step",
      label: en ? "First small step you’d actually take?" : "Primo piccolo passo che faresti davvero?",
      placeholder: en ? "one call/email/hour" : "una chiamata/mail/ora",
    });
    qs.push({
      id: "success_signal",
      label: en ? "One signal you're on track?" : "Un segnale che sei sulla strada giusta?",
      placeholder: en ? "€ saved, hours, first reply" : "€ risparmiati, ore, prima risposta",
    });
  }

  if (!profilo?.city_now && !profilo?.city) {
    qs.push({
      id: "city_now",
      label: en ? "Where do you live now?" : "Dove vivi adesso?",
      placeholder: en ? "city" : "città",
    });
  } else if (!profilo?.work_role && !profilo?.role) {
    qs.push({
      id: "work_role",
      label: en ? "Your current role in one line?" : "Il tuo ruolo attuale in una riga?",
      placeholder: en ? "e.g., pharmacist technician" : "es. tecnico farmaceutico",
    });
  } else {
    qs.push({
      id: "constraint",
      label: en ? "Most concrete constraint?" : "Vincolo più concreto?",
      placeholder: en ? "budget/time/energy/commitment" : "budget/tempo/energia/impegno",
    });
  }

  return qs.slice(0, 3);
}

/* ───────── HTTP HANDLER ───────── */
export default async function handler(req, res) {
  // CORS / preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-whatif-stream");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const {
      domanda,
      lang = "it",
      periodo = "future",
      stile = "whatif",       // "whatif" | "wtf"
      clarify = false,
      stream = false,
      profilo = {},
      clarifications = {},
      extra = "",
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    // Clarify
    if (clarify) {
      const questions = localClarify(domanda, profilo, lang, periodo);
      return res.status(200).json({ questions });
    }

    // Generation
    const sys1 = systemPrompt({ stile, lang, profile: profilo });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile });

    // Finale/gancio
    const finaleHint = isFinalEpisode(profilo)
      ? (isEn(lang)
          ? "FINALE MODE: end with ONE memorable line. Invite a fresh new 'what if'."
          : "MODALITÀ FINALE: chiudi con UNA riga memorabile. Invita a un nuovo 'e se'.")
      : (isEn(lang)
          ? "MID-EPISODE: finish with ONE subtle personal hook."
          : "EPISODIO INTERMEDIO: chiudi con UN gancio personale.");

    // Guard-rail finale
    const hardGuard = isEn(lang)
      ? `VERIFY STYLE BEFORE SENDING:
- EXACTLY 8–10 lines. ONE sentence per line. No labels.
- Max words per line: ${stile === "wtf" ? 12 : 14}. If exceeded, REWRITE shorter.
- Snappy call-and-response cadence. End with hook (mid) or closure (finale).
- Do NOT write bartender-first-person monologue.`
      : `VERIFICA STILE PRIMA DELL'INVIO:
- ESATTAMENTE 8–10 righe. UNA frase per riga. Niente etichette.
- Parole massime per riga: ${stile === "wtf" ? 12 : 14}. Se sfori, RISCRIVI più corto.
- Cadenza botta-e-risposta. Chiudi con gancio (intermedio) o chiusura (finale).
- Vietato il monologo del barista in prima persona.`;

    const messages = [
      { role: "system", content: sys1 },
      { role: "user", content: user },
      { role: "system", content: finaleHint },
      { role: "system", content: hardGuard },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    const temperature = stile === "wtf" ? 0.93 : 0.82;

    // STREAM: accumula e formatta a fine testo per coerenza stilistica
    if (String(req.headers["x-whatif-stream"] || "").length > 0 || stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const s = await client.chat.completions.create({
        model: MODEL_TEXT,
        messages,
        temperature,
        max_tokens: 700,
        stream: true,
      });

      let buffer = "";
      for await (const chunk of s) {
        buffer += chunk.choices?.[0]?.delta?.content || "";
      }
      const finale = isFinalEpisode(profilo);
      const shaped = sanitizeAndShape(buffer, { stile, finale });
      res.write(`data: ${JSON.stringify({ token: shaped })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // NON-stream
    const c = await client.chat.completions.create({
      model: MODEL_TEXT,
      messages,
      temperature,
      max_tokens: 750,
    });

    let text = c.choices?.[0]?.message?.content?.trim() || "";
    const finale = isFinalEpisode(profilo);
    text = sanitizeAndShape(text, { stile, finale });
    return res.status(200).json({ answer: text });
  } catch (err) {
    console.error("API /ask error:", err);
    const isAbort = ("" + err?.message).toLowerCase().includes("aborted");
    return res.status(500).json({
      error: "server",
      detail: isAbort ? "aborted" : err?.message || "unknown",
    });
  }
}
