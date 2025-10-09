// /api/ask.js — chiarimenti + generazione con stile predittivo-personale (no “storiella”)
import OpenAI from "openai";

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-whatif-stream");
}

export default async function handler(req, res) {
  // CORS / preflight
  if (req.method === "OPTIONS") {
    setCORS(res);
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    setCORS(res);
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    setCORS(res);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    const {
      question, domanda, lang = "it",
      periodo, stile, stream,
      clarify = false,
      clarifications = {},
      profilo = {},
      extra = ""
    } = req.body || {};

    const q = (question || domanda || "").toString().trim();
    if (!q) return res.status(400).json({ error: "question required" });

    // Normalizzazione periodo
    const periodNorm = periodo === "past" ? "past" : "future";

    // ---- snapshot profilo
    const p = profilo || {};
    const snap = [
      p.name ? `nome: ${p.name}` : null,
      p.age ? `età: ${p.age}` : null,
      p.city ? `città: ${p.city}` : null,
      p.gender ? `sesso: ${p.gender}` : null,
      p.phase ? `fase: ${p.phase}` : null,
      p.role ? `professione: ${p.role}` : null,
      p.goal ? `obiettivo: ${p.goal}` : null,
    ].filter(Boolean).join(" · ");

    const micro = p.micro && typeof p.micro === "object"
      ? Object.entries(p.micro).slice(0, 8).map(([k,v]) => `${k}: ${v}`).join(" | ")
      : "";

    const clarStr = clarifications && typeof clarifications === "object"
      ? Object.entries(clarifications).map(([k,v]) => `${k}: ${v}`).join(" | ")
      : "";

    // ---- contesto temporale
    const time =
      periodNorm === "past"
        ? (lang === "en" ? "the past (what if)" : "il passato (what if)")
        : (lang === "en" ? "the near future (plausible what if)" : "il prossimo futuro (what if plausibile)");

    // ---- guida di stile
    const baseGuide_it =
`Scrivi in seconda persona (“tu”), tono analitico e concreto. Evita melodramma, frasi generiche e diario.
Usa SOLO i dati forniti (profilo e chiarimenti); non inventare nomi propri o eventi specifici non dati.
Struttura del testo (130–170 parole), SENZA elenchi numerati:
• Apertura: 2 frasi che formulano un’ipotesi realistica su come ti comporteresti in ${time}.
• Previsioni: 2–3 sviluppi concreti con marcatori di quotidianità (orari, luoghi tipologici, gesti), plausibili per il tuo profilo.
• Trade-off: un compromesso reale che probabilmente dovrai gestire.
• Indicatore da tenere d’occhio: un segnale pratico per capire se l’ipotesi regge.
• Prossima mossa da 10 minuti: un’azione micro e fattibile ora.
Niente bullet espliciti: integra le sezioni in un unico testo scorrevole con etichette brevi in grassetto (es. **Indicatore**, **Prossima mossa**).`;

    const wtfAddon_it =
`Mantieni la stessa struttura predittiva ma con piglio brillante e due tocchi da bar (uno spritz, il bancone affollato, una battuta secca).
Il colore serve a rendere vivo lo scenario, non a incoraggiare eccessi pericolosi.`;

    const baseGuide_en =
`Write in second person (“you”), analytical and concrete tone. No melodrama, no diary voice.
Use ONLY given data (profile and clarifications); don’t invent proper names or unknown facts.
Output (130–170 words), NO numbered lists:
• Opening: 2 sentences stating a realistic hypothesis about how you'd likely behave in ${time}.
• Predictions: 2–3 concrete developments with everyday markers (times of day, typical places, gestures), plausible for this user.
• Trade-off: one real compromise you’d likely manage.
• Leading indicator: one practical signal to check if the hypothesis holds.
• Next 10-minute move: one tiny action to do now.
No bullets: weave everything into a single flowing text with short bold labels (e.g., **Indicator**, **Next move**).`;

    const wtfAddon_en =
`Keep the same predictive structure but with witty, lively bar color (a spritz, a noisy counter, a dry quip).
Color makes it vivid, not an encouragement of dangerous excess.`;

    const guide = lang === "en"
      ? (stile === "wtf" ? `${baseGuide_en}\n${wtfAddon_en}` : baseGuide_en)
      : (stile === "wtf" ? `${baseGuide_it}\n${wtfAddon_it}` : baseGuide_it);

    const client = new OpenAI({ apiKey });

    // ---- CLARIFY MODE
    if (clarify === true) {
      const clarifySystem = lang === "en"
        ? `You are What?f. Ask 2–3 SHORT, targeted clarifying questions to sharpen predictions (habits, constraints, tolerance for risk, key people). Output strict JSON: {"questions":[{"id":"q1","label":"...","placeholder":"..."}]}`
        : `Sei What?f. Formula 2–3 domande di chiarimento, BREVI e mirate, per affinare le previsioni (abitudini, vincoli, tolleranza al rischio, figure chiave). Rispondi SOLO in JSON: {"questions":[{"id":"q1","label":"...","placeholder":"..."}]}`;

      const clarifyUser = [
        lang === "en" ? `User question: ${q}` : `Domanda utente: ${q}`,
        snap ? (lang === "en" ? `Profile snap
