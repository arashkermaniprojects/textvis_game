#!/usr/bin/env node
// render-lecture.mjs — end-to-end "render a lecture as an MP4" wrapper.
//
// Runs Godot with --auto-lecture + --write-movie to produce an MJPEG AVI
// (Godot's only supported movie format other than PNG sequences), then
// pipes through ffmpeg to H.264 + AAC MP4 at the user's requested path.
// Cleans up the AVI intermediate by default.
//
// Usage:
//   node tools/render-lecture.mjs --lecture <basename> --output <path.mp4>
//                                 [--max-time N] [--resolution 1920x1080]
//                                 [--keep-avi] [--crf 20]
//
// Requires Godot 4.3+ (on PATH or at ~/.local/bin/godot) and an ffmpeg
// binary. Prefers system ffmpeg; falls back to the imageio-ffmpeg binary
// bundled with the repo's .venv-kokoro if system ffmpeg is missing.
//
// Exit codes: 0 on success, 1 on arg error, 2 on Godot render failure,
// 3 on ffmpeg failure.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const GODOT_PROJECT = path.join(REPO_ROOT, "godot");

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function usage() {
  console.error(
    "Usage: node tools/render-lecture.mjs --lecture <basename> --output <path.mp4>\n" +
      "                                [--max-time N] [--resolution 1920x1080]\n" +
      "                                [--keep-avi] [--crf 20]",
  );
}

function findFfmpeg() {
  const candidates = [
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    path.resolve(
      REPO_ROOT,
      ".venv-kokoro/lib/python3.12/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2",
    ),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "ffmpeg";
}

function findGodot() {
  const candidates = [
    path.join(process.env.HOME || "", ".local/bin/godot"),
    "/usr/local/bin/godot",
    "/usr/bin/godot",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "godot";
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function run(cmd, args, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const proc = spawn(cmd, args, { stdio: "inherit" });
    proc.on("exit", (code) => {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`[${label}] done in ${elapsed}s`);
        resolve(code);
      } else {
        reject(
          new Error(`${label} exited with code ${code} after ${elapsed}s`),
        );
      }
    });
    proc.on("error", (err) => reject(err));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const lecture = args.lecture;
  const output = args.output;
  if (!lecture || !output) {
    usage();
    process.exit(1);
  }
  if (!output.endsWith(".mp4")) {
    console.error("--output must end in .mp4");
    process.exit(1);
  }

  const resolution = args.resolution || "1920x1080";
  const maxTime = args["max-time"];
  const crf = args.crf || "20";
  const keepAvi = !!args["keep-avi"];

  const outputAbs = path.resolve(output);
  const aviTmp = path.join(
    path.dirname(outputAbs),
    `.${path.basename(outputAbs, ".mp4")}.render.avi`,
  );
  fs.mkdirSync(path.dirname(outputAbs), { recursive: true });

  const godot = findGodot();
  const ffmpeg = findFfmpeg();
  console.log(`[render] godot=${godot}`);
  console.log(`[render] ffmpeg=${ffmpeg}`);
  console.log(`[render] lecture=${lecture}`);
  console.log(`[render] avi_tmp=${aviTmp}`);
  console.log(`[render] output=${outputAbs}`);

  if (fs.existsSync(aviTmp)) fs.unlinkSync(aviTmp);

  const godotArgs = [
    "--resolution",
    resolution,
    "--fixed-fps",
    "24",
    "--write-movie",
    aviTmp,
    "--path",
    GODOT_PROJECT,
    "--",
    "--lecture",
    lecture,
    "--auto-lecture",
  ];
  if (maxTime) godotArgs.push("--max-time", String(maxTime));

  try {
    await run(godot, godotArgs, "godot");
  } catch (e) {
    console.error(`[render] godot FAILED: ${e.message}`);
    process.exit(2);
  }
  if (!fs.existsSync(aviTmp)) {
    console.error(`[render] godot did not produce ${aviTmp}`);
    process.exit(2);
  }
  const aviSize = fs.statSync(aviTmp).size;
  console.log(`[render] avi: ${formatSize(aviSize)} at ${aviTmp}`);

  const ffmpegArgs = [
    "-y",
    "-i",
    aviTmp,
    "-c:v",
    "libx264",
    "-crf",
    String(crf),
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputAbs,
  ];
  try {
    await run(ffmpeg, ffmpegArgs, "ffmpeg");
  } catch (e) {
    console.error(`[render] ffmpeg FAILED: ${e.message}`);
    process.exit(3);
  }

  const mp4Size = fs.statSync(outputAbs).size;
  const ratio = (aviSize / mp4Size).toFixed(1);
  console.log(
    `[render] mp4: ${formatSize(mp4Size)} at ${outputAbs}  (compression ${ratio}x)`,
  );

  if (!keepAvi) {
    fs.unlinkSync(aviTmp);
    console.log(`[render] cleaned up ${aviTmp}`);
  }
}

main().catch((e) => {
  console.error("render-lecture:", e);
  process.exit(1);
});
