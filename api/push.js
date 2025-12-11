const title = buildNotificationTitle(phase);
    const body = buildNotificationBody(slot, phase);

    // ✅ Messaggio *solo data* → lo mostra /sw.js
    const message = {
      data: {
        title,
        body,
        src: "daily_push",
        signal: slot,          // morning | afternoon | evening
        phase: String(phase),  // "1" o "2"
        url: CLICK_LINK,
        click_action: CLICK_LINK
      },
      tokens,
    };

    const resp = await admin.messaging().sendEachForMulticast(message);
