/* ==== Mini i18n per tutta l’app ==== */
const I18N = {
  dict: {
    it: {
      choose_lang_title: "Scegli la lingua",
      choose_lang_sub: "Potrai cambiarla in ogni momento.",
      lang_it: "Italiano",
      lang_en: "English",
      home_headline: "Scopri il tuo What?f",
      home_lead: "Immagina la scelta che non hai fatto… e quella che potresti fare domani. What?f ti mostra “cosa sarebbe potuto accadere” e “cosa potrebbe accadere” se scegli una porta invece dell’altra.",
      past: "Passato", future: "Futuro",
      whatif: "What if", wtf: "What the F",
      selected: "Selezionato:", next: "AVANTI",
      policy: "Privacy Policy", terms: "Termini d’uso",
      about_title: "Parlami di te",
      about_intro: "Raccontami brevemente chi sei, cosa stai vivendo o cosa ti spinge a usare What?f. Questo aiuterà l’intelligenza artificiale a comprenderti meglio e a risponderti in modo più personale.",
      continue: "Continua",
      ask_title: "La tua domanda",
      discover: "Scopri",
      back: "Indietro", result: "Risultato",
      more_title: "Vuoi di più?",
      pro_unlock: "Sblocca approfondimento",
      freemium: "Piano freemium: ottieni 1 versione estesa gratis alla registrazione."
    },
    en: {
      choose_lang_title: "Choose your language",
      choose_lang_sub: "You can change it anytime.",
      lang_it: "Italiano", lang_en: "English",
      home_headline: "Discover your What?f",
      home_lead: "Imagine the choice you didn’t make… and the one you could make tomorrow. What?f shows “what might have happened” and “what could happen” if you pick one door over the other.",
      past: "Past", future: "Future",
      whatif: "What if", wtf: "What the F",
      selected: "Selected:", next: "NEXT",
      policy: "Privacy Policy", terms: "Terms of use",
      about_title: "Tell me about you",
      about_intro: "Briefly tell me who you are, what you’re going through, or why you’re using What?f. This helps the AI understand you better and reply more personally.",
      continue: "Continue",
      ask_title: "Your question",
      discover: "Discover",
      back: "Back", result: "Result",
      more_title: "Want more?",
      pro_unlock: "Unlock deep-dive",
      freemium: "Freemium plan: get 1 extended answer free on sign-up."
    }
  },

  getLang() {
    return localStorage.getItem("whatif_lang") || "it";
  },
  setLang(l) {
    localStorage.setItem("whatif_lang", l);
    I18N.apply();
  },
  t(k) {
    const l = localStorage.getItem("whatif_lang") || "it";
    return (I18N.dict[l] && I18N.dict[l][k]) || I18N.dict.it[k] || k;
  },
  apply() {
    document.documentElement.lang = localStorage.getItem("whatif_lang") || "it";
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      if (key) el.textContent = I18N.t(key);
    });
  }
};
window.I18N = I18N;
