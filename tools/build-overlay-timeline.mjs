#!/usr/bin/env node
/**
 * Build the ffmpeg overlay timeline for a rendered lecture.
 *
 * Reads:
 *   --graph      graph_data.json (nodes, edges, subtitles)
 *   --durations  audio_clips/durations.json ({clip, start, duration}[])
 *   --binding    binding.json (asset_id → node_id)
 *   --pdf-assets pdf_assets.json
 *   --formulas   formula_assets.json
 *   --assets-dir root that all asset PNG paths are relative to
 *   --max-seconds cap timeline at this time (e.g. 30)
 *   --out        overlay_timeline.json
 *
 * Output schema:
 *   { entries: [{ start, end, png, kind, caption, node_id, asset_id }] }
 *
 * Logic:
 *   For each edge i (== clip i):
 *     - active node = edges[i].to (the newly-introduced concept)
 *     - find any binding where node_id matches → use its asset
 *     - if multiple assets bind to the same node, pick the first seen
 *     - if nothing matches, fall back to edges[i].from
 *     - if still nothing, emit no overlay for this window
 */
import { readFile, writeFile } from 'fs/promises';
import path from 'path';

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  return process.argv[i + 1];
}

const graphPath     = arg('graph');
const durationsPath = arg('durations');
const bindingPath   = arg('binding');
const pdfAssetsPath = arg('pdf-assets');
const formulasPath  = arg('formulas');
const wikiAssetsPath = arg('wiki-assets');
const assetsDir     = arg('assets-dir');
const maxSeconds    = parseFloat(arg('max-seconds', '1e9'));
const outPath       = arg('out');

if (!graphPath || !durationsPath || !bindingPath || !outPath) {
  console.error('usage: build-overlay-timeline.mjs --graph g.json --durations d.json --binding b.json --pdf-assets p.json --formulas f.json --assets-dir dir --max-seconds 30 --out t.json');
  process.exit(2);
}

const graph = JSON.parse(await readFile(graphPath, 'utf-8'));
const durations = JSON.parse(await readFile(durationsPath, 'utf-8'));
const binding = JSON.parse(await readFile(bindingPath, 'utf-8'));
const pdfAssets = pdfAssetsPath ? JSON.parse(await readFile(pdfAssetsPath, 'utf-8')) : { assets: [] };
const formulaAssets = formulasPath ? JSON.parse(await readFile(formulasPath, 'utf-8')) : { assets: [] };
const wikiAssets = wikiAssetsPath ? JSON.parse(await readFile(wikiAssetsPath, 'utf-8')) : { assets: [] };

// index: asset_id → full asset record
// PDF assets take precedence over wiki assets (user rule: if the article has
// an image or formula for a concept, Wikipedia is not used for that concept).
// Here we just load everything; the node-level precedence is applied below
// when picking an asset per edge.
const assetById = new Map();
for (const a of formulaAssets.assets || []) assetById.set(a.id, a);
for (const a of pdfAssets.assets || []) assetById.set(a.id, a);
for (const a of wikiAssets.assets || []) assetById.set(a.id, a);

// index: node_id → list of asset_ids bound to it (preserve order)
const assetsByNode = new Map();
for (const b of binding.bindings) {
  if (!b.node_id) continue;
  if (!assetsByNode.has(b.node_id)) assetsByNode.set(b.node_id, []);
  assetsByNode.get(b.node_id).push(b.asset_id);
}

// Track which assets we've already shown AND which nodes have ever been
// covered by an on-screen asset. We prefer clips that introduce a never-
// before-covered node over clips whose endpoint already got its turn.
const shown = new Set();
const coveredNodes = new Set();

// Pre-compute: for every node within the max-seconds window, the index of
// its LAST clip appearance. That's the node's last chance to be covered —
// we give it priority at that clip so a poorly-positioned node (e.g.
// always edge.from) still gets its asset shown somewhere.
const lastChanceClip = new Map();  // node_id → last clip index within window
const _n = Math.min(graph.edges.length, durations.length);
for (let i = 0; i < _n; i++) {
  if (durations[i].start >= maxSeconds) break;
  const e = graph.edges[i];
  if (e.from) lastChanceClip.set(e.from, i);
  if (e.to)   lastChanceClip.set(e.to,   i);
}

