#!/usr/bin/env node
/**
 * post-process-narration.mjs <basename> [--voice technical|non_technical|auto]
 *
 * Apply all narration quality fixes to a completed Steps 1-6 workspace:
 *   1. Node deduplication (merge nodes with identical labels, remove self-edges)
 *   2. Pronoun substitution for consecutive same-subject edges
 *   3. Abbreviation rotation (GenAI, AI, ML, LLM, PCG, ...) per pipeline-config.json
 *   4. Regenerate affected audio clips via Kokoro TTS using the selected voice
 *   5. Append 0.4s silence to every audio clip for natural sentence gaps
 *   6. Recompute durations.json and rebuild narration.wav
 *
 * Voice selection:
 *   --voice technical       → uses voices.technical from config (bf_lily)
 *   --voice non_technical   → uses voices.non_technical from config (af_river, slow)
 *   --voice auto            → classify by keyword matching on article title (default)
 *   --voice <name>          → use that Kokoro voice verbatim at speed 1.0
 *
 * Config is loaded from tools/pipeline-config.json.
 *
 * This script is fully self-contained apart from: Kokoro in .venv-kokoro and
 * the workspace at /tmp/textvis_run_<basename>/.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT = dirname(__dirname);  // tools/ → project root

const args = process.argv.slice(2);
const basename = args[0];
if (!basename) {
  console.error('usage: post-process-narration.mjs <basename> [--voice technical|non_technical|auto|<name>]');
  process.exit(2);
}
const voiceArg = (() => {
  const i = args.indexOf('--voice');
  return i >= 0 ? args[i + 1] : 'auto';
})();

const WORK = `/tmp/textvis_run_${basename}`;
const graphPath = `${WORK}/graph_data.json`;
const durationsPath = `${WORK}/audio_clips/durations.json`;
const audioDir = `${WORK}/audio_clips`;
const configPath = `${PROJECT}/tools/pipeline-config.json`;

if (!existsSync(graphPath)) {
  console.error(`No graph_data.json for ${basename}`);
  process.exit(2);
}
if (!existsSync(configPath)) {
  console.error(`No config at ${configPath}`);
  process.exit(2);
}

const config = JSON.parse(readFileSync(configPath, 'utf-8'));

// ═══════════════════════════════════════════════════
// Voice selection
// ═══════════════════════════════════════════════════
function classifyDomain(basename) {
  const lower = basename.toLowerCase().replace(/_/g, ' ');
  const kws = config.voice_classifier.technical_keywords || [];
  for (const kw of kws) {
    if (lower.includes(kw.toLowerCase())) return 'technical';
  }
  return 'non_technical';
}

let voiceSetting;
if (voiceArg === 'auto') {
  const domain = classifyDomain(basename);
  voiceSetting = config.voices[domain];
  console.log(`  [voice] auto-classified as "${domain}" → ${voiceSetting.name} @ speed ${voiceSetting.speed}`);
} else if (voiceArg === 'technical' || voiceArg === 'non_technical') {
  voiceSetting = config.voices[voiceArg];
  console.log(`  [voice] forced "${voiceArg}" → ${voiceSetting.name} @ speed ${voiceSetting.speed}`);
} else {
  voiceSetting = { name: voiceArg, speed: 1.0, lang: 'en-us' };
  console.log(`  [voice] custom → ${voiceSetting.name} @ speed 1.0`);
}

const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));

// ═══════════════════════════════════════════════════
// STEP 1: Node deduplication
// ═══════════════════════════════════════════════════
const labelToCanonical = new Map();
const idRemap = new Map();
for (const n of graph.nodes) {
  const key = (n.label || n.id).toLowerCase().trim();
  if (labelToCanonical.has(key)) idRemap.set(n.id, labelToCanonical.get(key));
  else labelToCanonical.set(key, n.id);
}

const origNodes = graph.nodes.length;
graph.nodes = graph.nodes.filter(n => !idRemap.has(n.id));

for (const e of graph.edges) {
  if (idRemap.has(e.from)) e.from = idRemap.get(e.from);
  if (idRemap.has(e.to)) e.to = idRemap.get(e.to);
}

const origEdgeCount = graph.edges.length;
const newEdges = [];
const newSubs = [];
const edgeIdxMap = []; // old → new or null
const oldSubs = graph.subtitles || [];
for (let i = 0; i < graph.edges.length; i++) {
  const e = graph.edges[i];
  if (e.from === e.to) {
    edgeIdxMap.push(null);
  } else {
    edgeIdxMap.push(newEdges.length);
    newEdges.push(e);
    newSubs.push(oldSubs[i] || '');
  }
}
graph.edges = newEdges;
graph.subtitles = newSubs;
console.log(`  [dedup] nodes ${origNodes}→${graph.nodes.length}, self-edges removed: ${origEdgeCount - newEdges.length}`);

const nodeLabel = new Map();
for (const n of graph.nodes) nodeLabel.set(n.id, n.label || n.id.replace(/_/g, ' '));

// ═══════════════════════════════════════════════════
// STEP 2: Pronoun substitution for same-subject runs
// ═══════════════════════════════════════════════════
const { connectors } = config.narration;
function rewriteForPronoun(sub, position, subjectLabel) {
  let s = sub.trim();
  const lower = s.toLowerCase();
  const subjLower = subjectLabel.toLowerCase();
  let connector;
  if (position === 'last') connector = connectors.last_in_run || 'And';
  else connector = connectors.middle || 'It also';

  // GUARD 1: If the sentence already starts with a pronoun connector (from a
  // previous pass), don't add another one. Just keep it as-is.
  if (/^(it also|it|and|also,? it|additionally,? it|furthermore,? it)\b/i.test(s)) {
    return s;
  }

  // GUARD 2: If it starts with the subject, strip it and use connector
  const subjIdx = lower.indexOf(subjLower);
  if (subjIdx >= 0 && subjIdx < 20) {
    const after = s.substring(subjIdx + subjectLabel.length).trimStart();
    // Strip leading punctuation like comma
    const cleaned = after.replace(/^[,;:]\s*/, '');
    return `${connector} ${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}`;
  }

  // GUARD 3: If it doesn't start with subject, prefix with connector
  // but lowercase the first letter
  return `${connector} ${s.charAt(0).toLowerCase()}${s.slice(1)}`;
}

