const CLICK_LINK = `https://what-ifapp.vercel.app/fifth.html?signal=${slot}&phase=${phase}&src=daily_push`;

const message = {
  // ⚠ QUI ora togliamo il blocco 'notification' per evitare doppia notifica di Chrome
  // notification: { title, body },

  data: {
    src: "daily_push",
    signal: slot,           // morning | afternoon | evening
    phase: String(phase),   // "1" o "2"
    url: CLICK_LINK,
    click_action: CLICK_LINK
  },
  webpush: {
    fcmOptions: {
      link: CLICK_LINK,
    },
  },
  tokens,
};
