#!/usr/bin/env node
// ingest-paper.mjs — one-shot "PDF → lecture" orchestrator.
//
// Takes a research paper PDF and runs the full TextVis extraction
// pipeline:
//   1. article-watcher-v2.mjs   — 2-pass LLM planning + narration + formula extraction + Kokoro TTS
//   2. render-formula-pngs.py   — LaTeX formulas → matplotlib-rendered PNG cards
//   3. watcher-to-blender-data.mjs — HTML watcher → graph_data.json, audio_clips, png_icons
//   4. post-process-narration.mjs — pronoun substitution + abbreviation rotation + re-TTS
//   5. Copy the resulting /tmp/textvis_run_<basename>/ → lectures/<basename>/
//
// After this runs, the lecture is ready for:
//   - fetch-wiki-simple.mjs
//   - inspect-images-vl.mjs
//   - rebuild-overlay-timeline.mjs
//   - render-lecture.mjs
//
// Usage:
//   node tools/ingest-paper.mjs --pdf <path> --basename <id> [--title "Paper title"]
//   node tools/ingest-paper.mjs --pdf source_papers/attention_is_all_you_need_vaswani_2017.pdf --basename attention_is_all_you_need_vaswani_2017

import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const LECTURES_DIR = path.join(REPO_ROOT, "lectures");
// All production code lives inside this repository (agents/, visual/,
// llm/, pipeline/, tools/).
const PARENT_ROOT = REPO_ROOT;

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      flags[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    }
  }
  return flags;
}

function runStep(label, cmd, opts = {}) {
  console.log(`\n[ingest] → ${label}`);
  console.log(`    ${cmd}`);
  try {
    execSync(cmd, { stdio: "inherit", ...opts });
    return true;
  } catch (e) {
    console.error(`[ingest] FAILED: ${label}`);
    return false;
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const pdf = flags.pdf;
  const basename = flags.basename;
  const title = flags.title || null;
  if (!pdf || !basename) {
    console.error("usage: node tools/ingest-paper.mjs --pdf <path> --basename <id> [--title \"...\"]");
    process.exit(2);
  }
  const pdfAbs = path.resolve(pdf);
  if (!fs.existsSync(pdfAbs)) {
    console.error(`PDF not found: ${pdfAbs}`);
    process.exit(1);
  }

  const workDir = `/tmp/textvis_run_${basename}`;
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(path.join(workDir, "overlay_assets"), { recursive: true });

  // ── 1. article-watcher-v2.mjs ────────────────────────────────────
  const watcherHtml = path.join(workDir, `${basename}_watcher.html`);
  const env = { ...process.env, TEXTVIS_LLM_BACKEND: "local", KOKORO_TTS: "1" };
  const titleArg = title ? `--title ${JSON.stringify(title)}` : "";
  const ok1 = runStep(
    "article-watcher-v2",
    `node agents/article-watcher-v2.mjs --input ${JSON.stringify(pdfAbs)} --output ${JSON.stringify(watcherHtml)} --max-scenes 24 ${titleArg}`,
    { cwd: REPO_ROOT, env },
  );
  if (!ok1) process.exit(3);

  // article-watcher may have produced a formulas.json in the workDir.
  // The file is named by an auto-inferred slug, not our basename. Find it.
  let formulasJson = null;
  for (const f of fs.readdirSync(workDir)) {
    if (f.endsWith("_formulas.json")) {
      formulasJson = path.join(workDir, f);
      break;
    }
  }

  // ── 2. render-formula-pngs.py ────────────────────────────────────
  if (formulasJson && fs.existsSync(formulasJson)) {
    const pyBin = `${REPO_ROOT}/.venv-kokoro/bin/python`;
    const script = `${REPO_ROOT}/pipeline/render-formula-pngs.py`;
    const outDir = path.join(workDir, "overlay_assets");
    runStep(
      "render-formula-pngs",
      `${JSON.stringify(pyBin)} ${JSON.stringify(script)} ${JSON.stringify(formulasJson)} ${JSON.stringify(outDir)}`,
    );
  } else {
    console.log("[ingest] no formulas.json produced — skipping formula render");
  }

  // ── 3. watcher-to-blender-data.mjs ───────────────────────────────
  const ok3 = runStep(
    "watcher-to-blender-data",
    `node pipeline/watcher-to-blender-data.mjs --input ${JSON.stringify(watcherHtml)} --godot-dir ${JSON.stringify(workDir)}`,
    { cwd: REPO_ROOT },
  );
  if (!ok3) process.exit(4);

  // ── 4. post-process-narration.mjs ────────────────────────────────
  // It expects the workDir to be /tmp/textvis_run_<basename>/, which it is.
  runStep(
    "post-process-narration",
    `node tools/post-process-narration.mjs ${basename} --voice auto`,
    { cwd: REPO_ROOT },
  );

  // ── 5. Copy workdir → lectures/<basename>/ ──────────────────────
  const lectureDir = path.join(LECTURES_DIR, basename);
  fs.mkdirSync(lectureDir, { recursive: true });
  fs.mkdirSync(path.join(lectureDir, "audio_clips"), { recursive: true });
  fs.mkdirSync(path.join(lectureDir, "overlay_assets"), { recursive: true });
  fs.mkdirSync(path.join(lectureDir, "png_icons"), { recursive: true });

  function copyIfExists(src, dst) {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
      return true;
    }
    return false;
  }

  copyIfExists(path.join(workDir, "graph_data.json"), path.join(lectureDir, "graph_data.json"));
  copyIfExists(path.join(workDir, "lecture_state.json"), path.join(lectureDir, "lecture_state.json"));

  // Audio clips
  const workAudio = path.join(workDir, "audio_clips");
  if (fs.existsSync(workAudio)) {
    for (const f of fs.readdirSync(workAudio)) {
      fs.copyFileSync(path.join(workAudio, f), path.join(lectureDir, "audio_clips", f));
    }
  }

  // png_icons
  const workIcons = path.join(workDir, "png_icons");
  if (fs.existsSync(workIcons)) {
    for (const f of fs.readdirSync(workIcons)) {
      fs.copyFileSync(path.join(workIcons, f), path.join(lectureDir, "png_icons", f));
    }
  }

  // overlay_assets (formula_assets.json + formulas/*.png)
  const workOverlay = path.join(workDir, "overlay_assets");
  if (fs.existsSync(workOverlay)) {
    for (const f of fs.readdirSync(workOverlay)) {
      const src = path.join(workOverlay, f);
      const dst = path.join(lectureDir, "overlay_assets", f);
      if (fs.statSync(src).isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        for (const ff of fs.readdirSync(src)) {
          fs.copyFileSync(path.join(src, ff), path.join(dst, ff));
        }
      } else {
        fs.copyFileSync(src, dst);
      }
    }
  }

  console.log(`\n[ingest] DONE → ${lectureDir}`);
  if (formulasJson && fs.existsSync(path.join(lectureDir, "overlay_assets", "formula_assets.json"))) {
    const m = JSON.parse(fs.readFileSync(path.join(lectureDir, "overlay_assets", "formula_assets.json"), "utf8"));
    console.log(`[ingest] ${m.assets?.length || 0} formulas extracted`);
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
