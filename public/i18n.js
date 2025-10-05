// public/i18n.js
(function (w){
  const DICT = {
    it: {
      choose_lang_title: "Scegli la lingua",
      choose_lang_sub: "Potrai cambiarla in ogni momento.",
      lang_it: "Italiano", lang_en: "English",
      home_headline: "Scopri il tuo What?f",
      home_lead: "Immagina la scelta che non hai fatto… e quella che potresti fare domani. What?f ti mostra “cosa sarebbe potuto accadere” e “cosa potrebbe accadere” se scegli una porta invece dell’altra.",
      past: "Passato", future: "Futuro",
      whatif: "What if", wtf: "What the F",
      selected: "Selezionato:",
      next: "AVANTI",
      policy: "Privacy Policy", terms: "Termini d’uso"
    },
    en: {
      choose_lang_title: "Choose your language",
      choose_lang_sub: "You can change it anytime.",
      lang_it: "Italiano", lang_en: "English",
      home_headline: "Discover your What?f",
      home_lead: "Imagine the choice you didn’t make… and the one you could make tomorrow. What?f shows “what could have happened” and “what might happen” if you choose one door over the other.",
      past: "Past", future: "Future",
      whatif: "What if", wtf: "What the F",
      selected: "Selected:",
      next: "NEXT",
      policy: "Privacy Policy", terms: "Terms of Use"
    }
  };

  const I18N = {
    setLang(lang){
      const L = (lang === 'en') ? 'en' : 'it';
      localStorage.setItem('whatif_lang', L);
      this.apply();
    },
    t(key){
      const lang = localStorage.getItem('whatif_lang') || 'it';
      return (DICT[lang] && DICT[lang][key]) || key;
    },
    apply(){
      const lang = localStorage.getItem('whatif_lang') || 'it';
      document.documentElement.lang = lang;
      document.querySelectorAll('[data-i18n]').forEach(el=>{
        const k = el.getAttribute('data-i18n');
        const txt = (DICT[lang] && DICT[lang][k]) || k;
        // aggiorna solo testo (no HTML rischioso)
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON') {
          if (el.placeholder !== undefined) el.placeholder = txt;
          if (el.tagName === 'BUTTON') el.textContent = txt;
        } else {
          el.textContent = txt;
        }
      });
    }
  };

  w.I18N = I18N;
})(window);
