#!/usr/bin/env node
// metric-image-grounding.mjs — independent VLM check of in-context image
// relevance for the paper's automatic metrics.
//
// Re-scores every image that ended up in a lecture's overlay_timeline.json
// by asking Qwen2.5-VL (the same judge used during the pipeline, but
// with a different prompt framing) whether the image faithfully depicts
// the concept IN THE CONTEXT of the article title. Returns a per-image
// score, aggregated to per-lecture mean and a dataset-wide mean.
//
// The prompt here is deliberately stricter than the accept/reject filter
// used during ingest: it asks for a continuous 0-1 score instead of a
// binary decision, so we can measure degradation when the filter is
// ablated.
//
// Usage:
//   node tools/metric-image-grounding.mjs <basename>
//   node tools/metric-image-grounding.mjs --all
//   node tools/metric-image-grounding.mjs --all --output /tmp/grounding.json

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const LECTURES_DIR = path.join(REPO_ROOT, "lectures");

const VL_URL = process.env.TEXTVIS_LOCAL_VL_URL || "http://127.0.0.1:8001/v1";
const VL_MODEL = process.env.TEXTVIS_LOCAL_VL_MODEL || "Qwen/Qwen2.5-VL-7B-Instruct-AWQ";

function parseArgs(argv) {
  const flags = { _positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[k] = next;
        i++;
      } else flags[k] = true;
    } else flags._positional.push(a);
  }
  return flags;
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function imageToDataUrl(filePath) {
  const tmp = `/tmp/metric_grounding_${process.pid}_${Math.random().toString(36).slice(2, 10)}.jpg`;
  try {
    execSync(
      `ffmpeg -y -loglevel error -i ${JSON.stringify(filePath)} ` +
        `-vf "scale='min(640,iw)':'min(640,ih)':force_original_aspect_ratio=decrease" ` +
        `-q:v 4 ${JSON.stringify(tmp)}`,
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const bytes = fs.readFileSync(tmp);
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}

async function scoreImage({ pngPath, concept, articleTitle }) {
  const messages = [
    {
      role: "system",
      content:
        "You are a strict image-relevance grader for an educational multimedia system. " +
        "You judge whether an image is a faithful, in-context visual depiction of a named concept, " +
        "given the article title. Respond with COMPACT JSON only.",
    },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageToDataUrl(pngPath) } },
        {
          type: "text",
          text:
            `Article: "${articleTitle}"\n` +
            `Concept: "${concept}"\n\n` +
            `Grade the image's faithfulness as a visual illustration of the concept in the context of this article. ` +
            `Return JSON: {"score": float in [0,1], "reason": one short sentence}.`,
        },
      ],
    },
  ];
  const body = {
    model: VL_MODEL,
    messages,
    max_tokens: 120,
    temperature: 0.1,
    stream: false,
  };
  const res = await fetch(`${VL_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`VL HTTP ${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("no content");
  const s = content.indexOf("{");
  if (s < 0) throw new Error("no JSON");
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = s; i < content.length; i++) {
    const ch = content[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error("unbalanced JSON");
  const parsed = JSON.parse(content.slice(s, end + 1));
  return {
    score: typeof parsed.score === "number" ? parsed.score : 0,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
}

async function measureLecture(basename) {
  const lectureDir = path.join(LECTURES_DIR, basename);
  const timelinePath = path.join(lectureDir, "overlay_assets", "overlay_timeline.json");
  const statePath = path.join(lectureDir, "lecture_state.json");
  if (!fs.existsSync(timelinePath) || !fs.existsSync(statePath)) {
    return null;
  }
  const timeline = loadJson(timelinePath);
  const state = loadJson(statePath);
  const title = state.title || basename.replace(/_/g, " ");

  const perImage = [];
  for (const entry of timeline.entries || []) {
    if (entry.kind !== "wiki_image") continue; // formulas are evaluated differently
    const png = entry.png;
    if (!png || !fs.existsSync(png)) continue;
    const concept = entry.caption || entry.node_id;
    try {
      const r = await scoreImage({ pngPath: png, concept, articleTitle: title });
      perImage.push({ asset_id: entry.asset_id, concept, score: r.score, reason: r.reason });
    } catch (e) {
      perImage.push({ asset_id: entry.asset_id, concept, score: 0, reason: `error: ${e.message}` });
    }
  }

  const meanScore = perImage.length > 0
    ? perImage.reduce((s, p) => s + p.score, 0) / perImage.length
    : 0;
  return {
    basename,
    num_images: perImage.length,
    mean_score: Number(meanScore.toFixed(3)),
    per_image: perImage,
  };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
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
    console.error("usage: node tools/metric-image-grounding.mjs <basename>|--all [--output <file>]");
    process.exit(1);
  }

  const all = [];
  for (const b of targets) {
    process.stdout.write(`${b} ... `);
    const r = await measureLecture(b);
    if (r) {
      console.log(`${r.num_images} images, mean ${r.mean_score}`);
      all.push(r);
    } else console.log("skip");
  }

  console.log("\n=== summary ===");
  console.log(`${"lecture".padEnd(55)} ${"images".padStart(8)} ${"mean".padStart(8)}`);
  console.log("-".repeat(75));
  let totalN = 0;
  let totalS = 0;
  for (const r of all) {
    console.log(`${r.basename.padEnd(55)} ${String(r.num_images).padStart(8)} ${r.mean_score.toFixed(3).padStart(8)}`);
    totalN += r.num_images;
    totalS += r.num_images * r.mean_score;
  }
  console.log("-".repeat(75));
  const weighted = totalN > 0 ? totalS / totalN : 0;
  console.log(`${"WEIGHTED AVG".padEnd(55)} ${String(totalN).padStart(8)} ${weighted.toFixed(3).padStart(8)}`);

  if (flags.output) {
    fs.writeFileSync(flags.output, JSON.stringify({ lectures: all, weighted_mean: weighted }, null, 2));
    console.log(`\nwrote ${flags.output}`);
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
