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

/* ✅ lingua supportata app */
const SUP_LANGS = ["it", "en", "es", "fr", "de"];
function normLang(l = "it") {
  const s = String(l || "it").toLowerCase().slice(0, 2);
  return SUP_LANGS.includes(s) ? s : "it";
}

/* ========= copy notifiche (ROTANTI) ========= */
/* --- TITOLI --- */
const PUSH_TITLES = {
  it: [
    "What?f · frase del giorno",
    "What?f · due righe per te",
    "What?f · oggi si gira così",
    "What?f · apri un secondo",
    "What?f · micro-oracolo",
    "What?f · messaggio rapido",
  ],
  en: [
    "What?f · phrase of the day",
    "What?f · two lines for you",
    "What?f · today goes like this",
    "What?f · open for a second",
    "What?f · micro-oracle",
    "What?f · quick message",
  ],
  es: [
    "What?f · frase del día",
    "What?f · dos líneas para ti",
    "What?f · hoy va así",
    "What?f · abre un segundo",
    "What?f · micro-oráculo",
    "What?f · mensaje rápido",
  ],
  fr: [
    "What?f · phrase du jour",
    "What?f · deux lignes pour toi",
    "What?f · aujourd’hui ça tourne comme ça",
    "What?f · ouvre une seconde",
    "What?f · micro-oracle",
    "What?f · message rapide",
  ],
  de: [
    "What?f · Satz des Tages",
    "What?f · zwei Zeilen für dich",
    "What?f · heute läuft’s so",
    "What?f · kurz öffnen",
    "What?f · Mikro-Orakel",
    "What?f · kurze Nachricht",
  ],
};

