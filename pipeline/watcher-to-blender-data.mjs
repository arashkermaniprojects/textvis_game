#!/usr/bin/env node
/**
 * Bridge: extract graph + audio from a compiled watcher HTML into the schema
 * that the renderers expect (see docs/blender_animated.py.reference).
 *
 * Inputs : data/<name>_watcher.html  (produced by agents/article-watcher-v2.mjs)
 * Outputs: godot-viz/graph_data.json
 *          godot-viz/audio_clips/narration.wav     (concatenated WAV)
 *          godot-viz/audio_clips/durations.json    (per-edge start/duration)
 *          godot-viz/audio_clips/edge_NNN.wav      (individual clips, debug)
 *
 * Flags:
 *   --input <html>            Path to watcher HTML (required)
 *   --max-seconds <n>         Truncate to first edges fitting within N seconds
 *   --godot-dir <dir>         Override godot-viz directory (default: ./godot-viz)
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = { input: null, maxSeconds: null, godotDir: 'godot-viz', minSeconds: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input' && argv[i+1])        { out.input = argv[++i]; }
    else if (a === '--max-seconds' && argv[i+1]) { out.maxSeconds = parseFloat(argv[++i]); }
    else if (a === '--min-seconds' && argv[i+1]) { out.minSeconds = parseFloat(argv[++i]); }
    else if (a === '--godot-dir' && argv[i+1])   { out.godotDir = argv[++i]; }
  }
  if (!out.input) { console.error('--input <html> required'); process.exit(2); }
  return out;
}

// Pad a parsed WAV with trailing silence (PCM16) so its duration is at least
// minSec seconds. Mutates by returning a new object. The original WAV bytes
// are kept by callers that still need them; this builds a new buffer.
function padWavWithSilence(w, minSec) {
  const curDur = wavDurationSec(w);
  if (curDur >= minSec) return w;
  const silenceSec = minSec - curDur;
  const bytesPerSample = w.bitsPerSample / 8;
  const silenceSamples = Math.round(silenceSec * w.sampleRate);
  const silenceBytes = silenceSamples * w.numChannels * bytesPerSample;
  const silence = Buffer.alloc(silenceBytes); // zero-filled
  const newData = Buffer.concat([w.data, silence]);
  return {
    audioFormat:   w.audioFormat,
    numChannels:   w.numChannels,
    sampleRate:    w.sampleRate,
    bitsPerSample: w.bitsPerSample,
    data:          newData,
  };
}

// ── JS-literal extractor: pull `var NAME = <json>;` from the HTML text ──
function extractJsVar(html, name) {
  const marker = `var ${name} = `;
  const start = html.indexOf(marker);
  if (start < 0) throw new Error(`could not find "${marker}" in HTML`);
  const jsonStart = start + marker.length;
  // Walk the string tracking bracket/brace depth and string literals
  let depth = 0, inStr = false, strCh = null, esc = false;
  for (let i = jsonStart; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc)       { esc = false; continue; }
      if (c === '\\'){ esc = true;  continue; }
      if (c === strCh) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        const raw = html.slice(jsonStart, i + 1);
        return JSON.parse(raw);
      }
    }
  }
  throw new Error(`unterminated literal for var ${name}`);
}

// ── Tiny WAV concatenator: stdlib-only, PCM16 mono assumed ──
// Parses RIFF header, extracts fmt + data chunk, writes one output WAV.
function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('not a WAV file');
  let off = 12;
  let fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = buf.slice(off + 8, off + 8 + size);
    if (id === 'fmt ') fmt = body;
    else if (id === 'data') data = body;
    off += 8 + size + (size & 1); // pad to even
  }
  if (!fmt || !data) throw new Error('WAV missing fmt or data chunk');
  const audioFormat   = fmt.readUInt16LE(0);
  const numChannels   = fmt.readUInt16LE(2);
  const sampleRate    = fmt.readUInt32LE(4);
  const bitsPerSample = fmt.readUInt16LE(14);
  return { audioFormat, numChannels, sampleRate, bitsPerSample, data };
}

function buildWav({ numChannels, sampleRate, bitsPerSample, data }) {
  const byteRate   = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const fmtChunk = Buffer.alloc(24);
  fmtChunk.write('fmt ', 0, 'ascii');
  fmtChunk.writeUInt32LE(16, 4);            // chunk size
  fmtChunk.writeUInt16LE(1, 8);             // PCM
  fmtChunk.writeUInt16LE(numChannels, 10);
  fmtChunk.writeUInt32LE(sampleRate, 12);
  fmtChunk.writeUInt32LE(byteRate, 16);
  fmtChunk.writeUInt16LE(blockAlign, 20);
  fmtChunk.writeUInt16LE(bitsPerSample, 22);
  const dataHdr = Buffer.alloc(8);
  dataHdr.write('data', 0, 'ascii');
  dataHdr.writeUInt32LE(data.length, 4);
  const riffSize = 4 + fmtChunk.length + dataHdr.length + data.length;
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(riffSize, 4);
  header.write('WAVE', 8, 'ascii');
  return Buffer.concat([header, fmtChunk, dataHdr, data]);
}

function concatWavs(wavs) {
  if (wavs.length === 0) throw new Error('no wavs to concat');
  const ref = wavs[0];
  const dataParts = [];
  for (const w of wavs) {
    if (w.sampleRate !== ref.sampleRate || w.numChannels !== ref.numChannels || w.bitsPerSample !== ref.bitsPerSample)
      throw new Error(`WAV format mismatch: ${JSON.stringify(w)} vs ${JSON.stringify(ref)}`);
    dataParts.push(w.data);
  }
  return buildWav({
    numChannels: ref.numChannels,
    sampleRate:  ref.sampleRate,
    bitsPerSample: ref.bitsPerSample,
    data: Buffer.concat(dataParts),
  });
}

function wavDurationSec(w) {
  const bytesPerSample = w.bitsPerSample / 8;
  const totalSamples = w.data.length / (w.numChannels * bytesPerSample);
  return totalSamples / w.sampleRate;
}

// ── Graph translation: watcher schema → godot-viz schema ──
function buildGraphData({ nodes, edges, hierarchy, subtitles }) {
  // Watcher `graphNodes` entries: { id, label, visual, type }
  // Godot-viz  `nodes` entries:    { id, label, type, x, y, cluster }
  const gvNodes = nodes.map((n, i) => ({
    id: n.id,
    label: n.label || n.id,
    type: n.type || n.nodeType || 'default',
    x: 0, y: 0,           // layout is decided by blender_animated.py
    cluster: 0,           // filled below
  }));

  // Watcher edges: { from, to, verb, time, edgeId, ... }
  // Godot-viz edges: { from, to, verb, time, cluster }
  const gvEdges = edges.map(e => ({
    from: e.from,
    to: e.to,
    verb: e.verb || e.label || 'relates to',
    time: e.time || 0,
    cluster: 0,
  }));

  // Hierarchy is already a tree of { id, label, children }; pass through.
  const gvHierarchy = Array.isArray(hierarchy) ? hierarchy : [];

  // Assign cluster ids from hierarchy order
  const clusterOf = {};
  gvHierarchy.forEach((cont, ci) => {
    clusterOf[cont.id] = ci;
    for (const ch of (cont.children || [])) {
      clusterOf[ch.id] = ci;
      for (const gc of (ch.children || [])) clusterOf[gc.id] = ci;
    }
  });
  for (const n of gvNodes) {
    if (clusterOf[n.id] !== undefined) n.cluster = clusterOf[n.id];
  }
  for (const e of gvEdges) {
    e.cluster = clusterOf[e.from] ?? clusterOf[e.to] ?? 0;
  }

  return { nodes: gvNodes, edges: gvEdges, hierarchy: gvHierarchy, subtitles };
}

// ── Main ──
const cli = parseArgs(process.argv.slice(2));
const html = fs.readFileSync(cli.input, 'utf8');

const graphNodes = extractJsVar(html, 'graphNodes');   // nodeList
const graphEdges = extractJsVar(html, 'graphEdges');   // finalEdges
const graphSubs  = extractJsVar(html, 'graphSubs');    // [{time, cmd, text}]
let   hierarchy  = [];
try { hierarchy = extractJsVar(html, 'precomputedHierarchy') || []; } catch {}
const sceneEpisodes = (() => { try { return extractJsVar(html, 'sceneEpisodes'); } catch { return []; } })();

// The watcher embeds per-edge audio as <audio id="ea-N"><source src="data:audio/wav;base64,..."></audio>
const audioRe = /<audio id="ea-(\d+)"[^>]*>\s*<source[^>]*src="data:audio\/(wav|mpeg|wave|x-wav);base64,([^"]+)"/g;
const audioMap = new Map();
let m;
while ((m = audioRe.exec(html)) !== null) {
  audioMap.set(parseInt(m[1], 10), Buffer.from(m[3], 'base64'));
}
const audioCount = audioMap.size;
if (audioCount === 0) {
  console.error('No per-edge audio found in HTML (looked for <audio id="ea-N"...>)');
  process.exit(2);
}
console.log(`Parsed: ${graphNodes.length} nodes, ${graphEdges.length} edges, ${graphSubs.length} subtitles, ${audioCount} audio clips`);

// Parse WAVs in index order. If --min-seconds is set, pad each clip with
// trailing silence so the per-edge screen time has a minimum floor.
const wavs = [];
let totalDur = 0;
let paddedCount = 0;
for (let i = 0; i < audioCount; i++) {
  const buf = audioMap.get(i);
  if (!buf) throw new Error(`missing audio ea-${i}`);
  let w = parseWav(buf);
  if (cli.minSeconds && cli.minSeconds > 0) {
    const before = wavDurationSec(w);
    if (before < cli.minSeconds) {
      w = padWavWithSilence(w, cli.minSeconds);
      paddedCount++;
    }
  }
  // Re-emit WAV bytes (with any silence padding) for the per-clip file output
  w._buf = buildWav(w);
  w._dur = wavDurationSec(w);
  wavs.push(w);
  totalDur += w._dur;
}
if (paddedCount) console.log(`Padded ${paddedCount}/${audioCount} clips to ≥ ${cli.minSeconds}s with trailing silence`);
console.log(`Total audio: ${totalDur.toFixed(2)}s`);

// Truncate by --max-seconds
let useN = audioCount;
if (cli.maxSeconds && cli.maxSeconds > 0) {
  let running = 0;
  useN = 0;
  for (const w of wavs) {
    if (running + w._dur > cli.maxSeconds) break;
    running += w._dur;
    useN++;
  }
  if (useN === 0) useN = 1; // always keep at least one
  console.log(`Truncating to first ${useN} clips (${running.toFixed(2)}s) to fit --max-seconds=${cli.maxSeconds}`);
}
const useWavs  = wavs.slice(0, useN);
const useEdges = graphEdges.slice(0, useN);
const useSubs  = graphSubs.slice(0, useN).map(s => (typeof s === 'string' ? s : s.text));

// Keep only nodes that participate in the kept edges
const keepNodeIds = new Set();
for (const e of useEdges) { keepNodeIds.add(e.from); keepNodeIds.add(e.to); }
const useNodes = graphNodes.filter(n => keepNodeIds.has(n.id));

// Compute durations + concat audio
const durations = [];
let start = 0;
for (let i = 0; i < useWavs.length; i++) {
  const d = useWavs[i]._dur;
  durations.push({ clip: `edge_${String(i).padStart(3,'0')}.wav`, duration: d, start });
  start += d;
}
const concatWav = concatWavs(useWavs);

// ── Write outputs ──
const godotDir   = path.resolve(cli.godotDir);
const audioDir   = path.join(godotDir, 'audio_clips');
fs.mkdirSync(audioDir, { recursive: true });

const gd = buildGraphData({
  nodes: useNodes,
  edges: useEdges,
  hierarchy,
  subtitles: useSubs,
});
fs.writeFileSync(path.join(godotDir, 'graph_data.json'), JSON.stringify(gd, null, 2));
fs.writeFileSync(path.join(audioDir, 'durations.json'), JSON.stringify(durations));
fs.writeFileSync(path.join(audioDir, 'narration.wav'), concatWav);
// individual clips (for debug / fallback)
for (let i = 0; i < useWavs.length; i++) {
  const name = `edge_${String(i).padStart(3,'0')}.wav`;
  fs.writeFileSync(path.join(audioDir, name), useWavs[i]._buf);
}

console.log(`Wrote:
  ${path.join(godotDir, 'graph_data.json')}   (${gd.nodes.length} nodes, ${gd.edges.length} edges, ${gd.hierarchy.length} clusters)
  ${path.join(audioDir, 'narration.wav')}    (${(concatWav.length/1024).toFixed(0)} KB)
  ${path.join(audioDir, 'durations.json')}   (${durations.length} entries, total ${start.toFixed(2)}s)
  ${useWavs.length} edge_NNN.wav clips`);

// ── Render per-node SVG visuals to png_icons/ so the Blender script's
//    primitive_plane_add(textured) path renders proper shapes instead of
//    falling back to plain spheres. ──
const svgsById = {};
for (const n of useNodes) {
  if (n.visual && typeof n.visual === 'string' && n.visual.includes('<svg')) {
    svgsById[n.id] = n.visual;
  }
}
const svgCount = Object.keys(svgsById).length;
if (svgCount === 0) {
  console.log('No SVG visuals found in graphNodes — Blender will use sphere fallbacks.');
} else {
  const iconsDir = path.join(godotDir, 'png_icons');
  fs.mkdirSync(iconsDir, { recursive: true });
  // Wipe ONLY the icons we are about to overwrite (preserve any pre-existing
  // icons keyed to other ids — they're harmless and may help debugging).
  for (const id of Object.keys(svgsById)) {
    const p = path.join(iconsDir, `${id}.png`);
    if (fs.existsSync(p)) try { fs.unlinkSync(p); } catch {}
  }
  const tmpJson = path.join(godotDir, '_svgs_input.json');
  fs.writeFileSync(tmpJson, JSON.stringify(svgsById));
  const py = path.join(PROJECT_DIR, '.venv-kokoro/bin/python');
  // The helper script sits alongside this file in pipeline/; fall back to tools/.
  let script = path.join(PROJECT_DIR, 'pipeline/svgs-to-pngs.py');
  if (!fs.existsSync(script)) {
    script = path.join(PROJECT_DIR, 'tools/svgs-to-pngs.py');
  }
  if (!fs.existsSync(py)) {
    console.warn(`  cairosvg python venv missing at ${py} — skipping icon render`);
  } else {
    const result = spawnSync(py, [script, tmpJson, iconsDir], { stdio: 'inherit' });
    if (result.status !== 0) {
      console.warn('  svgs-to-pngs.py failed — Blender will use sphere fallbacks');
    }
  }
  try { fs.unlinkSync(tmpJson); } catch {}
}