const entries = [];
const n = Math.min(graph.edges.length, durations.length);
for (let i = 0; i < n; i++) {
  const edge = graph.edges[i];
  const d = durations[i];
  const start = d.start;
  const end   = d.start + d.duration;
  if (start >= maxSeconds) break;
  const clippedEnd = Math.min(end, maxSeconds);

  // Candidate endpoints ranked by:
  //  (1) this is the node's LAST chance to be covered in the window AND it
  //      still has a fresh asset — highest priority
  //  (2) node not yet covered (any endpoint)
  //  (3) node already covered (fallback / repeat)
  //
  // When both endpoints are last-chance, prefer edge.from: sources tend to
  // lose to targets in the normal rank (we walk edge.to first everywhere
  // else), so this is their one chance.
  const endpoints = [edge.to, edge.from].filter(Boolean);
  const lastChanceHereRaw = endpoints.filter(nid =>
    !coveredNodes.has(nid) && lastChanceClip.get(nid) === i
  );
  const lastChanceHere = lastChanceHereRaw.length === 2
    ? [edge.from, edge.to].filter(n => lastChanceHereRaw.includes(n))
    : lastChanceHereRaw;
  const uncovered = endpoints.filter(nid =>
    !coveredNodes.has(nid) && !lastChanceHere.includes(nid)
  );
  const covered   = endpoints.filter(nid => coveredNodes.has(nid));
  const rankedEndpoints = [...lastChanceHere, ...uncovered, ...covered];

  let pickedAssetId = null;
  let pickedNode = null;
  for (const nid of rankedEndpoints) {
    const list = assetsByNode.get(nid) || [];
    for (const aid of list) {
      if (shown.has(aid)) continue;
      pickedAssetId = aid;
      pickedNode = nid;
      break;
    }
    if (pickedAssetId) break;
  }
  // Fallback: any asset bound to any endpoint (repeat-show is better
  // than a blank slot).
  if (!pickedAssetId) {
    for (const nid of endpoints) {
      const list = assetsByNode.get(nid) || [];
      if (list.length) { pickedAssetId = list[0]; pickedNode = nid; break; }
    }
  }
  if (!pickedAssetId) continue;

  const asset = assetById.get(pickedAssetId);
  if (!asset) continue;
  shown.add(pickedAssetId);
  if (pickedNode) coveredNodes.add(pickedNode);

  const pngAbs = path.isAbsolute(asset.png) ? asset.png : path.join(assetsDir, asset.png);
  entries.push({
    start: Number(start.toFixed(3)),
    end: Number(clippedEnd.toFixed(3)),
    png: pngAbs,
    kind: asset.kind,
    caption: asset.caption,
    node_id: pickedNode,
    asset_id: pickedAssetId,
  });
}

// ── Consolidate consecutive runs of the same asset ──
// If the same image would appear N times in a row with no other image in
// between, merge the run into a single entry that spans from the LAST
// entry's start to its end. This avoids the visual stutter of the same
// picture disappearing and reappearing, and keeps the screen clean until
// that image is actually needed.
const consolidated = [];
let runStart = 0;
while (runStart < entries.length) {
  let runEnd = runStart;
  // Extend while next entry has the same asset_id
  while (runEnd + 1 < entries.length &&
         entries[runEnd + 1].asset_id === entries[runStart].asset_id) {
    runEnd++;
  }
  if (runStart === runEnd) {
    // No run — keep as-is
    consolidated.push(entries[runStart]);
  } else {
    // Merge: use the last entry's start→end (show only once, at the last slot)
    const last = entries[runEnd];
    consolidated.push({
      ...last,
      start: last.start,
      end: last.end,
    });
  }
  runStart = runEnd + 1;
}

const removed = entries.length - consolidated.length;
if (removed > 0) {
  console.log(`[timeline] consolidated ${entries.length} → ${consolidated.length} entries (removed ${removed} consecutive duplicates)`);
}

await writeFile(outPath, JSON.stringify({ entries: consolidated, max_seconds: maxSeconds }, null, 2));
console.log(`[timeline] ${consolidated.length} entries across ${maxSeconds}s → ${outPath}`);

// ── Sync verification: show what narration plays alongside each overlay image ──
const subtitles = graph.subtitles || [];
console.log(`\n[sync-audit] Overlay image vs narration alignment:`);
for (const e of consolidated) {
  // Find which edge(s) this overlay spans
  const edgesInWindow = [];
  for (let i = 0; i < durations.length; i++) {
    const ds = durations[i].start;
    const de = ds + durations[i].duration;
    if (de > e.start && ds < e.end) {
      edgesInWindow.push({ idx: i, edge: graph.edges[i], sub: subtitles[i] || '' });
    }
  }
  const narSnippet = edgesInWindow.map(ew =>
    `[${ew.idx}] "${(ew.sub || '').substring(0, 60)}..."`
  ).join(' | ');
  const imageDesc = e.caption || e.asset_id;
  console.log(`  ${e.start.toFixed(1)}→${e.end.toFixed(1)}s  IMAGE: ${imageDesc}`);
  console.log(`    NARRATING: ${narSnippet}`);
  // Flag potential mismatch: image node not mentioned in narration
  const nodeLabel = graph.nodes.find(n => n.id === e.node_id)?.label || e.node_id;
  const narText = edgesInWindow.map(ew => ew.sub).join(' ').toLowerCase();
  const labelWords = nodeLabel.toLowerCase().split(/[\s_]+/).filter(w => w.length > 3);
  const overlap = labelWords.filter(w => narText.includes(w));
  if (overlap.length === 0) {
    console.log(`    ⚠ MISMATCH: image for "${nodeLabel}" but narration doesn't mention it`);
  }
}