/* --- WHAT IF (mattina/sera) --- */
/* ✅ le tue frasi IT: INTACT */
const WHATIF_MORNING = {
  it: [
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
  ],
  en: [
    "This morning there’s a line that puts you back in place: open it.",
    "I left you something small but powerful for today: open here.",
    "One short line, but it changes your angle: open it.",
    "Today starts better if you read this: open for a second.",
    "There’s a line that makes you want to move: open.",
    "If you open this now, the rest of the morning flows better: trust it and open.",
    "A line to start without chasing everything: open here.",
    "Before you jump into the mess: open this and start cleaner.",
    "A line that helps you choose better today: open.",
    "You don’t need motivation: you need to read this and start. Open here.",
    "Today you’ve got one extra point on your side—if you open it: go.",
    "Open this and you save yourself a pointless loop this morning.",
    "A line that takes a small weight off your shoulders: open.",
    "If you already feel late: open here and get back on track.",
    "Two lines, zero preaching: open and see.",
    "Open: there’s a detail you’re missing today, but you need it.",
    "I’m leaving you a line that brings order without shouting: open.",
    "Open now: your day will thank you later.",
    "A small mental ‘click’ for today: open here.",
    "Open this: it gives you a bit more courage to start.",
  ],
  es: [
    "Esta mañana hay una frase que te vuelve a alinear: ábrela.",
    "Te dejé algo pequeño pero potente para hoy: abre aquí.",
    "Una frase corta, pero te cambia el ángulo: ábrela.",
    "Hoy empieza mejor si lees esto: ábrelo un segundo.",
    "Hay una frase que te da ganas de moverte: ábrela.",
    "Si la abres ahora, el resto de la mañana fluye mejor: confía y abre.",
    "Una frase para empezar sin perseguirlo todo: abre aquí.",
    "Antes de meterte en el lío: abre esto y empieza más limpio.",
    "Una frase que te hace elegir mejor hoy: ábrela.",
    "No hace falta motivación: hace falta leer esto y arrancar. Abre aquí.",
    "Hoy tienes un punto más a favor si la abres: vamos.",
    "Ábrela y te ahorras una vuelta inútil esta mañana.",
    "Una frase que te quita un peso ligero de encima: ábrela.",
    "Si ya te sientes tarde: abre aquí y vuelve al carril.",
    "Dos líneas, cero sermones: abre y mira.",
    "Abre: hoy se te escapa un detalle, pero te sirve.",
    "Te dejo una frase que ordena sin gritar: abre.",
    "Ábrela ahora: tu día te lo agradece luego.",
    "Un pequeño ‘click’ mental para hoy: abre aquí.",
    "Ábrela: te hace empezar con un poco más de valentía.",
  ],
  fr: [
    "Ce matin, il y a une phrase qui te remet d’aplomb : ouvre-la.",
    "Je t’ai laissé quelque chose de petit mais puissant pour aujourd’hui : ouvre ici.",
    "Une phrase courte, mais elle change l’angle : ouvre-la.",
    "Aujourd’hui démarre mieux si tu lis ça : ouvre une seconde.",
    "Il y a une phrase qui te donne envie de bouger : ouvre.",
    "Si tu l’ouvres maintenant, le reste de la matinée glisse mieux : fais confiance et ouvre.",
    "Une phrase pour commencer sans tout courir : ouvre ici.",
    "Avant de plonger dans le bazar : ouvre ça et pars plus propre.",
    "Une phrase qui t’aide à mieux choisir aujourd’hui : ouvre.",
    "Pas besoin d’être motivé : lis ça et démarre. Ouvre ici.",
    "Aujourd’hui tu as un point de plus pour toi, si tu l’ouvres : vas-y.",
    "Ouvre ça et tu t’épargnes un tour à vide ce matin.",
    "Une phrase qui t’enlève un petit poids : ouvre.",
    "Si tu te sens déjà en retard : ouvre ici et reviens sur les rails.",
    "Deux lignes, zéro sermon : ouvre et vois.",
    "Ouvre : il y a un détail qui t’échappe aujourd’hui, mais il te sert.",
    "Je te laisse une phrase qui met de l’ordre sans crier : ouvre.",
    "Ouvre maintenant : ta journée te dira merci plus tard.",
    "Un petit ‘clic’ mental pour aujourd’hui : ouvre ici.",
    "Ouvre ça : ça te donne un peu plus de courage pour démarrer.",
  ],
  de: [
    "Heute Morgen gibt’s einen Satz, der dich wieder ausrichtet: öffne ihn.",
    "Ich hab dir etwas Kleines, aber Starkes für heute dagelassen: hier öffnen.",
    "Ein kurzer Satz, aber er ändert deinen Blickwinkel: öffne ihn.",
    "Heute startet besser, wenn du das liest: kurz öffnen.",
    "Da ist ein Satz, der dich in Bewegung bringt: öffnen.",
    "Wenn du das jetzt öffnest, läuft der Rest des Morgens leichter: vertrau’s und öffne.",
    "Ein Satz, um zu starten ohne allem hinterherzurennen: hier öffnen.",
    "Bevor du ins Chaos springst: öffne das und starte sauberer.",
    "Ein Satz, der dir heute bessere Entscheidungen gibt: öffnen.",
    "Du brauchst keine Motivation: du musst das lesen und starten. Hier öffnen.",
    "Heute hast du einen Punkt mehr auf deiner Seite—wenn du’s öffnest: los.",
    "Öffne das und du sparst dir heute Morgen eine sinnlose Runde.",
    "Ein Satz, der dir ein kleines Gewicht von den Schultern nimmt: öffnen.",
    "Wenn du dich schon zu spät fühlst: hier öffnen und zurück in die Spur.",
    "Zwei Zeilen, keine Predigt: öffnen und schauen.",
    "Öffne: heute entgeht dir ein Detail, aber du brauchst es.",
    "Ich lass dir einen Satz da, der Ordnung macht ohne zu schreien: öffnen.",
    "Jetzt öffnen: dein Tag dankt es dir später.",
    "Ein kleiner mentaler ‘Klick’ für heute: hier öffnen.",
    "Öffne das: es gibt dir etwas mehr Mut zum Start.",
  ],
};

