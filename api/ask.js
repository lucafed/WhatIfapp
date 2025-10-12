// /api/ask.js
import OpenAI from "openai";

/* ============== Setup ============== */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_TEXT = "gpt-4o-mini";
const isEn = (lang) => String(lang || "it").toLowerCase().startsWith("en");

/* ============== Utils: sintesi profilo per personalizzazione ============== */
function renderProfileDigest(p = {}) {
  if (!p || typeof p !== "object") return "";
  const parts = [];

  // Identità & contesto base
  if (p.name) parts.push(`${p.name}${p.age_range ? ", " + p.age_range : ""}`);
  const roots = [p.city_origin || p.city_from, p.city_now || p.city].filter(Boolean).join(" → ");
  if (roots) parts.push(`luoghi: ${roots}`);
  if (p.work_role || p.role) parts.push(`ruolo: ${p.work_role || p.role}`);
  if (Array.isArray(p.goals) && p.goals.length) parts.push(`obiettivi: ${p.goals.join(", ")}`);
  if (p.goal && (!parts.find(x => x.startsWith("obiettivi:")))) parts.push(`obiettivo: ${p.goal}`);
  if (Array.isArray(p.values) && p.values.length) parts.push(`valori: ${p.values.join(", ")}`);
  if (Array.isArray(p.wins) && p.wins.length) parts.push(`vittorie: ${p.wins.join(", ")}`);
  if (Array.isArray(p.pains) && p.pains.length) parts.push(`difficoltà: ${p.pains.join(", ")}`);

  // Interessi generali
  if (Array.isArray(p.hobbies) && p.hobbies.length) parts.push(`interessi: ${p.hobbies.join(", ")}`);

  // Preferenze “relax” / bar vibe
  if (typeof p.drinks_pref === "string") parts.push(`drinks_pref: ${p.drinks_pref}`);
  if (typeof p.unwind === "string") parts.push(`unwind: ${p.unwind}`);

  // === Nuovi campi predittivi === (non verranno etichettati in output)
  if (p.time_window) parts.push(`finestra: ${p.time_window}`);
  if (p.success_indicator) parts.push(`indicatore_successo: ${p.success_indicator}`);
  if (p.risk_tolerance) parts.push(`rischio: ${p.risk_tolerance}`);
  if (p.landmark) parts.push(`ancora: ${p.landmark}`);

  // Micro-dati giornalieri (solo stringhe utili)
  if (p.micro && typeof p.micro === "object") {
    const micro = p.micro;
    Object.entries(micro).forEach(([k, v]) => {
      if (v && typeof v === "string" && v.trim()) {
        parts.push(`${k}: ${v.trim()}`);
      }
    });
  }

  return parts.join(" • ");
}

function isFinalEpisode(profile = {}) {
  const ep = Number(profile?.story_state?.episode ?? 1);
  const max = Number(profile?.story_state?.max_episodes ?? 3);
  return ep >= max;
}

