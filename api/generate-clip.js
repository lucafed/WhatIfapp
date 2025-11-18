// FILE: api/generate-clip.js
// Stub temporaneo: niente ffmpeg, solo JSON "feature in arrivo"

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  // Qui in futuro metteremo la vera generazione video
  return res.status(200).json({
    ok: false,
    message:
      "La generazione del video non è ancora attiva su questa versione. " +
      "Puoi comunque fare uno screenshot della risposta o condividerla dal pulsante 'Condividi / Copia'.",
  });
}
