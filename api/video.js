// FILE: api/video.js
import ffmpegPath from "ffmpeg-static";
import { spawn } from "child_process";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { domanda, answer, style } = req.body || {};

  if (!domanda || !answer) {
    res.status(400).json({ error: "Missing domanda or answer" });
    return;
  }

  // Limita la lunghezza per sicurezza
  const q = String(domanda).slice(0, 140);
  const a = String(answer).slice(0, 300);

  // Parametri video molto leggeri (per stare nei limiti Vercel)
  const width = 720;
  const height = 1280;
  const bgColor = style === "wtf" ? "101414" : "0A0F14";
  const duration = 8; // 8 secondi

  // Costruiamo i filtri drawtext (domanda in alto, risposta al centro)
  // NB: usiamo font di sistema generici; su Vercel c’è di solito DejaVuSans
  const font = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

  const esc = (s) =>
    String(s)
      .replace(/\\/g, "\\\\")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "");

  const drawQuestion = `drawtext=fontfile='${font}':text='${esc(
    q
  )}':fontcolor=white:fontsize=32:box=1:boxcolor=0x00000066:boxborderw=12:x=(w-text_w)/2:y=120`;

  const drawAnswer = `drawtext=fontfile='${font}':text='${esc(
    a
  )}':fontcolor=0xA0B2BA:fontsize=26:box=1:boxcolor=0x00000066:boxborderw=12:x=(w-text_w)/2:y=(h-text_h)/2+40`;

  const vfFilter = `${drawQuestion},${drawAnswer}`;

  // Comando ffmpeg: genera un video da una sorgente "color"
  const args = [
    "-f",
    "lavfi",
    "-i",
    `color=c=#${bgColor}:s=${width}x${height}:d=${duration}`,
    "-vf",
    vfFilter,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    "pipe:1",
  ];

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="whatf-clip.mp4"'
  );

  try {
    const ff = spawn(ffmpegPath, args);

    ff.stdout.pipe(res);

    let stderr = "";
    ff.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    ff.on("close", (code) => {
      if (code !== 0) {
        console.error("ffmpeg exit code", code, stderr);
        if (!res.headersSent) {
          res
            .status(500)
            .json({ error: "ffmpeg-failed", detail: stderr.slice(0, 4000) });
        }
      }
    });
  } catch (err) {
    console.error("api/video error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "server-error" });
    }
  }
}