/* ============== Helpers tempo/season ============== */
function safeNow(nowIso, tz) {
  const d = nowIso ? new Date(nowIso) : new Date();
  const w = d.toLocaleDateString("en-GB", { weekday: "long" });
  const wd_it = d.toLocaleDateString("it-IT", { weekday: "long" });
  const date_it = d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
  const date_en = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const month = d.getMonth() + 1;
  const season_it = seasonForMonth(month, "it");
  const season_en = seasonForMonth(month, "en");
  const month_it = d.toLocaleDateString("it-IT", { month: "long" });
  const month_en = d.toLocaleDateString("en-GB", { month: "long" });
  return {
    time24: `${hh}:${mm}`,
    weekday_en: w,
    weekday_it: wd_it,
    date_it, date_en,
    season_it, season_en,
    month_it, month_en,
    tz: tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}
function seasonForMonth(m, lang) {
  const it = ["inverno","inverno","primavera","primavera","primavera","estate","estate","estate","autunno","autunno","autunno","inverno"];
  const en = ["winter","winter","spring","spring","spring","summer","summer","summer","autumn","autumn","autumn","winter"];
  return (lang === "en" ? en : it)[(m-1)%12];
}

/* ============== Chiusura “smart” variata (invito micro-domande) ============== */
function smartClosure(lang = "it", stile = "whatif") {
  const en = isEn(lang);
  const poolIt = stile === "wtf"
    ? [
        "Se domani torni, continuiamo il disastro con stile.",
        "Domani ti aspetto al bancone: due dettagli in più e vediamo se reggi il colpo.",
        "Riapriamo domani: lasciami un paio di appigli e alzo il livello.",
        "Passa domani con due note su tempo e confini, e ti spingo un passo avanti."
      ]
    : [
        "Se domani mi lasci due dettagli in più, continuo la storia dove l’abbiamo interrotta.",
        "Domani, con due note su tempi e risorse, ti porto al prossimo bivio.",
        "Torna domani con un piccolo aggiornamento e spostiamo la linea un po’ più avanti.",
        "Quando vuoi, aggiungi due dettagli: domani la storia riparte da lì."
      ];
  const poolEn = stile === "wtf"
    ? [
        "Come back tomorrow; bring two clues and we’ll raise the stakes.",
        "Tomorrow at the bar: two details, one bolder move.",
        "Drop by tomorrow with boundaries and timing; I’ll push the plot.",
        "Return tomorrow; give me two hints and I’ll make it spicier."
      ]
    : [
        "Come back tomorrow with two small details and I’ll continue the story.",
        "Tomorrow, add timing and a constraint; I’ll map the next fork.",
        "Bring a tiny update tomorrow and we’ll move the line forward.",
        "Whenever you’re ready, add two details; I’ll pick the story up."
      ];
  const arr = en ? poolEn : poolIt;
  return arr[Math.floor(Math.random() * arr.length)];
}

/* ============== Persona prompts (tono, tempi, personalità) ============== */
function systemPrompt({ stile = "whatif", lang = "it", profile = {}, nowIso, tz }) {
  const en = isEn(lang);
  const drinksYes = profile?.drinks_pref === "yes" || profile?.unwind === "drink";
  const cityNow = profile?.city_now || profile?.city || (en ? "your city" : "la tua città");
  const workRole = profile?.work_role || profile?.role || (en ? "your role" : "il tuo ruolo");
  const finale = isFinalEpisode(profile);

  const finaleInstr_en = finale
    ? `FINALE: provide closure — no cliffhanger. Land a memorable last line.`
    : `MID-EPISODE: end with a soft hook that invites the next step.`;

  const finaleInstr_it = finale
    ? `FINALE: chiudi davvero — niente cliffhanger. Ultima riga memorabile.`
    : `EPISODIO INTERMEDIO: chiudi con un gancio leggero verso il prossimo passo.`;

  const now = safeNow(nowIso, tz);
  const when_en = `Today is ${now.weekday_en}, ${now.date_en}. Season: ${now.season_en}. Local time ~${now.time24}.`;
  const when_it = `Oggi è ${now.weekday_it}, ${now.date_it}. Stagione: ${now.season_it}. Ora locale ~${now.time24}.`;

  if (stile === "wtf") {
    // WHAT THE F — barista tagliente, 2a persona, sarcasmo pulito
    return en
      ? `You are "What the F": a late-night bartender-philosopher — witty, slightly drunk, brutally honest.
${when_en}
Speak as ONE voice. 8–10 punchy short lines — bar-banter rhythm.
- Second person only ("you"); never "I".
- Bold, playful sarcasm. Clever, never cruel. No slurs/insults.
- Two or more punchlines. Humor > lesson. No moralizing.
- Each line ≤15 words; pause like you're sipping between lines.
Tense control:
- TIMEFRAME="future": near future (you will / you'll).
- TIMEFRAME="past": counterfactual (you would have).
Personalization:
- Ground the scene subtly in ${cityNow}, ${workRole}, without listing data.
Do NOT use explicit labels like “constraint/indicator/trade-off”. Weave them naturally.
Ending:
- ${finaleInstr_en}`
      : `Sei “What the F”: barista nottambulo, ironico, lucido anche con un filo di whisky.
${when_it}
Parla come UNA sola voce. 8–10 righe brevi, ritmo da bancone.
- Solo seconda persona (“tu”); mai “io”.
- Sarcasmo brillante e giocoso, mai cattivo. Niente volgarità.
- Almeno due punchline. Umorismo > lezione. Niente moralismi.
- Ogni frase ≤15 parole; pausa come tra un sorso e l’altro.
Controllo dei tempi:
- PERIODO="future": futuro vicino (“farai”, “ti ritroverai”).
- PERIODO="past": controfattuale (“avresti”, “saresti”).
Personalizzazione:
- Ancora la scena a ${cityNow}, ${workRole}, senza elencare i dati.
NON usare etichette tipo “vincolo/indicatore/trade-off”: intrecciali nel discorso.
Chiusura:
- ${finaleInstr_it}`;
  }

  // WHAT?f — amico lucido, predittivo, empatico
  return en
    ? `You are "What?f": a lucid, candid friend — concrete, current, gently insightful.
${when_en}
Speak as ONE calm inner voice. 8–10 short lines, visual and firm.
- Second person only ("you"); never "I".
Goal: show a believable near-future fork (FUTURE) or a counterfactual slice (PAST).
Style:
- Grounded, specific when useful (time of day, neighborhood, texture).
- Use profile knowledge implicitly; mirror their patterns with tact.
Tense control:
- TIMEFRAME="future": near future (you will / you'll).
- TIMEFRAME="past": counterfactual (you would have).
Do NOT use explicit labels like “constraint/indicator/trade-off”. Weave them into the narrative.
Ending:
- ${finaleInstr_en}`
    : `Sei “What?f”: un amico lucido e concreto, con intuizioni gentili.
${when_it}
Parla come UNA voce interiore calma. 8–10 righe brevi, visive e nette.
- Solo seconda persona (“tu”); mai “io”.
Obiettivo: mostrare un futuro vicino credibile (FUTURO) o un controfattuale vivido (PASSATO).
Stile:
- Specifico quando serve (orario, quartiere, piccole “texture” reali).
- Usa il profilo in modo implicito; rispecchia i pattern con tatto.
Controllo dei tempi:
- PERIODO="future": futuro vicino (“farai”, “ti ritroverai”).
- PERIODO="past": controfattuale (“avresti”, “saresti”).
NON usare etichette tipo “vincolo/indicatore/trade-off”: intreccia i concetti nel racconto.
Chiusura:
- ${finaleInstr_it}`;
}

/* ============== Few-shots (stile) ============== */
function getFewShots(style = "whatif", lang = "it") {
  const it = !isEn(lang);

  if (style === "wtf") {
    // 3 esempi WTF — punchy, 2a persona, sarcasmo pulito
    if (it) {
      return [
        { role: "system", content:
`ESEMPIO_WTF_1
DOMANDA: "Se avessi vinto 1.000.000 di euro?"
RISPOSTA:
Un milione, eh? Perfetto: puoi finalmente litigare in alta definizione.
Fai pace col conto, non con il carrello.
Attico? Sì. Ma l’ascensore non paga le paranoie.
La ricchezza compra opzioni, non abitudini.
Rischio? Più cose, meno te.
Successo? Dormi meglio, compri meno scuse.
Primo brindisi: alla libertà, non allo shopping.
Se i sorrisi salgono e gli scontrini scendono, stai andando bene.
Quando finisce lo champagne, resta chi sei.
Punchline: tieni lo scontrino del sogno. Potrebbe servirti.` },
        { role: "system", content:
`ESEMPIO_WTF_2
DOMANDA: "E se tornassi all’Aquila?"
RISPOSTA:
Ti vedo già: caffè corto, saluti lunghi.
Tutti felici, tre favori a testa.
Felicità su, anonimato giù. Pacchetto rientro.
Ritmo? Tuo. Non del gruppo WhatsApp.
Misura il lunedì: se respiri meglio, è casa.
Serate leggere? Due a settimana: segno che funziona.
Se ti chiedono “ci pensi tu?”, rispondi “dipende”.
Cuore pieno, agenda furba.
Punchline: casa sì, portineria no.` },
        { role: "system", content:
`ESEMPIO_WTF_3
DOMANDA: "Se aprissi un bar?"
RISPOSTA:
Idea romantica. Sveglia all’alba, conti a mezzanotte.
Il caffè fa amici, i turni fanno cerchi sotto gli occhi.
Ti piacerà il bancone, meno l’inventario.
Segno buono: clienti che tornano, non solo selfie.
Segno cattivo: tu che torni a casa più tardi dei pensieri.
Parti piccolo, taglia fighetti superflui.
Se ridi ancora al mese tre, brinda davvero.
Punchline: fai schiuma sulle tazze, non sui debiti.` },
      ];
    }
    // EN versions if needed
    return [
      { role: "system", content:
`WTF_EX_1
QUESTION: "What if I won €1,000,000?"
ANSWER:
A million buys options, not habits.
Penthouse? Sure. Maintenance marries you back.
Risk: more stuff, less you.
Win if sleep gets deeper and receipts shrink.
Punchline: keep the dream’s receipt.` },
    ];
  }

  // WHATIF — 7 esempi, empatici, predittivi, 2a persona
  if (it) {
    return [
      { role: "system", content:
`ESEMPIO_WHATIF_1
DOMANDA: "Se avessi vinto 1.000.000 di euro?"
RISPOSTA:
Hai sempre cercato libertà più che rumore.
Il primo mese ti sgonfi l’ansia, non il conto.
Sistemi ciò che pesa, lasci respirare le giornate.
Ti accorgi che la ricchezza non compra il ritmo: lo costruisci.
Segnale buono: più sonno, meno impulso.
Parti mettendo da parte una quota intoccabile e dai nomi al resto.
Dopo tre mesi scegli cosa resta, non cosa luccica.
A quel punto non scappi: decidi.
Se domani mi lasci due dettagli, continuiamo da dove ti vedo più sereno.` },
      { role: "system", content:
`ESEMPIO_WHATIF_2
DOMANDA: "E se tornassi all’Aquila tra 3–6 mesi?"
RISPOSTA:
Con te funziona quando la routine è breve ma fedele.
Teste una settimana fissa al mese: stessi giorni, stessi volti.
All’inizio è gioia + richieste: impari a dire “più tardi”.
Capisci che appartenenza non è disponibilità.
Segno buono: due serate leggere, sonno regolare.
Dopo novanta giorni, o chiami “casa”, o chiami “pendolarismo emotivo”.
Nel dubbio, semplifica spostamenti e riti.
Domani, lasciami due note su tempi e confini: ti porto al prossimo bivio.` },
      { role: "system", content:
`ESEMPIO_WHATIF_3
DOMANDA: "Se aprissi un bar?"
RISPOSTA:
Ti muovi bene dove le persone si ritrovano davvero.
Il primo mese il bancone ti dà energia, i turni te la rubano.
Ti salva partire stretto: meno fronzoli, più rituali.
Capisci presto chi torna per te e non per la foto.
Segno che gira: chiusura serale senza rimuginare.
Se domani mi dici quartiere e orari, disegno il ritmo giusto.` },
      { role: "system", content:
`ESEMPIO_WHATIF_4
DOMANDA: "Se cambiassi lavoro entro l’estate?"
RISPOSTA:
Quando smetti di dimostrare e inizi a scegliere, ti si apre il petto.
Prima settimana: due contatti chiari, zero candidature a pioggia.
Ti ascolti: vuoi margine, non solo titolo.
Il passaggio critico è proteggere l’energia fuori orario.
Segno buono: ti svegli curioso, non in difesa.
Se domani mi scrivi due città e un ruolo, traccio la mappa corta.` },
      { role: "system", content:
`ESEMPIO_WHATIF_5
DOMANDA: "Se iniziassi quel master?"
RISPOSTA:
Ti conosco: studi bene quando vedi una porta aprirsi, non un voto.
Il primo mese incastri lezioni e respiro, non eroismi.
Ti nutrono i compagni giusti, non le brochure.
Segno buono: appunti puliti e sonno decente.
Se domani mi dici orari e distanza, ti disegno una settimana pilota.` },
      { role: "system", content:
`ESEMPIO_WHATIF_6
DOMANDA: "Se mi trasferissi a Milano?"
RISPOSTA:
Ti accende il ritmo, ti stanca il brusio.
Funzioni se ti costruisci un’ansa: tre luoghi tuoi, orari corti.
All’inizio brillerai fuori e tacerai dentro: fisiologico.
Segno buono: silenzi pieni la sera, non scroll infinito.
Domani, dimmi quartiere e fascia oraria: metto giù la giornata che regge.` },
      { role: "system", content:
`ESEMPIO_WHATIF_7
DOMANDA: "Se provassi a rallentare?"
RISPOSTA:
Il tuo tempo cambia quando smetti di rincorrere l’ultima notifica.
La prima settimana togli un impegno e metti un respiro.
Ti accorgi che la calma non è vuoto, è scelta.
Segno buono: risate senza guardare l’orologio.
Domani lasciami due dettagli su mattine e sere: continuo da lì.` },
    ];
  }

  // EN (fallback)
  return [
    { role: "system", content:
`WHATIF_EX_1
QUESTION: "What if I moved back home?"
ANSWER:
Test one fixed week per month.
Protect mornings, simplify logistics.
Good sign: two light evenings + steady sleep.
Tomorrow bring two details; I’ll map the next fork.` },
  ];
}

/* ============== Istruzioni di formato (no etichette “a stampino”) ============== */
function responseStyleInstruction(lang, stile) {
  const en = isEn(lang);
  if (stile === "wtf") {
    return en
      ? `Format: 8–10 short lines. One speaker. Second person only. Bold playful sarcasm. Respect timeframe tenses. Never list labels like “constraint/indicator/trade-off”; weave ideas naturally. End with a light hook.`
      : `Formato: 8–10 righe brevi. Voce unica in seconda persona. Sarcasmo brillante e giocoso. Rispetta i tempi verbali del periodo. Mai elenchi con etichette tipo “vincolo/indicatore/trade-off”: integra i concetti nel testo. Chiudi con gancio leggero.`;
  }
  return en
    ? `Format: 8–10 concise lines. One calm voice. Second person only. Visual, current, grounded. No explicit labels (constraint/indicator/trade-off). Weave concepts into the narrative. Respect timeframe tenses. Close with a soft predictive hook.`
    : `Formato: 8–10 righe concise. Voce calma, seconda persona. Visivo, attuale, ancorato. Niente etichette esplicite (“vincolo/indicatore/trade-off”): integra i concetti nel racconto. Rispetta i tempi verbali in base al periodo. Chiudi con un gancio predittivo leggero.`;
}

/* ============== Costruzione messaggio utente (con profilo) ============== */
function buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, nowIso, tz, tags = [] }) {
  const en = isEn(lang);
  const L = [];
  L.push(en ? `QUESTION: ${domanda}` : `DOMANDA: ${domanda}`);
  L.push(en ? `TIMEFRAME: ${periodo || "future"}` : `PERIODO: ${periodo || "future"}`);
  L.push(en ? `STYLE: ${stile}` : `STILE: ${stile}`);

  // Now/locale hints
  const now = safeNow(nowIso, tz);
  L.push(
    en
      ? `NOW:
weekday=${now.weekday_en}; season=${now.season_en}; month=${now.month_en}; local_time≈${now.time24};`
      : `ADESSO:
giorno=${now.weekday_it}; stagione=${now.season_it}; mese=${now.month_it}; ora_locale≈${now.time24};`
  );

  // Tags (opzionali) per maggior pertinenza
  if (Array.isArray(tags) && tags.length) {
    L.push((en ? "TOPIC TAGS: " : "TAG TEMA: ") + tags.slice(0, 8).join(", "));
  }

  // Digest profilo
  const digest = renderProfileDigest(profilo);
  if (digest) L.push(en ? `PROFILE DIGEST: ${digest}` : `SINTESI PROFILO: ${digest}`);

  // Chiarimenti utente
  if (clarifications && Object.keys(clarifications).length) {
    const c = Object.entries(clarifications).map(([k, v]) => `${k}: ${v}`);
    L.push((en ? "CLARIFICATIONS:\n" : "CHIARIMENTI:\n") + c.join("\n"));
  }

  // Obiettivo predittivo (solo per guida interna; non apparirà come etichette in output)
  L.push(
    en
      ? `PREDICTIVE OBJECTIVE (guidance only, do NOT echo labels):
- PAST → counterfactual vignette with a believable cost and a small verifying sign.
- FUTURE → near-future path with a small first move and a concrete sign it’s working.
- Use timing/energy/place implicitly. No bullet labels.`
      : `OBIETTIVO PREDITTIVO (solo guida, NON ripetere etichette):
- PASSATO → controfattuale credibile con un costo plausibile e un segnale di riuscita.
- FUTURO → percorso vicino con un primo passo piccolo e un segno concreto che sta funzionando.
- Usa tempi/energia/luogo in modo implicito. Niente elenchi con etichette.`
  );

  // Chiusura smart suggerita (da fondere nel finale)
  L.push((en ? "CLOSURE_HINT: " : "SUGGERIMENTO_CHIUSURA: ") + smartClosure(lang, stile));

  return L.join("\n\n");
}

