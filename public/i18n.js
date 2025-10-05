<script>
// Simple client-side i18n for What?f
(function(){
  const DICT = {
    it: {
      change_lang: "Cambia lingua",
      choose_lang_title: "Scegli la lingua",
      choose_lang_sub: "Potrai cambiarla in ogni momento.",
      home_title_prefix: "Scopri il tuo",
      home_lead:
        "Immagina la scelta che non hai fatto… e quella che potresti fare domani. What?f ti mostra “cosa sarebbe potuto accadere” e “cosa potrebbe accadere” se scegli una porta invece dell’altra.",
      opt_past: "Passato",
      opt_future: "Futuro",
      opt_whatif: "What if",
      opt_wtf: "What the F",
      selected: "Selezionato: ",
      cta_next: "AVANTI",
      disclaimer_short: "Continuando accetti la nostra",
      privacy: "Privacy Policy",
      terms: "Termini d’uso",

      // SECOND PAGE (Parlami di te)
      tell_me_title: "Parlami di te",
      tell_me_intro:
        "Raccontami brevemente chi sei, cosa stai vivendo o cosa ti spinge a usare What?f. Questo aiuterà l’intelligenza artificiale a comprenderti meglio e risponderti in modo più personale.",
      who_are_you: "Chi sei?",
      gender: "Sesso",
      age: "Età",
      phase: "In quale fase ti trovi?",
      where_from: "Da dove vieni?",
      more_optional:
        "Vuoi raccontarci qualcosa di più su di te? (opzionale – aiuta l’AI a darti risposte più accurate)",
      btn_continue: "Continua",
      // placeholders
      ph_city: "Città / Paese",
      ph_more: "Esempio: lavoro nel digitale, sto pensando di cambiare città, ho due figli…",

      // THIRD PAGE (La tua domanda)
      your_question: "La tua domanda",
      ask_placeholder: "Esempio: Se avessi accettato quel lavoro a Milano?",
      btn_discover: "Scopri",

      // FOURTH PAGE (Risultato)
      result_title: "Risultato",
      btn_home: "Home",
      btn_share: "Condividi",

      // FIFTH PAGE (freemium teaser)
      read_more: "Vuoi la versione estesa con piani d’azione e alternative?",
      coming_soon: "(in arrivo)"
    },
    en: {
      change_lang: "Change language",
      choose_lang_title: "Choose your language",
      choose_lang_sub: "You can change it anytime.",
      home_title_prefix: "Discover your",
      home_lead:
        "Imagine the choice you didn’t make… and the one you might make tomorrow. What?f shows you “what could have happened” and “what might happen” if you choose one door over the other.",
      opt_past: "Past",
      opt_future: "Future",
      opt_whatif: "What if",
      opt_wtf: "What the F",
      selected: "Selected: ",
      cta_next: "NEXT",
      disclaimer_short: "By continuing you accept our",
      privacy: "Privacy Policy",
      terms: "Terms of Use",

      // SECOND PAGE
      tell_me_title: "Tell me about you",
      tell_me_intro:
        "Briefly tell me who you are, what you’re going through or why you’re using What?f. This helps the AI understand you better and reply more personally.",
      who_are_you: "Who are you?",
      gender: "Gender",
      age: "Age",
      phase: "Which phase are you in?",
      where_from: "Where are you from?",
      more_optional:
        "Want to share more about you? (optional – helps the AI give more accurate answers)",
      btn_continue: "Continue",
      ph_city: "City / Country",
      ph_more: "Example: I work in tech, I’m thinking about moving city, I have two kids…",

      // THIRD PAGE
      your_question: "Your question",
      ask_placeholder: "Example: What if I had accepted that job in Milan?",
      btn_discover: "Discover",

      // FOURTH PAGE
      result_title: "Result",
      btn_home: "Home",
      btn_share: "Share",

      // FIFTH PAGE
      read_more: "Want the extended version with action plans and alternatives?",
      coming_soon: "(coming soon)"
    }
  };

  const LS_KEY = "whatif_lang";
  const I18N = {
    getLang(){
      return localStorage.getItem(LS_KEY) ||
             (navigator.language||"it").slice(0,2).toLowerCase() === "en" ? "en" : "it";
    },
    setLang(lang){
      const v = (lang==="en" ? "en" : "it");
      localStorage.setItem(LS_KEY, v);
      this.apply();
    },
    t(key){
      const lang = this.getLang();
      return (DICT[lang] && DICT[lang][key]) || (DICT.it && DICT.it[key]) || "";
    },
    apply(){
      const lang = this.getLang();
      document.documentElement.lang = lang;

      // data-i18n => textContent
      document.querySelectorAll("[data-i18n]").forEach(el=>{
        const k = el.getAttribute("data-i18n");
        const val = this.t(k);
        if(val) el.textContent = val;
      });

      // data-i18n-placeholder => placeholder
      document.querySelectorAll("[data-i18n-placeholder]").forEach(el=>{
        const k = el.getAttribute("data-i18n-placeholder");
        const val = this.t(k);
        if(val) el.setAttribute("placeholder", val);
      });

      // data-i18n-aria => aria-label
      document.querySelectorAll("[data-i18n-aria]").forEach(el=>{
        const k = el.getAttribute("data-i18n-aria");
        const val = this.t(k);
        if(val) el.setAttribute("aria-label", val);
      });
    }
  };

  // expose
  window.I18N = I18N;

  // auto-apply on DOM ready
  document.addEventListener("DOMContentLoaded", ()=> I18N.apply());
})();
</script>