const WHATIF_EVENING = {
  it: [
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
  ],
  en: [
    "End the day with a line that brings you back to peace: open it.",
    "Before you turn your brain off, read this: it helps.",
    "Two lines to peel the day off your skin: open here.",
    "A line to close without putting yourself on trial: open it.",
    "Open this and sleep with less noise in your head.",
    "You don’t have to fix everything tonight: open this and let go better.",
    "Open: there’s a line that makes you end the day lighter.",
    "If you bring the day into bed, open here first.",
    "Two lines to put a period, not three dots: open.",
    "Open: here’s a gentle way to close today.",
    "A line so you don’t carry the same weight into tomorrow: open.",
    "Open: you need a more honest ending, not a more perfect one.",
    "Open this, then shut everything down: you deserve it.",
    "Open: there’s an ‘ok’ you can allow yourself tonight.",
    "A small line, but it changes your sleep: open.",
  ],
  es: [
    "Cierra el día con una frase que te devuelve la calma: ábrela.",
    "Antes de apagar el cerebro, lee esto: te hace bien.",
    "Dos líneas para sacarte el día de encima: abre aquí.",
    "Una frase para cerrar sin juicio: ábrela.",
    "Ábrela y duerme con menos ruido en la cabeza.",
    "No hace falta arreglarlo todo hoy: abre esto y suelta mejor.",
    "Abre: hay una frase que te deja el día más ligero.",
    "Si te llevas el día a la cama, abre aquí antes.",
    "Dos líneas para poner un punto, no tres puntos: abre.",
    "Abre: te doy una forma amable de cerrar hoy.",
    "Una frase para no repetirte mañana el mismo peso: abre.",
    "Abre: te sirve un final más honesto, no más perfecto.",
    "Abre esto y luego apaga todo: te lo mereces.",
    "Abre: hay un ‘ok’ que puedes permitirte esta noche.",
    "Una frase pequeña, pero te cambia el sueño: abre.",
  ],
  fr: [
    "Termine la journée avec une phrase qui te remet en paix : ouvre-la.",
    "Avant d’éteindre le cerveau, lis ça : ça fait du bien.",
    "Deux lignes pour te retirer la journée de dessus : ouvre ici.",
    "Une phrase pour fermer sans procès : ouvre-la.",
    "Ouvre ça et dors avec moins de bruit dans la tête.",
    "Pas besoin de tout réparer ce soir : ouvre ça et lâche mieux.",
    "Ouvre : il y a une phrase qui te fait finir la journée plus léger.",
    "Si tu amènes la journée au lit, ouvre ici avant.",
    "Deux lignes pour mettre un point, pas trois points : ouvre.",
    "Ouvre : je te donne une façon douce de fermer aujourd’hui.",
    "Une phrase pour ne pas traîner le même poids demain : ouvre.",
    "Ouvre : il te faut une fin plus honnête, pas plus parfaite.",
    "Ouvre ça, puis ferme tout : tu le mérites.",
    "Ouvre : il y a un ‘ok’ que tu peux t’accorder ce soir.",
    "Une petite phrase, mais ça change ton sommeil : ouvre.",
  ],
  de: [
    "Beende den Tag mit einem Satz, der dich beruhigt: öffne ihn.",
    "Bevor du den Kopf ausschaltest, lies das: es tut gut.",
    "Zwei Zeilen, um den Tag von dir abzuziehen: hier öffnen.",
    "Ein Satz zum Schließen ohne Selbstprozess: öffnen.",
    "Öffne das und schlaf mit weniger Lärm im Kopf.",
    "Du musst heute Abend nicht alles reparieren: öffne das und lass besser los.",
    "Öffne: da ist ein Satz, der dich den Tag leichter beenden lässt.",
    "Wenn du den Tag mit ins Bett nimmst, öffne hier zuerst.",
    "Zwei Zeilen für einen Punkt statt drei Punkten: öffnen.",
    "Öffne: eine sanfte Art, heute zu schließen.",
    "Ein Satz, damit du morgen nicht dasselbe Gewicht trägst: öffnen.",
    "Öffne: du brauchst ein ehrlicheres Ende, kein perfekteres.",
    "Öffne das, dann mach alles aus: du verdienst es.",
    "Öffne: da ist ein ‘ok’, das du dir heute erlauben kannst.",
    "Ein kleiner Satz, aber er verändert deinen Schlaf: öffnen.",
  ],
};

