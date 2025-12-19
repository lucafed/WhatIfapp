// FILE: /api/oracle.js
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { topic, effect, channel, tone, voice, lang } = req.body || {};
    const L = (lang || "it").toLowerCase().slice(0, 2);

    // Normalizza input
    const V = (voice === "wtf") ? "wtf" : "whatif";

    // Dizionari base (IT first; EN minimale se vuoi)
    const TXT = {
      it: {
        title_wi: "🔮 Oracolo (What if)",
        title_wtf: "🔮 Oracolo (What the F)",
        safety: "Nota: niente cose illegali, pericolose o che danneggiano qualcuno. Solo mosse reali e pulite.",
        rulesLabel: "Regole",
      },
      en: {
        title_wi: "🔮 Oracle (What if)",
        title_wtf: "🔮 Oracle (What the F)",
        safety: "Note: nothing illegal, dangerous, or harmful. Only real, clean moves.",
        rulesLabel: "Rules",
      }
    };
    const T = TXT[L] || TXT.it;

    // ---- Mappa “COSA FARE” (do) per topic/effect/channel
    // Sono template brevi e azionabili. Il tono influenza lo stile.
    const DO = buildDo({ topic, effect, channel, tone, V, L });

    // ---- Primo passo (first_step) super concreto (entro 15 min)
    const FIRST = buildFirstStep({ topic, channel, effect, V, L });

    // ---- Regole minime (sempre pratiche)
    const RULES = buildRules({ effect, tone, V, L });

    const base = {
      title: V === "wtf" ? T.title_wtf : T.title_wi,
      do: DO,
      first_step: FIRST,
      rules: RULES,
      safety: T.safety
    };

    // styled = stesso contenuto ma con “voce”
    const styled = {
      ...base,
      do: styleLine(base.do, V, L),
      first_step: styleLine(base.first_step, V, L),
    };

    return res.status(200).json({ base, styled });
  } catch (e) {
    console.error("oracle error:", e);
    return res.status(500).json({ error: "oracle_failed" });
  }
}

function buildDo({ topic, effect, channel, tone, V, L }) {
  // fallback
  const t = topic || "life";
  const e = effect || "solid";
  const c = channel || "people";
  const k = `${t}|${e}|${c}`;

  const it = {
    "money|fast|online": "Crea un’offerta semplice da vendere online (prezzo basso, consegna veloce) e validala con 20 messaggi a target reale in 48 ore.",
    "money|solid|online": "Imposta un piano di entrate ricorrenti: un servizio mensile ultra-specifico con 1 sola promessa chiara e 1 canale di acquisizione.",
    "money|risky|online": "Scegli un’unica scommessa misurabile per 14 giorni: traffico → offerta → incasso. Se non converte, taglia e cambia.",
    "work|fast|people": "Ottieni una leva immediata: chiedi 2 feedback strutturati a chi decide, poi proponi 1 miglioramento piccolo ma visibile in 7 giorni.",
    "work|solid|people": "Costruisci reputazione: scegli un problema ricorrente, documenta una soluzione replicabile e rendila ‘standard’ del team.",
    "life|fast|cut": "Taglia una sola cosa che ti ruba energia (un impegno/abitudine) e rimpiazzala con 30 minuti fissi al giorno per te.",
    "relationships|solid|people": "Metti 1 confine + 1 richiesta chiara: ‘Questo mi pesa / questo mi serve’. Se non cambia nulla, decidi in 14 giorni.",
    "mind|fast|cut": "Riduci rumore: disattiva 3 fonti di stress (notifiche/scroll/chat) e sostituiscile con una routine di 10 minuti.",
    "world|radical|environment": "Fai una micro-rivoluzione locale: scegli un problema nel tuo quartiere e crea una ‘azione settimanale’ con altre 2 persone."
  };

  // fallback intelligente se non matcha una chiave
  const genericIT = {
    money: "Fai una mossa che genera cassa: offerta semplice, pubblico chiaro, test rapido, numeri in mano.",
    work: "Sblocca carriera con un output visibile: un miglioramento misurabile, comunicato bene.",
    life: "Riduci frizione: taglia una cosa, fissa una routine minima, rendila automatica.",
    relationships: "Chiarezza e confini: 1 richiesta, 1 limite, 1 deadline.",
    mind: "Igiene mentale: meno input, più recupero, una micro-azione quotidiana.",
    world: "Impatto pratico: un problema reale, un’azione ripetibile, persone coinvolte."
  };

  const out = it[k] || genericIT[t] || genericIT.life;

  // Tonalità: “wtf” più brutale/ironica, whatif più pulita
  return out;
}

