import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const body = await req.json();
      await redis.incr('visits'); // salva un conteggio di esempio
      return res.status(200).json({ message: '📊 Tracking salvato con successo!' });
    }

    // Test GET
    return res.status(200).json({
      message: '✅ Route attiva! Tracking funzionante.',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Errore Redis:', err);
    return res.status(500).json({ error: 'Errore interno Redis', details: err.message });
  }
}