/* --- WTF (sera + speciali) --- */
/* ✅ le tue frasi IT: INTACT */
const WTF_EVENING = {
  it: [
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
  ],
  en: [
    "Oi, you still awake? Open this and go to bed—tomorrow hits early, what the f.",
    "Look at the time. Open this, then sleep… tomorrow won’t save you, what the f.",
    "Tomorrow not even a drum-playing elephant wakes you up: open this and disappear to bed, what the f.",
    "Enough mental movies: open this and let’s close the day with a crooked smile, what the f.",
    "If you judge yourself again tonight, I swear I’ll throw you a moral alarm clock: open this, what the f.",
    "Open this, then turn everything off: even your brain needs maintenance, what the f.",
    "If you keep scrolling, the night grows on you: open this and we close it, what the f.",
    "Two lines and then no more drama: open this and sleep, what the f.",
    "Open this before tomorrow shows up like an empty fridge: loud and sad, what the f.",
    "Ok, last thing today: open this and vanish under the blankets, what the f.",
    "Open this: here’s the honest version of your day, no sugar, what the f.",
    "If you want to be alive tomorrow, close tonight right: open this and then bed, what the f.",
    "Open this and close the night like a bar: lights down, thoughts out, what the f.",
    "You caused enough chaos today: open this and stop, what the f.",
    "Open this and let me see if you can close at least one thing properly today, what the f.",
    "If you feel like a rag, it’s because you are: open this and sleep, what the f.",
    "Open this: two affectionate slaps, then bed—what the f.",
    "Ok champ, end of day: open this and then sleep, what the f.",
  ],
  es: [
    "¿Sigues despierto? Abre esto y a la cama, que mañana pega temprano, qué carajo.",
    "Mira la hora. Abre esto y a dormir… mañana no te salva nadie, qué carajo.",
    "Mañana ni un elefante con tambor te despierta: abre esto y desaparece a la cama, qué carajo.",
    "Basta películas mentales: abre esto y cerramos el día con sonrisa torcida, qué carajo.",
    "Si vuelves a juzgarte esta noche, te tiro un despertador moral: abre esto, qué carajo.",
    "Abre esto y apaga todo: hasta el cerebro necesita mantenimiento, qué carajo.",
    "Si sigues scrolleando, la noche se te pega: abre esto y cerramos, qué carajo.",
    "Dos líneas y se acabó el drama: abre esto y duerme, qué carajo.",
    "Abre esto antes de que mañana llegues como una nevera vacía: triste y ruidosa, qué carajo.",
    "Ok, última cosa del día: abre esto y métete bajo las mantas, qué carajo.",
    "Abre esto: versión honesta del día, sin azúcar, qué carajo.",
    "Si mañana quieres estar vivo, cierra bien hoy: abre esto y a la cama, qué carajo.",
    "Abre esto y cierra la noche como un bar: luces abajo, pensamientos fuera, qué carajo.",
    "Ya hiciste suficiente caos hoy: abre esto y para, qué carajo.",
    "Abre esto y a ver si cierras bien al menos una cosa hoy, qué carajo.",
    "Si te sientes un trapo, es porque lo eres: abre esto y duerme, qué carajo.",
    "Abre esto: dos bofetadas cariñosas y a la cama, qué carajo.",
    "Ok campeón, fin del día: abre esto y a dormir, qué carajo.",
  ],
  fr: [
    "Eh, t’es encore réveillé ? Ouvre ça et va dormir, demain tape tôt, bordel.",
    "T’as vu l’heure ? Ouvre ça, puis dodo… demain te sauvera pas, bordel.",
    "Demain même un éléphant au tambour te réveille pas : ouvre ça et file au lit, bordel.",
    "Stop les films mentaux : ouvre ça et on ferme la journée avec un sourire tordu, bordel.",
    "Si tu te juges encore ce soir, je te balance un réveil moral : ouvre ça, bordel.",
    "Ouvre ça puis éteins tout : même ton cerveau a besoin de maintenance, bordel.",
    "Si tu scrolles encore, la nuit te colle : ouvre ça et on ferme, bordel.",
    "Deux lignes et basta le drama : ouvre ça et dors, bordel.",
    "Ouvre ça avant que demain t’arrive comme un frigo vide : triste et bruyant, bordel.",
    "Ok, dernière chose : ouvre ça puis sous la couette, bordel.",
    "Ouvre ça : version honnête de ta journée, sans sucre, bordel.",
    "Si demain tu veux être vivant, ferme bien ce soir : ouvre ça puis lit, bordel.",
    "Ouvre ça et ferme la soirée comme un bar : lumières down, pensées dehors, bordel.",
    "T’as fait assez de chaos aujourd’hui : ouvre ça et stop, bordel.",
    "Ouvre ça et voyons si tu peux fermer au moins un truc proprement aujourd’hui, bordel.",
    "Si tu te sens en chiffon, c’est normal : ouvre ça puis dors, bordel.",
    "Ouvre ça : deux claques affectueuses, puis au lit, bordel.",
    "Ok champion, fin de journée : ouvre ça et dodo, bordel.",
  ],
  de: [
    "Ey, bist du noch wach? Öffne das und geh pennen—morgen knallt früh rein, verdammt nochmal.",
    "Hast du die Uhr gesehen? Öffnen, dann schlafen… morgen rettet dich keiner, verdammt nochmal.",
    "Morgen weckt dich nicht mal ein Trommel-Elefant: öffne das und verschwinde ins Bett, verdammt nochmal.",
    "Genug Kopfkino: öffne das und wir schließen den Tag mit schiefem Grinsen, verdammt nochmal.",
    "Wenn du dich heute Nacht noch mal verurteilst, werf ich dir einen Moral-Wecker hin: öffnen, verdammt nochmal.",
    "Öffne das, dann mach alles aus: sogar dein Gehirn braucht Wartung, verdammt nochmal.",
    "Wenn du weiter scrollst, wächst dir die Nacht über den Kopf: öffnen und Schluss, verdammt nochmal.",
    "Zwei Zeilen und dann kein Drama mehr: öffnen und schlafen, verdammt nochmal.",
    "Öffne das, bevor du morgen wie ein leerer Kühlschrank auftauchst: traurig und laut, verdammt nochmal.",
    "Ok, letzte Sache heute: öffnen und ab unter die Decke, verdammt nochmal.",
    "Öffne das: die ehrliche Version deines Tages, ohne Zucker, verdammt nochmal.",
    "Wenn du morgen leben willst, schließ heute sauber: öffnen und dann Bett, verdammt nochmal.",
    "Öffne das und schließ den Abend wie eine Bar: Lichter runter, Gedanken raus, verdammt nochmal.",
    "Genug Chaos für heute: öffnen und stopp, verdammt nochmal.",
    "Öffne das—mal sehen ob du heute wenigstens eine Sache richtig abschließen kannst, verdammt nochmal.",
    "Wenn du dich wie ein Lappen fühlst: ja. Öffne das und schlaf, verdammt nochmal.",
    "Öffne das: zwei liebevolle Klatscher, dann Bett, verdammt nochmal.",
    "Ok Champion, Tagesende: öffnen und schlafen, verdammt nochmal.",
  ],
};