function buildFirstStep({ topic, channel, effect, V, L }) {
  const t = topic || "life";
  const c = channel || "online";

  const it = {
    money: {
      online: "Apri Note: scrivi 1 offerta in 1 riga (a chi, cosa risolvi, in quanto). Poi manda 10 DM mirati oggi.",
      app: "Scrivi 3 schermate MVP su carta (home → scelta → risultato). Poi fai 1 pagina HTML statica.",
      people: "Chiama 1 persona che ha già venduto qualcosa: 10 minuti, chiedi ‘come hai trovato i primi clienti?’"
    },
    work: {
      people: "Fai una lista di 5 problemi ricorrenti del team. Scegline 1 e proponi un fix ‘in 7 giorni’ al tuo capo.",
      online: "Aggiorna CV/LinkedIn con 1 risultato misurabile. Poi candidati a 3 ruoli specifici oggi.",
      cut: "Elimina 1 meeting/attività inutile e usa quel tempo per completare 1 deliverable ad alto impatto."
    },
    relationships: {
      people: "Scrivi 2 frasi: ‘Quando succede X io mi sento Y’ + ‘Mi serve Z’. Dille entro 24 ore.",
      cut: "Togli ambiguità: decidi 1 confine e comunicalo con calma, senza giustificarti troppo."
    },
    life: {
      cut: "Scegli 1 cosa da togliere per 7 giorni (scroll serale, impegno, alcol, ecc.). Metti un promemoria fisso.",
      environment: "Sistema 1 spazio (scrivania/camera) in 15 minuti. Ambiente pulito = testa più leggera."
    },
    mind: {
      cut: "Disattiva notifiche di 2 app. Imposta 2 finestre al giorno per controllarle.",
      people: "Scrivi a 1 amico: ‘Mi serve una passeggiata di 20 minuti, mi fai compagnia?’"
    },
    world: {
      people: "Trova 1 persona del quartiere/gruppo locale e proponi 1 micro-azione nel weekend.",
      online: "Scrivi un post: problema + proposta + ‘chi si unisce?’. Poi manda a 5 contatti."
    }
  };

  const fallback = "Apri Note: scrivi l’obiettivo in 1 riga + 3 azioni possibili. Poi scegli quella più piccola e falla oggi.";

  return it[t]?.[c] || it[t]?.online || fallback;
}

function buildRules({ effect, tone, V, L }) {
  const it = [
    "Se non è misurabile, non esiste: definisci un numero (tempo, soldi, output).",
    "Una sola priorità per 7 giorni. Il resto è contorno.",
    "Ogni scelta deve ridurre stress o aumentare entrate: scegli una delle due."
  ];

  if ((effect || "") === "fast") it.unshift("Velocità > perfezione: fai una bozza in 30 minuti.");
  if ((effect || "") === "solid") it.unshift("Stabilità > hype: costruisci una routine replicabile.");
  if ((effect || "") === "risky") it.unshift("Rischio controllato: metti un limite di perdita (tempo/soldi) prima di partire.");
  if ((effect || "") === "radical") it.unshift("Radicale non vuol dire distruttivo: cambia una cosa alla volta, ma sul serio.");

  // tono “senza scrupoli” resta legale
  if ((tone || "") === "no_mercy") it.push("Niente scuse: scegli e taglia tutto ciò che non porta risultato entro 14 giorni.");

  return it.slice(0, 5);
}

function styleLine(line, V, L) {
  if (V !== "wtf") return line;

  // WTF: più diretto/da barista affettuoso
  if (L === "en") return `Alright: ${line}`;
  return `Ok: ${line} (e non mi fare filosofia, vai).`;
}
