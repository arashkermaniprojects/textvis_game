#!/usr/bin/env node
// inspect-images-vl.mjs — Visual LLM image relevance inspector.
//
// For each image under lectures/<basename>/overlay_assets/wiki/, asks
// Qwen2.5-VL-7B at http://127.0.0.1:8001/v1 whether the image is
// relevant to the node concept in the context of the article title.
// Rejects images with score < threshold by moving them to
// wiki/_rejected/. Writes a vl_inspect_report.json per lecture.
//
// Usage:
//   node tools/inspect-images-vl.mjs <basename>
//   node tools/inspect-images-vl.mjs --all
//   node tools/inspect-images-vl.mjs --all --threshold 0.55
//   node tools/inspect-images-vl.mjs --all --dry
//   node tools/inspect-images-vl.mjs --all --keep-rejected

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
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      flags._positional.push(a);
    }
  }
  return flags;
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJsonPretty(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function slugify(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function articleTitle(lectureDir, basename) {
  const wsp = path.join(lectureDir, "world_state.json");
  if (fs.existsSync(wsp)) {
    const w = loadJson(wsp);
    if (w.title && typeof w.title === "string" && w.title.trim()) return w.title;
  }
  return basename.replace(/_/g, " ");
}

function collectImages(lectureDir, basename) {
  const nodes = loadJson(path.join(lectureDir, "graph_data.json")).nodes;
  const nodeLabel = Object.fromEntries(nodes.map((n) => [n.id, n.label || n.id]));
  const title = articleTitle(lectureDir, basename);

  const bindingPath = path.join(lectureDir, "overlay_assets", "binding.json");
  const bindings = fs.existsSync(bindingPath)
    ? loadJson(bindingPath).bindings || []
    : [];
  const assetToNode = {};
  for (const b of bindings) {
    assetToNode[b.asset_id] = b.node_id;
  }

  const wikiDir = path.join(lectureDir, "overlay_assets", "wiki");
  if (!fs.existsSync(wikiDir)) return { title, images: [] };
  const files = fs
    .readdirSync(wikiDir)
    .filter(
      (f) =>
        /\.(jpe?g|png|webp)$/i.test(f) &&
        fs.statSync(path.join(wikiDir, f)).isFile(),
    );

  const out = [];
  for (const f of files) {
    const stem = f.replace(/\.[^.]+$/, "");
    const m = stem.match(/^wiki_(.+?)(?:_(\d+))?$/);
    if (!m) continue;
    const slug = m[1];
    let nodeId = assetToNode[`wiki_${slug}`] || slug;
    if (!nodeLabel[nodeId]) {
      const candidate = Object.keys(nodeLabel).find(
        (k) => k === slug || slugify(k) === slug,
      );
      if (candidate) nodeId = candidate;
    }
    const label = nodeLabel[nodeId] || slug.replace(/_/g, " ");
    out.push({
      path: path.join(wikiDir, f),
      filename: f,
      node_id: nodeId,
      node_label: label,
      article_title: title,
    });
  }
  return { title, images: out };
}

// Resize the image to max 640×640 via ffmpeg so its tokenized form stays
// well inside Qwen2.5-VL's 8192-token context. The raw files from
// Wikipedia can be 2000×2000 which tokenises to 16k+ tokens and errors.
function imageToDataUrl(filePath) {
  const tmpPath = `/tmp/vl_inspect_${process.pid}_${Math.random().toString(36).slice(2, 10)}.jpg`;
  try {
    execSync(
      `ffmpeg -y -loglevel error -i ${JSON.stringify(filePath)} ` +
        `-vf "scale='min(640,iw)':'min(640,ih)':force_original_aspect_ratio=decrease" ` +
        `-q:v 4 ${JSON.stringify(tmpPath)}`,
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const bytes = fs.readFileSync(tmpPath);
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

async function scoreImage({ path: p, node_label, article_title }) {
  const messages = [
    {
      role: "system",
      content:
        "You are an image relevance judge for an educational lecture. " +
        "Look at the image and decide whether it visually depicts the " +
        "specified concept in the context of the specified article. " +
        "Respond with COMPACT JSON only — no prose outside JSON.",
    },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageToDataUrl(p) } },
        {
          type: "text",
          text:
            `Article: "${article_title}"\n` +
            `Concept: "${node_label}"\n\n` +
            `Task: Is this image a faithful visual depiction of "${node_label}" ` +
            `as it would appear in the context of the article above?\n\n` +
            `Return JSON with these keys ONLY:\n` +
            `  "score": a float in [0, 1]\n` +
            `  "reason": one short sentence\n` +
            `Example: {"score": 0.85, "reason": "Clear photo of turmeric root"}`,
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
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`vLLM-VL HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("vLLM-VL response missing content");

  const start = content.indexOf("{");
  if (start < 0) throw new Error(`no JSON in response: ${content.slice(0, 200)}`);
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < content.length; i++) {
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
  if (end < 0) throw new Error(`unbalanced JSON: ${content.slice(0, 200)}`);
  let parsed;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch (e) {
    throw new Error(`JSON parse failed: ${e.message} / raw: ${content.slice(0, 200)}`);
  }
  return {
    score: typeof parsed.score === "number" ? parsed.score : 0,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
}

async function inspectLecture(basename, { threshold, dryRun, keepRejected }) {
  const lectureDir = path.join(LECTURES_DIR, basename);
  const { title, images } = collectImages(lectureDir, basename);

  console.log(`\n=== ${basename} (${images.length} images) ===`);
  console.log(`   article: "${title}"`);

  if (images.length === 0) {
    console.log(`   (no images, skipping)`);
    return { basename, total: 0, accepted: 0, rejected: 0 };
  }

  const results = [];
  let accepted = 0;
  let rejected = 0;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    process.stdout.write(
      `   [${i + 1}/${images.length}] ${img.filename.slice(0, 40).padEnd(40)} → ${img.node_label.slice(0, 40).padEnd(40)} ... `,
    );
    let r;
    try {
      r = await scoreImage(img);
    } catch (e) {
      console.log(`ERROR: ${e.message.slice(0, 100)}`);
      results.push({
        path: img.path,
        filename: img.filename,
        node_id: img.node_id,
        node_label: img.node_label,
        score: 0,
        reason: `error: ${e.message}`,
        accept: false,
      });
      rejected++;
      continue;
    }
    const accept = r.score >= threshold;
    const mark = accept ? "✓" : "✗";
    console.log(`${mark} ${r.score.toFixed(2)}  ${r.reason.slice(0, 60)}`);
    results.push({
      path: img.path,
      filename: img.filename,
      node_id: img.node_id,
      node_label: img.node_label,
      score: r.score,
      reason: r.reason,
      accept,
    });
    if (accept) accepted++;
    else rejected++;
  }

  const reportPath = path.join(lectureDir, "overlay_assets", "vl_inspect_report.json");
  writeJsonPretty(reportPath, {
    basename,
    article_title: title,
    threshold,
    total: images.length,
    accepted,
    rejected,
    images: results,
  });
  console.log(`   report: ${reportPath}`);
  console.log(`   accepted=${accepted} rejected=${rejected}`);

  if (!dryRun && !keepRejected) {
    const rejectDir = path.join(lectureDir, "overlay_assets", "wiki", "_rejected");
    fs.mkdirSync(rejectDir, { recursive: true });
    for (const r of results) {
      if (r.accept) continue;
      const src = r.path;
      const dst = path.join(rejectDir, r.filename);
      try {
        fs.renameSync(src, dst);
      } catch (e) {
        // may already be moved
      }
    }
  }

  return { basename, total: images.length, accepted, rejected };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const threshold = flags.threshold ? parseFloat(flags.threshold) : 0.55;
  const dryRun = !!flags.dry || !!flags["dry-run"];
  const keepRejected = !!flags["keep-rejected"];

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
    console.error(
      "Usage: node tools/inspect-images-vl.mjs <basename>|--all [--threshold 0.55] [--dry] [--keep-rejected]",
    );
    process.exit(1);
  }

  const summary = [];
  for (const b of targets) {
    try {
      summary.push(
        await inspectLecture(b, { threshold, dryRun, keepRejected }),
      );
    } catch (e) {
      console.error(`ERROR on ${b}: ${e.message}`);
    }
  }

  console.log("\n=== summary ===");
  for (const s of summary) {
    console.log(
      `  ${s.basename}: total=${s.total || 0} accepted=${s.accepted || 0} rejected=${s.rejected || 0}`,
    );
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
