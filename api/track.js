import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
})

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const { event, details } = req.body

      // Salva l’evento nel database
      const timestamp = new Date().toISOString()
      await redis.rpush('user_events', JSON.stringify({ event, details, timestamp }))

      return res.status(200).json({ success: true, message: 'Evento salvato ✅' })
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message })
    }
  } else {
    // Test rapido
    return res.status(200).json({ message: '✅ Route attiva! Tracking funzionante.', timestamp: new Date().toISOString() })
  }
}