const modifiedIdxs = new Set();
let runStart = 0;
while (runStart < graph.edges.length) {
  let runEnd = runStart + 1;
  while (runEnd < graph.edges.length && graph.edges[runEnd].from === graph.edges[runStart].from) runEnd++;
  const runLen = runEnd - runStart;
  if (runLen >= 2) {
    const subjLabel = nodeLabel.get(graph.edges[runStart].from) || graph.edges[runStart].from.replace(/_/g, ' ');
    for (let k = runStart + 1; k < runEnd; k++) {
      const position = (k === runEnd - 1 && runLen > 2) ? 'last' : 'middle';
      const newSub = rewriteForPronoun(graph.subtitles[k], position, subjLabel);
      if (newSub !== graph.subtitles[k]) {
        graph.subtitles[k] = newSub;
        modifiedIdxs.add(k);
      }
    }
  }
  runStart = runEnd;
}
console.log(`  [pronouns] ${modifiedIdxs.size} edges rewritten`);

// ═══════════════════════════════════════════════════
// STEP 3: Abbreviation rotation
// ═══════════════════════════════════════════════════
const occurCount = new Map();
for (let i = 0; i < graph.subtitles.length; i++) {
  let text = graph.subtitles[i];
  if (!text) continue;
  let changed = false;
  for (const { pattern, abbrev } of config.abbreviations.pairs) {
    const re = new RegExp(`\\b${pattern.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi');
    text = text.replace(re, (match) => {
      const key = match.toLowerCase();
      const c = (occurCount.get(key) || 0) + 1;
      occurCount.set(key, c);
      if (c === 1) return match; // introduce full form first time
      return abbrev;
    });
    if (text !== graph.subtitles[i]) changed = true;
  }
  if (text !== graph.subtitles[i]) {
    graph.subtitles[i] = text;
    modifiedIdxs.add(i);
  }
}
console.log(`  [abbrev] total modified (pronouns+abbrev): ${modifiedIdxs.size}`);

// FINAL PASS: clean up double-pronouns and stray duplications
for (let i = 0; i < graph.subtitles.length; i++) {
  let t = graph.subtitles[i];
  if (!t) continue;
  // Collapse "It also it also", "It it", "And and", "Also also" etc.
  t = t.replace(/\b(it also)(\s+it\s+also)+/gi, '$1');
  t = t.replace(/\b(it)(\s+it)+\b/gi, '$1');
  t = t.replace(/\b(and)(\s+and)+\b/gi, '$1');
  t = t.replace(/\b(also)(\s+also)+\b/gi, '$1');
  t = t.replace(/\b(it also)\s+(and)\b/gi, '$2');
  t = t.replace(/\s+/g, ' ').trim();
  if (t !== graph.subtitles[i]) {
    graph.subtitles[i] = t;
    modifiedIdxs.add(i);
  }
}

writeFileSync(graphPath, JSON.stringify(graph, null, 2));

// ═══════════════════════════════════════════════════
// STEP 4: Regenerate ALL audio clips (voice may have changed)
// ═══════════════════════════════════════════════════
// Because the user wants a clean voice switch, regenerate ALL clips with the
// selected voice — not just the modified subtitles. This is faster than mixing
// voices and keeps the audio perfectly consistent.
console.log(`  [tts] regenerating all ${graph.subtitles.length} clips with ${voiceSetting.name} @ ${voiceSetting.speed}...`);

// Use a single persistent Kokoro Python process via stdin JSON
const pyScript = `
import sys, os, json
sys.path.insert(0, '${PROJECT}/.venv-kokoro/lib/python3.12/site-packages')
from kokoro_onnx import Kokoro
import soundfile as sf
import numpy as np

k = Kokoro('${PROJECT}/.kokoro-models/kokoro-v1.0.onnx', '${PROJECT}/.kokoro-models/voices-v1.0.bin')
voice = ${JSON.stringify(voiceSetting.name)}
speed = ${voiceSetting.speed}
lang = ${JSON.stringify(voiceSetting.lang || 'en-us')}
gap = ${config.audio.sentence_gap_seconds}

requests = json.load(sys.stdin)
for req in requests:
    idx = req['idx']
    text = req['text']
    out = req['path']
    try:
        samples, rate = k.create(text, voice=voice, speed=speed, lang=lang)
        # Append silence gap
        silence = np.zeros(int(rate * gap), dtype=samples.dtype)
        padded = np.concatenate([samples, silence])
        sf.write(out, padded, rate, format='WAV', subtype='PCM_16')
        print(f'{idx} {len(padded)/float(rate)}', flush=True)
    except Exception as e:
        print(f'{idx} ERROR {e}', flush=True)
`;

const requests = [];
for (let idx = 0; idx < graph.subtitles.length; idx++) {
  const text = (graph.subtitles[idx] || '').trim();
  if (!text) continue;
  requests.push({
    idx,
    text,
    path: `${audioDir}/edge_${String(idx).padStart(3, '0')}.wav`,
  });
}

// Write requests to temp file and pipe via stdin
const requestsJson = JSON.stringify(requests);
const ttsResult = spawnSync(
  `${PROJECT}/.venv-kokoro/bin/python`,
  ['-c', pyScript],
  { input: requestsJson, encoding: 'utf-8', maxBuffer: 128 * 1024 * 1024 }
);
if (ttsResult.status !== 0) {
  console.error(`TTS failed: ${ttsResult.stderr?.substring(0, 500)}`);
  process.exit(1);
}

// Parse per-clip durations from stdout
const newDurMap = new Map();
for (const line of (ttsResult.stdout || '').split('\n')) {
  const parts = line.trim().split(' ');
  if (parts.length >= 2) {
    const idx = parseInt(parts[0], 10);
    const dur = parseFloat(parts[1]);
    if (isFinite(idx) && isFinite(dur)) newDurMap.set(idx, dur);
  }
}

// ═══════════════════════════════════════════════════
// STEP 5: Rebuild durations.json with new timings
// ═══════════════════════════════════════════════════
const newDurations = [];
let cum = 0;
for (let i = 0; i < graph.subtitles.length; i++) {
  const dur = newDurMap.get(i) || 2.0;
  newDurations.push({
    clip: `edge_${String(i).padStart(3, '0')}.wav`,
    start: cum,
    duration: dur,
  });
  cum += dur;
}
writeFileSync(durationsPath, JSON.stringify(newDurations, null, 2));
console.log(`  [durations] ${newDurations.length} entries, total ${cum.toFixed(1)}s`);

// ═══════════════════════════════════════════════════
// FLEXIBLE STORE: lecture_state.json — the single source of truth
// for all per-edge data. Modifying one entry and re-running the audio
// rebuild step takes seconds, not hours.
// ═══════════════════════════════════════════════════
const overlayTimelinePath = `${WORK}/overlay_assets/overlay_timeline.json`;
const overlayMap = new Map();  // edge time → asset
if (existsSync(overlayTimelinePath)) {
  try {
    const ot = JSON.parse(readFileSync(overlayTimelinePath, 'utf-8'));
    for (const entry of ot.entries || []) {
      overlayMap.set(Number(entry.start.toFixed(2)), entry);
    }
  } catch {}
}

const lectureState = {
  basename,
  generated_at: new Date().toISOString(),
  voice: {
    name: voiceSetting.name,
    speed: voiceSetting.speed,
    lang: voiceSetting.lang || 'en-us',
  },
  audio: {
    sentence_gap_seconds: config.audio.sentence_gap_seconds,
    total_duration: cum,
  },
  edges: [],
};

for (let i = 0; i < graph.edges.length; i++) {
  const e = graph.edges[i];
  const d = newDurations[i] || {};
  const overlay = overlayMap.get(Number(d.start.toFixed(2)));
  lectureState.edges.push({
    index: i,
    from: e.from,
    from_label: nodeLabel.get(e.from) || e.from,
    to: e.to,
    to_label: nodeLabel.get(e.to) || e.to,
    verb: e.verb || null,
    subtitle: graph.subtitles[i] || '',
    audio_clip: `audio_clips/edge_${String(i).padStart(3, '0')}.wav`,
    audio_start: d.start,
    audio_duration: d.duration,
    image: overlay ? {
      png: overlay.png,
      caption: overlay.caption,
      kind: overlay.kind,
    } : null,
  });
}

const lectureStatePath = `${WORK}/lecture_state.json`;
writeFileSync(lectureStatePath, JSON.stringify(lectureState, null, 2));
console.log(`  [lecture_state] ${lectureStatePath} (${lectureState.edges.length} edges)`);

// ═══════════════════════════════════════════════════
// STEP 6: Rebuild narration.wav via ffmpeg concat
// ═══════════════════════════════════════════════════
const edgeWavs = newDurations.map(d => `${audioDir}/${d.clip}`).filter(existsSync);
if (edgeWavs.length > 0) {
  const listFile = `${audioDir}/concat_list.txt`;
  writeFileSync(listFile, edgeWavs.map(p => `file '${p}'`).join('\n'));
  const ffmpegBin = `${PROJECT}/.venv-kokoro/lib/python3.12/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2`;
  try {
    execSync(`"${ffmpegBin}" -y -f concat -safe 0 -i "${listFile}" -c copy "${audioDir}/narration.wav"`, { stdio: 'pipe' });
    console.log(`  [narration.wav] rebuilt (${edgeWavs.length} clips, ${cum.toFixed(1)}s)`);
  } catch (e) {
    console.warn(`  narration concat failed: ${e.message?.substring(0, 100)}`);
  }
  try { unlinkSync(listFile); } catch {}
}

console.log(`[${basename}] post-process-narration.mjs complete.`);
