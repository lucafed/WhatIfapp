// FILE: api/video.js
const ffmpegPath = require("ffmpeg-static");
const { spawn } = require("child_process");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk.toString();
  });

  req.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(body || "{}");
    } catch (e) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const domanda = (payload.domanda || "").toString().trim();
    const answer  = (payload.answer  || "").toString().trim();
    const style   = (payload.style   || "whatif").toString().trim();

    if (!domanda || !answer) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing domanda or answer" }));
      return;
    }

    if (!ffmpegPath) {
      console.error("ffmpeg-static path is null");
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "ffmpeg-not-found" }));
      return;
    }

    // Limito un po' la lunghezza per sicurezza
    const q = domanda.slice(0, 140);
    const a = answer.slice(0, 320);

    const width = 720;
    const height = 1280;
    const duration = 8; // secondi
    const bgColor = style === "wtf" ? "101414" : "0A0F14";

    // Escape del testo per drawtext
    const esc = (s) =>
      String(s)
        .replace(/\\/g, "\\\\")
        .replace(/:/g, "\\:")
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "");

    const drawQuestion = `drawtext=text='${esc(
      q
    )}':fontcolor=white:fontsize=32:box=1:boxcolor=0x00000066:boxborderw=12:x=(w-text_w)/2:y=120`;

    const drawAnswer = `drawtext=text='${esc(
      a
    )}':fontcolor=0xA0B2BA:fontsize=26:box=1:boxcolor=0x00000066:boxborderw=12:x=(w-text_w)/2:y=(h-text_h)/2+40`;

    const vfFilter = `${drawQuestion},${drawAnswer}`;

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

    res.statusCode = 200;
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="whatf-clip.mp4"'
    );

    try {
      const ff = spawn(ffmpegPath, args);

      ff.stdout.on("data", (chunk) => {
        res.write(chunk);
      });

      let stderr = "";
      ff.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      ff.on("error", (err) => {
        console.error("ffmpeg spawn error:", err);
        try { res.end(); } catch {}
      });

      ff.on("close", (code) => {
        if (code !== 0) {
          console.error("ffmpeg exit code", code, stderr);
        }
        try { res.end(); } catch {}
      });
    } catch (err) {
      console.error("api/video runtime error:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "server-error" }));
      }
    }
  });
};
