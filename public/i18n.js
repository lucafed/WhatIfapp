<script>
// /public/i18n.js

;(function (w) {
  // ---- Dizionari -----------------------------------------------------------
  const DICT = {
    it: {
      // Modal lingua
      "choose_lang_title": "Scegli la lingua",
      "choose_lang_sub": "Potrai cambiarla in ogni momento.",
      "lang_it": "Italiano",
      "lang_en": "English",

      // Home
      "home_title": "Scopri il tuo <b>What?f</b>",
      "home_lead": "Immagina la scelta che non hai fatto… e quella che potresti fare domani. What?f ti mostra “cosa sarebbe potuto accadere” e “cosa potrebbe accadere” se scegli una porta invece dell’altra.",
      "opt_past": "Passato",
      "opt_future": "Futuro",
      "opt_whatif": "What if",
      "opt_wtf": "What the F",
      "chip_selected_prefix": "Selezionato:",
      "cta_next": "AVANTI",
      "disclaimer_short": "Continuando accetti la nostra <a href=\"privacy.html\">Privacy Policy</a> e i <a href=\"terms.html\">Termini d’uso</a>. © 2025 What?f",

      // Seconda pagina (Parlami di te)
      "about_title": "Parlami di te",
      "about_blurb": "Raccontami brevemente chi sei, cosa stai vivendo o cosa ti spinge a usare What?f. Questo aiuterà l’intelligenza artificiale a comprenderti meglio e risponderti in modo più personale.",
      "about_who": "Chi sei?",
      "about_sex": "Sesso",
      "about_age": "Età",
      "about_phase": "In quale fase ti trovi?",
      "about_where": "Da dove vieni?",
      "about_more": "Vuoi raccontarci qualcosa di più su di te? <span class=\"muted\">(opzionale – aiuta l’AI a darti risposte più accurate)</span>",
      "btn_continue": "Continua",
      "val_required": "Seleziona almeno un’opzione per continuare.",

      // Terza (La tua domanda)
      "ask_title": "La tua domanda",
      "ask_placeholder": "Esempio: Se avessi accettato quel lavoro a Milano?",
      "ask_btn": "Scopri",
      "ask_hint": "Suggerimento: sii specifico. Es: “Se restassi a L’Aquila per i prossimi 2 anni, cosa cambierebbe nella mia carriera?”",

      // Quarta (Risultato)
      "result_title": "Risultato",
      "result_share": "Condividi",
      "result_home": "Home",
      "result_more": "Vuoi la versione estesa con piani d’azione e alternative? (in arrivo)",

      // Piccoli testi
      "back": "Indietro",
    },

    en: {
      "choose_lang_title": "Choose your language",
      "choose_lang_sub": "You can change it anytime.",
      "lang_it": "Italiano",
      "lang_en": "English",

      "home_title": "Discover your <b>What?f</b>",
      "home_lead": "Imagine the choice you didn’t make… and the one you could make tomorrow. What?f shows you “what could have happened” and “what might happen” if you pick one door over the other.",
      "opt_past": "Past",
      "opt_future": "Future",
      "opt_whatif": "What if",
      "opt_wtf": "What the F",
      "chip_selected_prefix": "Selected:",
      "cta_next": "NEXT",
      "disclaimer_short": "By continuing you accept our <a href=\"privacy.html\">Privacy Policy</a> and <a href=\"terms.html\">Terms</a>. © 2025 What?f",

      "about_title": "Tell me about you",
      "about_blurb": "Briefly share who you are, what you’re going through or why you want to use What?f. This helps the AI understand you better and reply more personally.",
      "about_who": "Who are you?",
      "about_sex": "Gender",
      "about_age": "Age",
      "about_phase": "Which phase are you in?",
      "about_where": "Where are you from?",
      "about_more": "Want to tell us more about you? <span class=\"muted\">(optional – helps the AI give more accurate answers)</span>",
      "btn_continue": "Continue",
      "val_required": "Please select at least one option to continue.",

      "ask_title": "Your question",
      "ask_placeholder": "Example: What if I had accepted that job in Milan?",
      "ask_btn": "Reveal",
      "ask_hint": "Tip: be specific. E.g. “If I stay in L’Aquila for the next 2 years, how would my career change?”",

      "result_title": "Result",
      "result_share": "Share",
      "result_home": "Home",
      "result_more": "Want the extended version with action plans and alternatives? (coming soon)",

      "back": "Back",
    }
  };

  // ---- API minimale --------------------------------------------------------
  const KEY = "whatif_lang";

  function getLang() {
    const saved = localStorage.getItem(KEY);
    if (saved && DICT[saved]) return saved;
    // autodetect
    const nav = (navigator.language || "it").slice(0,2);
    return DICT[nav] ? nav : "it";
  }

  function setLang(lang) {
    if (!DICT[lang]) return;
    localStorage.setItem(KEY, lang);
    apply();
  }

  function t(key) {
    const lang = getLang();
    return (DICT[lang] && DICT[lang][key]) || key;
  }

  function apply(root=document) {
    const lang = getLang();
    // data-i18n con html
    root.querySelectorAll("[data-i18n]").forEach(el=>{
      const k = el.getAttribute("data-i18n");
      el.innerHTML = t(k);
    });
    // placeholder
    root.querySelectorAll("[data-i18n-ph]").forEach(el=>{
      const k = el.getAttribute("data-i18n-ph");
      el.setAttribute("placeholder", stripHtml(t(k)));
    });
    // titoli
    root.querySelectorAll("[data-i18n-title]").forEach(el=>{
      const k = el.getAttribute("data-i18n-title");
      el.setAttribute("title", stripHtml(t(k)));
    });
    document.documentElement.setAttribute("lang", lang);
  }

  function stripHtml(s){ const d=document.createElement("div"); d.innerHTML=s; return d.textContent||d.innerText||""; }

  w.I18N = { t, apply, setLang, getLang };
})(window);
</script>
