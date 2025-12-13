// FILE: /api/push.js
import admin from "../firebase-admin-server.js";

const db = admin.firestore();
const APP_ORIGIN = "https://what-ifapp.vercel.app";

/* ========= helpers deterministici (rotazione giornaliera) ========= */
function ymdRome(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function weekdayRome(d = new Date()) {
  // 0=Sun ... 6=Sat
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Rome",
    weekday: "short",
  }).format(d);
  return ({ Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }[wd] ?? 0);
}

function hashStr(str = "") {
  let h = 2166136261 >>> 0;
  for (const ch of String(str)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function pickDaily(arr, seedStr) {
  if (!arr || !arr.length) return "";
  const seed = hashStr(seedStr);
  return arr[seed % arr.length];
}

/* ========= LANG helpers ========= */
const SUP_LANGS = ["it", "en", "es", "fr", "de"];
function normLang(l = "it") {
  const s = String(l || "it").toLowerCase().slice(0, 2);
  return SUP_LANGS.includes(s) ? s : "it";
}

/* ========= copy notifiche (ROTANTI) ========= */

/* --- TITOLI --- */
const PUSH_TITLES = [
  "What?f · frase del giorno",
  "What?f · due righe per te",
  "What?f · oggi si gira così",
  "What?f · apri un secondo",
  "What?f · micro-oracolo",
  "What?f · messaggio rapido",
];

const PUSH_TITLES_EN = [
  "What?f · daily line",
  "What?f · two lines for you",
  "What?f · today goes like this",
  "What?f · open for a sec",
  "What?f · micro-oracle",
  "What?f · quick message",
];

const PUSH_TITLES_ES = [
  "What?f · frase del día",
  "What?f · dos líneas para ti",
  "What?f · hoy va así",
  "What?f · abre un segundo",
  "What?f · micro-oráculo",
  "What?f · mensaje rápido",
];

const PUSH_TITLES_FR = [
  "What?f · phrase du jour",
  "What?f · deux lignes pour toi",
  "What?f · aujourd’hui c’est comme ça",
  "What?f · ouvre une seconde",
  "What?f · micro-oracle",
  "What?f · message rapide",
];

const PUSH_TITLES_DE = [
  "What?f · Satz des Tages",
  "What?f · zwei Zeilen für dich",
  "What?f · heute läuft’s so",
  "What?f · kurz öffnen",
  "What?f · Mikro-Orakel",
  "What?f · kurze Nachricht",
];

const PUSH_TITLES_BY_LANG = {
  it: PUSH_TITLES,
  en: PUSH_TITLES_EN,
  es: PUSH_TITLES_ES,
  fr: PUSH_TITLES_FR,
  de: PUSH_TITLES_DE,
};

/* --- WHAT IF MORNING --- */
const WHATIF_MORNING = [
  "Stamattina c’è una frase che ti rimette in asse: aprila.",
  "Ti ho lasciato una cosa piccola ma potente per oggi: apri qua.",
  "Una frase breve, ma ti cambia l’angolo: aprila.",
  "Oggi parte meglio se leggi questa: apri un secondo.",
  "C’è una frase che ti fa venire voglia di muoverti: apri.",
  "Se apri questa adesso, il resto della mattina scorre meglio: fidati e apri.",
  "Una frase per iniziare senza rincorrere tutto: apri qua.",
  "Prima di buttarti nel casino: apri questa e parti più pulito.",
  "Una frase che ti fa scegliere meglio oggi: apri.",
  "Non serve essere motivati: serve leggere questa e partire. Apri qua.",
  "Oggi hai un punto in più a favore, se la apri: vai.",
  "Apri questa e ti risparmi un giro a vuoto stamattina.",
  "Una frase che ti toglie un peso leggero dalle spalle: apri.",
  "Se ti senti già in ritardo: apri qua, ti rimetti in carreggiata.",
  "Due righe, zero prediche: apri e vedi.",
  "Apri: c’è un dettaglio che oggi ti sfugge, ma ti serve.",
  "Ti lascio una frase che fa ordine senza urlare: apri.",
  "Apri adesso: la giornata ti ringrazia più tardi.",
  "Un piccolo “click” mentale per oggi: apri qua.",
  "Apri questa: ti fa partire con un filo di coraggio in più.",
];

const WHATIF_MORNING_EN = [
  "This morning there’s a line that re-centers you: open it.",
  "I left you something small but powerful for today: open this.",
  "A short line, but it changes your angle: open it.",
  "Today starts better if you read this: open for a second.",
  "There’s a line that makes you want to move: open it.",
  "If you open this now, the rest of the morning flows better: trust me and open it.",
  "One line to start without chasing everything: open this.",
  "Before you jump into the mess: open this and start cleaner.",
  "A line that helps you choose better today: open it.",
  "You don’t need motivation: you need to read this and begin. Open it.",
  "Today you have one extra point in your favor—if you open it. Go.",
  "Open this and you save yourself a useless loop this morning.",
  "A line that lifts a light weight off your shoulders: open it.",
  "If you already feel late: open this and get back on track.",
  "Two lines, zero lectures: open and see.",
  "Open it: there’s a detail you’re missing today, and you need it.",
  "I’m leaving you a line that brings order without shouting: open it.",
  "Open now: your day will thank you later.",
  "A tiny mental “click” for today: open this.",
  "Open this: it gives you a thread of extra courage to start.",
];

const WHATIF_MORNING_ES = [
  "Esta mañana hay una frase que te vuelve a centrar: ábrela.",
  "Te dejé algo pequeño pero potente para hoy: abre aquí.",
  "Una frase corta, pero te cambia el ángulo: ábrela.",
  "Hoy empieza mejor si lees esto: abre un segundo.",
  "Hay una frase que te dan ganas de moverte: abre.",
  "Si la abres ahora, el resto de la mañana fluye mejor: confía y abre.",
  "Una frase para empezar sin perseguirlo todo: abre aquí.",
  "Antes de meterte en el lío: abre esto y arranca más limpio.",
  "Una frase que te ayuda a elegir mejor hoy: abre.",
  "No hace falta motivación: hace falta leer esto y empezar. Abre aquí.",
  "Hoy tienes un punto a favor, si lo abres: vamos.",
  "Abre esto y te ahorras una vuelta tonta esta mañana.",
  "Una frase que te quita un peso ligero de los hombros: abre.",
  "Si ya te sientes tarde: abre aquí y vuelve al carril.",
  "Dos líneas, cero sermones: abre y mira.",
  "Abre: hay un detalle que hoy se te escapa, y te sirve.",
  "Te dejo una frase que ordena sin gritar: abre.",
  "Abre ahora: el día te lo agradece después.",
  "Un pequeño “clic” mental para hoy: abre aquí.",
  "Abre esto: te da un hilo más de valentía para arrancar.",
];

const WHATIF_MORNING_FR = [
  "Ce matin, il y a une phrase qui te remet d’aplomb : ouvre-la.",
  "Je t’ai laissé un truc petit mais puissant pour aujourd’hui : ouvre ici.",
  "Une phrase courte, mais elle change ton angle : ouvre-la.",
  "Aujourd’hui démarre mieux si tu lis ça : ouvre une seconde.",
  "Il y a une phrase qui te donne envie de bouger : ouvre.",
  "Si tu ouvres ça maintenant, le reste de la matinée coule mieux : fais confiance et ouvre.",
  "Une phrase pour commencer sans tout courir : ouvre ici.",
  "Avant de plonger dans le bazar : ouvre ça et pars plus net.",
  "Une phrase qui t’aide à mieux choisir aujourd’hui : ouvre.",
  "Pas besoin de motivation : lis ça et démarre. Ouvre ici.",
  "Aujourd’hui tu as un point en plus en ta faveur, si tu l’ouvres : vas-y.",
  "Ouvre ça et tu t’épargnes un tour inutile ce matin.",
  "Une phrase qui enlève un petit poids des épaules : ouvre.",
  "Si tu te sens déjà en retard : ouvre ici et remets-toi sur les rails.",
  "Deux lignes, zéro leçon : ouvre et vois.",
  "Ouvre : il y a un détail qui t’échappe aujourd’hui, et il te sert.",
  "Je te laisse une phrase qui met de l’ordre sans crier : ouvre.",
  "Ouvre maintenant : ta journée te remerciera plus tard.",
  "Un petit “clic” mental pour aujourd’hui : ouvre ici.",
  "Ouvre ça : ça te donne un fil de courage en plus pour commencer.",
];

const WHATIF_MORNING_DE = [
  "Heute Morgen gibt’s einen Satz, der dich wieder ausrichtet: öffne ihn.",
  "Ich hab dir etwas Kleines, aber Starkes dagelassen: hier öffnen.",
  "Ein kurzer Satz, der den Blickwinkel kippt: öffne ihn.",
  "Heute startet besser, wenn du das liest: kurz öffnen.",
  "Da ist ein Satz, der dich in Bewegung bringt: öffnen.",
  "Wenn du das jetzt öffnest, läuft der Morgen leichter: vertrau mir und öffne.",
  "Ein Satz, um zu starten ohne allem hinterherzurennen: hier öffnen.",
  "Bevor du ins Chaos springst: öffne das und starte sauberer.",
  "Ein Satz, der dir hilft, heute besser zu wählen: öffnen.",
  "Du brauchst keine Motivation: du musst das lesen und anfangen. Öffne es.",
  "Heute hast du einen Punkt mehr auf deiner Seite—wenn du öffnest. Los.",
  "Öffne das und spar dir heute Morgen eine sinnlose Schleife.",
  "Ein Satz, der dir ein leichtes Gewicht von den Schultern nimmt: öffnen.",
  "Wenn du dich schon zu spät fühlst: öffne das und komm zurück auf Kurs.",
  "Zwei Zeilen, null Predigt: öffnen und sehen.",
  "Öffne: da ist ein Detail, das dir heute entgeht—und du brauchst es.",
  "Ein Satz, der Ordnung schafft ohne zu schreien: öffnen.",
  "Jetzt öffnen: dein Tag dankt es dir später.",
  "Ein kleiner mentaler „Klick“ für heute: hier öffnen.",
  "Öffne das: es gibt dir ein bisschen extra Mut zum Start.",
];

const WHATIF_MORNING_BY_LANG = {
  it: WHATIF_MORNING,
  en: WHATIF_MORNING_EN,
  es: WHATIF_MORNING_ES,
  fr: WHATIF_MORNING_FR,
  de: WHATIF_MORNING_DE,
};

/* --- WHAT IF EVENING --- */
const WHATIF_EVENING = [
  "Chiudi la giornata con una frase che ti rimette in pace: aprila.",
  "Prima di spegnere il cervello, leggi questa: ti fa bene.",
  "Due righe per sfilarti la giornata di dosso: apri qua.",
  "Una frase per chiudere senza processo: aprila.",
  "Apri questa e vai a dormire con meno rumore in testa.",
  "Non serve sistemare tutto stasera: apri questa e lasci andare meglio.",
  "Apri: c’è una frase che ti fa finire la giornata più leggero.",
  "Se ti porti la giornata nel letto, apri qua prima.",
  "Due righe per mettere un punto, non tre puntini: apri.",
  "Apri: ti do un modo gentile per chiudere oggi.",
  "Una frase per non ripeterti domani lo stesso peso: apri.",
  "Apri: ti serve un finale più onesto, non più perfetto.",
  "Apri questa, poi chiudi tutto e basta: te lo meriti.",
  "Apri: c’è un “ok” che puoi concederti stasera.",
  "Una frase piccola, ma ti cambia il sonno: apri.",
];

const WHATIF_EVENING_EN = [
  "Close your day with a line that brings you peace: open it.",
  "Before you switch your brain off, read this: it helps.",
  "Two lines to peel the day off your skin: open this.",
  "A line to close without putting yourself on trial: open it.",
  "Open this and go to sleep with less noise in your head.",
  "You don’t need to fix everything tonight: open this and let go better.",
  "Open it: there’s a line that makes your day end lighter.",
  "If you take the day to bed with you, open this first.",
  "Two lines to put a period, not three dots: open it.",
  "Open it: here’s a gentle way to close today.",
  "A line so you don’t carry the same weight into tomorrow: open it.",
  "Open it: you need an honest ending, not a perfect one.",
  "Open this, then shut everything down: you deserve it.",
  "Open it: there’s an “ok” you can allow yourself tonight.",
  "A small line, but it changes your sleep: open it.",
];

const WHATIF_EVENING_ES = [
  "Cierra el día con una frase que te deja en paz: ábrela.",
  "Antes de apagar el cerebro, lee esto: te hace bien.",
  "Dos líneas para sacarte el día de encima: abre aquí.",
  "Una frase para cerrar sin juicio: ábrela.",
  "Abre esto y duerme con menos ruido en la cabeza.",
  "No hace falta arreglarlo todo hoy: abre esto y suelta mejor.",
  "Abre: hay una frase que te deja el día más ligero.",
  "Si te llevas el día a la cama, abre aquí antes.",
  "Dos líneas para poner un punto, no tres puntos: abre.",
  "Abre: te doy una forma amable de cerrar hoy.",
  "Una frase para no cargarte mañana con lo mismo: abre.",
  "Abre: te hace falta un final más honesto, no más perfecto.",
  "Abre esto, luego ciérralo todo y ya: te lo mereces.",
  "Abre: hay un “ok” que puedes darte esta noche.",
  "Una frase pequeña, pero te cambia el sueño: abre.",
];

const WHATIF_EVENING_FR = [
  "Termine la journée avec une phrase qui te remet en paix : ouvre-la.",
  "Avant d’éteindre le cerveau, lis ça : ça fait du bien.",
  "Deux lignes pour retirer la journée de toi : ouvre ici.",
  "Une phrase pour fermer sans procès : ouvre-la.",
  "Ouvre ça et dors avec moins de bruit dans la tête.",
  "Pas besoin de tout régler ce soir : ouvre ça et lâche mieux.",
  "Ouvre : il y a une phrase qui finit ta journée plus léger.",
  "Si tu emmènes la journée au lit, ouvre ici avant.",
  "Deux lignes pour mettre un point, pas des points de suspension : ouvre.",
  "Ouvre : je te donne une façon douce de fermer aujourd’hui.",
  "Une phrase pour ne pas traîner le même poids demain : ouvre.",
  "Ouvre : il te faut une fin plus honnête, pas plus parfaite.",
  "Ouvre ça, puis ferme tout : tu le mérites.",
  "Ouvre : il y a un “ok” que tu peux t’accorder ce soir.",
  "Une petite phrase, mais elle change ton sommeil : ouvre.",
];

const WHATIF_EVENING_DE = [
  "Beende den Tag mit einem Satz, der dich beruhigt: öffne ihn.",
  "Bevor du dein Gehirn ausschaltest: lies das, es tut gut.",
  "Zwei Zeilen, um den Tag von dir abzustreifen: hier öffnen.",
  "Ein Satz zum Abschließen ohne Prozess: öffnen.",
  "Öffne das und schlaf mit weniger Lärm im Kopf.",
  "Du musst heute Abend nicht alles reparieren: öffne das und lass besser los.",
  "Öffne: da ist ein Satz, der den Tag leichter enden lässt.",
  "Wenn du den Tag mit ins Bett nimmst: öffne das zuerst.",
  "Zwei Zeilen für einen Punkt statt drei Punkte: öffnen.",
  "Öffne: eine sanfte Art, heute zu schließen.",
  "Ein Satz, damit du morgen nicht dasselbe Gewicht trägst: öffnen.",
  "Öffne: du brauchst ein ehrliches Ende, kein perfektes.",
  "Öffne das, dann mach alles zu: du verdienst es.",
  "Öffne: da ist ein „ok“, das du dir heute erlauben kannst.",
  "Ein kleiner Satz, der deinen Schlaf verändert: öffnen.",
];

const WHATIF_EVENING_BY_LANG = {
  it: WHATIF_EVENING,
  en: WHATIF_EVENING_EN,
  es: WHATIF_EVENING_ES,
  fr: WHATIF_EVENING_FR,
  de: WHATIF_EVENING_DE,
};

/* --- WTF EVENING --- */
const WTF_EVENING = [
  "We, ancora sveglio stai? Leggiti questa e vai a letto che domani ti alzi, ecchecazz!!!",
  "Hai visto che ore sono? Apri qua, poi nanna… che domani non ti salva nessuno, ecchecazz!!!",
  "Domani manco un elefante col tamburo ti sveglia: apri questa e poi sparisci a dormì, ecchecazz!!!",
  "Dai su, basta film mentali: apri qua e chiudiamo ‘sta giornata col sorriso storto, ecchecazz!!!",
  "Se stasera ti giudichi ancora, giuro che ti tiro una sveglia morale: apri qua, ecchecazz!!!",
  "Apri questa, poi spegni tutto: che pure il cervello ha bisogno di manutenzione, ecchecazz!!!",
  "Se continui a scrollare ti cresce la notte addosso: apri qua e chiudiamo, ecchecazz!!!",
  "Due righe e poi basta drammi: apri qua e vai a dormì, ecchecazz!!!",
  "Apri qua prima che domani ti presenti come un frigorifero vuoto: triste e rumoroso, ecchecazz!!!",
  "Ok, ultima cosa della giornata: apri questa e poi sparisci sotto le coperte, ecchecazz!!!",
  "Apri qua: ti do la versione onesta della giornata, senza zucchero, ecchecazz!!!",
  "Se domani vuoi essere vivo, stasera chiudi bene: apri qua e poi letto, ecchecazz!!!",
  "Apri questa e poi chiudi la serata come si chiude un bar: luci giù e pensieri fuori, ecchecazz!!!",
  "Hai fatto abbastanza casino per oggi: apri qua e poi stop, ecchecazz!!!",
  "Apri qua e fammi vedere se almeno una cosa la chiudi bene oggi, ecchecazz!!!",
  "Se ti senti uno straccio, è perché lo sei: apri qua e poi dormi, ecchecazz!!!",
  "Apri qua: ti do due schiaffetti affettuosi e poi ti mando a letto, ecchecazz!!!",
  "Ok campione, fine giornata: apri questa e poi a nanna, ecchecazz!!!",
];

const WTF_EVENING_EN = [
  "Oi, still awake? Open this, then go to bed—tomorrow you’re getting up, what the f.",
  "Have you seen the time? Open this, then sleep… tomorrow nobody saves you, what the f.",
  "Tomorrow not even an elephant with drums wakes you up: open this and disappear to bed, what the f.",
  "Alright, enough mental movies: open this and we close the day with a crooked smile, what the f.",
  "If you judge yourself again tonight, I swear I’ll smack you with a moral alarm clock: open this, what the f.",
  "Open this, then turn everything off: even your brain needs maintenance, what the f.",
  "If you keep scrolling, the night grows on you: open this and we’re done, what the f.",
  "Two lines then no more drama: open this and sleep, what the f.",
  "Open this before tomorrow shows up like an empty fridge: sad and loud, what the f.",
  "Okay, last thing today: open this then vanish under the blankets, what the f.",
  "Open this: here’s the honest version of your day, no sugar, what the f.",
  "If you want to be alive tomorrow, close tonight properly: open this then bed, what the f.",
  "Open this then close the night like a bar: lights down and thoughts out, what the f.",
  "You made enough mess for today: open this then stop, what the f.",
  "Open this and show me you can at least finish one thing properly today, what the f.",
  "If you feel like a rag, it’s because you are: open this then sleep, what the f.",
  "Open this: two affectionate slaps and then I send you to bed, what the f.",
  "Alright champ, end of day: open this then sleep, what the f.",
];

const WTF_EVENING_ES = [
  "Eh, ¿sigues despierto? Abre esto y a la cama, que mañana te levantas, qué carajo.",
  "¿Has visto la hora? Abre aquí y a dormir… mañana no te salva nadie, qué carajo.",
  "Mañana ni un elefante con tambores te despierta: abre esto y desaparece a dormir, qué carajo.",
  "Venga, basta de películas mentales: abre aquí y cerramos el día con una sonrisa torcida, qué carajo.",
  "Si hoy te juzgas otra vez, te juro que te meto un despertador moral: abre aquí, qué carajo.",
  "Abre esto y apaga todo: hasta el cerebro necesita mantenimiento, qué carajo.",
  "Si sigues scrolleando, la noche se te pega: abre aquí y cerramos, qué carajo.",
  "Dos líneas y ya sin drama: abre aquí y a dormir, qué carajo.",
  "Abre aquí antes de que mañana llegue como una nevera vacía: triste y ruidosa, qué carajo.",
  "Vale, última cosa del día: abre esto y bajo las mantas, qué carajo.",
  "Abre aquí: te doy la versión honesta del día, sin azúcar, qué carajo.",
  "Si mañana quieres estar vivo, cierra bien hoy: abre aquí y luego cama, qué carajo.",
  "Abre esto y cierra la noche como un bar: luces abajo y pensamientos fuera, qué carajo.",
  "Ya has montado bastante lío hoy: abre aquí y para, qué carajo.",
  "Abre aquí y a ver si por lo menos cierras una cosa bien hoy, qué carajo.",
  "Si te sientes hecho trapo, es porque lo estás: abre aquí y duerme, qué carajo.",
  "Abre aquí: dos bofetaditas cariñosas y a la cama, qué carajo.",
  "Venga campeón, fin del día: abre esto y a dormir, qué carajo.",
];

const WTF_EVENING_FR = [
  "Hé, t’es encore réveillé ? Ouvre ça et au lit, demain tu te lèves, bordel.",
  "T’as vu l’heure ? Ouvre ça, puis dodo… demain personne te sauve, bordel.",
  "Demain même un éléphant avec des tambours te réveille pas : ouvre ça et file dormir, bordel.",
  "Allez, stop les films mentaux : ouvre ça et on ferme la journée avec un sourire de travers, bordel.",
  "Si tu te juges encore ce soir, je te jure je te colle un réveil moral : ouvre ça, bordel.",
  "Ouvre ça puis éteins tout : même ton cerveau a besoin de maintenance, bordel.",
  "Si tu scrolles encore, la nuit te pousse dessus : ouvre ça et on ferme, bordel.",
  "Deux lignes et basta le drama : ouvre ça et dors, bordel.",
  "Ouvre ça avant que demain débarque comme un frigo vide : triste et bruyant, bordel.",
  "Ok, dernière chose du jour : ouvre ça puis sous la couette, bordel.",
  "Ouvre ça : version honnête de ta journée, sans sucre, bordel.",
  "Si tu veux être vivant demain, ferme bien ce soir : ouvre ça puis lit, bordel.",
  "Ouvre ça et ferme la nuit comme un bar : lumières bas et pensées dehors, bordel.",
  "T’as fait assez de bazar aujourd’hui : ouvre ça puis stop, bordel.",
  "Ouvre ça et montre-moi que tu sais finir au moins un truc proprement aujourd’hui, bordel.",
  "Si tu te sens comme une serpillière, c’est normal : ouvre ça puis dors, bordel.",
  "Ouvre ça : deux claques affectueuses et je t’envoie au lit, bordel.",
  "Ok champion, fin de journée : ouvre ça puis dodo, bordel.",
];

const WTF_EVENING_DE = [
  "Ey, noch wach? Öffne das und dann ins Bett—morgen stehst du auf, verdammt nochmal.",
  "Hast du die Uhr gesehen? Öffnen, dann schlafen… morgen rettet dich keiner, verdammt nochmal.",
  "Morgen weckt dich nicht mal ein Elefant mit Trommeln: öffne das und verschwinde ins Bett, verdammt nochmal.",
  "Okay, Schluss mit Kopfkino: öffne das und wir schließen den Tag mit schiefem Grinsen, verdammt nochmal.",
  "Wenn du dich heute Abend wieder verurteilst, schwör ich, ich hau dir einen moralischen Wecker rein: öffne das, verdammt nochmal.",
  "Öffne das, dann mach alles aus: sogar dein Gehirn braucht Wartung, verdammt nochmal.",
  "Wenn du weiter scrollst, wächst dir die Nacht über den Kopf: öffne das und Schluss, verdammt nochmal.",
  "Zwei Zeilen und dann kein Drama mehr: öffne das und schlaf, verdammt nochmal.",
  "Öffne das, bevor morgen wie ein leerer Kühlschrank auftaucht: traurig und laut, verdammt nochmal.",
  "Okay, letztes Ding heute: öffne das und dann unter die Decke, verdammt nochmal.",
  "Öffne das: die ehrliche Version deines Tages, ohne Zucker, verdammt nochmal.",
  "Wenn du morgen lebendig sein willst, schließ heute sauber: öffne das, dann Bett, verdammt nochmal.",
  "Öffne das und schließ den Abend wie eine Bar: Licht runter, Gedanken raus, verdammt nochmal.",
  "Du hast heute genug Chaos gemacht: öffne das, dann stopp, verdammt nochmal.",
  "Öffne das und zeig mir, dass du heute wenigstens eine Sache ordentlich beendest, verdammt nochmal.",
  "Wenn du dich wie ein Lappen fühlst, ist das korrekt: öffne das und schlaf, verdammt nochmal.",
  "Öffne das: zwei liebevolle Klatscher und dann schick ich dich ins Bett, verdammt nochmal.",
  "Okay Champion, Tagesende: öffne das und dann schlafen, verdammt nochmal.",
];

const WTF_EVENING_BY_LANG = {
  it: WTF_EVENING,
  en: WTF_EVENING_EN,
  es: WTF_EVENING_ES,
  fr: WTF_EVENING_FR,
  de: WTF_EVENING_DE,
};

/* --- WTF POST SBRONZA MORNING --- */
const WTF_POST_SBRONZA_MORNING = [
  "Post-sbronza mode: apri qua, così almeno la dignità la recuperi a rate, ecchecazz!!!",
  "Sabato mattina e faccia da “mai più”: apri questa e rimetti in moto il cervello, ecchecazz!!!",
  "Se hai la bocca impastata e la memoria a buchi, apri qua: ti sistemo il karma da bar, ecchecazz!!!",
  "Occhi a fessura e anima in hangover: apri qua prima di fare danni, ecchecazz!!!",
  "Se oggi ti senti un mobile: apri qua, che almeno il pensiero torna in piedi, ecchecazz!!!",
  "Apri questa prima di promettere “mai più” per la cinquantesima volta, ecchecazz!!!",
  "Post-sbronza e cuore fragile: apri qua, ti rimetto dritto senza fare poesia, ecchecazz!!!",
  "Apri qua: ti do una frase e un sorso di lucidità immaginaria, ecchecazz!!!",
  "Se il cervello sta ancora in modalità discoteca: apri qua e torna umano, ecchecazz!!!",
  "Apri questa e poi acqua, caffè e dignità: in quest’ordine, ecchecazz!!!",
];

const WTF_POST_SBRONZA_MORNING_EN = [
  "Post-hangover mode: open this, at least you’ll recover dignity in installments, what the f.",
  "Saturday morning with a ‘never again’ face: open this and restart your brain, what the f.",
  "If your mouth is glue and your memory has holes: open this, I’ll fix your bar karma, what the f.",
  "Squinty eyes and a hangover soul: open this before you do damage, what the f.",
  "If today you feel like furniture: open this—at least your thoughts stand up, what the f.",
  "Open this before you say ‘never again’ for the 50th time, what the f.",
  "Hangover and fragile heart: open this, I’ll straighten you out without poetry, what the f.",
  "Open this: one line and a sip of imaginary clarity, what the f.",
  "If your brain is still in nightclub mode: open this and come back human, what the f.",
  "Open this, then water, coffee, and dignity—in this order, what the f.",
];

const WTF_POST_SBRONZA_MORNING_ES = [
  "Modo resaca: abre esto, al menos recuperas la dignidad a plazos, qué carajo.",
  "Sábado por la mañana y cara de ‘nunca más’: abre esto y reinicia el cerebro, qué carajo.",
  "Si tienes la boca pegada y la memoria con agujeros: abre esto, te arreglo el karma de bar, qué carajo.",
  "Ojos entrecerrados y alma en resaca: abre esto antes de liarla, qué carajo.",
  "Si hoy te sientes un mueble: abre esto, que el pensamiento se pone de pie, qué carajo.",
  "Abre esto antes de prometer ‘nunca más’ por quincuagésima vez, qué carajo.",
  "Resaca y corazón frágil: abre esto, te enderezo sin poesía, qué carajo.",
  "Abre: una frase y un sorbo de lucidez imaginaria, qué carajo.",
  "Si el cerebro sigue en modo discoteca: abre esto y vuelve a ser humano, qué carajo.",
  "Abre esto y luego agua, café y dignidad: en ese orden, qué carajo.",
];

const WTF_POST_SBRONZA_MORNING_FR = [
  "Mode gueule de bois : ouvre ça, au moins tu récupères la dignité par petites tranches, bordel.",
  "Samedi matin avec la tête ‘plus jamais’ : ouvre ça et redémarre ton cerveau, bordel.",
  "Si ta bouche colle et ta mémoire a des trous : ouvre ça, je te répare le karma de bar, bordel.",
  "Yeux plissés et âme en hangover : ouvre ça avant de faire des dégâts, bordel.",
  "Si aujourd’hui tu te sens comme un meuble : ouvre ça, au moins la pensée se remet debout, bordel.",
  "Ouvre ça avant de dire ‘plus jamais’ pour la cinquantième fois, bordel.",
  "Gueule de bois et cœur fragile : ouvre ça, je te remets droit sans poésie, bordel.",
  "Ouvre : une phrase et une gorgée de lucidité imaginaire, bordel.",
  "Si ton cerveau est encore en mode boîte : ouvre ça et redeviens humain, bordel.",
  "Ouvre ça puis eau, café, et dignité : dans cet ordre, bordel.",
];

const WTF_POST_SBRONZA_MORNING_DE = [
  "Kater-Modus: öffne das, wenigstens bekommst du deine Würde in Raten zurück, verdammt nochmal.",
  "Samstagmorgen mit ‘nie wieder’-Gesicht: öffne das und starte dein Gehirn neu, verdammt nochmal.",
  "Wenn dein Mund klebt und dein Gedächtnis Löcher hat: öffne das, ich repariere dein Bar-Karma, verdammt nochmal.",
  "Schlitzaugen und Katerseele: öffne das, bevor du Schaden anrichtest, verdammt nochmal.",
  "Wenn du dich heute wie ein Möbelstück fühlst: öffne das—wenigstens stehen deine Gedanken wieder auf, verdammt nochmal.",
  "Öffne das, bevor du ‘nie wieder’ zum 50. Mal versprichst, verdammt nochmal.",
  "Kater und fragiles Herz: öffne das, ich richte dich ohne Poesie wieder gerade, verdammt nochmal.",
  "Öffne: ein Satz und ein Schluck imaginäre Klarheit, verdammt nochmal.",
  "Wenn dein Gehirn noch im Club-Modus ist: öffne das und werd wieder Mensch, verdammt nochmal.",
  "Öffne das, dann Wasser, Kaffee und Würde—in dieser Reihenfolge, verdammt nochmal.",
];

const WTF_POST_SBRONZA_MORNING_BY_LANG = {
  it: WTF_POST_SBRONZA_MORNING,
  en: WTF_POST_SBRONZA_MORNING_EN,
  es: WTF_POST_SBRONZA_MORNING_ES,
  fr: WTF_POST_SBRONZA_MORNING_FR,
  de: WTF_POST_SBRONZA_MORNING_DE,
};

/* --- WTF SUNDAY EVENING --- */
const WTF_SUNDAY_EVENING = [
  "Domenica sera: il weekend è morto e lunedì sta già bussando. Apri qua e fai pace col disastro, ecchecazz!!!",
  "È domenica sera: domani ricomincia la giostra e tu manco hai ricaricato l’anima. Apri qua, ecchecazz!!!",
  "Domenica sera: hai sprecato pure il “riposo”. Apri questa e almeno chiudiamo dignitosi, ecchecazz!!!",
  "Domani è lunedì: se ti deprimi adesso fai doppio danno. Apri qua e stringi i denti con stile, ecchecazz!!!",
  "Domenica sera: quel vuoto nello stomaco? È il lunedì che si avvicina. Apri qua, ecchecazz!!!",
  "È finita: domani si torna a fingere di essere adulti. Apri questa e metti il casco, ecchecazz!!!",
  "Domenica sera: se ti parte l’ansia, almeno falla utile. Apri qua e chiudiamo ‘sta farsa, ecchecazz!!!",
  "Domani si riparte e tu sei ancora in pigiama mentale. Apri qua e rimettiti in strada, ecchecazz!!!",
  "Domenica sera: la tristezza gratis non la vogliamo. Apri questa e poi letto, ecchecazz!!!",
  "Il lunedì è dietro l’angolo come un creditore: apri qua e preparati senza piangere, ecchecazz!!!",
];

const WTF_SUNDAY_EVENING_EN = [
  "Sunday night: the weekend is dead and Monday is already knocking. Open this and make peace with the mess, what the f.",
  "It’s Sunday night: tomorrow the carousel starts again and you didn’t even recharge your soul. Open this, what the f.",
  "Sunday night: you even wasted ‘rest’. Open this and let’s at least close with dignity, what the f.",
  "Tomorrow is Monday: if you spiral now you’re doing double damage. Open this and grit your teeth with style, what the f.",
  "Sunday night: that hole in your stomach? That’s Monday approaching. Open this, what the f.",
  "It’s over: tomorrow we go back to pretending we’re adults. Open this and put your helmet on, what the f.",
  "Sunday night: if anxiety hits, at least make it useful. Open this and we close this farce, what the f.",
  "Tomorrow we restart and you’re still in mental pajamas. Open this and get back on the road, what the f.",
  "Sunday night: we don’t want free sadness. Open this and then bed, what the f.",
  "Monday is around the corner like a creditor: open this and prepare without crying, what the f.",
];

const WTF_SUNDAY_EVENING_ES = [
  "Domingo por la noche: el finde está muerto y el lunes ya llama. Abre esto y haz las paces con el desastre, qué carajo.",
  "Es domingo por la noche: mañana vuelve la rueda y ni recargaste el alma. Abre aquí, qué carajo.",
  "Domingo noche: hasta ‘descansar’ lo gastaste. Abre esto y cerremos con dignidad, qué carajo.",
  "Mañana es lunes: si te hundes ahora haces doble daño. Abre aquí y aprieta los dientes con estilo, qué carajo.",
  "Domingo noche: ¿ese vacío en el estómago? Es el lunes acercándose. Abre aquí, qué carajo.",
  "Se acabó: mañana volvemos a fingir ser adultos. Abre esto y ponte el casco, qué carajo.",
  "Domingo noche: si llega la ansiedad, al menos que sirva. Abre aquí y cerramos esta farsa, qué carajo.",
  "Mañana se reinicia y tú sigues en pijama mental. Abre aquí y vuelve a la carretera, qué carajo.",
  "Domingo noche: tristeza gratis no la queremos. Abre esto y luego cama, qué carajo.",
  "El lunes está a la vuelta como un acreedor: abre aquí y prepárate sin llorar, qué carajo.",
];

const WTF_SUNDAY_EVENING_FR = [
  "Dimanche soir : le week-end est mort et lundi frappe déjà. Ouvre ça et fais la paix avec le désastre, bordel.",
  "C’est dimanche soir : demain la machine repart et tu n’as même pas rechargé l’âme. Ouvre ça, bordel.",
  "Dimanche soir : tu as même gâché le ‘repos’. Ouvre ça et qu’on ferme au moins dignement, bordel.",
  "Demain c’est lundi : si tu déprimes maintenant tu doubles les dégâts. Ouvre ça et serre les dents avec style, bordel.",
  "Dimanche soir : ce vide au ventre ? C’est lundi qui approche. Ouvre ça, bordel.",
  "C’est fini : demain on recommence à faire semblant d’être adultes. Ouvre ça et mets le casque, bordel.",
  "Dimanche soir : si l’angoisse débarque, qu’au moins elle serve. Ouvre ça et on ferme cette farce, bordel.",
  "Demain on repart et toi t’es encore en pyjama mental. Ouvre ça et remets-toi en route, bordel.",
  "Dimanche soir : la tristesse gratuite, non merci. Ouvre ça puis au lit, bordel.",
  "Lundi est au coin comme un créancier : ouvre ça et prépare-toi sans pleurer, bordel.",
];

const WTF_SUNDAY_EVENING_DE = [
  "Sonntagabend: Das Wochenende ist tot und Montag klopft schon. Öffne das und mach Frieden mit dem Chaos, verdammt nochmal.",
  "Es ist Sonntagabend: Morgen geht’s wieder los und du hast nicht mal deine Seele aufgeladen. Öffne das, verdammt nochmal.",
  "Sonntagabend: Du hast sogar ‘Erholung’ vergeudet. Öffne das und wir schließen wenigstens würdig, verdammt nochmal.",
  "Morgen ist Montag: Wenn du jetzt abstürzt, machst du doppelten Schaden. Öffne das und beiß mit Stil die Zähne zusammen, verdammt nochmal.",
  "Sonntagabend: Dieses Loch im Bauch? Das ist der Montag, der näherkommt. Öffne das, verdammt nochmal.",
  "Vorbei: Morgen tun wir wieder so, als wären wir Erwachsene. Öffne das und setz den Helm auf, verdammt nochmal.",
  "Sonntagabend: Wenn die Angst kommt, soll sie wenigstens nützlich sein. Öffne das und wir schließen diese Farce, verdammt nochmal.",
  "Morgen starten wir neu und du bist noch im mentalen Pyjama. Öffne das und zurück auf die Straße, verdammt nochmal.",
  "Sonntagabend: Gratis-Traurigkeit wollen wir nicht. Öffne das und dann Bett, verdammt nochmal.",
  "Montag steht um die Ecke wie ein Gläubiger: Öffne das und bereite dich vor, ohne zu heulen, verdammt nochmal.",
];

const WTF_SUNDAY_EVENING_BY_LANG = {
  it: WTF_SUNDAY_EVENING,
  en: WTF_SUNDAY_EVENING_EN,
  es: WTF_SUNDAY_EVENING_ES,
  fr: WTF_SUNDAY_EVENING_FR,
  de: WTF_SUNDAY_EVENING_DE,
};

/* ========= handler ========= */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const { slot = "morning", phase = "1", mood = "" } = req.query || {};

    const safeSlot = ["morning", "afternoon", "evening"].includes(String(slot))
      ? String(slot)
      : "morning";

    let safePhase = String(phase) === "2" ? "2" : "1";
    const safeMood = String(mood || "");

    const wd = weekdayRome(new Date()); // 0=Sun..6=Sat
    const isSunday = wd === 0;
    const isSaturday = wd === 6;

    const isMorning = safeSlot === "morning";
    const isEvening = safeSlot === "evening";

    // ✅ SABATO MATTINA = WTF post-sbronza
    const isSaturdayPostSbronza = isSaturday && isMorning;
    if (isSaturdayPostSbronza) safePhase = "2";

    // ✅ DOMENICA SERA = WTF cattiva
    const isSundayNightCattiva = isSunday && isEvening;
    if (isSundayNightCattiva) safePhase = "2";

    const signalPath =
      `/fifth.html?signal=${safeSlot}&phase=${safePhase}` +
      (safeMood ? `&mood=${encodeURIComponent(safeMood)}` : "");

    const CLICK_LINK = `${APP_ORIGIN}${signalPath}`;

    const snap = await db
      .collection("fcm_tokens")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();

    if (snap.empty) {
      return res.status(200).json({ ok: false, error: "no_tokens" });
    }

    // ✅ token + lang dal doc
    const tokenRows = snap.docs.map((d) => {
      const data = d.data() || {};
      return {
        token: d.id,
        lang: normLang(data.lang || "it"),
      };
    });

    // ✅ raggruppa token per lingua
    const tokensByLang = {};
    for (const r of tokenRows) {
      const L = normLang(r.lang);
      if (!tokensByLang[L]) tokensByLang[L] = [];
      tokensByLang[L].push(r.token);
    }

    // 🔁 Seed giornaliero (Roma) + slot + phase → rotazione 1/giorno per mattina e 1/giorno per sera
    const day = ymdRome(new Date());
    const seedBase = `${day}|${safeSlot}|${safePhase}|${safeMood}`;

    let totalSent = 0;
    let totalFailed = 0;

    // ✅ invia UNA multicast per lingua
    for (const L of Object.keys(tokensByLang)) {
      const tokens = tokensByLang[L];
      if (!tokens || !tokens.length) continue;

      const titlesLib = PUSH_TITLES_BY_LANG[L] || PUSH_TITLES_BY_LANG.it;
      const title =
        pickDaily(titlesLib, `${seedBase}|title|${L}`) ||
        (titlesLib[0] || "What?f · frase del giorno");

      let body = L === "it" ? "La tua frase di oggi è pronta 🔔" : "Your daily message is ready 🔔";

      if (safePhase === "1") {
        // WHAT IF
        body =
          safeSlot === "evening"
            ? pickDaily((WHATIF_EVENING_BY_LANG[L] || WHATIF_EVENING_BY_LANG.it), `${seedBase}|${L}`)
            : pickDaily((WHATIF_MORNING_BY_LANG[L] || WHATIF_MORNING_BY_LANG.it), `${seedBase}|${L}`);
      } else {
        // WTF
        if (isSundayNightCattiva) {
          body = pickDaily((WTF_SUNDAY_EVENING_BY_LANG[L] || WTF_SUNDAY_EVENING_BY_LANG.it), `${seedBase}|${L}`);
        } else if (isSaturdayPostSbronza) {
          body = pickDaily((WTF_POST_SBRONZA_MORNING_BY_LANG[L] || WTF_POST_SBRONZA_MORNING_BY_LANG.it), `${seedBase}|${L}`);
        } else {
          body = pickDaily((WTF_EVENING_BY_LANG[L] || WTF_EVENING_BY_LANG.it), `${seedBase}|${L}`);
        }
      }

      const message = {
        data: {
          title,
          body,
          src: "signal",
          slot: safeSlot,
          phase: safePhase,
          mood: safeMood,
          url: signalPath,
          click_action: CLICK_LINK,
          lang: L,
        },
        tokens,
      };

      const resp = await admin.messaging().sendEachForMulticast(message);
      totalSent += resp.successCount;
      totalFailed += resp.failureCount;
    }

    return res.status(200).json({
      ok: true,
      day,
      slot: safeSlot,
      phase: safePhase,
      sent: totalSent,
      failed: totalFailed,
    });
  } catch (err) {
    console.error("push error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
