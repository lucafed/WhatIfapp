// FILE: api/video.js
import ffmpegPath from "ffmpeg-static";
import { spawn } from "child_process";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  let body = "";
  for await (const c of req) body += c.toString();

  let payload;
  try {
    payload = JSON.parse(body || "{}");
  } catch {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "Invalid JSON" }));
  }

  const domanda = (payload.domanda || "").trim();
  const answer = (payload.answer || "").trim();
  const style = (payload.style || "whatif").trim();

  if (!domanda || !answer) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "Missing domanda or answer" }));
  }

  if (!ffmpegPath) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: "ffmpeg not available" }));
  }

  const q = domanda.slice(0, 140).replace(/\n/g, "\\N");
  const a = answer.slice(0, 500).replace(/\n/g, "\\N");

  // ASS subtitle script (nessun font necessario)
  const ass = `
[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280

[V4+ Styles]
Style: qStyle,Arial,36,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,2,2,10,10,10,1
Style: aStyle,Arial,30,&H00A0B2BA,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,2,2,10,10,10,1

[Events]
Dialogue: 0,0:00:00.00,0:00:08.00,qStyle,,0,0,0,,${q}
Dialogue: 0,0:00:02.00,0:00:08.00,aStyle,,0,0,0,,${a}
`;

  const width = 720;
  const height = 1280;
  const duration = 8;
  const bg = style === "wtf" ? "101414" : "0A0F14";

  const args = [
    "-f", "lavfi",
    "-i", `color=c=#${bg}:s=${width}x${height}:d=${duration}`,
    "-f", "ass",
    "-i", "pipe:0",
    "-filter_complex", "[0:v][1:s]overlay",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-f", "mp4",
    "pipe:1"
  ];

  res.statusCode = 200;
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", 'attachment; filename="whatf-clip.mp4"');

  const ff = spawn(ffmpegPath, args);

  ff.stdin.write(ass);
  ff.stdin.end();

  ff.stdout.on("data", (chunk) => res.write(chunk));

  let err = "";
  ff.stderr.on("data", (c) => (err += c.toString()));

  ff.on("close", (code) => {
    if (code !== 0) console.error("FFmpeg exit:", code, err);
    res.end();
  });
}