/* ============== Clarify “aware” del periodo + profiling progressivo ============== */
function clarifySystemPrompt(lang = "it") {
  const en = isEn(lang);
  const base = en
    ? `You create 3 short, focused clarifying questions (one line each) tightly linked to the user's main question. Return ONLY a JSON array of { "id","label","placeholder" }.`
    : `Crei 3 domande brevi e mirate (una riga) strettamente collegate alla domanda principale. Restituisci SOLO un array JSON di { "id","label","placeholder" }.`;

  const period = en
    ? `PERIOD AWARE:
- TIMEFRAME="past": pivot year/event, place/context back then, key sign that would've changed things.
- TIMEFRAME="future": decision window, concrete sign of progress, real-world constraint/resource.`
    : `CONSAPEVOLEZZA DEL PERIODO:
- PERIODO="past": anno/evento di svolta, luogo/contesto di allora, segnale chiave che avrebbe cambiato la rotta.
- PERIODO="future": finestra decisionale, segno concreto di progresso, risorsa/limite realistico.`;

  const profiling = en
    ? `Progressive profiling when missing: city_now/city_origin, work_role, main concrete goal, 2–3 values.`
    : `Profilazione progressiva se mancano dati: city_now/city_origin, work_role, obiettivo concreto, 2–3 valori.`;

  const style = en
    ? `No repeated generic questions. Tailor to the topic and any provided tags.`
    : `Evita ripetizioni generiche. Aggancia le domande al tema e agli eventuali tag.`;

  return `${base}\n${period}\n${profiling}\n${style}`;
}

