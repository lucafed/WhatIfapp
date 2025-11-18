import { createFFmpeg, fetchFile } from "@ffmpeg/ffmpeg";

export const config = {
  maxDuration: 50
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Leggi body
    const { domanda, answer, style } = req.body || {};
    if (!domanda || !answer) {
      return res.status(400).json({ error: "Missing domanda or answer" });
    }

    // Prepara testo
    const aShort = answer.length > 220 ? answer.slice(0, 220) + "…" : answer;
    const bgColor = style === "wtf" ? "0x101414" : "0x0A0F14";

    // Carica FFmpeg (WASM)
    const ffmpeg = createFFmpeg({
      log: false,
      corePath: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js"
    });

    if (!ffmpeg.isLoaded()) {
      await ffmpeg.load();
    }

    // Genera video
    const filter = `
      drawtext=text='${sanitize(domanda)}':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=200,
      drawtext=text='${sanitize(aShort)}':fontcolor=0xA0B2BA:fontsize=34:x=(w-text_w)/2:y=(h-text_h)/2+80
    `.replace(/\s+/g, " ");

    await ffmpeg.run(
      "-f", "lavfi",
      "-i", `color=c=${bgColor}:s=1080x1920:d=8`,
      "-vf", filter,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "out.mp4"
    );

    const data = ffmpeg.FS("readFile", "out.mp4");

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Cache-Control", "no-store");

    return res.end(Buffer.from(data));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error", details: err.message });
  }
}

function sanitize(t) {
  return String(t)
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, " ")
    .replace(/\r/g, "");
}
