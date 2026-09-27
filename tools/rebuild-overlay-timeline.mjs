#!/usr/bin/env node
// rebuild-overlay-timeline.mjs — emit overlay_timeline.json from the
// accepted images produced by fetch-wiki-simple.mjs + inspect-images-vl.mjs.
//
// For each lecture:
//   1. Scan lectures/<basename>/overlay_assets/wiki/*.{jpg,jpeg,png,webp}
//      (files in wiki/_rejected/ are NOT included — already rejected by VL)
//   2. Parse wiki_<slug>[_<idx>].<ext> → candidate node id (slug)
//   3. Match slug to a graph node id (exact or via slugify)
//   4. Walk lecture_state.json edges in order (each has audio_start +
//      audio_duration) and assign up to --per-edge accepted images to that
//      edge's time window, preferring images whose node matches edge.to
//      or edge.from and that haven't been shown yet. A second pass fills
//      remaining unused images at any edge where either endpoint matches,
//      so nothing goes unused.
//   5. Write overlay_timeline.json with entries [{start,end,png,kind,
//      caption,node_id,asset_id}].
//
// Usage:
//   node tools/rebuild-overlay-timeline.mjs <basename>
//   node tools/rebuild-overlay-timeline.mjs --all [--per-edge 2]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const LECTURES_DIR = path.join(REPO_ROOT, "lectures");

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

