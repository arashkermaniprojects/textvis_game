#!/usr/bin/env node
// mutate-world.mjs — incremental mutations to a lecture's world_state.json.
//
// This is the primitive that Phase 5 (question mode) will call from the
// lecture-server to inject new edges/nodes without reshuffling the world.
// For add-node, the affected cluster is re-relaxed with every existing
// member pinned, so their positions are BYTE-IDENTICAL after the op.
//
// Usage:
//   mutate-world.mjs <lecture_dir> add-edge    --from X --to Y --verb V --subtitle S [--audio-clip P] [--audio-duration N]
//   mutate-world.mjs <lecture_dir> remove-edge --index N
//   mutate-world.mjs <lecture_dir> add-node    --id X --label L --cluster C [--type T] [--icon P]
//   mutate-world.mjs <lecture_dir> remove-node --id X
//   mutate-world.mjs <lecture_dir> move-node   --id X --pos x,y,z
//
// Every op records a single-line entry in world_state.questions[] (even for
// non-question mutations) with { op, args, at } so the mutation history is
// auditable. The generated_at timestamp is bumped on save.

import fs from "node:fs";
import path from "node:path";
import {
  forceLayout,
  mulberry32,
  makeUniform,
  FORCE_ITERS,
  RNG_SEED,
  round6,
} from "./compute-layout.mjs";

