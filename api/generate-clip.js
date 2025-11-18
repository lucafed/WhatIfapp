import ffmpegPath from "ffmpeg-static";
import { spawn } from "child_process";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  if (!ffmpegPath) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "ffmpeg-static non disponibile" }));
    return;
  }

  try {
    let rawBody = "";
    await new Promise((resolve, reject) => {
      req.on("data", chunk => rawBody += chunk);
      req.on("end", resolve);
      req.on("error", reject);
    });

    let data = {};
    try {
      data = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "JSON non valido" }));
      return;
    }

    const { domanda, answer, style } = data;
    if (!domanda || !answer) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "domanda e answer sono obbligatorie" }));
      return;
    }

    let aShort = answer.length > 240 ? answer.slice(0, 240) + "…" : answer;

    const bgColor = style === "wtf" ? "0x101414" : "0x0A0F14";
    const duration = 8;

    const sDomanda = sanitize(domanda);
    const sAnswer = sanitize(aShort);

    const drawFilter = [
      `drawtext=text='${sDomanda}':fontcolor=white:fontsize=44:box=1:boxcolor=0x00000066:boxborderw=16:x=(w-text_w)/2:y=200`,
      `drawtext=text='${sAnswer}':fontcolor=0xA0B2BA:fontsize=34:box=1:boxcolor=0x00000066:boxborderw=16:x=(w-text_w)/2:y=(h-text_h)/2+80`
    ].join(",");

    const args = [
      "-f", "lavfi",
      "-i", `color=c=${bgColor}:s=1080x1920:d=${duration}`,
      "-vf", drawFilter,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-f", "mp4",
      "pipe:1"
    ];

    const ff = spawn(ffmpegPath, args);

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Cache-Control", "no-store");

    ff.stdout.pipe(res);
    ff.stderr.on("data", () => {});
    ff.on("error", () => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "Errore ffmpeg" }));
      }
    });

  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "Errore interno" }));
    }
  }
}

function sanitize(t) {
  return String(t)
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}
