#!/usr/bin/env node
// compute-layout.mjs — Phase 1 data unification.
//
// Reads a lecture's graph_data.json (+ optional overlay_timeline.json and
// lecture_state.json) and writes a world_state.json with:
//   scene.{background_color, fps, global_radius}
//   clusters[] with center, radius, color, node_ids
//   nodes[]    with position, cluster_id, label, edge_in/out_count
//   edges[]    merged from lecture_state.json if present, else from graph_data.json
//   voice/audio/questions passthrough
//
// Layout ported from docs/blender_animated.py.reference lines ~99-220
// (Fibonacci sphere for containers + force-directed inside each). The
// JS RNG is seeded (mulberry32(42)) so output is deterministic across
// runs on any platform, but it does NOT match Python's Mersenne Twister —
// so re-rendering the Blender video will pick up new positions. That's
// the point: both video and game consume the same world_state.json.
//
// Usage:
//   node tools/compute-layout.mjs <lecture_dir>
//   node tools/compute-layout.mjs --all

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const LECTURES_DIR = path.join(REPO_ROOT, "lectures");

// ─── deterministic RNG ──────────────────────────────────────────────────────
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function makeUniform(rand) {
  return (a, b) => a + (b - a) * rand();
}

// Cluster color palette — matches the CC palette in blender_animated.py.
export const CC = [
  [0.3, 0.7, 0.9],
  [0.3, 0.5, 0.9],
  [0.65, 0.4, 0.85],
  [0.9, 0.65, 0.2],
  [0.3, 0.8, 0.4],
  [0.9, 0.8, 0.2],
  [0.9, 0.4, 0.4],
  [0.6, 0.6, 0.65],
];

export const BACKGROUND_COLOR = [0.02, 0.02, 0.04];
export const FPS = 24;
export const RNG_SEED = 42;
export const FORCE_ITERS = 80;

// ─── helpers ────────────────────────────────────────────────────────────────
function countDescendants(cont) {
  const children = cont.children || [];
  let n = 1;
  for (const ch of children) n += countDescendants(ch);
  return n;
}

function collectKids(cont) {
  // Python version: direct children + grandchildren only (two levels).
  const kids = [];
  for (const child of cont.children || []) {
    kids.push(child.id);
    for (const gc of child.children || []) kids.push(gc.id);
  }
  return kids;
}