function slugify(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function rebuildLecture(basename, { perEdge }) {
  const lectureDir = path.join(LECTURES_DIR, basename);
  const graphPath = path.join(lectureDir, "graph_data.json");
  const statePath = path.join(lectureDir, "lecture_state.json");
  const wikiDir = path.join(lectureDir, "overlay_assets", "wiki");
  const formulasDir = path.join(lectureDir, "overlay_assets", "formulas");
  const formulaManifest = path.join(lectureDir, "overlay_assets", "formula_assets.json");
  const outPath = path.join(lectureDir, "overlay_assets", "overlay_timeline.json");

  if (!fs.existsSync(graphPath) || !fs.existsSync(statePath)) {
    console.log(`  skip: missing graph_data or lecture_state`);
    return { basename, entries: 0 };
  }

  const graph = loadJson(graphPath);
  const state = loadJson(statePath);
  const nodes = graph.nodes || [];
  const edges = state.edges || [];

  const nodeIds = new Set(nodes.map((n) => n.id));
  const bySlug = new Map();
  for (const n of nodes) {
    bySlug.set(n.id, n.id);
    bySlug.set(slugify(n.id), n.id);
    bySlug.set(slugify(n.label || n.id), n.id);
  }
  const nodeLabel = Object.fromEntries(nodes.map((n) => [n.id, n.label || n.id]));

  // ── Collect wiki images ──────────────────────────────────────────
  const images = [];
  if (fs.existsSync(wikiDir)) {
    const files = fs
      .readdirSync(wikiDir)
      .filter(
        (f) =>
          /\.(jpe?g|png|webp)$/i.test(f) &&
          fs.statSync(path.join(wikiDir, f)).isFile(),
      );
    for (const f of files) {
      const stem = f.replace(/\.[^.]+$/, "");
      const m = stem.match(/^wiki_(.+?)(?:_(\d+))?$/);
      if (!m) continue;
      const slug = m[1];
      let nodeId = bySlug.get(slug);
      if (!nodeId) {
        const cand = [...bySlug.keys()].find(
          (k) => slugify(k) === slug || k.startsWith(slug + "_") || slug.startsWith(k + "_"),
        );
        if (cand) nodeId = bySlug.get(cand);
      }
      if (!nodeId || !nodeIds.has(nodeId)) continue;
      images.push({
        kind: "wiki_image",
        filename: f,
        path: path.join(wikiDir, f),
        node_id: nodeId,
        caption: nodeLabel[nodeId] || nodeId,
        asset_id: `wiki_${stem}`,
      });
    }
  }

  // ── Collect formula PNGs (matplotlib-rendered LaTeX cards) ───────
  // Match each formula to a node whose label contains the formula name
  // (case-insensitive substring). If no match, the formula is bound to
  // any node whose label most closely shares keywords from the formula
  // name — a fallback that keeps the formula from being orphaned.
  const formulas = [];
  if (fs.existsSync(formulaManifest)) {
    const manifest = loadJson(formulaManifest);
    const assets = manifest.assets || [];
    for (const a of assets) {
      const pngAbs = path.isAbsolute(a.png)
        ? a.png
        : path.join(lectureDir, "overlay_assets", a.png);
      if (!fs.existsSync(pngAbs)) continue;
      const name = (a.caption || a.name || a.id || "").toLowerCase();
      // Try to match formula name to a node label.
      let nodeId = null;
      let bestScore = 0;
      const nameTokens = name.split(/[\s_-]+/).filter((t) => t.length >= 3);
      for (const n of nodes) {
        const label = (n.label || n.id || "").toLowerCase();
        let score = 0;
        if (label.includes(name) || name.includes(label)) score += 10;
        for (const t of nameTokens) if (label.includes(t)) score += 1;
        if (score > bestScore) {
          bestScore = score;
          nodeId = n.id;
        }
      }
      if (!nodeId && nodes.length > 0) nodeId = nodes[0].id; // anchor to first node as last resort
      formulas.push({
        kind: "formula",
        filename: path.basename(pngAbs),
        path: pngAbs,
        node_id: nodeId,
        caption: a.caption || a.id,
        asset_id: a.id,
      });
    }
  }

  // ── Group assets by node, prioritizing formulas over wiki images ─
  const byNode = new Map();
  for (const asset of [...formulas, ...images]) {
    if (!byNode.has(asset.node_id)) byNode.set(asset.node_id, []);
    byNode.get(asset.node_id).push(asset);
  }

  const used = new Set();
  const entries = [];

  for (let pass = 0; pass < 2; pass++) {
    for (let ei = 0; ei < edges.length; ei++) {
      const e = edges[ei];
      const start = e.audio_start ?? 0;
      const dur = e.audio_duration ?? 0;
      if (dur <= 0) continue;
      const endT = start + dur;

      let pickedThisEdge = 0;
      for (const endpoint of [e.to, e.from]) {
        if (pickedThisEdge >= perEdge) break;
        const list = byNode.get(endpoint) || [];
        for (const asset of list) {
          if (used.has(asset.asset_id)) continue;
          if (pass === 0 && pickedThisEdge >= 1) break;
          used.add(asset.asset_id);
          entries.push({
            start: Number(start.toFixed(3)),
            end: Number(endT.toFixed(3)),
            png: asset.path,
            kind: asset.kind,
            caption: asset.caption,
            node_id: asset.node_id,
            asset_id: asset.asset_id,
          });
          pickedThisEdge++;
          if (pickedThisEdge >= perEdge) break;
        }
      }
    }
  }

  entries.sort((a, b) => a.start - b.start || a.asset_id.localeCompare(b.asset_id));

  fs.writeFileSync(
    outPath,
    JSON.stringify({ entries, source: "rebuild-overlay-timeline.mjs" }, null, 2),
  );
  const unusedCount = images.filter((i) => !used.has(i.asset_id)).length;
  console.log(
    `  ${basename}: images=${images.length} placed=${entries.length} unused=${unusedCount} → ${path.basename(outPath)}`,
  );
  return { basename, total: images.length, placed: entries.length, unused: unusedCount };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const perEdge = flags["per-edge"] ? parseInt(flags["per-edge"], 10) : 2;

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
      "usage: node tools/rebuild-overlay-timeline.mjs <basename>|--all [--per-edge 2]",
    );
    process.exit(1);
  }

  console.log(`rebuilding overlay timelines (per-edge=${perEdge})`);
  const summary = [];
  for (const b of targets) {
    summary.push(rebuildLecture(b, { perEdge }));
  }
  console.log("\n=== summary ===");
  for (const s of summary) {
    console.log(
      `  ${s.basename}: total=${s.total || 0} placed=${s.placed || 0} unused=${s.unused || 0}`,
    );
  }
}

main();