const WTF_POST_SBRONZA_MORNING = {
  it: [
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
  ],
  en: [
    "Post-hangover mode: open this—at least we’ll recover your dignity in installments, what the f.",
    "Saturday morning with a “never again” face: open this and restart your brain, what the f.",
    "If your mouth is glue and your memory has holes, open this: I’ll fix your bar-karma, what the f.",
    "Half-closed eyes and hangover soul: open this before you do damage, what the f.",
    "If today you feel like furniture: open this so your thoughts stand up again, what the f.",
    "Open this before you promise “never again” for the 50th time, what the f.",
    "Hangover and fragile heart: open this, I’ll straighten you out with no poetry, what the f.",
    "Open this: a line and an imaginary sip of clarity, what the f.",
    "If your brain is still in nightclub mode: open this and become human again, what the f.",
    "Open this, then water, coffee, and dignity—in that order, what the f.",
  ],
  es: [
    "Modo resaca: abre esto—al menos recuperamos la dignidad a plazos, qué carajo.",
    "Sábado por la mañana con cara de “nunca más”: abre esto y reinicia el cerebro, qué carajo.",
    "Si tienes la boca pegada y la memoria con agujeros, abre esto: te arreglo el karma de bar, qué carajo.",
    "Ojos en rendija y alma en resaca: abre esto antes de hacer daños, qué carajo.",
    "Si hoy te sientes un mueble: abre esto y que el pensamiento se levante, qué carajo.",
    "Abre esto antes de prometer “nunca más” por la quincuagésima vez, qué carajo.",
    "Resaca y corazón frágil: abre esto, te enderezo sin poesía, qué carajo.",
    "Abre esto: una frase y un sorbo imaginario de lucidez, qué carajo.",
    "Si el cerebro sigue en modo discoteca: abre esto y vuelve a ser humano, qué carajo.",
    "Abre esto y luego agua, café y dignidad—en ese orden, qué carajo.",
  ],
  fr: [
    "Mode gueule de bois : ouvre ça—au moins on récupère ta dignité à crédit, bordel.",
    "Samedi matin, tête de “plus jamais” : ouvre ça et redémarre ton cerveau, bordel.",
    "Bouche pâteuse et mémoire trouée ? Ouvre ça : je répare ton karma de bar, bordel.",
    "Yeux en fente et âme en hangover : ouvre ça avant de faire des dégâts, bordel.",
    "Si aujourd’hui tu te sens comme un meuble : ouvre ça, que tes pensées se remettent debout, bordel.",
    "Ouvre ça avant de promettre “plus jamais” pour la 50e fois, bordel.",
    "Gueule de bois et cœur fragile : ouvre ça, je te remets droit sans poésie, bordel.",
    "Ouvre ça : une phrase et une gorgée imaginaire de lucidité, bordel.",
    "Si ton cerveau est encore en mode boîte de nuit : ouvre ça et redeviens humain, bordel.",
    "Ouvre ça puis eau, café, dignité—dans cet ordre, bordel.",
  ],
  de: [
    "Kater-Modus: Öffne das—wenigstens retten wir deine Würde in Raten, verdammt nochmal.",
    "Samstagmorgen mit “nie wieder”-Gesicht: öffnen und Gehirn neu starten, verdammt nochmal.",
    "Klebemund und Gedächtnislücken? Öffne das: ich reparier dein Bar-Karma, verdammt nochmal.",
    "Schlitzaugen und Hangover-Seele: öffnen, bevor du Schaden anrichtest, verdammt nochmal.",
    "Wenn du dich heute wie ein Möbelstück fühlst: öffnen, damit der Kopf wieder steht, verdammt nochmal.",
    "Öffne das, bevor du zum 50. Mal “nie wieder” versprichst, verdammt nochmal.",
    "Kater und fragiles Herz: öffnen—ich richte dich ohne Poesie gerade, verdammt nochmal.",
    "Öffne das: ein Satz und ein imaginärer Schluck Klarheit, verdammt nochmal.",
    "Wenn dein Gehirn noch im Club-Modus ist: öffnen und wieder Mensch werden, verdammt nochmal.",
    "Öffne das, dann Wasser, Kaffee, Würde—in der Reihenfolge, verdammt nochmal.",
  ],
};

