#!/usr/bin/env node
// metric-label-proximity.mjs — static proxy for label overlap.
//
// True screen-space label overlap depends on camera pose per frame, and
// can only be measured at render time inside Godot. As a cheap static
// proxy, we compute the 3D distance from every node to its nearest
// neighbor and take the inverse mean: a graph with many nodes crammed
// together will have high proximity (low distances) and thus high
// overlap risk. A well-separated layout has low proximity.
//
// We also report the COUNT of node pairs within a fixed threshold
// (the approximate world-space radius of a label plus its backdrop)
// — this is a lower-bound count of "will overlap at some camera pose".
//
// This metric is used to validate that the cluster-bowed active-edge
// technique (which operates on edges, not nodes) combined with the
// layout rescale pass keeps overlap counts within bounds.
//
// Usage:
//   node tools/metric-label-proximity.mjs <basename>|--all [--threshold 1.5] [--json <out.json>]

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

function measureLecture(basename, { threshold }) {
  const worldPath = path.join(LECTURES_DIR, basename, "world_state.json");
  if (!fs.existsSync(worldPath)) return null;
  const world = JSON.parse(fs.readFileSync(worldPath, "utf8"));
  const nodes = world.nodes || [];
  if (nodes.length < 2) return null;

  // Blender axis convention: (x, y, z) tuple. We take the 2D horizontal
  // projection (x, y) since labels billboard vertically and the main
  // overlap risk is horizontal neighbors at screen height.
  const pts = nodes.map((n) => ({ id: n.id, x: n.position[0], y: n.position[1], z: n.position[2] }));

  let sumNearest = 0;
  let closePairs = 0;
  for (let i = 0; i < pts.length; i++) {
    let minD = Infinity;
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      const dz = pts[i].z - pts[j].z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < minD) minD = d;
      if (j > i && d < threshold) closePairs++;
    }
    sumNearest += minD;
  }
  const meanNearest = sumNearest / pts.length;

  return {
    basename,
    num_nodes: pts.length,
    mean_nearest_neighbor_dist: Number(meanNearest.toFixed(3)),
    pairs_within_threshold: closePairs,
    threshold,
  };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const threshold = flags.threshold ? parseFloat(flags.threshold) : 1.5;

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
    console.error("usage: node tools/metric-label-proximity.mjs <basename>|--all [--threshold 1.5]");
    process.exit(1);
  }

  console.log(`threshold=${threshold} world units\n`);
  console.log(
    `${"lecture".padEnd(55)} ${"nodes".padStart(6)} ${"mean-nn-dist".padStart(13)} ${"close-pairs".padStart(12)}`,
  );
  console.log("-".repeat(92));
  let totalNodes = 0;
  let totalClose = 0;
  let sumMean = 0;
  let count = 0;
  const rows = [];
  for (const b of targets) {
    const r = measureLecture(b, { threshold });
    if (!r) continue;
    rows.push(r);
    console.log(
      `${r.basename.padEnd(55)} ${String(r.num_nodes).padStart(6)} ${r.mean_nearest_neighbor_dist.toFixed(3).padStart(13)} ${String(r.pairs_within_threshold).padStart(12)}`,
    );
    totalNodes += r.num_nodes;
    totalClose += r.pairs_within_threshold;
    sumMean += r.mean_nearest_neighbor_dist;
    count++;
  }
  console.log("-".repeat(92));
  const avgMean = count > 0 ? sumMean / count : 0;
  console.log(
    `${"AVERAGE".padEnd(55)} ${String(totalNodes).padStart(6)} ${avgMean.toFixed(3).padStart(13)} ${String(totalClose).padStart(12)}`,
  );
  if (typeof flags.json === "string") {
    const out = {
      metric: "label_proximity",
      threshold,
      lectures: rows,
      aggregate: {
        num_lectures: count,
        total_nodes: totalNodes,
        mean_nearest_neighbor_dist: avgMean,
        total_close_pairs: totalClose,
      },
    };
    fs.mkdirSync(path.dirname(path.resolve(flags.json)), { recursive: true });
    fs.writeFileSync(flags.json, JSON.stringify(out, null, 2) + "\n");
  }
}

main();
