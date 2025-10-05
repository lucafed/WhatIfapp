(function(){
  const dict = {
    it: {
      home_title_1: "Scopri il tuo",
      home_lead:
        "Immagina la scelta che non hai fatto… e quella che potresti fare domani. What?f ti mostra “cosa sarebbe potuto accadere” e “cosa potrebbe accadere” se scegli una porta invece dell’altra.",
      past: "Passato",
      future: "Futuro",
      whatif: "What if",
      wtf: "What the F",
      selected: "Selezionato:",
      next: "AVANTI",
      disclaimer: "Continuando accetti la nostra",
      and: "e",
      privacy: "Privacy Policy",
      terms: "Termini d’uso",
      change_lang: "Cambia lingua",
      choose_lang_title: "Scegli la lingua",
      choose_lang_sub: "Potrai cambiarla in ogni momento."
    },
    en: {
      home_title_1: "Discover your",
      home_lead:
        "Imagine the choice you didn’t make… and the one you might make tomorrow. What?f shows you “what could have happened” and “what might happen” if you choose one door over the other.",
      past: "Past",
      future: "Future",
      whatif: "What if",
      wtf: "What the F",
      selected: "Selected:",
      next: "NEXT",
      disclaimer: "By continuing you agree to our",
      and: "and",
      privacy: "Privacy Policy",
      terms: "Terms of Use",
      change_lang: "Change language",
      choose_lang_title: "Choose your language",
      choose_lang_sub: "You can change it anytime."
    }
  };

  const I18N = {
    lang: localStorage.getItem('whatif_lang') || (navigator.language||'it').slice(0,2),
    t(key){ return (dict[this.lang] && dict[this.lang][key]) || (dict.it[key]||key); },
    setLang(l){
      this.lang = (l==='en'?'en':'it');
      localStorage.setItem('whatif_lang', this.lang);
      this.apply();
    },
    apply(){
      // Testi
      document.querySelectorAll('[data-i18n]').forEach(el=>{
        const k = el.getAttribute('data-i18n');
        const v = this.t(k);
        if (el.tagName==='INPUT' || el.tagName==='TEXTAREA') el.value = v;
        else el.textContent = v;
      });
      // Placeholder
      document.querySelectorAll('[data-i18n-placeholder]').forEach(el=>{
        const k = el.getAttribute('data-i18n-placeholder');
        el.setAttribute('placeholder', this.t(k));
      });
      document.dispatchEvent(new CustomEvent('i18n:ready'));
    }
  };
  window.I18N = I18N;
  // Applica all'avvio
  document.addEventListener('DOMContentLoaded', ()=> I18N.apply());
})();
