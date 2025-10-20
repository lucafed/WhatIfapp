import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  // Chiave univoca per ogni giorno
  const today = new Date().toISOString().split('T')[0];
  const key = `usage:${ip}:${today}`;

  // Leggi e aggiorna il conteggio
  let count = (await kv.get(key)) || 0;
  count++;
  await kv.set(key, count, { ex: 86400 }); // 24h

  // Risposta
  res.status(200).json({
    date: today,
    ip,
    usageToday: count,
    message:
      count > 5
        ? '⚠️ Limite giornaliero raggiunto (solo per test)'
        : '✅ Uso registrato correttamente'
  });
}
