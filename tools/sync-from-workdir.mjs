#!/usr/bin/env node
// sync-from-workdir.mjs — syncs a lecture's audio + metadata from the
// pipeline's /tmp/textvis_run_<basename>/ workdir into
// lectures/<basename>/. Use after regen-from-state.mjs has regenerated
// audio (new silence gaps, revoiced clips, etc.) and the local lecture is stale.
//
// Detects drift by comparing `audio_clips/durations.json` between the
// two. If they match, skips the lecture. Otherwise copies:
//   - audio_clips/durations.json
//   - audio_clips/narration.wav    (concatenated full-length narration)
//   - audio_clips/edge_NNN.wav     (all per-edge clips)
//   - lecture_state.json           (workdir version, if newer)
//
// After copy, re-runs compute-layout.mjs for the affected lectures so
// world_state.json picks up the new timings from lecture_state.json.
//
// This script only reads from the /tmp workdirs, which the pipeline
// treats as outputs/caches.
//
// Usage:
//   node tools/sync-from-workdir.mjs <basename>
//   node tools/sync-from-workdir.mjs --all

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const LECTURES_DIR = path.join(REPO_ROOT, "lectures");
const WORKDIR_PREFIX = "/tmp/textvis_run_";

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function totalDuration(durations) {
  if (!Array.isArray(durations) || durations.length === 0) return 0;
  const last = durations[durations.length - 1];
  return last.start + last.duration;
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function syncLecture(basename, { dryRun = false } = {}) {
  const localDir = path.join(LECTURES_DIR, basename);
  const workDir = `${WORKDIR_PREFIX}${basename}`;

  if (!fs.existsSync(localDir)) {
    return { basename, status: "skip", reason: "no local lecture dir" };
  }
  if (!fs.existsSync(workDir)) {
    return { basename, status: "skip", reason: "no parent workdir" };
  }

  const localDurPath = path.join(localDir, "audio_clips", "durations.json");
  const workDurPath = path.join(workDir, "audio_clips", "durations.json");
  if (!fs.existsSync(localDurPath) || !fs.existsSync(workDurPath)) {
    return { basename, status: "skip", reason: "durations.json missing" };
  }

  const localDur = readJson(localDurPath);
  const workDur = readJson(workDurPath);
  const localTotal = totalDuration(localDur);
  const workTotal = totalDuration(workDur);

  if (Math.abs(localTotal - workTotal) < 0.001 && localDur.length === workDur.length) {
    // Deep check: per-edge drift
    let maxDrift = 0;
    for (let i = 0; i < localDur.length; i++) {
      const a = localDur[i].start;
      const b = workDur[i].start;
      const d = Math.abs(a - b);
      if (d > maxDrift) maxDrift = d;
    }
    if (maxDrift < 0.001) {
      return { basename, status: "in-sync", localTotal, workTotal };
    }
  }

  // Sync needed.
  const filesToCopy = [];

  // 1. durations.json
  filesToCopy.push({
    src: workDurPath,
    dst: localDurPath,
    label: "durations.json",
  });

  // 2. narration.wav
  const workNarr = path.join(workDir, "audio_clips", "narration.wav");
  const localNarr = path.join(localDir, "audio_clips", "narration.wav");
  if (fs.existsSync(workNarr)) {
    filesToCopy.push({
      src: workNarr,
      dst: localNarr,
      label: "narration.wav",
    });
  }

  // 3. edge_*.wav
  const workAudioDir = path.join(workDir, "audio_clips");
  const workAudioFiles = fs.readdirSync(workAudioDir).filter((f) => /^edge_\d+\.wav$/.test(f));
  for (const f of workAudioFiles) {
    filesToCopy.push({
      src: path.join(workAudioDir, f),
      dst: path.join(localDir, "audio_clips", f),
      label: f,
    });
  }

  // 4. lecture_state.json (if parent has one and it's newer)
  const workLS = path.join(workDir, "lecture_state.json");
  const localLS = path.join(localDir, "lecture_state.json");
  if (fs.existsSync(workLS)) {
    const wStat = fs.statSync(workLS);
    const lStat = fs.existsSync(localLS) ? fs.statSync(localLS) : null;
    if (lStat == null || wStat.mtimeMs > lStat.mtimeMs) {
      filesToCopy.push({
        src: workLS,
        dst: localLS,
        label: "lecture_state.json",
      });
    }
  }

  if (dryRun) {
    return {
      basename,
      status: "needs-sync",
      localTotal,
      workTotal,
      files: filesToCopy.map((f) => f.label),
    };
  }

  for (const { src, dst, label } of filesToCopy) {
    copyFile(src, dst);
  }

  return {
    basename,
    status: "synced",
    localTotal,
    workTotal,
    fileCount: filesToCopy.length,
    totalDelta: (workTotal - localTotal).toFixed(2),
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node tools/sync-from-workdir.mjs <basename>");
    console.error("       node tools/sync-from-workdir.mjs --all");
    console.error("       node tools/sync-from-workdir.mjs --all --dry");
    process.exit(1);
  }
  const dryRun = args.includes("--dry") || args.includes("--dry-run");
  let targets;
  if (args.includes("--all")) {
    targets = fs
      .readdirSync(LECTURES_DIR)
      .filter((d) => fs.statSync(path.join(LECTURES_DIR, d)).isDirectory())
      .sort();
  } else {
    targets = args.filter((a) => !a.startsWith("--"));
  }

  const synced = [];
  const skipped = [];
  for (const t of targets) {
    const r = syncLecture(t, { dryRun });
    const tag = r.status === "synced" ? "✓" : r.status === "needs-sync" ? "~" : "·";
    let line = `${tag} ${r.basename.padEnd(50)} ${r.status}`;
    if (r.localTotal != null && r.workTotal != null) {
      line += `  local=${r.localTotal.toFixed(1)}s  parent=${r.workTotal.toFixed(1)}s`;
    }
    if (r.totalDelta != null) line += `  Δ=${r.totalDelta}s`;
    if (r.fileCount != null) line += `  files=${r.fileCount}`;
    if (r.reason) line += `  (${r.reason})`;
    console.log(line);
    if (r.status === "synced") synced.push(r.basename);
    else if (r.status !== "needs-sync") skipped.push(r.basename);
  }

  console.log(`\n${synced.length} synced, ${skipped.length} skipped (in-sync or missing)`);

  // Re-run compute-layout for synced lectures so world_state.json picks
  // up the new audio_start / audio_duration values from lecture_state.json.
  if (!dryRun && synced.length > 0) {
    console.log("\nRe-running compute-layout.mjs for synced lectures…");
    for (const b of synced) {
      try {
        execSync(
          `node ${path.join(__dirname, "compute-layout.mjs")} ${path.join(LECTURES_DIR, b)}`,
          { stdio: "inherit" },
        );
      } catch (e) {
        console.error(`compute-layout failed for ${b}: ${e.message}`);
      }
    }
  }
}

main();
