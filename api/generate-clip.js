// FILE: api/generate-clip.js
// Generazione video lato server con ffmpeg.wasm (@ffmpeg/ffmpeg)

import { createFFmpeg } from "@ffmpeg/ffmpeg";

let ffmpeg = null;
let ffmpegLoading = null;

function sanitize(t) {
  return String(t || "")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

async function getFFmpeg() {
  if (!ffmpeg) {
    ffmpeg = createFFmpeg({
      log: false
    });
  }

  if (!ffmpeg.isLoaded()) {
    if (!ffmpegLoading) {
      ffmpegLoading = ffmpeg.load();
    }
    await ffmpegLoading;
  }

  return ffmpeg;
}

// Piccolo helper per leggere il body sia se è già oggetto, sia se è stringa
async function readBody(req) {
  if (req.body) {
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body);
      } catch {
        return {};
      }
    }
    // già un oggetto
    return req.body;
  }

  // fallback stile Node puro
  return await new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    const data = await readBody(req);
    const domanda = (data.domanda || "").toString();
    const answer = (data.answer || "").toString();
    const style = (data.style || "whatif").toString();

    if (!domanda || !answer) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          error: "domanda e answer sono obbligatorie"
        })
      );
      return;
    }

    // Risposta accorciata per il video
    const aShort =
      answer.length > 240 ? answer.slice(0, 240).trimEnd() + "…" : answer;

    const bgColor = style === "wtf" ? "0x101414" : "0x0A0F14";
    const duration = 8; // secondi

    const sDomanda = sanitize(domanda);
    const sAnswer = sanitize(aShort);

    const drawFilter = [
      `drawtext=text='${sDomanda}':fontcolor=white:fontsize=44:box=1:boxcolor=0x00000066:boxborderw=16:x=(w-text_w)/2:y=200`,
      `drawtext=text='${sAnswer}':fontcolor=0xA0B2BA:fontsize=34:box=1:boxcolor=0x00000066:boxborderw=16:x=(w-text_w)/2:y=(h-text_h)/2+80`
    ].join(",");

    const ff = await getFFmpeg();

    // Pulizia eventuale file precedenti
    try {
      ff.FS("unlink", "out.webm");
    } catch {}

    // Genera un video .webm (VP9) 1080x1920 con sfondo color e testo
    await ff.run(
      "-f",
      "lavfi",
      "-i",
      `color=c=${bgColor}:s=1080x1920:d=${duration}`,
      "-vf",
      drawFilter,
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "1M",
      "-an",
      "out.webm"
    );

    const dataFile = ff.FS("readFile", "out.webm");

    res.statusCode = 200;
    res.setHeader("Content-Type", "video/webm");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", String(dataFile.length));

    // Invia il buffer al client
    res.end(Buffer.from(dataFile));
  } catch (err) {
    console.error("generate-clip error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "Errore nella generazione del video",
          detail: String(err && err.message ? err.message : err)
        })
      );
    }
  }
}