function clarifyUserContent({ domanda, periodo = "future", profilo = {}, lang = "it", tags = [] }) {
  const en = isEn(lang);
  const parts = [];
  parts.push((en ? "QUESTION: " : "DOMANDA: ") + (domanda || ""));
  parts.push((en ? "TIMEFRAME: " : "PERIODO: ") + periodo);

  const digest = renderProfileDigest(profilo);
  if (digest) parts.push(en ? "PROFILE DIGEST: " + digest : "SINTESI PROFILO: " + digest);

  if (Array.isArray(tags) && tags.length) {
    parts.push((en ? "TOPIC TAGS: " : "TAG TEMA: ") + tags.slice(0, 8).join(", "));
  }

  parts.push(en ? "Return ONLY the JSON array." : "Ritornare SOLO l’array JSON.");
  return parts.join("\n\n");
}

/* ============== Fallback clarify “intelligente” ============== */
function localClarify(domanda = "", profilo = {}, lang = "it", periodo = "future", tags = []) {
  const en = isEn(lang);
  const hint = (tags && tags[0]) ? tags[0] : "";
  const qs = [];

  if (periodo === "past") {
    qs.push({ id: "pivot_year", label: en ? "Turning point year or missed moment?" : "Anno di svolta o momento mancato?", placeholder: en ? "e.g., 2015 move / 2010 offer" : "es. trasferimento 2015 / offerta 2010" });
    qs.push({ id: "then_place", label: en ? "Where and with whom back then?" : "Dove e con chi eri allora?", placeholder: en ? "city, team, family" : "città, squadra, famiglia" });
    qs.push({ id: "key_sign", label: en ? "One sign it would've worked?" : "Un segno che avrebbe detto ‘funziona’?", placeholder: en ? "person/number/result" : "persona/numero/risultato" });
  } else {
    qs.push({ id: "time_window", label: en ? "Real decision window?" : "Finestra decisionale reale?", placeholder: en ? "this month / 3–6 months" : "questo mese / 3–6 mesi" });
    qs.push({ id: "progress_sign", label: en ? `One sign of progress${hint ? " about " + hint : ""}?` : `Un segno di progresso${hint ? " su " + hint : ""}?`, placeholder: en ? "first reply / deeper sleep" : "prima risposta / sonno più profondo" });
    qs.push({ id: "boundary", label: en ? "One boundary you won't cross?" : "Un confine che non vuoi oltrepassare?", placeholder: en ? "time/energy/money" : "tempo/energia/budget" });
  }

  // Profilazione rapida se mancano basi
  if (!profilo?.city_now && !profilo?.city) {
    qs.unshift({ id: "city_now", label: en ? "Where do you live now?" : "Dove vivi adesso?", placeholder: en ? "city" : "città" });
  }
  if (!profilo?.work_role && !profilo?.role) {
    qs.push({ id: "work_role", label: en ? "Your current role in one line?" : "Il tuo ruolo attuale in una riga?", placeholder: en ? "e.g., pharmacist technician" : "es. tecnico farmaceutico" });
  }

  return qs.slice(0, 3);
}

