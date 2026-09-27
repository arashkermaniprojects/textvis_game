#!/usr/bin/env node
// rebuild-lecture.mjs — one-shot reconditioning tool for a lecture.
//
// For a given basename (or --all), runs the full narration-quality
// pipeline that v6 of marketing_generative_ai landed on:
//
//   1. Restore original subtitles from graph_data.json (so any prior
//      LLM rewrites/noise are wiped and we start from the pre-cleaning
//      baseline each time).
//   2. Apply voice + speed from tools/pipeline-config.json using a
//      keyword classifier over the article title (technical vs
//      non_technical).
//   3. Run clean-subtitles.mjs (targeted regex fix + aggressive global
//      pronoun substitution pass via local LLM).
//   4. Run regen-from-state.mjs — generates fresh WAVs via Kokoro with
//      the new voice and cleaned text.
//   5. Copy regenerated WAVs + durations + lecture_state.json from the
//      parent workdir (/tmp/textvis_run_<basename>/) back to the local
//      lecture directory (lectures/<basename>/).
//   6. Re-run compute-layout.mjs so world_state.json picks up the new
//      audio timings.
//
// After this, the lecture is ready for render-lecture.mjs.
//
// Usage:
//   node tools/rebuild-lecture.mjs <basename>
//   node tools/rebuild-lecture.mjs --all
//   node tools/rebuild-lecture.mjs <basename> --skip-clean  (voice only)

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const LECTURES_DIR = path.join(REPO_ROOT, "lectures");
const CONFIG_PATH = path.join(REPO_ROOT, "tools", "pipeline-config.json");

function parseArgs(argv) {
  const flags = { _positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      flags[a.slice(2)] = true;
    } else {
      flags._positional.push(a);
    }
  }
  return flags;
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function classifyDomain(title, config) {
  const kws = config.voice_classifier?.technical_keywords || [];
  const t = (title || "").toLowerCase();
  for (const kw of kws) {
    if (t.includes(kw.toLowerCase())) return "technical";
  }
  return "non_technical";
}

function runStep(label, cmd) {
  console.log(`\n  → ${label}`);
  try {
    execSync(cmd, { stdio: "inherit", cwd: REPO_ROOT });
  } catch (e) {
    console.error(`  ✗ ${label} FAILED`);
    throw e;
  }
}

function rebuildLecture(basename, { skipClean }) {
  console.log(`\n=== ${basename} ===`);

  const lectureDir = path.join(LECTURES_DIR, basename);
  const workDir = `/tmp/textvis_run_${basename}`;
  const localState = path.join(lectureDir, "lecture_state.json");
  const workState = path.join(workDir, "lecture_state.json");
  const graphPath = path.join(lectureDir, "graph_data.json");

  if (!fs.existsSync(graphPath)) {
    console.log("  skip: no graph_data.json");
    return false;
  }
  if (!fs.existsSync(workState)) {
    console.log(`  skip: no workdir state at ${workState}`);
    return false;
  }

  // 1. Restore original subtitles from graph_data.json into BOTH states.
  const graph = loadJson(graphPath);
  const origSubs = graph.subtitles || [];
  if (origSubs.length === 0) {
    console.log("  skip: graph_data has no subtitles array");
    return false;
  }

  // 2. Pick voice from config based on the article title.
  const config = loadJson(CONFIG_PATH);
  const localStateObj = fs.existsSync(localState) ? loadJson(localState) : loadJson(workState);
  const title = localStateObj.title || basename.replace(/_/g, " ");
  const domain = classifyDomain(title, config);
  const voiceCfg = config.voices[domain] || config.voices.non_technical;
  const voice = {
    name: voiceCfg.name,
    speed: voiceCfg.speed,
    lang: voiceCfg.lang,
  };
  console.log(`  domain=${domain} voice=${voice.name} speed=${voice.speed}`);

  // Apply to both state files (workdir is what regen-from-state reads).
  for (const p of [workState, localState]) {
    if (!fs.existsSync(p)) continue;
    const s = loadJson(p);
    for (let i = 0; i < s.edges.length && i < origSubs.length; i++) {
      s.edges[i].subtitle = origSubs[i];
    }
    s.voice = voice;
    s.generated_at = new Date().toISOString();
    writeJson(p, s);
  }
  console.log(`  restored ${origSubs.length} original subtitles`);

  // 3. Clean-subtitles (targeted + aggressive pronoun pass).
  if (!skipClean) {
    runStep(
      "clean-subtitles",
      `node tools/clean-subtitles.mjs ${basename}`,
    );
  }

  // 4. Regen audio via Kokoro (TTS).
  runStep(
    "regen-from-state",
    `node tools/regen-from-state.mjs ${basename}`,
  );

  // 5. Sync WAVs + durations + state back to local lecture.
  const workAudio = path.join(workDir, "audio_clips");
  const localAudio = path.join(lectureDir, "audio_clips");
  fs.mkdirSync(localAudio, { recursive: true });
  for (const f of fs.readdirSync(workAudio)) {
    if (/\.wav$/i.test(f) || f === "durations.json") {
      fs.copyFileSync(path.join(workAudio, f), path.join(localAudio, f));
    }
  }
  fs.copyFileSync(workState, localState);
  console.log(`  synced audio + state → ${lectureDir}`);

  // 6. Recompute layout (updates world_state.json with new timings).
  runStep(
    "compute-layout",
    `node tools/compute-layout.mjs lectures/${basename}`,
  );

  return true;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const skipClean = !!flags["skip-clean"];

  let targets;
  if (flags.all) {
    targets = fs
      .readdirSync(LECTURES_DIR)
      .filter((d) => fs.statSync(path.join(LECTURES_DIR, d)).isDirectory())
      .sort();
  } else {
    targets = flags._positional;
  }
  if (targets.length === 0) {
    console.error("usage: node tools/rebuild-lecture.mjs <basename>|--all [--skip-clean]");
    process.exit(1);
  }

  const summary = [];
  for (const b of targets) {
    try {
      const ok = rebuildLecture(b, { skipClean });
      summary.push({ basename: b, ok });
    } catch (e) {
      console.error(`  ${b} FAILED: ${e.message}`);
      summary.push({ basename: b, ok: false, err: e.message });
    }
  }
  console.log("\n=== summary ===");
  for (const s of summary) {
    console.log(`  ${s.ok ? "✓" : "✗"} ${s.basename}${s.err ? " " + s.err : ""}`);
  }
}

main();
