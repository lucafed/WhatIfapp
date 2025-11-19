// FILE: api/video.js
import ffmpegPath from "ffmpeg-static";
import { spawn } from "child_process";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  // Leggi il body raw
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
  }

  let payload;
  try {
    payload = JSON.parse(body || "{}");
  } catch (e) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "Invalid JSON" }));
  }

  const domanda = String(payload.domanda || "").trim();
  const answer = String(payload.answer || "").trim();
  const style = String(payload.style || "whatif").trim();

  if (!domanda || !answer) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "Missing domanda or answer" }));
  }

  if (!ffmpegPath) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: "ffmpeg not available" }));
  }

  // 🔒 Sanificazione testo per drawtext (niente :, ' , " , \ , = , , )
  const sanitizeForDrawtext = (txt, maxLen = 160) => {
    return String(txt)
      .replace(/\r?\n/g, " ")
      .replace(/[:\\'=,"[\]]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, maxLen);
  };

  const qText = sanitizeForDrawtext(domanda, 120);
  const aText = sanitizeForDrawtext(answer, 260);

  const width = 720;
  const height = 1280;
  const duration = 8;
  const bgColor = style === "wtf" ? "0x101414" : "0x0A0F14";

  // Un solo filtro con due drawtext in cascata
  const vf = [
    `drawtext=text='${qText}':fontcolor=white:fontsize=42:box=1:boxcolor=0x00000066:boxborderw=10:x=(w-text_w)/2:y=200`,
    `drawtext=text='${aText}':fontcolor=0xA0B2BA:fontsize=32:box=1:boxcolor=0x00000066:boxborderw=10:x=(w-text_w)/2:y=(h-text_h)/2+80`
  ].join(",");

  const args = [
    "-f", "lavfi",
    "-i", `color=c=${bgColor}:s=${width}x${height}:d=${duration}`,
    "-vf", vf,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-f", "mp4",
    "pipe:1"
  ];

  // Headers risposta
  res.statusCode = 200;
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", 'attachment; filename="whatf-clip.mp4"');

  // Avvia ffmpeg
  const ff = spawn(ffmpegPath, args);

  let stderrBuf = "";

  ff.stdout.on("data", (chunk) => {
    res.write(chunk);
  });

  ff.stderr.on("data", (chunk) => {
    const txt = chunk.toString();
    stderrBuf += txt;
  });

  ff.on("close", (code) => {
    if (code !== 0) {
      console.error("FFmpeg exit code", code, "stderr:\n", stderrBuf);
    }
    res.end();
  });

  ff.on("error", (err) => {
    console.error("FFmpeg spawn error:", err);
    try {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "FFmpeg spawn error" }));
    } catch {}
  });
}