// ✅ DOMENICA SERA: cattiva, “weekend finito / lunedì in arrivo”
const WTF_SUNDAY_EVENING = {
  it: [
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
  ],
  en: [
    "Sunday night: the weekend is dead and Monday is already knocking. Open this and make peace with the mess, what the f.",
    "It’s Sunday night: tomorrow the ride restarts and you didn’t recharge your soul. Open this, what the f.",
    "Sunday night: you even wasted the “rest”. Open this and at least we close with dignity, what the f.",
    "Tomorrow is Monday: if you spiral now, you do double damage. Open this and grit your teeth with style, what the f.",
    "Sunday night: that hollow feeling? That’s Monday approaching. Open this, what the f.",
    "It’s over: tomorrow we go back to pretending to be adults. Open this and put your helmet on, what the f.",
    "Sunday night: if anxiety hits, at least make it useful. Open this and we close the farce, what the f.",
    "Tomorrow we restart and you’re still in mental pajamas. Open this and get back on the road, what the f.",
    "Sunday night: we don’t want free sadness. Open this and then bed, what the f.",
    "Monday is around the corner like a creditor: open this and prepare without crying, what the f.",
  ],
  es: [
    "Domingo por la noche: el finde murió y el lunes ya está llamando. Abre esto y haz las paces con el desastre, qué carajo.",
    "Es domingo por la noche: mañana vuelve la rueda y ni recargaste el alma. Abre esto, qué carajo.",
    "Domingo por la noche: hasta desperdiciaste el “descanso”. Abre esto y al menos cerramos con dignidad, qué carajo.",
    "Mañana es lunes: si te deprimes ahora haces doble daño. Abre esto y aprieta los dientes con estilo, qué carajo.",
    "Domingo por la noche: ¿ese vacío? Es el lunes acercándose. Abre esto, qué carajo.",
    "Se acabó: mañana volvemos a fingir ser adultos. Abre esto y ponte el casco, qué carajo.",
    "Domingo por la noche: si te sube la ansiedad, al menos hazla útil. Abre esto y cerramos la farsa, qué carajo.",
    "Mañana se reinicia y tú sigues en pijama mental. Abre esto y vuelve a la carretera, qué carajo.",
    "Domingo por la noche: tristeza gratis no queremos. Abre esto y luego a la cama, qué carajo.",
    "El lunes está a la vuelta como un acreedor: abre esto y prepárate sin llorar, qué carajo.",
  ],
  fr: [
    "Dimanche soir : le week-end est mort et lundi frappe déjà. Ouvre ça et fais la paix avec le bazar, bordel.",
    "C’est dimanche soir : demain la machine redémarre et t’as même pas rechargé ton âme. Ouvre ça, bordel.",
    "Dimanche soir : t’as gaspillé même le “repos”. Ouvre ça et au moins on ferme dignement, bordel.",
    "Demain c’est lundi : si tu plonges maintenant, tu fais double dégâts. Ouvre ça et serre les dents avec style, bordel.",
    "Dimanche soir : ce creux dans le ventre ? C’est lundi qui arrive. Ouvre ça, bordel.",
    "C’est fini : demain on rejoue aux adultes. Ouvre ça et mets le casque, bordel.",
    "Dimanche soir : si l’angoisse monte, rends-la utile. Ouvre ça et on ferme la farce, bordel.",
    "Demain ça repart et toi t’es encore en pyjama mental. Ouvre ça et remets-toi en route, bordel.",
    "Dimanche soir : la tristesse gratuite, non merci. Ouvre ça puis au lit, bordel.",
    "Lundi est au coin comme un créancier : ouvre ça et prépare-toi sans pleurer, bordel.",
  ],
  de: [
    "Sonntagabend: Das Wochenende ist tot und Montag klopft schon. Öffne das und mach Frieden mit dem Chaos, verdammt nochmal.",
    "Es ist Sonntagabend: morgen startet die Nummer neu und du hast nicht mal die Seele aufgeladen. Öffne das, verdammt nochmal.",
    "Sonntagabend: sogar die “Erholung” hast du vergeudet. Öffne das und wenigstens schließen wir würdig, verdammt nochmal.",
    "Morgen ist Montag: wenn du jetzt abstürzt, machst du doppelt Schaden. Öffne das und beiß mit Stil die Zähne zusammen, verdammt nochmal.",
    "Sonntagabend: dieses Loch im Bauch? Das ist Montag im Anflug. Öffne das, verdammt nochmal.",
    "Vorbei: morgen tun wir wieder so, als wären wir Erwachsene. Öffne das und setz den Helm auf, verdammt nochmal.",
    "Sonntagabend: wenn die Angst kommt, mach sie wenigstens nützlich. Öffne das und wir schließen die Farce, verdammt nochmal.",
    "Morgen geht’s wieder los und du bist noch im mentalen Schlafanzug. Öffne das und zurück auf die Straße, verdammt nochmal.",
    "Sonntagabend: kostenlose Traurigkeit wollen wir nicht. Öffne das und dann Bett, verdammt nochmal.",
    "Montag steht um die Ecke wie ein Gläubiger: öffne das und bereite dich vor ohne zu heulen, verdammt nochmal.",
  ],
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

    // ✅ ora prendiamo token + lang
    const entries = snap.docs.map((d) => {
      const data = d.data() || {};
      return {
        token: d.id,
        lang: normLang(data.lang || "it"),
      };
    });

    // ✅ group by lang (senza cambiare il resto della tua logica)
    const groups = {};
    for (const e of entries) {
      if (!groups[e.lang]) groups[e.lang] = [];
      groups[e.lang].push(e.token);
    }

    // 🔁 Seed giornaliero (Roma) + slot + phase → rotazione 1/giorno per mattina e 1/giorno per sera
    const day = ymdRome(new Date());

    let sentTotal = 0;
    let failedTotal = 0;

    // ✅ invio per lingua
    for (const L of Object.keys(groups)) {
      const seedBase = `${day}|${safeSlot}|${safePhase}|${safeMood}|${L}`;

      const titlesLib = PUSH_TITLES[L] || PUSH_TITLES.it;
      const title =
        pickDaily(titlesLib, `${seedBase}|title`) ||
        (titlesLib[0] || "What?f · frase del giorno");

      let body = "La tua frase di oggi è pronta 🔔";

      if (safePhase === "1") {
        // WHAT IF
        const lib = safeSlot === "evening"
          ? (WHATIF_EVENING[L] || WHATIF_EVENING.it)
          : (WHATIF_MORNING[L] || WHATIF_MORNING.it);

        body = pickDaily(lib, seedBase);
      } else {
        // WTF
        if (isSundayNightCattiva) {
          const lib = WTF_SUNDAY_EVENING[L] || WTF_SUNDAY_EVENING.it;
          body = pickDaily(lib, seedBase);
        } else if (isSaturdayPostSbronza) {
          const lib = WTF_POST_SBRONZA_MORNING[L] || WTF_POST_SBRONZA_MORNING.it;
          body = pickDaily(lib, seedBase);
        } else {
          const lib = WTF_EVENING[L] || WTF_EVENING.it;
          body = pickDaily(lib, seedBase);
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
          lang: L, // ✅ utile anche lato SW se vuoi log/debug
        },
        tokens: groups[L],
      };

      const resp = await admin.messaging().sendEachForMulticast(message);
      sentTotal += resp.successCount || 0;
      failedTotal += resp.failureCount || 0;
    }

    return res.status(200).json({
      ok: true,
      day,
      slot: safeSlot,
      phase: safePhase,
      title: "multi-lang", // ✅ non ti rompo la struttura: campo rimane, ma è multi invio
      body: "multi-lang",
      sent: sentTotal,
      failed: failedTotal,
    });
  } catch (err) {
    console.error("push error", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
    }