// ─── I/O ────────────────────────────────────────────────────────────────────
function loadWorld(lectureDir) {
  const p = path.join(lectureDir, "world_state.json");
  if (!fs.existsSync(p)) {
    throw new Error(
      `world_state.json not found in ${lectureDir} — run compute-layout.mjs first`,
    );
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function saveWorld(lectureDir, world) {
  world.generated_at = new Date().toISOString();
  const p = path.join(lectureDir, "world_state.json");
  fs.writeFileSync(p, JSON.stringify(world, null, 2));
}

function findNode(world, id) {
  return world.nodes.find((n) => n.id === id);
}
function findCluster(world, id) {
  return world.clusters.find((c) => c.id === id);
}

// ─── mutations ──────────────────────────────────────────────────────────────

export function addEdge(
  world,
  { from, to, verb, subtitle, audioClip, audioDuration },
) {
  const nFrom = findNode(world, from);
  const nTo = findNode(world, to);
  if (!nFrom) throw new Error(`from node "${from}" not found`);
  if (!nTo) throw new Error(`to node "${to}" not found`);

  const maxIdx = world.edges.reduce(
    (m, e) => (typeof e.index === "number" && e.index > m ? e.index : m),
    -1,
  );
  const edge = {
    index: maxIdx + 1,
    from,
    from_label: nFrom.label,
    to,
    to_label: nTo.label,
    verb: verb || "",
    subtitle: subtitle || "",
    audio_clip: audioClip || null,
    audio_start: null,
    audio_duration: audioDuration ?? null,
    image: null,
    injected: true,
  };
  world.edges.push(edge);
  nFrom.edge_out_count = (nFrom.edge_out_count || 0) + 1;
  nTo.edge_in_count = (nTo.edge_in_count || 0) + 1;
  return edge;
}

export function removeEdge(world, { index }) {
  const i = world.edges.findIndex((e) => e.index === index);
  if (i < 0) throw new Error(`edge with index ${index} not found`);
  const [removed] = world.edges.splice(i, 1);
  const nFrom = findNode(world, removed.from);
  const nTo = findNode(world, removed.to);
  if (nFrom)
    nFrom.edge_out_count = Math.max(0, (nFrom.edge_out_count || 0) - 1);
  if (nTo) nTo.edge_in_count = Math.max(0, (nTo.edge_in_count || 0) - 1);
  return removed;
}

export function addNode(world, { id, label, type, clusterId, icon }) {
  if (findNode(world, id)) throw new Error(`node "${id}" already exists`);
  const cluster = findCluster(world, clusterId);
  if (!cluster) throw new Error(`cluster "${clusterId}" not found`);

  // Pinned-neighbor relaxation: solve for this one new node with every
  // existing cluster member frozen in place.
  const existingIds = [...cluster.node_ids];
  const allIds = [...existingIds, id];
  const initialPos = {};
  for (const nid of existingIds) {
    const n = findNode(world, nid);
    if (n) initialPos[nid] = n.position;
  }
  const pinned = new Set(existingIds);

  const rng = mulberry32(RNG_SEED);
  const uniform = makeUniform(rng);
  const newPos = forceLayout({
    nids: allIds,
    center: cluster.center,
    radius: cluster.radius,
    edges: world.edges,
    hostSet: new Set(),
    uniform,
    iters: FORCE_ITERS,
    pinned,
    initialPos,
  });

  const node = {
    id,
    label: label || id,
    type: type || "default",
    position: newPos[id].map(round6),
    cluster_id: clusterId,
    icon: icon || `png_icons/${id}.png`,
    edge_in_count: 0,
    edge_out_count: 0,
    injected: true,
  };
  world.nodes.push(node);
  cluster.node_ids.push(id);
  return node;
}

export function removeNode(world, { id }) {
  const i = world.nodes.findIndex((n) => n.id === id);
  if (i < 0) throw new Error(`node "${id}" not found`);
  const [removed] = world.nodes.splice(i, 1);

  // Strip from any cluster membership.
  for (const c of world.clusters) {
    const j = c.node_ids.indexOf(id);
    if (j >= 0) c.node_ids.splice(j, 1);
  }

  // Cascade-remove edges that reference the node and decrement the
  // corresponding counters on their remaining endpoint.
  const removedEdges = [];
  const keep = [];
  for (const e of world.edges) {
    if (e.from === id || e.to === id) {
      removedEdges.push(e);
    } else {
      keep.push(e);
    }
  }
  world.edges = keep;
  for (const e of removedEdges) {
    const otherId = e.from === id ? e.to : e.from;
    const other = findNode(world, otherId);
    if (!other) continue;
    if (e.to === otherId)
      other.edge_in_count = Math.max(0, (other.edge_in_count || 0) - 1);
    if (e.from === otherId)
      other.edge_out_count = Math.max(0, (other.edge_out_count || 0) - 1);
  }
  return { node: removed, edges: removedEdges };
}

export function moveNode(world, { id, position }) {
  const node = findNode(world, id);
  if (!node) throw new Error(`node "${id}" not found`);
  if (!Array.isArray(position) || position.length !== 3) {
    throw new Error(`position must be [x,y,z]`);
  }
  node.position = position.map(round6);
  return node;
}

// ─── history log ───────────────────────────────────────────────────────────
function recordMutation(world, op, args) {
  world.questions = world.questions || [];
  world.questions.push({
    op,
    args,
    at: new Date().toISOString(),
  });
}

// ─── CLI ────────────────────────────────────────────────────────────────────
function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function usage() {
  console.error(`Usage:
  mutate-world.mjs <lecture_dir> add-edge    --from X --to Y --verb V --subtitle S [--audio-clip P] [--audio-duration N]
  mutate-world.mjs <lecture_dir> remove-edge --index N
  mutate-world.mjs <lecture_dir> add-node    --id X --label L --cluster C [--type T] [--icon P]
  mutate-world.mjs <lecture_dir> remove-node --id X
  mutate-world.mjs <lecture_dir> move-node   --id X --pos x,y,z`);
}

function main() {
  const [lectureDir, op, ...rest] = process.argv.slice(2);
  if (!lectureDir || !op) {
    usage();
    process.exit(1);
  }
  const resolved = path.resolve(lectureDir);
  const world = loadWorld(resolved);
  const f = parseFlags(rest);

  try {
    switch (op) {
      case "add-edge": {
        const r = addEdge(world, {
          from: f.from,
          to: f.to,
          verb: f.verb,
          subtitle: f.subtitle,
          audioClip: f["audio-clip"] || null,
          audioDuration: f["audio-duration"]
            ? parseFloat(f["audio-duration"])
            : null,
        });
        recordMutation(world, "add-edge", {
          index: r.index,
          from: r.from,
          to: r.to,
          verb: r.verb,
          subtitle: r.subtitle,
        });
        console.log(`✓ added edge ${r.index}: ${r.from} → ${r.to}`);
        break;
      }
      case "remove-edge": {
        if (f.index == null) throw new Error("--index required");
        const r = removeEdge(world, { index: parseInt(f.index, 10) });
        recordMutation(world, "remove-edge", { index: r.index });
        console.log(`✓ removed edge ${r.index}: ${r.from} → ${r.to}`);
        break;
      }
      case "add-node": {
        if (!f.id || !f.cluster)
          throw new Error("--id and --cluster required");
        const r = addNode(world, {
          id: f.id,
          label: f.label || f.id,
          type: f.type || "default",
          clusterId: f.cluster,
          icon: f.icon || null,
        });
        recordMutation(world, "add-node", {
          id: r.id,
          cluster_id: r.cluster_id,
          position: r.position,
        });
        console.log(
          `✓ added node ${r.id} in cluster ${r.cluster_id} at [${r.position
            .map((v) => v.toFixed(2))
            .join(", ")}]`,
        );
        break;
      }
      case "remove-node": {
        if (!f.id) throw new Error("--id required");
        const r = removeNode(world, { id: f.id });
        recordMutation(world, "remove-node", {
          id: r.node.id,
          cascaded_edges: r.edges.map((e) => e.index),
        });
        console.log(
          `✓ removed node ${r.node.id} (+ ${r.edges.length} cascaded edges)`,
        );
        break;
      }
      case "move-node": {
        if (!f.id || !f.pos) throw new Error("--id and --pos required");
        const position = f.pos.split(",").map((v) => parseFloat(v.trim()));
        const r = moveNode(world, { id: f.id, position });
        recordMutation(world, "move-node", { id: r.id, position: r.position });
        console.log(
          `✓ moved ${r.id} to [${r.position.map((v) => v.toFixed(2)).join(", ")}]`,
        );
        break;
      }
      default:
        console.error(`unknown op: ${op}`);
        usage();
        process.exit(1);
    }
  } catch (e) {
    console.error(`✗ ${op}: ${e.message}`);
    process.exit(1);
  }

  saveWorld(resolved, world);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
