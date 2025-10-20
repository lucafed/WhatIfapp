export default async function handler(req, res) {
  try {
    res.status(200).json({
      message: "✅ Route attiva! Tracking funzionante.",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: "Errore interno del server", details: error.message });
  }
}
