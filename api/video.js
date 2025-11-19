// FILE: api/video.js
import ffmpegPath from "ffmpeg-static";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { createCanvas } from "canvas";

function sanitize(text, maxLen = 400) {
  return String(text || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLen);
}

function wrapLines(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";

  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  let body = "";
  for await (const chunk of req) body += chunk.toString();

  let payload;
  try {
    payload = JSON.parse(body || "{}");
  } catch {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "Invalid JSON" }));
  }

  const domanda = sanitize(payload.domanda, 160);
  const answerFull = sanitize(payload.answer, 500);
  const style = String(payload.style || "whatif").trim();

  if (!domanda || !answerFull) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "Missing domanda or answer" }));
  }

  if (!ffmpegPath) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: "ffmpeg not available" }));
  }

  // --- PARAMETRI VIDEO ---
  const width = 720;
  const height = 1280;
  const bgColor = style === "wtf" ? "#101414" : "#0A0F14";

  // Effetto scrittura: numero frame dinamico
  const minFrames = 18;
  const maxFrames = 40;
  const framesCount = Math.min(
    maxFrames,
    Math.max(minFrames, Math.ceil(answerFull.length / 12))
  );
  const fps = 6; // 6 fps → durata ≈ framesCount / 6 secondi

  // --- PREPARA CANVAS ---
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const marginX = 60;
  const maxTextWidth = width - marginX * 2;

  // Stile domanda
  ctx.font = "bold 34px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";

  const questionLines = wrapLines(ctx, domanda, maxTextWidth);

  // Funzione che disegna un frame con parte della risposta
  function drawFrame(answerPartial) {
    // Sfondo
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    // DOMANDA
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 34px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    let y = 160;
    const lineHeightQ = 44;
    for (const line of questionLines) {
      ctx.fillText(line, marginX, y);
      y += lineHeightQ;
    }

    // Risposta (effetto scrittura)
    ctx.fillStyle = "#A0B2BA";
    ctx.font = "28px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    const lineHeightA = 38;
    y += 40;

    const answerLines = wrapLines(ctx, answerPartial, maxTextWidth);
    for (const line of answerLines) {
      ctx.fillText(line, marginX, y);
      y += lineHeightA;
    }
  }

  // --- CREA FRAME PNG SU /tmp ---
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "whatf-"));

  const frameFiles = [];

  for (let i = 0; i < framesCount; i++) {
    const ratio = (i + 1) / framesCount;
    const chars = Math.max(1, Math.round(answerFull.length * ratio));
    const partial = answerFull.slice(0, chars);

    drawFrame(partial);

    const buffer = canvas.toBuffer("image/png");
    const filename = path.join(
      tmpDir,
      `frame-${String(i).padStart(3, "0")}.png`
    );
    fs.writeFileSync(filename, buffer);
    frameFiles.push(filename);
  }

  // --- LANCIA FFMPEG: immagini → video con pipe ---
  const ffArgs = [
    "-framerate", String(fps),
    "-i", "frame-%03d.png",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-f", "mp4",
    "pipe:1"
  ];

  res.statusCode = 200;
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="whatf-clip.mp4"'
  );

  const ff = spawn(ffmpegPath, ffArgs, { cwd: tmpDir });

  let stderrBuf = "";

  ff.stdout.on("data", (chunk) => {
    res.write(chunk);
  });

  ff.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString();
  });

  ff.on("close", (code) => {
    if (code !== 0) {
      console.error("FFmpeg exit", code, "stderr:\n", stderrBuf);
    }

    // Cleanup best-effort
    try {
      for (const f of frameFiles) fs.unlinkSync(f);
      fs.rmdirSync(tmpDir);
    } catch (_) {}

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