// ─── force-directed layout inside one cluster ──────────────────────────────
//
// Options:
//   nids        — ordered list of node ids in this cluster
//   center      — [cx, cy, cz]
//   radius      — cluster shell radius
//   edges       — array of {from,to} edges (any not fully inside nids are ignored)
//   hostSet     — Set of node ids that get extra repulsion (large overlay hosts)
//   uniform     — closure from makeUniform(rng) for deterministic jitter
//   iters       — iteration count (defaults to FORCE_ITERS)
//   pinned      — Set of node ids whose positions must NOT change; they still
//                 exert forces but are skipped during integration. Positions
//                 must be provided via initialPos
//   initialPos  — map of nid → [x,y,z] starting positions (required for pinned,
//                 optional for free nodes — free nodes without an entry get
//                 either Fibonacci-sphere init (full-fresh case) or a small
//                 random jitter near center (mixed case))
//
// Returns a map of nid → [x,y,z] for ALL nids (pinned included, at their
// unchanged initialPos).
export function forceLayout({
  nids,
  center,
  radius,
  edges,
  hostSet,
  uniform,
  iters = FORCE_ITERS,
  pinned = null,
  initialPos = null,
}) {
  const pos = {};
  const [cx, cy, cz] = center;
  const n = nids.length;
  if (n === 0) return pos;
  const pinnedSet = pinned || new Set();
  const initMap = initialPos || {};

  // Seed from initialPos where provided.
  for (const nid of nids) {
    if (initMap[nid]) pos[nid] = [...initMap[nid]];
  }
  const uninited = nids.filter((nid) => !pos[nid]);

  // Original singleton case (preserves existing RNG stream for non-pinned).
  if (n === 1 && pinnedSet.size === 0 && uninited.length === 1) {
    const jx = uniform(-radius * 0.5, radius * 0.5);
    const jy = uniform(-radius * 0.5, radius * 0.5);
    const jz = uniform(-radius * 0.5, radius * 0.5);
    pos[nids[0]] = [cx + jx, cy + jy, cz + jz];
    return pos;
  }

  // Full-fresh case: no pinned, no initialPos → Fibonacci sphere at 0.7r
  // (preserves existing behavior exactly).
  if (pinnedSet.size === 0 && uninited.length === n) {
    for (let ki = 0; ki < n; ki++) {
      const phi = Math.acos(1 - (2 * (ki + 0.5)) / n);
      const th = Math.PI * (1 + Math.sqrt(5)) * ki;
      const r = radius * 0.7;
      pos[nids[ki]] = [
        cx + r * Math.sin(phi) * Math.cos(th),
        cy + r * Math.sin(phi) * Math.sin(th),
        cz + r * Math.cos(phi),
      ];
    }
  } else {
    // Mixed case: some nodes pinned/pre-positioned. Un-inited free nodes
    // start with a small random jitter near the cluster center so repulsion
    // doesn't divide by zero and they settle into whatever gaps exist.
    for (const nid of uninited) {
      pos[nid] = [
        cx + uniform(-radius * 0.2, radius * 0.2),
        cy + uniform(-radius * 0.2, radius * 0.2),
        cz + uniform(-radius * 0.2, radius * 0.2),
      ];
    }
  }
  // Adjacency within this cluster only.
  const nset = new Set(nids);
  const adj = new Map(nids.map((id) => [id, new Set()]));
  for (const e of edges) {
    if (nset.has(e.from) && nset.has(e.to)) {
      adj.get(e.from).add(e.to);
      adj.get(e.to).add(e.from);
    }
  }
  // Iterate.
  for (let iter = 0; iter < iters; iter++) {
    const forces = new Map(nids.map((id) => [id, [0, 0, 0]]));
    for (let i = 0; i < n; i++) {
      const a = nids[i];
      const pa = pos[a];
      const fa = forces.get(a);
      // Repulsive against all later nodes.
      for (let j = i + 1; j < n; j++) {
        const b = nids[j];
        const pb = pos[b];
        const dx = pb[0] - pa[0];
        const dy = pb[1] - pa[1];
        const dz = pb[2] - pa[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
        const hostScale = hostSet.has(a) || hostSet.has(b) ? 2.4 : 1.0;
        const rep = (3.0 / (d * d)) * hostScale;
        const vx = (dx / d) * rep;
        const vy = (dy / d) * rep;
        const vz = (dz / d) * rep;
        fa[0] -= vx;
        fa[1] -= vy;
        fa[2] -= vz;
        const fb = forces.get(b);
        fb[0] += vx;
        fb[1] += vy;
        fb[2] += vz;
      }
      // Attractive along edges (same ordering as Python: iterates adj[a] per i).
      for (const b of adj.get(a)) {
        const pb = pos[b];
        const dx = pb[0] - pa[0];
        const dy = pb[1] - pa[1];
        const dz = pb[2] - pa[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
        const att = d * 0.05;
        fa[0] += (dx / d) * att;
        fa[1] += (dy / d) * att;
        fa[2] += (dz / d) * att;
      }
    }
    // Integrate + constrain to 0.78r shell. Pinned nodes skip integration —
    // they still exerted forces above but don't move.
    const mr = radius * 0.78;
    for (const nid of nids) {
      if (pinnedSet.has(nid)) continue;
      const p = pos[nid];
      const f = forces.get(nid);
      p[0] += f[0] * 0.08;
      p[1] += f[1] * 0.08;
      p[2] += f[2] * 0.08;
      const dx = p[0] - cx;
      const dy = p[1] - cy;
      const dz = p[2] - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
      if (d > mr) {
        p[0] = cx + (dx / d) * mr;
        p[1] = cy + (dy / d) * mr;
        p[2] = cz + (dz / d) * mr;
      }
    }
  }
  return pos;
}

// ─── main per-lecture computation ──────────────────────────────────────────
export function computeLayout(graph, overlayEntries) {
  const rand = mulberry32(RNG_SEED);
  const uniform = makeUniform(rand);

  const nodes = graph.nodes;
  const edges = graph.edges;
  const hierarchy = graph.hierarchy;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const assetHostNodes = new Set(
    (overlayEntries || []).map((e) => e.node_id).filter(Boolean),
  );

  // Stable sort by descendant count desc.
  const sortedH = [...hierarchy].sort(
    (a, b) => countDescendants(b) - countDescendants(a),
  );
  const nTotal = sortedH.length;

  // Container radii.
  const contRadii = new Map();
  for (const cont of sortedH) {
    const nChildren = countDescendants(cont) - 1;
    const r = Math.max(
      5.0,
      Math.min(3.0 + Math.sqrt(Math.max(nChildren, 1)) * 2.2, 11.0),
    );
    contRadii.set(cont.id, r);
  }
  const maxR = Math.max(...contRadii.values());
  const SPHERE_R = Math.max(12.0, maxR * 4.5 + nTotal * 1.6);

  // Fibonacci-sphere container placement with per-cluster radial jitter.
  const containerCenters = new Map();
  for (let ci = 0; ci < nTotal; ci++) {
    const cont = sortedH[ci];
    const phi = Math.acos(1 - (2 * (ci + 0.5)) / nTotal);
    const th = Math.PI * (1 + Math.sqrt(5)) * ci;
    const rj = SPHERE_R + uniform(-SPHERE_R * 0.15, SPHERE_R * 0.15);
    const cx = rj * Math.sin(phi) * Math.cos(th);
    const cy = rj * Math.sin(phi) * Math.sin(th);
    const cz = rj * Math.cos(phi);
    containerCenters.set(cont.id, {
      center: [cx, cy, cz],
      radius: contRadii.get(cont.id),
    });
  }

  // Node positions.
  const positions = new Map();
  const clusterOfNode = new Map();
  const clusterNodeIds = new Map(); // cluster id -> ordered list of node ids

  for (let ci = 0; ci < nTotal; ci++) {
    const cont = sortedH[ci];
    const cid = cont.id;
    const { center, radius } = containerCenters.get(cid);
    const ids = [];

    if (nodeMap.has(cid)) {
      positions.set(cid, center.slice());
      clusterOfNode.set(cid, cid);
      ids.push(cid);
    }

    const allKids = collectKids(cont);
    const validKids = allKids.filter((k) => nodeMap.has(k));
    const kidPos = forceLayout({
      nids: validKids,
      center,
      radius,
      edges,
      hostSet: assetHostNodes,
      uniform,
    });
    for (const k of validKids) {
      positions.set(k, kidPos[k]);
      clusterOfNode.set(k, cid);
      ids.push(k);
    }
    clusterNodeIds.set(cid, ids);
  }

  // Orphan nodes (present in graph.nodes but never placed by the hierarchy).
  // Drop them into a synthetic "orphans" cluster at the sphere origin so the
  // game doesn't get NaN positions. Log count in the return.
  const orphanIds = [];
  for (const n of nodes) {
    if (!positions.has(n.id)) orphanIds.push(n.id);
  }
  if (orphanIds.length > 0) {
    const orphanRadius = Math.max(5.0, 3.0 + Math.sqrt(orphanIds.length) * 2.2);
    const orphanCenter = [0, 0, 0];
    containerCenters.set("__orphans__", {
      center: orphanCenter,
      radius: orphanRadius,
    });
    const kidPos = forceLayout({
      nids: orphanIds,
      center: orphanCenter,
      radius: orphanRadius,
      edges,
      hostSet: assetHostNodes,
      uniform,
    });
    for (const k of orphanIds) {
      positions.set(k, kidPos[k]);
      clusterOfNode.set(k, "__orphans__");
    }
    clusterNodeIds.set("__orphans__", orphanIds);
    sortedH.push({ id: "__orphans__", label: "Other topics", children: [] });
  }

  // ─── Rescale pass ──────────────────────────────────────────────────────
  // The close-hold camera framing in lecture_mode.gd places the camera at a
  // distance computed from each edge's length. At the camera's fixed FOV
  // (65° horizontal, 37° vertical) clamped to MAX_DISTANCE = 75 units, the
  // widest frameable span is about 96 units horizontally and 50 vertically.
  // A vertical edge of length MAX_EDGE_LEN + label margin must fit inside
  // the 50-unit vertical span. With label margin ~16, that caps
  // MAX_EDGE_LEN ≈ 25 (worst case, vertically-oriented edge).
  // User's directive: "if the clusters are too far from each other, put
  // them closer" — this is the scaled-down layout that makes every edge
  // fit regardless of world-space orientation.
  const MAX_EDGE_LEN = 25.0;
  let maxEdgeLen = 0;
  for (const e of edges) {
    const a = positions.get(e.from);
    const b = positions.get(e.to);
    if (!a || !b) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len > maxEdgeLen) maxEdgeLen = len;
  }
  let scale = 1.0;
  if (maxEdgeLen > MAX_EDGE_LEN) {
    scale = MAX_EDGE_LEN / maxEdgeLen;
    for (const [id, p] of positions) {
      positions.set(id, [p[0] * scale, p[1] * scale, p[2] * scale]);
    }
    for (const [cid, info] of containerCenters) {
      info.center = info.center.map((v) => v * scale);
      info.radius = info.radius * scale;
    }
  }
  const SPHERE_R_FINAL = SPHERE_R * scale;

  // Cluster overlap count (informational).
  const cids = [...containerCenters.keys()];
  let overlaps = 0;
  for (let i = 0; i < cids.length; i++) {
    for (let j = i + 1; j < cids.length; j++) {
      const a = containerCenters.get(cids[i]);
      const b = containerCenters.get(cids[j]);
      const dx = b.center[0] - a.center[0];
      const dy = b.center[1] - a.center[1];
      const dz = b.center[2] - a.center[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < a.radius + b.radius + 1.0) overlaps++;
    }
  }

  // Edge in/out counts for node metadata.
  const inCount = new Map();
  const outCount = new Map();
  for (const e of edges) {
    outCount.set(e.from, (outCount.get(e.from) || 0) + 1);
    inCount.set(e.to, (inCount.get(e.to) || 0) + 1);
  }

  // Assemble clusters[]. Labels are disambiguated if two clusters
  // would render with the same uppercase text (Godot's cluster label
  // goes through .to_upper()). When a collision is detected, append
  // " (II)", " (III)", etc. to the later occurrence so each cluster
  // has a unique floating label.
  const clustersOut = [];
  const seenLabels = new Map(); // uppercased label → count
  const romans = ["", " II", " III", " IV", " V", " VI", " VII"];
  for (let ci = 0; ci < sortedH.length; ci++) {
    const cont = sortedH[ci];
    const info = containerCenters.get(cont.id);
    let label = cont.label || cont.id;
    const keyUpper = label.toUpperCase();
    const prevCount = seenLabels.get(keyUpper) || 0;
    if (prevCount > 0) {
      const suffix = romans[Math.min(prevCount, romans.length - 1)];
      label = `${label}${suffix}`;
    }
    seenLabels.set(keyUpper, prevCount + 1);
    clustersOut.push({
      id: cont.id,
      label,
      color: CC[ci % CC.length],
      center: info.center.map((v) => round6(v)),
      radius: round6(info.radius),
      node_ids: clusterNodeIds.get(cont.id) || [],
    });
  }

  // Assemble nodes[] in the original graph order.
  const nodesOut = nodes.map((n) => {
    const p = positions.get(n.id);
    const iconPath = `png_icons/${n.id}.png`;
    return {
      id: n.id,
      label: n.label,
      type: n.type || "default",
      position: p ? p.map(round6) : [0, 0, 0],
      cluster_id: clusterOfNode.get(n.id) || null,
      icon: iconPath,
      edge_in_count: inCount.get(n.id) || 0,
      edge_out_count: outCount.get(n.id) || 0,
    };
  });

  return {
    scene: {
      background_color: BACKGROUND_COLOR,
      fps: FPS,
      global_radius: round6(SPHERE_R_FINAL),
      coord_system: "z_up",
      max_edge_len_before_rescale: round6(maxEdgeLen),
      rescale_factor: round6(scale),
    },
    clusters: clustersOut,
    nodes: nodesOut,
    _stats: {
      node_count: nodesOut.length,
      cluster_count: clustersOut.length,
      overlap_pairs: overlaps,
      orphan_count: orphanIds.length,
    },
  };
}

export function round6(v) {
  return Math.round(v * 1e6) / 1e6;
}

// ─── per-lecture file I/O ───────────────────────────────────────────────────
export function processLecture(lectureDir) {
  const basename = path.basename(lectureDir);
  const graphPath = path.join(lectureDir, "graph_data.json");
  if (!fs.existsSync(graphPath)) {
    throw new Error(`graph_data.json not found in ${lectureDir}`);
  }
  const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));

  const overlayPath = path.join(
    lectureDir,
    "overlay_assets",
    "overlay_timeline.json",
  );
  let overlayEntries = [];
  if (fs.existsSync(overlayPath)) {
    const raw = JSON.parse(fs.readFileSync(overlayPath, "utf8"));
    overlayEntries = raw.entries || [];
  }

  const layout = computeLayout(graph, overlayEntries);

  // Merge with existing lecture_state.json (voice/audio/edges) if present.
  const lectureStatePath = path.join(lectureDir, "lecture_state.json");
  let lectureState = {};
  if (fs.existsSync(lectureStatePath)) {
    lectureState = JSON.parse(fs.readFileSync(lectureStatePath, "utf8"));
  }

  // Merge with existing world_state.json to preserve questions[] on re-runs.
  const worldStatePath = path.join(lectureDir, "world_state.json");
  let existingWorld = {};
  if (fs.existsSync(worldStatePath)) {
    existingWorld = JSON.parse(fs.readFileSync(worldStatePath, "utf8"));
  }

  const sourcePdfRel = path.posix.join("source_papers", `${basename}.pdf`);
  const sourcePdfAbs = path.join(REPO_ROOT, sourcePdfRel);
  const sourcePdf = fs.existsSync(sourcePdfAbs) ? sourcePdfRel : null;

  const world = {
    basename,
    version: "1.0",
    generated_at: new Date().toISOString(),
    title: lectureState.title || basename.replace(/_/g, " "),
    source_pdf: sourcePdf,
    voice: lectureState.voice || null,
    audio: lectureState.audio || null,
    scene: layout.scene,
    clusters: layout.clusters,
    nodes: layout.nodes,
    edges: lectureState.edges || graph.edges,
    questions: existingWorld.questions || [],
  };

  fs.writeFileSync(worldStatePath, JSON.stringify(world, null, 2));
  return { basename, path: worldStatePath, ...layout._stats };
}

// ─── CLI ────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage: node tools/compute-layout.mjs <lecture_dir>\n" +
        "       node tools/compute-layout.mjs --all",
    );
    process.exit(1);
  }
  let targets;
  if (args[0] === "--all") {
    targets = fs
      .readdirSync(LECTURES_DIR)
      .map((d) => path.join(LECTURES_DIR, d))
      .filter((d) => fs.statSync(d).isDirectory())
      .sort();
  } else {
    targets = args.map((a) => path.resolve(a));
  }

  let ok = 0;
  let fail = 0;
  for (const t of targets) {
    try {
      const r = processLecture(t);
      console.log(
        `✓ ${r.basename}: ${r.node_count} nodes, ${r.cluster_count} clusters, ${r.overlap_pairs} overlap pairs, ${r.orphan_count} orphans`,
      );
      ok++;
    } catch (e) {
      console.error(`✗ ${path.basename(t)}: ${e.message}`);
      fail++;
    }
  }
  console.log(`\n${ok} ok, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
