// ============================
// /api/ask.js — The Life Cliffhanger Engine™
// versione stabile e completa (IT/EN, future & past/counterfactual)
// ============================

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/* ---------------- Utils ---------------- */
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function episodicClosing(style = "whatif", lang = "it") {
  const en = isEn(lang);
  const wtf = en
    ? ["Keep the glass; the night isn’t done", "Save the tab; next round writes itself", "Same bar tomorrow; truth on ice"]
    : ["Tieni il bicchiere: la serata non è finita", "Conto aperto: il prossimo giro si scrive da solo", "Stesso bancone domani: verità col ghiaccio"];
  const whf = en
    ? ["We’ll nudge the thread soon", "Let’s see where this leads next", "You haven’t seen the rest yet"]
    : ["Tra poco spingiamo il filo", "Vediamo dove porta il passo dopo", "Non hai ancora visto il resto"];
  return pick(style === "wtf" ? wtf : whf);
}

/* ---------------- Personas ---------------- */

const Whatif_IT = `
Sei "What?f": voce lucida, realistica e predittiva che conosce l’utente.
Tono: visivo, umano, profetico senza retorica. Frasi complete, fluide (7–10 frasi).
L’episodio deve avere un seguito implicito (gancio finale).
Se periodo=future: descrivi un futuro prossimo verosimile, come se lo stessi vedendo accadere.
Se periodo=past: costruisci un controfattuale (“cosa sarebbe potuto succedere”), chiaro e coinvolgente, senza riscrivere il passato: racconta la linea possibile che sarebbe seguita da lì in avanti.
Evita elenchi puntati e coaching generico. Niente invenzioni di fatti specifici (soldi, case, offerte) non menzionati dall’utente.
Chiudi con un gancio morbido e predittivo (non ripetere “Domani” ogni volta; varia).
Rispondi soltanto in Italiano.
`;

const Wtf_IT = `
Sei "What the F": amico da bar brillante, sarcastico, leggermente alticcio ma lucido.
Racconto continuo, 8–10 frasi, ritmo vivo, battute intelligenti, almeno un riferimento all’alcol.
Obiettivo: far ridere forte ma far intravedere verità. Mai cattivo.
Se periodo=future: futuro vicino, realistico ma scatenato; se periodo=past: controfattuale “come sarebbe andata” con ironia.
Chiudi sempre con una battuta in sospeso (gancio da seriale).
Niente elenchi. Non inventare dettagli concreti non menzionati.
Rispondi soltanto in Italiano.
`;

const Whatif_EN = `
You are "What?f": clear, realistic, gently prophetic voice that knows the user.
Tone: visual, human, no grandstanding. 7–10 smooth sentences, complete lines.
Each episode must feel like it continues.
If period=future: show a plausible near future as if you’re watching it happen.
If period=past: craft a counterfactual line (“what could have unfolded”) without rewriting the past; narrate the path that would likely follow from that point.
No bullet lists, no generic coaching. Do not invent concrete facts (money, apartments, offers) not mentioned by the user.
End with a soft predictive hook. Reply only in English.
`;

const Wtf_EN = `
You are "What the F": witty, tipsy, brutally funny but kind bartender-friend.
Continuous mini-story, 8–10 sentences, sharp rhythm, at least one booze gag.
Goal: big laugh + a glimpse of truth. Never mean.
If period=future: near-future mayhem but believable; if period=past: counterfactual “how it would have gone” with irony.
Always end with a playful cliffhanger. No lists. Don’t invent concrete facts not mentioned.
Reply only in English.
`;

/* ---------------- HTTP handler ---------------- */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "missing_api_key" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      domanda = "",
      stile = "whatif",       // "whatif" | "wtf"
      lang = "it",            // "it" | "en"
      extra = "",
      periodo = "future",     // "future" | "past" (counterfactual)
      follow = false,         // teaser for tomorrow
      answer = ""             // today's text (for teasers)
      // profile, micro … opzionali in futuro
    } = body;

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ---- FOLLOW TEASERS ---- */
    if (follow) {
      const system = `
You create exactly three SHORT teaser prompts for TOMORROW to continue a serial story.
They MUST be derived from the user's original question AND today's answer (tone: "${stile}", period: "${periodo}").
Write brief IMPERATIVES (not questions), 5–12 words, no final punctuation.
Reference specific concrete elements from today's answer (places, objects, tiny decisions, time hints).
Return STRICT JSON: {"followups":["t1","t2","t3"]} — nothing else.
Language: ${isEn(lang) ? "English" : "Italiano"}.
`.trim();

      const user = `
Original question: "${domanda}"
Today's answer (trimmed): "${(answer || "").slice(0, 1400)}"
Generate 3 concrete story-driven teasers for tomorrow in the same voice.
`.trim();

      const r = await client.chat.completions.create({
        model: MODEL,
        temperature: stile === "wtf" ? 0.9 : 0.7,
        max_tokens: 180,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      });

      const raw = r.choices?.[0]?.message?.content?.trim() || "{}";
      let out = { followups: [] };
      try { out = JSON.parse(raw); } catch {}
      if (!Array.isArray(out.followups) || out.followups.length < 3) {
        out.followups = isEn(lang)
          ? ["Note the first sign you’ll accept", "Go back to the place you mentioned", "Tell one person and watch what shifts"]
          : ["Segna il primo segnale che accetterai", "Torna nel posto che hai citato", "Dillo a una persona e guarda cosa cambia"];
      }
      return res.status(200).json(out);
    }

    /* ---- EPISODIO ---- */
    const system = (stile === "wtf"
      ? (isEn(lang) ? Wtf_EN : Wtf_IT)
      : (isEn(lang) ? Whatif_EN : Whatif_IT)
    ).trim();

    const closing = episodicClosing(stile, lang);
    const user = `
User question: "${domanda}"
Context detail (optional): "${String(extra || "").trim()}"
Period: "${periodo}"  // "future" for realistic near-future; "past" for counterfactual line of what could have unfolded

Write ONE compact episode in the "${stile}" voice that clearly sets up a continuation.
Do not use bullets. Keep 7–10 complete sentences.
End with exactly this hook line: "${closing}"
`.trim();

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.95 : 0.85,
      max_tokens: 700,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    });

    const text = completion?.choices?.[0]?.message?.content?.trim() || "";
    if (!text) throw new Error("empty_model_response");

    return res.status(200).json({ answer: text });
  } catch (err) {
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
  }
}