/* ============== HTTP handler ============== */
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
      lang = "it",
      periodo = "future",      // "past" | "future"
      stile = "whatif",        // "whatif" | "wtf"
      clarify = false,         // true => genera 2–3 domande
      stream = false,          // true => text/event-stream
      profilo = {},            // { ... , story_state:{ thread_id, episode, max_episodes } }
      clarifications = {},     // risposte dell’utente ai chiarimenti
      extra = "",              // input extra opzionale
      now: nowIso,             // opzionale: ISO dal client
      tz,                      // opzionale: timezone IANA dal client
      tags = [],               // opzionale: array di tag tema
    } = req.body || {};

    if (!domanda || typeof domanda !== "string") {
      return res.status(400).json({ error: "bad_request", detail: "domanda_required" });
    }

    /* ---------- Clarify branch ---------- */
    if (clarify) {
      let questions = [];
      try {
        const sys = clarifySystemPrompt(lang);
        const usr = clarifyUserContent({ domanda, periodo, profilo, lang, tags });
        const resp = await client.chat.completions.create({
          model: MODEL_TEXT,
          temperature: 0.6,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: usr },
          ],
        });
        const raw = resp.choices?.[0]?.message?.content?.trim() || "[]";
        const start = raw.indexOf("[");
        const end = raw.lastIndexOf("]");
        if (start >= 0 && end > start) {
          questions = JSON.parse(raw.slice(start, end + 1));
        }
      } catch (err) {
        console.error("Clarify dynamic error:", err);
      }

      if (!Array.isArray(questions) || questions.length === 0) {
        questions = localClarify(domanda, profilo, lang, periodo, tags);
      }

      questions = questions.slice(0, 3).map((q, i) => ({
        id: String(q.id || `q${i + 1}`),
        label: String(q.label || q?.text || (isEn(lang) ? "Question" : "Domanda")),
        placeholder: String(q.placeholder || (isEn(lang) ? "Answer in one line" : "Rispondi in una riga")),
      }));

      try {
        const todayIso = new Date().toISOString().slice(0, 10);
        const clarHdr = { date: todayIso, used: (questions?.length || 0) };
        res.setHeader("X-Whatif-Clarify", JSON.stringify(clarHdr));
      } catch {}

      return res.status(200).json({ questions });
    }

    /* ---------- Generation branch ---------- */
    const sys1 = systemPrompt({ stile, lang, profile: profilo, nowIso, tz });
    const user = buildUserContent({ domanda, periodo, profilo, clarifications, lang, stile, nowIso, tz, tags });
    const sys2 = responseStyleInstruction(lang, stile);

    const finaleHint = isFinalEpisode(profilo)
      ? (isEn(lang)
          ? "This is the finale for this thread: deliver real closure (no cliffhanger)."
          : "Questo è il finale di questa storia: chiudi davvero (niente cliffhanger).")
      : (isEn(lang)
          ? `Mid-episode: end with a soft personal hook connected to ${profilo?.city_now || profil0?.city || "their city"} or ${profilo?.work_role || profilo?.role || "their role"}.`
          : `Episodio intermedio: chiudi con un gancio personale legato a ${profilo?.city_now || profilo?.city || "la tua città"} o ${profilo?.work_role || profilo?.role || "il tuo ruolo"}.`);

    const fewshots = getFewShots(stile, lang);

    const messages = [
      { role: "system", content: sys1 },
      ...fewshots,
      { role: "user", content: user },
      { role: "system", content: sys2 },
      { role: "system", content: finaleHint },
      extra ? { role: "user", content: extra } : null,
    ].filter(Boolean);

    // Temperatura: più alta per wtf per favorire battute e ritmo
    const temperature = stile === "wtf" ? 0.97 : 0.82;

    // Streaming (SSE)
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
      messages,
      temperature,
      max_tokens: 700,
    });
    const text = c.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ answer: text });
  } catch (err) {
    console.error("API /ask error:", err);
    const isAbort = ("" + err?.message).toLowerCase().includes("aborted");
    return res
      .status(500)
      .json({ error: "server", detail: isAbort ? "aborted" : err?.message || "unknown" });
  }
}
