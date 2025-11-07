// /api/ask.js — What?f Engine (WhatIf naturale + WTF demenziale — MULTILINGUA)
// Versione: identica alla tua, con WhatIf più breve/emotivo (+ frase motivante breve) e
// WTF con oggetti contestuali + sbronza da bar + morale + tono leggermente demotivante

import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { randomBytes, createHash } from "node:crypto";

/* ========= OpenAI ========= */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ========= Rate limit ========= */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "1 m") });

/* ========= CORS ========= */
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token, x-pro");
}

/* ========= Helpers ========= */
const SUP_LANGS = ["it","en","es","fr","de"];
const normLang = (l="it") =>
  SUP_LANGS.includes(String(l||"it").toLowerCase().slice(0,2))
    ? String(l).toLowerCase().slice(0,2)
    : "it";

const normLine = (s="") => String(s).toLowerCase()
  .replace(/[“”"']/g,"").replace(/\s+/g," ")
  .replace(/[.,;:!?()[\]\-—]+$/g,"").trim();

function tightenSentences(text, maxSentences){
  const parts=String(text||"").replace(/\n+/g," ").split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
  const out=[], seen=new Set();
  for(const p of parts){ const n=normLine(p); if(!n||seen.has(n)) continue; out.push(p); if(out.length>=maxSentences) break; }
  let t=out.join(" "); if(!/[.!?…]$/.test(t)) t+="."; return t;
}
function clampWords(text, maxWords){
  const w=String(text||"").split(/\s+/); if(w.length<=maxWords) return text;
  const slice=w.slice(0,maxWords).join(" ");
  const m=slice.match(/([\s\S]*?[.!?…])(?![\s\S]*[.!?…])/);
  return m?m[1]:slice+"…";
}
function normalizeOneParagraph(s=""){
  return String(s)
    .replace(/\s*\n+\s*/g," ")
    .replace(/\s{2,}/g," ")
    .replace(/\.\.\.+/g,"…")
    .replace(/\s+([.,;:!?])/g,"$1")
    .trim();
}
function stripQuestionEcho(domanda,text){
  let t=String(text||"");
  const d=String(domanda||"").replace(/[“”"']/g,"").trim().toLowerCase();
  if(d.length>=8){
    const lead=t.slice(0,Math.min(t.length,d.length+12)).toLowerCase().replace(/[“”"']/g,"").trim();
    if(lead.startsWith(d)){ const cut=t.indexOf("."); if(cut>-1) t=t.slice(cut+1).trim(); }
  }
  const rx=/^(?:\s*(?:e\s*se|what\s*if|domanda:|q:)\s*[^.!?…]*[.!?…]\s+)/i;
  return t.replace(rx,"").trim();
}
const sentenceCaseAll = (s="") => s.replace(/(^|[.!?…]\s+)([a-zà-ÿ])/gu,(m,p,c)=>p+c.toUpperCase());
const finalPunct = (s="") => /[.!?…]$/.test(s)?s:s+".";

/* ========= WHAT IF ========= */
// ➜ Modifica: 7–9 frasi (prima 8–11) e tono “voce amica di una vita” + aggiunta frase motivante breve in post-process
const WHATIF_RULES = {
  it: `Sei "What If": VOCE DA AMICO DI UNA VITA — calma, empatica, concreta, con calore vero (mai robotico). Scrivi in ITALIANO.
Paragrafo unico, 7–9 frasi, no elenchi né emoji, NON ripetere la domanda.
Sequenza: (1) radice emotiva; (2) perché conta ora; (3) prime settimane;
(4) outlook 3–6 mesi (pro + una sfida credibile); (5) realtà pratica (costi/tempo/energia/contesto);
(6) da dove nasce il desiderio; (7) micro-test; (8) criterio interno per decidere.
Stile naturale, frasi con lunghezze diverse, immagini quotidiane sobrie, tono umano e diretto.`.trim(),
  en: `You are "What If": LIFELONG-FRIEND VOICE — calm, empathetic, practical, human (never robotic). Write in ENGLISH.
Single paragraph, 7–9 sentences, no bullets or emojis, do NOT restate the question.
Sequence: emotional root → why now → first weeks → 3–6 month outlook (upsides + one real challenge) → practical reality (cost/time/energy/context) → origin of desire → micro-test → inner criterion. Keep it warm, natural.`.trim(),
  es: `Eres "What If": VOZ DE AMIGO DE TODA LA VIDA — calma, empática y práctica (nada robótica). Escribe en ESPAÑOL.
Un solo párrafo, 7–9 frases, sin listas ni emojis, NO repitas la pregunta. Sigue la secuencia indicada; tono humano y natural.`.trim(),
  fr: `Tu es "What If" : VOIX D’AMI DE TOUJOURS — calme, empathique et concrète (jamais robot). Écris en FRANÇAIS.
Un seul paragraphe, 7–9 phrases, pas de listes ni d’emojis, ne répète pas la question. Suis la séquence; ton humain, naturel.`.trim(),
  de: `Du bist "What If": STIMME EINES LEBENSLANGEN FREUNDS — ruhig, empathisch, pragmatisch (nie robotisch). Schreibe auf DEUTSCH.
Ein Absatz, 7–9 Sätze, keine Listen/Emojis, Frage NICHT wiederholen. Reihenfolge befolgen; Ton menschlich und natürlich.`.trim()
};
const WHATIF_EXAMPLES = {
  it:`All’inizio tutto ti sembrerà geniale: aria più pulita, meno rumore, la testa che rallenta. Dopo qualche settimana arriva la prova vera: le giornate si somigliano, il silenzio pesa a tratti, e capisci se quella calma ti nutre o ti rimpicciolisce. Nel giro di 3–6 mesi puoi guadagnare spazio mentale e abitudini più sane, ma rinunci a un po’ di scintilla quotidiana e dovrai essere tu a mettere benzina alle opportunità. In concreto risparmi soldi, dormi meglio e recuperi tempo, però serve disciplina per non scivolare nell’inerzia e creare contatti attivi. Questa voglia nasce dal bisogno di respirare e sentirti più tuo, non di scappare. Fai un test di due settimane “come se fosse già così”: orari, luoghi, lavoro e socialità più semplice. Se ti svegli più leggero e non senti di mettere la vita in pausa, è un passo avanti; se ti senti più piccolo, non è il posto giusto adesso.`,
  en:`At first it feels brilliant: cleaner air, less noise, your mind slowing down. A few weeks in comes the real test: days start to look alike, silence gets heavy, and you learn whether calm feeds you or shrinks you. Over 3–6 months you gain headspace and steadier habits, but trade away some daily spark and must fuel opportunities yourself. Practically you save money, sleep better and reclaim time, yet you’ll need discipline to avoid drift and to build active links. This desire comes from breathing again, not running away. Run a two-week “as if it’s already true” test: hours, places, work and simpler social life. If you wake lighter and don’t feel paused, it’s forward; if you feel smaller, not the place right now.`,
  es:`Al principio todo parece brillante: más aire y menos ruido; tu mente baja de revoluciones. A las semanas llega la prueba real: los días se parecen, el silencio pesa y ves si esa calma te nutre o te encoge. En 3–6 meses ganas espacio mental y hábitos más sanos, a cambio de menos chispa diaria y de tener que crear tú las oportunidades. En lo práctico ahorras, duermes mejor y recuperas tiempo, pero necesitarás disciplina para no caer en la inercia y cultivar vínculos. Este deseo nace de respirar de nuevo, no de huir. Haz una prueba de dos semanas “como si ya fuera cierto”: horarios, lugares, trabajo y vida social más simple. Si amaneces más ligero y no te sientes en pausa, es hacia adelante; si te sientes más pequeño, no es el lugar ahora.`,
  fr:`Au début tout paraît génial : air plus clair, moins de bruit, l’esprit qui ralentit. Après quelques semaines vient l’épreuve réelle : les jours se ressemblent, le silence pèse, et tu vois si ce calme te nourrit ou te rétrécit. En 3–6 mois tu gagnes de l’espace mental et des habitudes plus saines, au prix d’un peu d’étincelle quotidienne et d’efforts pour créer toi-même les opportunités. Concrètement tu économises, tu dors mieux et tu reprends du temps, mais il faut de la discipline pour éviter l’inertie et tisser des liens. Ce désir vient de l’envie de respirer, pas de fuir. Fais un test de deux semaines “comme si c’était déjà vrai” : horaires, lieux, travail, sociabilité simple. Si tu te réveilles plus léger sans te sentir en pause, c’est en avant; sinon, ce n’est pas le lieu maintenant.`,
  de:`Am Anfang wirkt alles genial: klarere Luft, weniger Lärm, dein Kopf wird ruhiger. Nach ein paar Wochen kommt der echte Test: Tage ähneln sich, Stille wird schwer — nährt dich die Ruhe oder macht sie dich kleiner? In 3–6 Monaten gewinnst du Kopf-Freiheit und gesündere Routinen, tauscht aber etwas Alltagsfunken ein und musst Chancen selbst anschieben. Praktisch sparst du Geld, schläfst besser und holst Zeit zurück; Disziplin ist nötig gegen Trägheit und für aktive Kontakte. Der Wunsch kommt vom Durchatmen, nicht vom Weglaufen. Mach einen Zwei-Wochen-Test „als wäre es schon so“: Zeiten, Orte, Arbeit, einfachere Sozialität. Wachst du leichter auf und fühlst dich nicht auf Pause, ist es vorwärts; fühlst du dich kleiner, ist es jetzt nicht der Ort.`
};

/* ========= WTF ========= */
/* --- Banche con varietà: oggetti, prese in giro, sbronza da bar (no paroloni), morale forzata --- */
const BANK = {
  it: {
    teasers: [
      "Ok, respira: sembri pronto a negoziare con il destino usando uno scontrino.",
      "Ehi, tranquillo: oggi facciamo pace con il caos e gli rubiamo pure il telecomando.",
      "Allora campione, hai portato il coraggio o l’hai lasciato in lavatrice coi calzini spaiati?",
      "D’accordo, genio del weekend: proviamo a non incendiare anche il lunedì.",
      "Respira: puoi sbagliare forte, ma almeno fallo con stile e ricevuta."
    ],
    scenes: [
      "il salotto che fa l’eco ai pensieri",
      "il frigorifero che giudica in silenzio",
      "la scrivania che crede di essere un altare",
      "la pianta che ti osserva come un revisore dei conti",
      "il citofono che suona solo quando stai per capire qualcosa",
      "la cucina che sembra un laboratorio segreto",
      "il corridoio che fa finta di essere un tappeto rosso"
    ],
    objects: [
      "moka","ventilatore","tapparella","lampada","Alexa","frigorifero","campanello","pianta",
      "citofono","microonde","stampante","telecomando","aspirapolvere","forno","tostapane",
      "sveglia","sedia girevole","bicicletta appesa","zaino vicino alla porta"
    ],
    verbs: [
      "applaude","fischia","si ribella","ti fa il tifo","ti mette in muto","ti manda una PEC",
      "si mette in modalità aereo","va in sciopero","si autodiagnostica","fa ghosting","apre un ticket",
      "ti assegna uno sprint","ti tagga in pubblico","finge un aggiornamento di sistema"
    ],
    twists: [
      "perché sa già come va a finire","per solidarietà sindacale","«per rispetto»",
      "per non vedere il disastro annunciato","perché anche lui ha dei limiti",
      "perché oggi si sente sindaco del tuo salotto","perché ha letto la tua scaletta (e ha riso)"
    ],
    impre: ["bestemmione corazzato","imprecazionona a detonazione","sacramentata a ciel sereno","vulcano d’anatemi","tromba d’aria di improperi"],
    booze: [
      "negroni grossi come la sete",
      "tequila a giri di shot",
      "rum in bicchieri di plastica",
      "birra media una dietro l’altra",
      "vino della casa a caraffa",
      "spritz a raffica dal bancone",
      "amaro doppio perché ‘fa bene’"
    ],
    morals: [
      "Morale: nessuno viene a salvarti; o ti muovi o resti qui.",
      "Morale: smetti di negoziare col divano.",
      "Morale: meno drama, più minuti fatti.",
      "Morale: la motivazione non arriva, la costruisci in piccolo.",
      "Morale: scegli una cosa minuscola e falla male, ma falla."
    ],
    dumbTips: [
      "Consiglio scemo: metti il timer nel freezer, così lo apri per qualcosa.",
      "Consiglio scemo: scrivi il piano su uno scontrino e timbralo.",
      "Consiglio scemo: prometti alla moka un aumento se parte al primo colpo.",
      "Consiglio scemo: cambia password in ‘ho-finito-questa-cosa’.",
      "Consiglio scemo: metti le chiavi nel frigo accanto al piano."
    ],
    emoEnd: [
      "E sì: sotto tutto questo rumore, tu ci tieni davvero.",
      "E in fondo lo sai: non vuoi perfetto, vuoi tuo.",
      "E guarda che si vede: vuoi provarci sul serio.",
      "E ti conosci: se inizi, ti ci metti davvero.",
      "E te lo meriti: una versione che profuma di adesso."
    ]
  },
  en: {
    teasers: [
      "Alright, breathe: you look ready to bargain with fate using a parking ticket.",
      "Easy, champ: today we tame chaos and steal its remote.",
      "Okay wizard, let’s try not to set Monday on fire again.",
      "Deep breath: failing loudly is allowed, just do it with taste.",
      "Cool your jets: even your to-do list needs a helmet."
    ],
    scenes: [
      "the couch echoing your thoughts","the fridge silently judging","a desk that thinks it’s a shrine",
      "the plant auditing your soul","the doorbell ringing at epiphany o’clock","the hallway pretending to be a red carpet"
    ],
    objects: ["coffee maker","fan","blind","lamp","Alexa","fridge","doorbell","plant","microwave","printer","remote","vacuum","toaster","stove","swivel chair","bike by the door","backpack on the hook"],
    verbs: ["cheers","boo","goes on strike","puts you on mute","files a complaint","switches to airplane mode","ghosts you","self-diagnoses","opens a ticket","assigns you a sprint","tags you publicly","pretends to update"],
    twists: ["because it knows how this ends","out of professional courtesy","‘out of respect’","to avoid witnessing the mess","because even it has limits","because today it’s mayor of your living room","because it read your checklist (and laughed)"],
    impre: ["armored expletive","detonating cuss","sky-splitting sacrament","volcano of curses","tornado of swears"],
    booze: [
      "Negronis the size of your thirst",
      "Tequila in shot rounds",
      "Rum in plastic cups",
      "Pints back to back",
      "House wine by the carafe",
      "Spritz on repeat from the bar",
      "Double amaro ‘for digestion’"
    ],
    morals: [
      "Moral: no one’s coming; move or stay.",
      "Moral: stop negotiating with the couch.",
      "Moral: less drama, more done minutes.",
      "Moral: motivation doesn’t arrive; you build it small.",
      "Moral: pick a tiny task and do it badly, but do it."
    ],
    dumbTips: [
      "Dumb tip: park your timer in the freezer so you open it for a reason.",
      "Dumb tip: write the plan on a receipt and stamp it.",
      "Dumb tip: promise the coffee maker a raise if it starts first try.",
      "Dumb tip: change your password to ‘i-finished-this’.",
      "Dumb tip: put the keys next to the plan in the fridge."
    ],
    emoEnd: [
      "And yes: beneath the noise, you actually care.",
      "Truth is: you don’t want perfect, you want yours.",
      "Look at you: you’re ready to try for real.",
      "You know yourself: once you start, you commit.",
      "You deserve a version that smells like now."
    ]
  },
  es: {
    teasers: [
      "Vale, respira: vas a regatear con el destino con un ticket del súper.",
      "Tranki, crack: hoy domamos el caos y le robamos el mando.",
      "Oye, mago: intentemos no incendiar el lunes otra vez.",
      "Inhala: fallar a lo grande se permite, pero con estilo.",
      "Calma: tu lista de tareas pide casco."
    ],
    scenes: [
      "el sofá con eco","la nevera que juzga","el escritorio-altar","la planta auditora",
      "el timbre oportunista","el pasillo con alfombra roja imaginaria"
    ],
    objects: ["cafetera","ventilador","persiana","lámpara","Alexa","nevera","timbre","planta","microondas","impresora","mando","aspiradora","tostadora","horno","silla giratoria","bici junto a la puerta","mochila en el perchero"],
    verbs: ["aplaude","abuchea","se pone en huelga","te silencia","presenta queja","activa modo avión","te hace ghosting","se autodiagnostica","abre un ticket","te asigna un sprint","te etiqueta en público","finge una actualización"],
    twists: ["porque ya sabe cómo acaba","por cortesía profesional","«por respeto»","para no ver el desastre","porque también tiene límites","porque hoy es alcalde de tu salón","porque leyó tu lista (y se rió)"],
    impre: ["blasfemia blindada","improperio detonante","sacramento a cielo abierto","volcán de maldiciones","tromba de juramentos"],
    booze: [
      "negronis del tamaño de tu sed",
      "tequila a rondas de shots",
      "ron en vaso de plástico",
      "cañas una detrás de otra",
      "vino de la casa en jarra",
      "spritz en racha desde la barra",
      "amaro doble ‘porque ayuda’"
    ],
    morals: [
      "Moral: nadie viene a salvarte; muévete o te quedas.",
      "Moral: deja de negociar con el sofá.",
      "Moral: menos drama, más minutos hechos.",
      "Moral: la motivación no llega; la fabricas en pequeño.",
      "Moral: elige algo mínimo y hazlo mal, pero hazlo."
    ],
    dumbTips: [
      "Tip tonto: mete el temporizador en el congelador.",
      "Tip tonto: escríbelo en un ticket y ponle sello.",
      "Tip tonto: prométele a la cafetera un bonus.",
      "Tip tonto: cambia la contraseña a ‘lo-terminé’.",
      "Tip tonto: guarda las llaves junto al plan en la nevera."
    ],
    emoEnd: [
      "Y sí: debajo del ruido, te importa de verdad.",
      "En el fondo: no quieres perfecto, quieres tuyo.",
      "Mírate: listo para intentarlo de verdad.",
      "Te conoces: si empiezas, te comprometes.",
      "Te mereces una versión que huele a ahora."
    ]
  },
  fr: {
    teasers: [
      "Ok, respire : tu veux marchander avec le destin avec un ticket de caisse.",
      "Doucement, champion : on dresse le chaos et on lui pique la télécommande.",
      "D’accord, magicien : évitons d’incendier le lundi encore une fois.",
      "Inspire : rater fort est autorisé, mais avec panache.",
      "Calme : même ta to-do exige un casque."
    ],
    scenes: [
      "le canapé qui résonne","le frigo juge muet","le bureau-autel","la plante commissaire",
      "la sonnette prophétique","le couloir qui se prend pour un tapis rouge"
    ],
    objects: ["cafetière","ventilateur","store","lampe","Alexa","frigo","sonnette","plante","micro-ondes","imprimante","télécommande","aspirateur","grille-pain","four","chaise pivotante","vélo près de la porte","sac à dos au portemanteau"],
    verbs: ["applaudit","hue","se met en grève","te met en silencieux","dépose plainte","passe en mode avion","te ghoste","s’auto-diagnostique","ouvre un ticket","t’assigne un sprint","te tague en public","fait semblant de se mettre à jour"],
    twists: ["car il connaît déjà la fin","par courtoisie pro","« par respect »","pour ne pas voir le bazar","car lui aussi a des limites","car aujourd’hui il est maire de ton salon","car il a lu ta liste (et a ri)"],
    impre: ["gros juron blindé","imprécation détonante","sacre en plein ciel","volcan de jurons","tornade d’insultes"],
    booze: [
      "negronis à la taille de ta soif",
      "tequila en tournées de shots",
      "rhum en gobelets",
      "demis à la chaîne",
      "vin de la maison en carafe",
      "spritz en série au comptoir",
      "amaro double ‘c’est pour digérer’"
    ],
    morals: [
      "Morale : personne ne vient te sauver ; bouge ou reste.",
      "Morale : arrête de négocier avec le canapé.",
      "Morale : moins de drame, plus de minutes faites.",
      "Morale : la motivation n’arrive pas ; tu la construis en petit.",
      "Morale : choisis un minuscule truc et fais-le mal, mais fais-le."
    ],
    dumbTips: [
      "Astuce bête : minuteur au congélo.",
      "Astuce bête : écris le plan sur un ticket et tamponne.",
      "Astuce bête : promets une prime à la cafetière.",
      "Astuce bête : change le mot de passe en ‘j-ai-fini-ça’.",
      "Astuce bête : mets les clés près du plan dans le frigo."
    ],
    emoEnd: [
      "Et oui : sous le bruit, tu y tiens vraiment.",
      "Au fond : tu ne veux pas parfait, tu veux à toi.",
      "Regarde-toi : prêt à essayer pour de vrai.",
      "Tu te connais : si tu commences, tu t’y mets.",
      "Tu mérites une version qui sent le présent."
    ]
  },
  de: {
    teasers: [
      "Okay, atme: du willst mit dem Schicksal mit einem Kassenbon feilschen.",
      "Locker, Chef: wir zähmen das Chaos und klauen die Fernbedienung.",
      "Alles klar, Zauberer: heute kein Montagsfeuer.",
      "Tief einatmen: laut scheitern ist erlaubt, aber mit Stil.",
      "Beruhig dich: selbst deine To-do braucht einen Helm."
    ],
    scenes: [
      "das Sofa mit Echo","der stumm urteilende Kühlschrank","der Schreibtisch-Altar","die prüfende Pflanze",
      "die hellsehende Klingel","der Flur als roter Teppich"
    ],
    objects: ["Kaffeemaschine","Ventilator","Rollladen","Lampe","Alexa","Kühlschrank","Klingel","Pflanze","Mikrowelle","Drucker","Fernbedienung","Staubsauger","Toaster","Ofen","Drehstuhl","Rad an der Tür","Rucksack am Haken"],
    verbs: ["applaudiert","buht","streikt","schaltet dich stumm","reicht Beschwerde ein","schaltet in Flugmodus","ghostet dich","diagnostiziert sich selbst","öffnet ein Ticket","ordnet dir einen Sprint zu","taggt dich öffentlich","spielt Update vor"],
    twists: ["weil es das Ende kennt","aus Kollegialität","„aus Respekt“","um das Chaos nicht anzusehen","weil auch es Grenzen hat","weil es heute Bürgermeister deines Wohnzimmers ist","weil es deine Liste gelesen hat (und gelacht)"],
    impre: ["gepanzertes Fluchen","detonierender Fluch","Himmels-Sakralschrei","Vulkan der Schimpfwörter","Tornado der Verwünschungen"],
    booze: [
      "Negronis so groß wie dein Durst",
      "Tequila in Shot-Runden",
      "Rum im Plastikbecher",
      "Halbe nacheinander",
      "Hauswein aus der Karaffe",
      "Spritz in Serie an der Theke",
      "doppelter Amaro ‘ist ja gesund’"
    ],
    morals: [
      "Moral: Niemand kommt; beweg dich oder bleib.",
      "Moral: Hör auf, mit dem Sofa zu verhandeln.",
      "Moral: Weniger Drama, mehr gemachte Minuten.",
      "Moral: Motivation kommt nicht; du baust sie klein.",
      "Moral: Nimm etwas Winziges und mach’s schlecht, aber mach’s."
    ],
    dumbTips: [
      "Blöder Tipp: Timer ins Gefrierfach.",
      "Blöder Tipp: Plan auf Bon schreiben und stempeln.",
      "Blöder Tipp: Prämie für die Kaffeemaschine versprechen.",
      "Blöder Tipp: Passwort zu ‘ich-hab-das-fertig’ ändern.",
      "Blöder Tipp: Schlüssel neben den Plan in den Kühlschrank."
    ],
    emoEnd: [
      "Und ja: unter dem Lärm liegt es dir wirklich am Herzen.",
      "Eigentlich willst du nicht perfekt, sondern deins.",
      "Sieh dich an: bereit, es wirklich zu versuchen.",
      "Du kennst dich: Start heißt ernst.",
      "Du verdienst eine Version, die nach Jetzt riecht."
    ]
  }
};

/* ===== Variability utils ===== */
function hash32(s){ return createHash("sha1").update(s).digest().readUInt32BE(0); }
function makePRNG(seed){ let x = seed >>> 0; return ()=>{ x=(x*1664525+1013904223)>>>0; return x/2**32; }; }
function pick(prng, arr){ return arr[Math.floor(prng()*arr.length)] }
function pickMany(prng, arr, k){
  const a=[...arr];
  const out=[];
  for(let i=0;i<Math.max(0,Math.min(k,a.length));i++){
    const idx=Math.floor(prng()*a.length);
    out.push(a.splice(idx,1)[0]);
  }
  return out;
}

/* ===== Oggetti contestuali dalla domanda ===== */
function deriveContextObjects(domanda){
  const d = String(domanda||"").toLowerCase();
  const add = [];
  const map = [
    [/citt[aà]/,"mappa piegata"],
    [/trasloc|casa|appart|affitto/,"scatolone col pennarello"],
    [/lavor|cv|curriculum|colloquio|linkedin/,"cartellina trasparente"],
    [/studio|esame|tesi|universit/,"quaderno con orecchie"],
    [/inglese|lingua|course|corso/,"post-it con verbi irregolari"],
    [/viagg|treno|volo|aereo|hotel/,"valigia che borbotta"],
    [/soldi|budget|spesa|aumento/,"calcolatrice stanca"],
    [/palestra|corsa|yoga|nuot/,"scarpe che chiedono strada"],
    [/startup|sito|e[- ]?commerce|shopify|app/,"laptop con adesivi motivazionali"],
    [/relaz|amico|partner/,"telefono che vuole essere sincero"]
  ];
  for(const [rx, obj] of map){ if(rx.test(d)) add.push(obj); }
  return Array.from(new Set(add)).slice(0,2);
}

function buildOpener(L, domanda){
  const b=BANK[L]||BANK.it;
  const prng = makePRNG(hash32(domanda) ^ randomBytes(4).readUInt32BE(0));
  const t = pick(prng,b.teasers);
  const s = pick(prng,b.scenes);
  return `${t} Qui intorno ${s}.`;
}
function buildObjectReactions(L, domanda, prng, n=3){
  const b=BANK[L]||BANK.it;
  const ctx = deriveContextObjects(domanda);
  const pool = Array.from(new Set([...(b.objects||[]), ...ctx]));
  const objs = pickMany(prng, pool, n); // 3 oggetti per varietà forte
  return objs.map(o=>{
    const v = pick(prng, b.verbs);
    const tw = pick(prng, b.twists);
    return `${o} ${v} ${tw}`;
  });
}

/* ========= Prompt builder ========= */
function buildMessages({ domanda, lang, periodo, stile }){
  const L = normLang(lang);

  const baseRules = L==="en"
    ? `RULES: single paragraph, no bullets, no emojis. Do NOT restate the question. Second person only.`
    : `REGOLE: un solo paragrafo, niente elenchi, niente emoji. NON ripetere la domanda. Solo seconda persona.`;

  const temporal = String(periodo).toLowerCase()==="past"
    ? (L==="en" ? "Write as if it already happened."
       : L==="es" ? "Escribe como si ya hubiera pasado."
       : L==="fr" ? "Écris comme si c’était déjà arrivé."
       : L==="de" ? "Schreibe, als wäre es bereits geschehen."
       : "Scrivi come se fosse già successo.")
    : (L==="en" ? "Write as a near-future unfolding starting now."
       : L==="es" ? "Escribe como un futuro cercano que empieza ahora."
       : L==="fr" ? "Écris comme un futur proche qui commence maintenant."
       : L==="de" ? "Schreibe als nahe Zukunft, die jetzt beginnt."
       : "Scrivi come un prossimo futuro che inizia ora.");

  const msgs = [
    { role: "system", content: baseRules },
    { role: "system", content: temporal },
  ];

  if(stile==="wtf"){
    const seed = hash32(domanda) ^ randomBytes(4).readUInt32BE(0);
    const rnd = makePRNG(seed);
    const b = BANK[L] || BANK.it;

    const opener = buildOpener(L, domanda);
    const impre = pick(rnd, b.impre);
    const reactLines = buildObjectReactions(L, domanda, rnd, 2 + Math.floor(rnd()*2)); // 2–3 reazioni
    const drinks = pickMany(rnd, b.booze, 2 + (rnd()<0.5?1:0)); // 2–3 giri
    const moral = pick(rnd, b.morals);
    const dumb = pick(rnd, b.dumbTips);
    const emo  = pick(rnd, b.emoEnd);

    const wtfRule =
      L==="en"
        ? `WHAT THE F (friendly, sharp sarcasm, helpful). Always open with a personalized tease. Keep 5–7 sentences. Flow: tease → 2–3 tiny mishaps → ONE theatrical outburst (“${impre}”, never at people) → ${reactLines.length} talking-object reactions (vary each time; scene-relevant) → BOOZE ROUNDS: ${drinks.join(" + ")} → 2–3 sentences that actually answer → close with: ironic moral + silly on-topic tip + brief emotional beat. Tone: slightly demotivating (no pep talk), dry and useful.`
        : L==="es"
        ? `WHAT THE F (amable, sarcasmo afilado, útil). Abre con burla personal. 5–7 frases. Flujo: burla → 2–3 contratiempos → UN estallido («${impre}») → ${reactLines.length} objetos parlantes (del contexto) → RONDAS DE BAR: ${drinks.join(" + ")} → 2–3 frases que sí responden → cierre: moraleja irónica + consejo tonto + toque emotivo breve. Tono: ligeramente desmotivante, seco y útil.`
        : L==="fr"
        ? `WHAT THE F (amical, sarcasme piquant, utile). Commence par une taquinerie perso. 5–7 phrases. Enchaînement : taquinerie → 2–3 couacs → UNE explosion (« ${impre} ») → ${reactLines.length} objets parlants (contextuels) → TOURNÉES DE BAR : ${drinks.join(" + ")} → 2–3 phrases qui répondent vraiment → fin : morale ironique + astuce débile + note émotive brève. Ton : légèrement démotivant, sec et utile.`
        : L==="de"
        ? `WHAT THE F (freundlich, spitzer Sarkasmus, hilfreich). Starte mit persönlichem Necken. 5–7 Sätze. Ablauf: Necken → 2–3 Pannen → EINE theatralische Entladung („${impre}“) → ${reactLines.length} sprechende, kontextbezogene Objekte → BAR-RUNDEN: ${drinks.join(" + ")} → 2–3 echte Antwortsätze → Schluss: ironische Moral + dummer Tipp + kurzer Gefühlsmoment. Ton: leicht demotivierend, trocken und nützlich.`
        : `WHAT THE F (amichevole, sarcasmo affilato, utile). APRI con presa in giro personale. 5–7 frasi. Flusso: presa in giro → 2–3 micro-imprevisti → UNO sfogo teatrale (“${impre}”) → ${reactLines.length} reazioni di oggetti (sempre diversi e di contesto) → GIRI DA BAR: ${drinks.join(" + ")} → 2–3 frasi che rispondono davvero → chiusura: morale ironica + consiglio scemo + colpo emotivo breve. Tono: leggermente demotivante (niente pep talk), secco e utile.`;

    msgs.push(
      { role:"system", content: wtfRule },
      { role:"system", content:`OPENING_EXAMPLE: ${opener}` },
      { role:"system", content:`OBJECT_REACTIONS:\n- ${reactLines.join("\n- ")}` },
      { role:"system", content:`MORAL: ${moral}` },
      { role:"system", content:`SILLY_TIP: ${dumb}` },
      { role:"system", content:`EMO_END: ${emo}` }
    );
  } else {
    msgs.push(
      { role:"system", content: WHATIF_RULES[L] || WHATIF_RULES.it },
      { role:"system", content: `Esempio/Example:\n${WHATIF_EXAMPLES[L] || WHATIF_EXAMPLES.it}` },
      { role:"system", content: `ADATTAMENTO PER TEMA: città/lavoro/relazioni/soldi/crescita.` }
    );
  }

  const ask =
    stile==="wtf"
      ? (L==="en" ? `Do NOT repeat the question. ONE SINGLE PARAGRAPH. Keep it punchy and helpful. "${domanda}"`
         : L==="es" ? `No repitas la pregunta. UN SOLO PÁRRAFO, directo y útil. «${domanda}»`
         : L==="fr" ? `Ne répète pas la question. UN SEUL PARAGRAPHE, nerveux et utile. « ${domanda} »`
         : L==="de" ? `Wiederhole die Frage nicht. EIN ABSATZ, prägnant und hilfreich. „${domanda}“`
         :           `Non ripetere la domanda. UN SOLO PARAGRAFO, diretto e utile. "${domanda}"`)
      : (L==="en" ? `Question (do NOT repeat it). ONE SINGLE PARAGRAPH (7–9 sentences). Keep it natural and slightly warmer. "${domanda}"`
         : L==="es" ? `No repitas la pregunta. Un solo párrafo (7–9 frases), natural y un punto más cálido. «${domanda}»`
         : L==="fr" ? `Ne répète pas la question. Un seul paragraphe (7–9 phrases), naturel et un peu plus chaleureux. « ${domanda} »`
         : L==="de" ? `Wiederhole die Frage nicht. Ein einziger Absatz (7–9 Sätze), natürlich und etwas wärmer. „${domanda}“`
         :           `Non ripetere la domanda. Scrivi UN SOLO PARAGRAFO (7–9 frasi), naturale e appena più emotivo. "${domanda}"`);
  msgs.push({ role: "user", content: ask });

  return msgs;
}

/* ========= HANDLER ========= */
export default async function handler(req, res){
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({ error:"missing_api_key" });

    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").toString().split(",")[0].trim();
    const { success } = await rl.limit(`ask:${ip}`);
    if(!success) return res.status(429).json({ error:"rate_limited_minute" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { domanda = "", stile = "whatif", lang = "it", periodo = "future", micro = {} } = body;
    if(!domanda || typeof domanda !== "string") return res.status(400).json({ error:"bad_request", detail:"domanda_required" });

    const messages = buildMessages({ domanda, lang, periodo, stile, micro });
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: stile === "wtf" ? 0.98 : 0.82,
      top_p: 0.92,
      max_tokens: 480,
      frequency_penalty: 0.1,
      presence_penalty: 0.0,
      messages,
    });

    let answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    if(!answer) throw new Error("empty_model_response");

    // ===== Post-process =====
    answer = stripQuestionEcho(domanda, answer);
    // WTF: 7 frasi max; WHAT IF: 9 frasi max
    answer = tightenSentences(answer, stile === "wtf" ? 7 : 9);
    // WHAT IF più corto: ~140 parole; WTF: ~135 parole
    answer = clampWords(answer, stile === "wtf" ? 135 : 140);
    answer = normalizeOneParagraph(answer);
    answer = sentenceCaseAll(answer);
    answer = finalPunct(answer);

    // What If — aggiungi una frase motivante breve (multi-lingua), senza scegliere al posto dell’utente
    if (stile !== "wtf") {
      const L = normLang(lang);
      const MOT_TAIL = {
        it: "Coraggio: oggi un passo vero.",
        en: "Courage: one real step today.",
        es: "Ánimo: un paso real hoy.",
        fr: "Courage : un vrai pas aujourd’hui.",
        de: "Mut: heute ein echter Schritt."
      };
      const tail = " " + (MOT_TAIL[L] || MOT_TAIL.it);
      const lower = answer.toLowerCase();
      if (
        !lower.includes(MOT_TAIL.it.toLowerCase()) &&
        !lower.includes((MOT_TAIL[L] || "").toLowerCase())
      ){
        answer = finalPunct(answer) + tail;
      }
      answer = finalPunct(answer);
    }

    // ===== IT normalizzazioni sicure =====
    if(normLang(lang)==="it"){
      const d=String(domanda||"");
      const nameRx=/\b([A-ZÀ-Ý][a-zà-ÿ']{2,})\b/g;
      const inQuestion=new Set((d.match(nameRx)||[]));
      answer = answer.replace(nameRx, (m, _g1, offset, str)=>{
        if(offset===0) return m;
        const before = str.slice(0, offset);
        if(/[.!?…]["'”)\]]?\s*$/.test(before)) return m;
        return inQuestion.has(m) || ["Ah","Oh","Ehi","Sai"].includes(m) ? m : m.toLowerCase();
      });
      answer = answer.replace(/\ball’aquila\b/g, "all’Aquila");
    }

    // Maiuscola iniziale
    answer = answer.replace(/^\s*([a-zà-ÿ])/u, (m,c)=>c.toUpperCase());

    return res.status(200).json({ answer, style: stile, lang: normLang(lang), periodo, model: MODEL });

  }catch(err){
    console.error("❌ [/api/ask] error:", err);
    return res.status(500).json({ error:"server_error", detail:String(err?.message||err) });
  }
                                     }
