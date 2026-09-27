/**
 * Streaming Visual Translator
 *
 * Every sentence the speaker says is translated to visual commands in real-time.
 * Objects appear, glow, fade, and make room as narration progresses.
 *
 * Architecture:
 *   1. Split narration into sentences
 *   2. For each sentence, generate a visual COMMAND (add, highlight, fade, connect, replace)
 *   3. Commands have timestamps synced to audio
 *   4. Player executes commands progressively — the scene BUILDS UP
 *
 * Command types:
 *   { time: 0.0, cmd: "add",       id: "enc",  node: { type: "box", label: "Encoder", icon: "⚙️" }, x: 400, y: 250 }
 *   { time: 3.5, cmd: "highlight",  id: "enc",  color: "#FFB74D" }
 *   { time: 7.0, cmd: "connect",    from: "enc", to: "dec", label: "context" }
 *   { time: 10.0, cmd: "fade",      id: "enc",  opacity: 0.3 }
 *   { time: 12.0, cmd: "remove",    id: "enc" }
 *   { time: 14.0, cmd: "label",     id: "dec",  text: "Generates output" }
 *   { time: 16.0, cmd: "move",      id: "dec",  x: 200, y: 300 }
 */

import { parseNarrationToCommands } from './semantic-parser.mjs';
import { getVerbCSS } from './visual-alphabet.mjs';
import { generateText, extractJsonArray } from '../llm/openai-client.mjs';

const C = {
  bg: '#f5f5f0', text: '#333', primary: '#1a6ea0', accent: '#c07800',
  success: '#2a7a35', danger: '#c04040', purple: '#7a3290', muted: '#666'
};
const INACTIVE_PRIMARY = '#1a8fc4';

const WPM = 155; // words per minute for TTS

// ═══════════════════════════════════════
// STEP 1: Split narration into timed sentences
// ═══════════════════════════════════════

function splitIntoTimedSentences(text) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let wordsSoFar = 0;
  return sentences.map(s => {
    const clean = s.trim();
    const wordCount = clean.split(/\s+/).length;
    const startTime = (wordsSoFar / WPM) * 60;
    const duration = (wordCount / WPM) * 60;
    wordsSoFar += wordCount;
    return { text: clean, startTime: Math.round(startTime * 10) / 10, duration: Math.round(duration * 10) / 10, wordCount };
  });
}

// ═══════════════════════════════════════
// STEP 2: Generate visual commands for each sentence
// ═══════════════════════════════════════

export async function generateCommands(narration, context = '', options = {}) {
  const { formulaLatex = null, figureBase64 = null, figureLabel = '' } = options;
  const sentences = splitIntoTimedSentences(narration);

  // Pre-build commands for figures and formulas
  const preCommands = [];

  // If there's a figure, show it first and keep it on screen
  if (figureBase64) {
    preCommands.push({ time: 0, cmd: 'image', id: 'figure', src: figureBase64, label: figureLabel, x: 250, y: 250 });
  }

  // If there's a formula, show it — positioned to avoid the figure
  if (formulaLatex) {
    const formulaX = figureBase64 ? 650 : 400;
    const formulaY = figureBase64 ? 400 : 200;
    preCommands.push({ time: 0.5, cmd: 'add', id: 'formula_main', type: 'formula', tex: formulaLatex, x: formulaX, y: formulaY });
  }

  const raw = await generateText({
    prompt: `You are a visual translator. Convert each sentence into visual commands that build a scene progressively.

NARRATION (${sentences.length} sentences):
${sentences.map((s, i) => `[${s.startTime}s] ${i + 1}. "${s.text}"`).join('\n')}

CONTEXT: ${context}
${figureBase64 ? `NOTE: An original figure from the paper is already shown on the left side of the screen. Your visual objects should appear on the RIGHT side (x: 500-750) to not overlap with it.` : ''}
${formulaLatex ? `NOTE: The formula "${formulaLatex}" is already shown on screen. Reference it with highlight commands, don't re-add it.` : ''}

Generate a JSON array of visual commands.

COMMAND TYPES:
- add: { "time": 0.0, "cmd": "add", "id": "unique_id", "type": "box|circle|icon|text", "label": "text", "icon": "emoji", "x": 400, "y": 250, "color": "#hex", "parent": "optional_parent_id" }
- highlight: { "time": 3.5, "cmd": "highlight", "id": "id", "color": "#FFB74D" }
- dim: { "time": 5.0, "cmd": "dim", "id": "id" }
- connect: { "time": 7.0, "cmd": "connect", "from": "id1", "to": "id2", "label": "text" }
- remove: { "time": 15.0, "cmd": "remove", "id": "id" }
- clear: { "time": 20.0, "cmd": "clear" }  ← removes ALL objects (fresh start)
- subtitle: { "time": 0.0, "cmd": "subtitle", "text": "sentence" }

CRITICAL RULES:
1. HIERARCHY: When a concept CONTAINS sub-concepts, add sub-concepts with "parent" field.
   Example: Add "Attention" first, then add "Q", "K", "V" with parent: "attention"
2. CLEANUP: Before introducing a NEW topic, use "clear" or "remove" to remove ALL objects from the PREVIOUS topic. The screen should only show what's currently being discussed.
3. FOCUS: Only ONE object should be highlighted at a time (the one being discussed). All others should be dimmed or neutral.
4. SPACING: Canvas is 800x500. Space objects: x=100-700, y=80-400. Leave room for subtitle at bottom.
5. MAX 5 objects on screen at once. Remove oldest when adding new ones.
6. Every sentence gets a SUBTITLE command.
7. Icons: ⚙️=encoder 🔓=decoder 👁️=attention 🧠=neural 📥=input 📤=output 📊=data ⚡=fast 🐌=slow 📐=layer ✨=concept

Return ONLY the JSON array.

Return ONLY the JSON array.`
    ,
    maxTokens: 2000
  });
  const llmCommands = extractJsonArray(raw) || [];

  // Merge: pre-commands (figures, formulas) first, then LLM commands
  const allCommands = [...preCommands, ...llmCommands];

  // Fallback: if no commands at all, at least show subtitles
  if (allCommands.length === 0) {
    return sentences.map(s => ({ time: s.startTime, cmd: 'subtitle', text: s.text }));
  }

  return allCommands.sort((a, b) => (a.time || 0) - (b.time || 0));
}

// ═══════════════════════════════════════
// STEP 3: Compile commands into an HTML player
// ═══════════════════════════════════════

export function compileStreamingPlayer(commands, title = '', audioBase64 = null, audioDuration = 0) {
  // ── Check for pre-ordered edges and concept hierarchy (from article-watcher pipeline) ──
  const preOrdered = commands.find(c => c.cmd === '_preordered_edges');
  const preHierarchy = commands.find(c => c.cmd === '_concept_hierarchy');

  const graphNodes = {};  // normalized id → { label, visual, type }
  const graphEdges = [];  // { from, to, verb, verbSvg, time, edgeId, cluster }

  // ── Aggressive normalization + stemming + synonym merging ──
  // Protected domain terms — NEVER stem these
  const protectedTerms = new Set([
    'transformer', 'encoder', 'decoder', 'attention', 'softmax',
    'layer', 'parameter', 'vector', 'tensor', 'matrix', 'filter',
    'computer', 'convolution', 'normalization', 'embedding',
    'recurrence', 'sequence', 'position', 'positional', 'residual',
    'feedforward', 'bottleneck', 'dropout', 'gradient', 'neuron',
    'training', 'inference', 'computation', 'parallelization',
  ]);

  function stem(w) {
    if (protectedTerms.has(w)) return w; // don't stem domain terms
    return w.replace(/ization$/, '').replace(/isation$/, '')
      .replace(/ment$/, '').replace(/ness$/, '').replace(/able$/, '')
      .replace(/ible$/, '').replace(/ive$/, '').replace(/ous$/, '')
      .replace(/ical$/, '').replace(/ally$/, '').replace(/ful$/, '')
      .replace(/ies$/, 'y').replace(/ses$/, '').replace(/s$/, '');
  }

  // Synonyms that should merge to the same node
  const synonymGroups = [
    ['parallel', 'paralleliz', 'simultaneous', 'concurrent'],
    ['sequential', 'serial', 'recurrent', 'recurrence'],
    ['transformer', 'transformer_architecture', 'transformer_model', 'transformer_arch'],
    ['attention', 'attention_mechanism', 'self_attention', 'self-attention', 'multi_head_attention', 'multi_head_self_attention', 'multihead_attention', 'scaled_dot_product_attention', 'masked_attention', 'cross_attention', 'attn', 'self_attn', 'self_attn_mech'],
    ['computation', 'processing', 'calculation', 'computing'],
    ['representation', 'encoding', 'embedding'],
    ['model', 'architecture', 'system', 'framework'],
    ['language', 'linguistic', 'natural_language'],
    ['speed', 'fast', 'efficient', 'efficiency'],
    ['slow', 'inefficient', 'bottleneck'],
    ['training', 'learning', 'optimization'],
    ['layer', 'sublayer', 'sub_layer'],
  ];
  const synonymMap = {};
  for (const group of synonymGroups) {
    const canonical = group[0];
    for (const syn of group) synonymMap[syn] = canonical;
  }

  const semanticStopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'of', 'for', 'to', 'and',
    'or', 'in', 'on', 'with', 'by', 'from', 'at', 'as', 'all', 'you', 'need',
    'paper', 'presentation', 'introduction', 'overview', 'summary', 'result'
  ]);

  function semanticPriority(node) {
    const id = (node?.id || '').toLowerCase();
    const label = (node?.label || '').toLowerCase();
    const text = `${id} ${label}`;
    let score = 1;

    if (/\battention\b|\bself attention\b|\bmulti[-_ ]?head attention\b/.test(text)) score += 2.4;
    if (/\btransformer\b|\bencoder\b|\bdecoder\b/.test(text)) score += 1.2;
    if (/\bquery\b|\bkey\b|\bvalue\b|\bhead\b/.test(text)) score -= 0.45;
    if (node?.type === 'head' || node?.type === 'vector' || node?.type === 'matrix') score -= 0.2;
    if (node?.type === 'attention' || node?.type === 'attention_mechanism' || node?.type === 'self_attention') score += 0.8;

    return Math.max(0.35, score);
  }

  function normalizeId(id) {
    let n = (id || '').toLowerCase().replace(/[-\s_]+/g, '_').replace(/_+$/,'').replace(/^_+/,'');
    // Stem each word
    const words = n.split('_').map(stem).filter(Boolean);
    n = words.join('_');
    // Check synonym map
    if (synonymMap[n]) n = synonymMap[n];
    else {
      const meaningfulWords = words.filter(w => w && !semanticStopWords.has(w));
      if (meaningfulWords.length === 1 && synonymMap[meaningfulWords[0]]) {
        n = synonymMap[meaningfulWords[0]];
      } else if (
        meaningfulWords.length === 2 &&
        meaningfulWords.some(w => w === 'self' || w === 'masked' || w === 'cross' || w === 'multihead') &&
        meaningfulWords.some(w => synonymMap[w])
      ) {
        const keyWord = meaningfulWords.find(w => synonymMap[w]);
        n = synonymMap[keyWord];
      }
    }
    // Remove very short meaningless remnants
    if (n.length < 2) n = (id || 'x').toLowerCase().replace(/[-\s_]+/g, '_');
    return n;
  }

  const nonMergeableIds = new Set([
    'q', 'k', 'v', 'n', 'd', 'dk', 'dv', 'wq', 'wk', 'wv', 'x', 'y', 'z', 'h'
  ]);
  const mergeableSuffixes = new Set(['mechanism', 'module', 'architecture', 'model']);

  function splitIdTokens(id) {
    return (id || '').split('_').filter(Boolean);
  }

  function hasContiguousTokenMatch(shortTokens, longTokens) {
    for (let start = 0; start <= longTokens.length - shortTokens.length; start++) {
      let matches = true;
      for (let offset = 0; offset < shortTokens.length; offset++) {
        if (longTokens[start + offset] !== shortTokens[offset]) {
          matches = false;
          break;
        }
      }
      if (matches) return start;
    }
    return -1;
  }

  function shouldContainMerge(shorter, longer) {
    if (!shorter || !longer || shorter === longer) return false;
    if (shorter.length < 4 || longer.length < 6) return false;
    if (nonMergeableIds.has(shorter) || nonMergeableIds.has(longer)) return false;

    const shortTokens = splitIdTokens(shorter);
    const longTokens = splitIdTokens(longer);
    if (shortTokens.length === 0 || longTokens.length === 0) return false;
    if (shortTokens.some(t => t.length < 2) || longTokens.some(t => t.length < 2)) return false;

    const matchStart = hasContiguousTokenMatch(shortTokens, longTokens);
    if (matchStart < 0) return false;

    // Only merge single-token concepts into narrowly generic expansions like
    // "attention_mechanism". Broader phrases like "attention_output" remain distinct.
    if (shortTokens.length === 1) {
      const extraTokens = longTokens.filter((_, idx) => idx < matchStart || idx >= matchStart + shortTokens.length);
      return extraTokens.length === 1 && mergeableSuffixes.has(extraTokens[0]);
    }

    return true;
  }

  // Second-pass dedup: conservatively merge obvious token-level expansions.
  function mergeContained(nodes) {
    const ids = Object.keys(nodes);
    const mergeMap = {};
    for (let i = 0; i < ids.length; i++) {
      if (mergeMap[ids[i]]) continue;
      for (let j = i + 1; j < ids.length; j++) {
        if (mergeMap[ids[j]]) continue;
        const a = ids[i], b = ids[j];
        const keeper = a.length <= b.length ? a : b;
        const merged = a.length <= b.length ? b : a;
        if (shouldContainMerge(keeper, merged)) {
          mergeMap[merged] = keeper;
        }
      }
    }
    return mergeMap;
  }

  const idMap = {};

  for (const c of commands) {
    if (c.cmd === 'graph_node') {
      const nid = normalizeId(c.id);
      idMap[c.id] = nid;
      if (!graphNodes[nid]) {
        graphNodes[nid] = { id: nid, label: c.label, visual: c.visual, type: c.nodeType || 'default' };
      }
    } else if (c.cmd === 'graph_edge') {
      const fromNid = normalizeId(c.from);
      const toNid = normalizeId(c.to);
      // Skip self-loops
      if (fromNid === toNid) continue;
      // Skip duplicate edges (same from→to→verb)
      const edgeKey = fromNid + '→' + toNid + '→' + (c.verb || '');
      if (graphEdges.some(e => e.from === fromNid && e.to === toNid && e.verb === c.verb)) continue;
      graphEdges.push({ from: fromNid, to: toNid, verb: c.verb, verbSvg: c.verbSvg, time: c.time || 0, edgeId: c.edgeId });
    }
  }

  // ── Second-pass dedup: merge nodes with substring-matching IDs ──
  const containMerge = mergeContained(graphNodes);
  if (Object.keys(containMerge).length > 0) {
    // Remap edges
    for (const e of graphEdges) {
      if (containMerge[e.from]) e.from = containMerge[e.from];
      if (containMerge[e.to]) e.to = containMerge[e.to];
    }
    // Remove merged nodes
    for (const merged of Object.keys(containMerge)) {
      delete graphNodes[merged];
    }
    // Remove self-loops and duplicates after merge
    for (let i = graphEdges.length - 1; i >= 0; i--) {
      if (graphEdges[i].from === graphEdges[i].to) { graphEdges.splice(i, 1); continue; }
      // Check for duplicate
      const dup = graphEdges.findIndex((e, j) => j < i && e.from === graphEdges[i].from && e.to === graphEdges[i].to && e.verb === graphEdges[i].verb);
      if (dup >= 0) graphEdges.splice(i, 1);
    }
  }

  // ── Cluster edges by time gaps (>5s = new cluster) ──
  const clusters = []; // array of { edges: [], nodeIds: Set }
  let curCluster = { edges: [], nodeIds: new Set() };
  for (let i = 0; i < graphEdges.length; i++) {
    if (curCluster.edges.length > 0 && graphEdges[i].time - graphEdges[i - 1].time > 5) {
      clusters.push(curCluster);
      curCluster = { edges: [], nodeIds: new Set() };
    }
    curCluster.edges.push(i);
    curCluster.nodeIds.add(graphEdges[i].from);
    curCluster.nodeIds.add(graphEdges[i].to);
    graphEdges[i].cluster = clusters.length;
  }
  if (curCluster.edges.length > 0) { clusters.push(curCluster); }

  // Assign cluster to each node (first cluster it appears in)
  for (const n of Object.values(graphNodes)) { n.cluster = -1; }
  for (let ci = 0; ci < clusters.length; ci++) {
    for (const nid of clusters[ci].nodeIds) {
      if (graphNodes[nid] && graphNodes[nid].cluster === -1) graphNodes[nid].cluster = ci;
    }
  }

  function computeDegreeMap(edges) {
    const degree = {};
    for (const e of edges) {
      degree[e.from] = (degree[e.from] || 0) + 1;
      degree[e.to] = (degree[e.to] || 0) + 1;
    }
    return degree;
  }

  function shouldUsePreorderedEdges(preorderedEdges) {
    if (!preorderedEdges || preorderedEdges.length === 0) return false;

    const rawDegree = computeDegreeMap(graphEdges);
    const preorderedNodeIds = new Set();
    for (const e of preorderedEdges) {
      if (e.from) preorderedNodeIds.add(e.from);
      if (e.to) preorderedNodeIds.add(e.to);
    }

    const importantNodes = Object.keys(graphNodes)
      .filter(nid => (rawDegree[nid] || 0) >= 2)
      .filter(nid => {
        const label = (graphNodes[nid]?.label || '').trim();
        return label.length >= 3 && !/^[a-z0-9]{1,2}$/i.test(label);
      })
      .sort((a, b) => {
        const aScore = (rawDegree[a] || 0) * semanticPriority(graphNodes[a]);
        const bScore = (rawDegree[b] || 0) * semanticPriority(graphNodes[b]);
        return bScore - aScore;
      })
      .slice(0, 12);

    if (importantNodes.length === 0) return true;

    const coveredImportantNodes = importantNodes.filter(nid => preorderedNodeIds.has(nid)).length;
    const coverage = coveredImportantNodes / importantNodes.length;

    const attentionScore = (rawDegree.attention || 0) * semanticPriority(graphNodes.attention);
    const headScore = (rawDegree.head || 0) * semanticPriority(graphNodes.head);
    if (attentionScore > headScore && !preorderedNodeIds.has('attention')) return false;

    return coverage >= 0.45;
  }

  function assignClustersFromFinalEdges(finalEdgesList) {
    clusters.length = 0;
    const maxClusterEdges = 8;
    const maxClusterNodes = 10;
    let curCl = { edges: [], nodeIds: new Set() };

    for (let i = 0; i < finalEdgesList.length; i++) {
      const e = finalEdgesList[i];
      if (curCl.edges.length > 0) {
        const sharesCurrentCluster = curCl.nodeIds.has(e.from) || curCl.nodeIds.has(e.to);
        const nextNodeCount = curCl.nodeIds.size +
          (curCl.nodeIds.has(e.from) ? 0 : 1) +
          (curCl.nodeIds.has(e.to) ? 0 : 1);
        const clusterIsFull = curCl.edges.length >= maxClusterEdges || nextNodeCount > maxClusterNodes;
        if (!sharesCurrentCluster || clusterIsFull) {
          clusters.push(curCl);
          curCl = { edges: [], nodeIds: new Set() };
        }
      }

      curCl.edges.push(i);
      curCl.nodeIds.add(e.from);
      curCl.nodeIds.add(e.to);
      finalEdgesList[i].cluster = clusters.length;
    }

    if (curCl.edges.length > 0) clusters.push(curCl);
    for (const n of Object.values(graphNodes)) n.cluster = -1;
    for (let ci = 0; ci < clusters.length; ci++) {
      for (const nid of clusters[ci].nodeIds) {
        if (graphNodes[nid] && graphNodes[nid].cluster === -1) graphNodes[nid].cluster = ci;
      }
    }
  }

  // ═══════════════════════════════════════
  // GRAPH-THEORY OPTIMAL LAYOUT + TRAVERSAL
  // If pre-ordered edges provided, use them directly (ensures narration sync)
  // ═══════════════════════════════════════
  let finalEdges;
  const usePreorderedEdges = shouldUsePreorderedEdges(preOrdered?.edges);
  if (usePreorderedEdges) {
    // USE PRE-ORDERED EDGES — preserves exact narration-to-edge mapping
    finalEdges = preOrdered.edges.map(e => ({ ...e }));
    // Rebuild graphNodes from pre-ordered edges
    for (const e of finalEdges) {
      if (e.from && !graphNodes[e.from]) graphNodes[e.from] = { id: e.from, label: e.from, visual: '', type: 'default' };
      if (e.to && !graphNodes[e.to]) graphNodes[e.to] = { id: e.to, label: e.to, visual: '', type: 'default' };
    }
    // Merge in any existing node visuals
    for (const c of commands) {
      if (c.cmd === 'graph_node') {
        const nid = normalizeId(c.id);
        if (graphNodes[nid]) {
          graphNodes[nid].label = c.label || graphNodes[nid].label;
          graphNodes[nid].visual = c.visual || graphNodes[nid].visual;
          graphNodes[nid].type = c.nodeType || graphNodes[nid].type;
        }
      }
    }
  } else {
  // COMPUTE TRAVERSAL FROM SCRATCH

  const adj = {};
  const degree = {};
  for (const nid of Object.keys(graphNodes)) { adj[nid] = []; degree[nid] = 0; }
  for (let ei = 0; ei < graphEdges.length; ei++) {
    const e = graphEdges[ei];
    if (adj[e.from]) adj[e.from].push(ei);
    if (adj[e.to]) adj[e.to].push(ei);
    degree[e.from] = (degree[e.from] || 0) + 1;
    degree[e.to] = (degree[e.to] || 0) + 1;
  }

  // ── PageRank to find the most important node ──
  const pr = {};
  const nodeKeys = Object.keys(graphNodes);
  const N_nodes = nodeKeys.length || 1;
  for (const nid of nodeKeys) pr[nid] = 1 / N_nodes;
  const damping = 0.85;
  for (let iter = 0; iter < 30; iter++) {
    const newPr = {};
    for (const nid of nodeKeys) newPr[nid] = (1 - damping) / N_nodes;
    for (const e of graphEdges) {
      const outDeg = degree[e.from] || 1;
      if (newPr[e.to] !== undefined) newPr[e.to] += damping * (pr[e.from] || 0) / outDeg;
      // Undirected: also propagate backwards
      const outDeg2 = degree[e.to] || 1;
      if (newPr[e.from] !== undefined) newPr[e.from] += damping * (pr[e.to] || 0) / outDeg2;
    }
    // Normalize
    let sum = 0;
    for (const nid of nodeKeys) sum += newPr[nid];
    for (const nid of nodeKeys) pr[nid] = newPr[nid] / (sum || 1);
  }

  // Hub = highest PageRank node WITH a meaningful label (>= 4 chars, not cryptic)
  let hubNode = nodeKeys[0] || '';
  for (const nid of nodeKeys) {
    const label = graphNodes[nid] ? (graphNodes[nid].label || '') : '';
    const isGoodLabel = label.length >= 4 && !/^[a-z0-9_]{1,3}$/i.test(label);
    const hubLabel = graphNodes[hubNode] ? (graphNodes[hubNode].label || '') : '';
    const hubIsGood = hubLabel.length >= 4;
    const nidScore = (pr[nid] || 0) * semanticPriority(graphNodes[nid]);
    const hubScore = (pr[hubNode] || 0) * semanticPriority(graphNodes[hubNode]);
    if (nidScore > hubScore && isGoodLabel) hubNode = nid;
    if (!hubIsGood && isGoodLabel) hubNode = nid; // prefer any good label over bad hub
  }

  // ── STEP 1: MST via Kruskal's on original edges ──
  // (MST determines traversal; layout will minimize MST edge lengths)

  // ── NODE QUALITY FILTER (domain-agnostic) ──
  // Trust the LLM's extraction. Only remove obviously-junk labels (too short,
  // numeric-only, single character) and truly isolated nodes (no edges at all).
  // Earlier versions hard-coded a list of attention-paper keywords ("transformer",
  // "encoder", "softmax", ...) and dropped any entity without one of those words;
  // that worked for the attention paper but butchered every other input by ~80%.
  // The label-fix prompt in semantic-parser already enforces meaningful labels,
  // so this filter just removes junk, not arbitrary domain content.

  for (const nid of Object.keys(graphNodes)) {
    const label = (graphNodes[nid].label || '').toLowerCase().trim();
    // Remove: too short, single chars, numbers only
    if (label.length < 3 || /^[a-z]$/i.test(label) || /^[0-9.]+$/.test(label)) {
      delete graphNodes[nid]; continue;
    }
    // Remove: completely isolated (no edges at all). Single-edge nodes are kept.
    if ((degree[nid] || 0) < 1) { delete graphNodes[nid]; continue; }
  }

  // Filter edges: only keep those referencing existing nodes
  for (let i = graphEdges.length - 1; i >= 0; i--) {
    if (!graphNodes[graphEdges[i].from] || !graphNodes[graphEdges[i].to]) {
      graphEdges.splice(i, 1);
    }
  }

  // Recompute degrees after filtering
  for (const nid of Object.keys(graphNodes)) { adj[nid] = []; degree[nid] = 0; }
  for (let ei = 0; ei < graphEdges.length; ei++) {
    const e = graphEdges[ei];
    if (adj[e.from]) adj[e.from].push(ei);
    if (adj[e.to]) adj[e.to].push(ei);
    degree[e.from] = (degree[e.from] || 0) + 1;
    degree[e.to] = (degree[e.to] || 0) + 1;
  }

  // Union-Find
  const parent = {}; const rank = {};
  for (const nid of Object.keys(graphNodes)) { parent[nid] = nid; rank[nid] = 0; }
  function find(x) { if (parent[x] !== x) parent[x] = find(parent[x]); return parent[x]; }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra === rb) return false;
    if (rank[ra] < rank[rb]) parent[ra] = rb;
    else if (rank[ra] > rank[rb]) parent[rb] = ra;
    else { parent[rb] = ra; rank[ra]++; }
    return true;
  }

  // Sort edges by SEMANTIC IMPORTANCE (highest combined PageRank first)
  // Important edges enter MST first — they form the backbone of the story
  const sortedEI = graphEdges.map((_, i) => i).sort((a, b) => {
    const prA = ((pr[graphEdges[a].from] || 0) * semanticPriority(graphNodes[graphEdges[a].from])) +
      ((pr[graphEdges[a].to] || 0) * semanticPriority(graphNodes[graphEdges[a].to]));
    const prB = ((pr[graphEdges[b].from] || 0) * semanticPriority(graphNodes[graphEdges[b].from])) +
      ((pr[graphEdges[b].to] || 0) * semanticPriority(graphNodes[graphEdges[b].to]));
    return prB - prA; // highest importance first
  });
  const mstEdges = []; // indices into graphEdges
  const nonMstEdges = [];
  for (const ei of sortedEI) {
    const e = graphEdges[ei];
    if (union(e.from, e.to)) mstEdges.push(ei);
    else nonMstEdges.push(ei);
  }

  // ── STEP 2: DFS traversal of MST from hub ──
  const mstAdj = {};
  for (const nid of Object.keys(graphNodes)) mstAdj[nid] = [];
  for (const ei of mstEdges) {
    const e = graphEdges[ei];
    // Skip edges referencing nodes that were merged away
    if (!mstAdj[e.from] || !mstAdj[e.to]) continue;
    mstAdj[e.from].push({ to: e.to, ei });
    mstAdj[e.to].push({ to: e.from, ei });
  }

  // ── Prerequisite-aware DFS: visit parents before children ──
  // Verbs that imply direction: if A "contains/produces/enables" B, visit A first
  const parentVerbs = new Set(['contains', 'produce', 'enable', 'create', 'generate', 'build']);
  const childVerbs = new Set(['depend', 'require', 'need', 'base']);

  const dfsOrder = [];
  const visitedNodes = new Set();
  function dfs(node) {
    visitedNodes.add(node);
    const neighbors = (mstAdj[node] || []).filter(n => !visitedNodes.has(n.to));
    // Sort: prerequisites first (edges where this node is parent), then by PageRank
    neighbors.sort((a, b) => {
      const eA = graphEdges[a.ei];
      const eB = graphEdges[b.ei];
      // Prefer edges where current node is the "parent" (from-side of contains/produces)
      const aIsParent = eA && eA.from === node && parentVerbs.has((eA.verb || '').split(/\s/)[0]);
      const bIsParent = eB && eB.from === node && parentVerbs.has((eB.verb || '').split(/\s/)[0]);
      if (aIsParent && !bIsParent) return -1;
      if (!aIsParent && bIsParent) return 1;
      const aScore = (pr[a.to] || 0) * semanticPriority(graphNodes[a.to]);
      const bScore = (pr[b.to] || 0) * semanticPriority(graphNodes[b.to]);
      return bScore - aScore;
    });
    for (const { to, ei } of neighbors) {
      if (!visitedNodes.has(to)) {
        dfsOrder.push(ei);
        dfs(to);
      }
    }
  }
  dfs(hubNode);

  // The graph can be disconnected. Walk every remaining component in priority order
  // so central concepts like attention are not silently dropped from the traversal.
  const remainingNodes = Object.keys(graphNodes)
    .filter(nid => !visitedNodes.has(nid))
    .sort((a, b) => {
      const aScore = (pr[a] || 0) * semanticPriority(graphNodes[a]);
      const bScore = (pr[b] || 0) * semanticPriority(graphNodes[b]);
      return bScore - aScore;
    });
  for (const nid of remainingNodes) {
    if (!visitedNodes.has(nid)) dfs(nid);
  }

  // Append non-MST edges sorted by combined PageRank of endpoints
  nonMstEdges.sort((a, b) => {
    const prA = ((pr[graphEdges[a].from] || 0) * semanticPriority(graphNodes[graphEdges[a].from])) +
      ((pr[graphEdges[a].to] || 0) * semanticPriority(graphNodes[graphEdges[a].to]));
    const prB = ((pr[graphEdges[b].from] || 0) * semanticPriority(graphNodes[graphEdges[b].from])) +
      ((pr[graphEdges[b].to] || 0) * semanticPriority(graphNodes[graphEdges[b].to]));
    return prB - prA;
  });
  const finalOrder = [...dfsOrder, ...nonMstEdges];

  // ── STEP 3: Assign times evenly ──
  const totalDur = audioDuration || (commands.length > 0 ? Math.max(...commands.map(c => c.time || 0)) + 5 : 30);
  const eInt = totalDur / Math.max(finalOrder.length, 1);
  finalEdges = finalOrder.map((oi, ni) => ({ ...graphEdges[oi], time: ni * eInt }));

  } // end else (compute traversal from scratch)

  assignClustersFromFinalEdges(finalEdges);

  // ── GRAPH-DRIVEN SUBTITLES ──
  // Check for pre-computed timing/subtitles/audio from article-watcher pipeline
  const preTimings = commands.find(c => c.cmd === '_edge_timings');
  const preSubs = commands.find(c => c.cmd === '_edge_subtitles');
  const preAudios = commands.find(c => c.cmd === '_edge_audios');
  const preScenes = commands.find(c => c.cmd === '_scene_episodes');

  if (usePreorderedEdges && preTimings && preTimings.timings && preTimings.timings.length >= finalEdges.length) {
    for (let i = 0; i < finalEdges.length; i++) {
      finalEdges[i].time = preTimings.timings[i] || finalEdges[i].time;
    }
  }

  // Collect per-edge audio base64 strings
  const edgeAudioList = (usePreorderedEdges && preAudios && preAudios.audios) ? preAudios.audios : [];
  const edgeAudioMime = (preAudios && preAudios.mime) ? preAudios.mime : 'audio/mpeg';
  const sceneEpisodes = Array.isArray(preScenes?.episodes) ? preScenes.episodes : [];
  const preFormulas = commands.find(c => c.cmd === '_formulas');
  const preRefFigures = commands.find(c => c.cmd === '_reference_figures');
  const formulaList = Array.isArray(preFormulas?.formulas) ? preFormulas.formulas : [];
  const referenceFigures = preRefFigures?.figures || {};

  // Keep only nodes that participate in at least one final edge.
  const connectedNodeIds = new Set();
  for (const e of finalEdges) {
    if (e.from) connectedNodeIds.add(e.from);
    if (e.to) connectedNodeIds.add(e.to);
  }
  for (const nid of Object.keys(graphNodes)) {
    if (!connectedNodeIds.has(nid)) delete graphNodes[nid];
  }

  const graphSubtitles = finalEdges.map((e, i) => {
    // Use pre-computed narration sentence if available
    if (usePreorderedEdges && preSubs && preSubs.subtitles && preSubs.subtitles[i]) {
      return { time: e.time, cmd: 'subtitle', text: preSubs.subtitles[i] };
    }
    const sNode = graphNodes[e.from];
    const oNode = graphNodes[e.to];
    const sLabel = sNode ? sNode.label : e.from;
    const oLabel = oNode ? oNode.label : e.to;
    const verb = e.verb || 'relates to';
    return { time: e.time, cmd: 'subtitle', text: `${sLabel} ${verb} ${oLabel}` };
  });
  const allSubtitleCmds = graphSubtitles;

  const nodeList = Object.values(graphNodes);
  const nodeIds = nodeList.map(n => n.id);

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"><\/script>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.162.0/examples/jsm/"}}<\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:${C.bg};font-family:-apple-system,sans-serif;overflow:hidden}

/* ─── Three.js canvas container ─── */
#canvas-container{position:relative;width:100%;height:calc(100% - 100px);overflow:hidden}
#canvas-container canvas{display:block}
#css2d-overlay{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden}

/* ─── Semantic color palette ─── */
:root{
  --tone-arch:20,100,160;
  --tone-math:120,50,140;
  --tone-process:180,100,20;
  --tone-data:30,120,50;
  --tone-result:160,130,10;
  --tone-attn:15,120,145;
  --tone-default:20,100,160;
}

/* ─── Animations ─── */
@keyframes nodePulse{0%,100%{filter:brightness(1) drop-shadow(0 0 0 transparent)}50%{filter:brightness(1.15) drop-shadow(0 0 12px rgba(255,183,77,0.4))}}

/* ─── Container labels (CSS2DRenderer) ─── */
.gcontainer-label{color:rgb(20,100,160);
  font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;
  background:${C.bg};padding:0 8px;border-radius:4px;white-space:nowrap;
  max-width:200px;overflow:hidden;text-overflow:ellipsis;
  transition:all 0.4s ease;pointer-events:none}
.gcontainer-label.active{color:${C.accent};font-size:16px;padding:2px 10px;
  background:rgba(255,255,255,0.95);border:1px solid rgba(200,120,0,0.5);border-radius:6px;
  box-shadow:0 4px 12px rgba(0,0,0,0.1);max-width:none;overflow:visible}
.gcontainer-label.sub{font-size:9px;letter-spacing:0.3px;
  background:rgba(255,255,255,0.85);opacity:0.8;padding:0 4px}
.gcontainer-label.neighbor{color:rgb(20,100,160);opacity:0.92}

/* ─── Graph nodes (inside CSS2DObject wrappers) ─── */
.gnode{display:flex;flex-direction:column;align-items:center;cursor:pointer;
  transition:transform 0.4s ease,opacity 0.4s ease,filter 0.4s ease;
  transform:scale(1.3);opacity:0.8;filter:none;pointer-events:auto}
.gnode.hidden{transform:scale(0.72);opacity:0;filter:grayscale(1) brightness(0.35) saturate(0.1);pointer-events:none}
.gnode.active{transform:scale(2.0);opacity:1;filter:none;z-index:100;animation:nodePulse 2s ease-in-out infinite}
.gnode.neighbor{transform:scale(1.5);opacity:0.9;filter:none;z-index:50}
.gnode.in-cluster{transform:scale(1.4);opacity:0.85;filter:none}
.gnode.in-cluster .gnode-label{opacity:0.7;font-size:9px}
.gnode.seen{transform:scale(1.3);opacity:0.6;filter:grayscale(0.3) saturate(0.7)}
.gnode-visual{display:inline-block}
.gnode-visual svg{display:block;max-width:72px;max-height:56px;opacity:1}
.gnode:not(.active) .gnode-visual svg *{animation:none !important;filter:none !important}
.gnode:not(.active) .gnode-visual svg [fill="#4FC3F7"],
.gnode:not(.active) .gnode-visual svg [fill="#4fc3f7"],
.gnode:not(.active) .gnode-visual svg [stroke="#4FC3F7"],
.gnode:not(.active) .gnode-visual svg [stroke="#4fc3f7"]{fill:${INACTIVE_PRIMARY} !important;stroke:${INACTIVE_PRIMARY} !important}
.gnode-label{color:#222;font-size:11px;font-weight:700;white-space:nowrap;text-shadow:none;margin-top:2px;max-width:130px;overflow:hidden;text-overflow:ellipsis;background:rgba(255,255,255,0.9);padding:2px 6px;border-radius:4px;opacity:0.9}
.gnode.active .gnode-label{font-size:15px;color:${C.accent};max-width:200px;opacity:1;
  background:rgba(255,255,255,0.95);padding:4px 10px;border:1px solid rgba(192,120,0,0.4);border-radius:5px;
  text-shadow:none;box-shadow:0 2px 8px rgba(0,0,0,0.12);z-index:200;position:relative;
  margin-top:6px}
.gnode.active .gnode-visual svg{max-width:100px;max-height:80px;opacity:1}

/* ─── Edge labels (CSS2DRenderer) ─── */
.edge-label{display:flex;align-items:center;gap:8px;pointer-events:none;
  transform:scale(0.9);opacity:0;
  transition:opacity 0.25s ease,transform 0.25s ease;
  white-space:nowrap;padding:6px 10px;border-radius:999px;
  background:rgba(255,255,255,0.95);border:1px solid rgba(20,100,160,0.4);
  box-shadow:0 4px 12px rgba(0,0,0,0.1)}
.edge-label.hidden{opacity:0;transform:scale(0.9)}
.edge-label.active{opacity:1;transform:scale(1)}
.edge-label-icon{display:flex;align-items:center;justify-content:center;width:28px;height:28px;
  border-radius:50%;background:rgba(20,100,160,0.15);flex:0 0 auto}
.edge-label-icon svg{display:block;width:100%;height:100%}
.edge-label-text{color:${C.accent};font-size:13px;font-weight:800;letter-spacing:0.02em;
  text-shadow:none}

/* ─── Tooltip ─── */
.gnode-tooltip{position:absolute;background:rgba(255,255,255,0.95);color:${C.text};
  padding:8px 12px;border-radius:8px;font-size:12px;max-width:280px;
  border:1px solid rgba(20,100,160,0.3);pointer-events:none;z-index:250;
  box-shadow:0 4px 12px rgba(0,0,0,0.15);white-space:normal;
  transform:translateY(-12px)}

/* ─── Reference Panel (formulas + figures from original paper) ─── */
#ref-panel{position:fixed;bottom:100px;left:0;right:0;
  display:flex;align-items:center;justify-content:center;gap:16px;
  padding:8px 20px;max-height:150px;z-index:190;
  background:rgba(255,255,255,0.95);border-top:1px solid rgba(0,0,0,0.08);
  box-shadow:0 -2px 12px rgba(0,0,0,0.06);
  opacity:0;transform:translateY(10px);
  transition:opacity 0.35s ease,transform 0.35s ease;
  pointer-events:none;overflow:hidden}
#ref-panel.visible{opacity:1;transform:translateY(0);pointer-events:auto}
#ref-panel .ref-formula{background:rgba(120,50,140,0.05);border:1px solid rgba(120,50,140,0.2);
  border-radius:10px;padding:6px 14px;max-width:45%;overflow:hidden;
  display:flex;flex-direction:column;align-items:center;gap:2px}
#ref-panel .ref-formula .ref-formula-name{font-size:10px;color:#666;
  font-weight:600;text-transform:uppercase;letter-spacing:0.5px}
#ref-panel .ref-formula .katex{font-size:14px}
#ref-panel .ref-figure{max-height:130px;border-radius:8px;
  border:1px solid rgba(20,100,160,0.2);overflow:hidden;
  display:flex;flex-direction:column;align-items:center}
#ref-panel .ref-figure img{max-height:110px;max-width:280px;object-fit:contain}
#ref-panel .ref-figure .ref-fig-label{font-size:10px;color:#666;
  font-weight:600;padding:2px 6px}

/* Subtitle */
#subtitle{position:fixed;bottom:60px;left:0;right:0;background:rgba(255,255,255,0.92);color:${C.text};text-align:center;padding:10px 20px;font-size:15px;line-height:1.5;z-index:200;min-height:40px}

/* Controls */
#controls{height:60px;background:#e8e8e0;display:flex;align-items:center;justify-content:center;gap:12px;padding:0 20px;border-top:1px solid #ccc;position:fixed;bottom:0;left:0;right:0;z-index:300}
.btn{padding:6px 14px;border:1px solid #bbb;border-radius:8px;background:#ffffff;color:#333;cursor:pointer;font-size:13px}
.btn:hover{background:#e0e0d8}
.btn.active{background:#0288D1;border-color:${C.primary};color:#fff}
#timer{color:${C.muted};font-size:12px;min-width:80px;text-align:center}
#progress{flex:1;height:4px;background:#ddd;border-radius:2px;cursor:pointer;max-width:400px}
#progress-fill{height:100%;background:${C.primary};border-radius:2px;transition:width 0.2s}
/* ─── Replay button ─── */
#replay-btn{display:none;position:fixed;bottom:80px;right:20px;padding:10px 20px;
  border:1px solid ${C.primary};border-radius:10px;background:rgba(255,255,255,0.95);
  color:${C.primary};font-size:14px;cursor:pointer;z-index:300;font-weight:600}
#replay-btn:hover{background:#e0e0d8}

/* ─── Minimap ─── */
#minimap{position:fixed;bottom:70px;right:10px;width:150px;height:100px;
  border:1px solid rgba(20,100,160,0.3);border-radius:6px;background:rgba(245,245,240,0.9);z-index:250}

${title ? `#title{position:absolute;top:6px;left:50%;transform:translateX(-50%);color:${C.muted};font-size:12px;z-index:50}` : ''}
${getVerbCSS()}
</style></head><body>

<div id="canvas-container">
  ${title ? `<div id="title" style="position:absolute;top:6px;left:50%;transform:translateX(-50%);color:${C.muted};font-size:12px;z-index:300">${title}</div>` : ''}
</div>

<div id="ref-panel"></div>
<div id="subtitle"></div>

<canvas id="minimap" width="150" height="100"></canvas>
<button id="replay-btn" onclick="restart();togglePlay();">&#8635; Replay</button>

<div id="controls">
  <button class="btn active" id="btn-play" onclick="togglePlay()">&#9654; Play</button>
  <span id="timer">0:00</span>
  <div id="progress" onclick="seek(event)"><div id="progress-fill"></div></div>
  <button class="btn" onclick="restart()">Restart</button>
</div>

${audioBase64 ? `<audio id="audio" preload="auto"><source src="data:${edgeAudioMime};base64,${audioBase64}"></audio>` : ''}
${edgeAudioList.length > 0 ? edgeAudioList.map((b64, i) =>
  b64 ? `<audio id="ea-${i}" preload="auto"><source src="data:${edgeAudioMime};base64,${b64}"></audio>` : ''
).join('\n') : ''}

<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

var commands = ${JSON.stringify(commands)};
var graphSubs = ${JSON.stringify(allSubtitleCmds)};
var duration = ${audioDuration || (commands.length > 0 ? Math.max(...commands.map(c => c.time || 0)) + 5 : 30)};
var graphNodes = ${JSON.stringify(nodeList)};
var graphEdges = ${JSON.stringify(finalEdges)};
var clusters = ${JSON.stringify(clusters.map(c => ({ edges: c.edges, nodeIds: [...c.nodeIds] })))};
var sceneEpisodes = ${JSON.stringify(sceneEpisodes)};
var refFormulas = ${JSON.stringify(formulaList)};
var refFigures = ${JSON.stringify(referenceFigures)};
var precomputedHierarchy = ${JSON.stringify(preHierarchy?.tree || null)};
var playing = false, startTime = 0, pauseOffset = 0, cmdIdx = 0, animFrame = null;
var audio = document.getElementById('audio');
var hasPerEdgeAudio = !!document.getElementById('ea-0');
var curEdgeAudio = null;
var currentEdgeIdx = -1;
var currentCluster = -1;
var canvasContainer = document.getElementById('canvas-container');
var GW, GH, W, H;
var idToNode = {};
var graphBounds = null;
var seenNodes = {};
var narrationComplete = false;
var activeTooltip = null;

// ─── Three.js objects ───
var scene, camera, webglRenderer, css2dRenderer, controls;
var layoutContainers = [];
var containerMeshes = {};   // id → { group, fill, outline, labelObj, tone }
var nodeCss2dObjects = {};  // id → CSS2DObject
var nodeElements = {};      // id → the inner .gnode div
var edgeLines = [];         // THREE.Line objects
var edgeLabelObjects = [];  // CSS2DObject for edge labels
var edgeCurves = [];        // QuadraticBezierCurve3 for particles
var currentLOD = 2;
var cameraTarget = null;    // { x, y, zoom } for smooth animation

var CAMERA_TILT = 0.22; // radians (~12.6°) — enough to see Z-depth layers
var OVERVIEW_DIST = 1800;
var DETAIL_DIST = 500;

function initScene() {
  W = canvasContainer.offsetWidth || 800;
  H = canvasContainer.offsetHeight || 600;

  scene = new THREE.Scene();

  // PerspectiveCamera — tilted to reveal Z-depth layers
  camera = new THREE.PerspectiveCamera(45, W / H, 1, 10000);
  camera.position.set(0, -OVERVIEW_DIST * Math.sin(CAMERA_TILT), OVERVIEW_DIST * Math.cos(CAMERA_TILT));
  camera.lookAt(0, 0, 0);

  // WebGL renderer for geometry
  webglRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  webglRenderer.setSize(W, H);
  webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  webglRenderer.setClearColor(new THREE.Color('${C.bg}'), 1);
  canvasContainer.appendChild(webglRenderer.domElement);

  // CSS2D renderer for labels (preserves HTML/SVG/KaTeX)
  css2dRenderer = new CSS2DRenderer();
  css2dRenderer.setSize(W, H);
  css2dRenderer.domElement.style.position = 'absolute';
  css2dRenderer.domElement.style.top = '0';
  css2dRenderer.domElement.style.left = '0';
  css2dRenderer.domElement.style.pointerEvents = 'none';
  css2dRenderer.domElement.id = 'css2d-overlay';
  canvasContainer.appendChild(css2dRenderer.domElement);

  // OrbitControls — pan + zoom + slight rotation allowed
  controls = new OrbitControls(camera, webglRenderer.domElement);
  controls.enableRotate = true;
  controls.maxPolarAngle = Math.PI * 0.48; // prevent flipping under
  controls.minPolarAngle = Math.PI * 0.15; // prevent going fully top-down
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.screenSpacePanning = true;
  controls.minDistance = 200;
  controls.maxDistance = 3500;
  controls.addEventListener('change', updateLOD);

  // Handle resize
  window.addEventListener('resize', function() {
    W = canvasContainer.offsetWidth || 800;
    H = canvasContainer.offsetHeight || 600;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    webglRenderer.setSize(W, H);
    css2dRenderer.setSize(W, H);
  });
}

// ─── Hierarchy inference + Containment layout ───
var hierarchy = { children: {}, parentOf: {}, roots: [], orphans: [], containerOf: {} };

function buildHierarchy() {
  // ═══ PRIMARY: Use LLM-generated hierarchy if available ═══
  if (precomputedHierarchy && Array.isArray(precomputedHierarchy) && precomputedHierarchy.length > 0) {
    var childMap = {};
    var parentMap = {};

    // Build a set of valid graph node IDs
    var validIds = {};
    for (var i = 0; i < graphNodes.length; i++) validIds[graphNodes[i].id] = true;

    function walkTree(nodes, parentId) {
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (!node || !node.id || !validIds[node.id]) continue;

        if (parentId && validIds[parentId]) {
          parentMap[node.id] = parentId;
          if (!childMap[parentId]) childMap[parentId] = [];
          childMap[parentId].push(node.id);
        }
        if (node.children && node.children.length > 0) {
          if (!childMap[node.id]) childMap[node.id] = [];
          walkTree(node.children, node.id);
        }
      }
    }
    walkTree(precomputedHierarchy, null);

    // Find roots
    var roots = [];
    for (var pid in childMap) {
      if (!parentMap[pid] && childMap[pid].length > 0) roots.push(pid);
    }

    // Orphans: nodes not in the tree at all
    var finalOrphans = [];
    for (var i = 0; i < graphNodes.length; i++) {
      var nid = graphNodes[i].id;
      if (!parentMap[nid] && !childMap[nid]) finalOrphans.push(nid);
    }

    // containerOf: find top-level ancestor for each node
    var containerOf = {};
    for (var nid in parentMap) {
      var top = nid;
      while (parentMap[top]) top = parentMap[top];
      containerOf[nid] = top;
    }

    hierarchy = { children: childMap, parentOf: parentMap, roots: roots, orphans: finalOrphans, containerOf: containerOf };
    return;
  }

  // ═══ FALLBACK: Heuristic-based hierarchy (no LLM data available) ═══
  var childMap = {};
  var parentMap = {};
  var degree = {};

  for (var e = 0; e < graphEdges.length; e++) {
    degree[graphEdges[e].from] = (degree[graphEdges[e].from] || 0) + 1;
    degree[graphEdges[e].to] = (degree[graphEdges[e].to] || 0) + 1;
  }

  var idToIdx = {};
  for (var i = 0; i < graphNodes.length; i++) idToIdx[graphNodes[i].id] = i;

  // Group orphans by cluster, use highest-degree as container
  var orphanIds = [];
  for (var i = 0; i < graphNodes.length; i++) {
    var nid = graphNodes[i].id;
    if (!parentMap[nid] && !childMap[nid]) orphanIds.push(nid);
  }
  var clusterOrphans = {};
  for (var i = 0; i < orphanIds.length; i++) {
    var nid = orphanIds[i];
    var idx = idToIdx[nid];
    var cl = idx !== undefined ? (graphNodes[idx].cluster >= 0 ? graphNodes[idx].cluster : -1) : -1;
    if (!clusterOrphans[cl]) clusterOrphans[cl] = [];
    clusterOrphans[cl].push(nid);
  }
  for (var cl in clusterOrphans) {
    var group = clusterOrphans[cl];
    if (group.length < 2) continue;
    var bestHub = null, bestDeg = 0;
    for (var i = 0; i < group.length; i++) {
      var d = degree[group[i]] || 0;
      if (d > bestDeg) { bestDeg = d; bestHub = group[i]; }
    }
    if (bestHub && bestDeg >= 2) {
      if (!childMap[bestHub]) childMap[bestHub] = [];
      for (var i = 0; i < group.length; i++) {
        if (group[i] !== bestHub && !parentMap[group[i]]) {
          parentMap[group[i]] = bestHub;
          childMap[bestHub].push(group[i]);
        }
      }
    }
  }

  var roots = [];
  for (var pid in childMap) {
    if (!parentMap[pid] && childMap[pid].length > 0) roots.push(pid);
  }
  var finalOrphans = [];
  for (var i = 0; i < graphNodes.length; i++) {
    var nid = graphNodes[i].id;
    if (!parentMap[nid] && !childMap[nid]) finalOrphans.push(nid);
  }
  var containerOf = {};
  for (var nid in parentMap) {
    var top = nid;
    while (parentMap[top]) top = parentMap[top];
    containerOf[nid] = top;
  }
  hierarchy = { children: childMap, parentOf: parentMap, roots: roots, orphans: finalOrphans, containerOf: containerOf };
}

function layoutGraph() {
  W = canvasContainer.offsetWidth || 800;
  H = (canvasContainer.offsetHeight || 600) - 40;
  var N = graphNodes.length;
  if (N === 0) return;

  GW = W; GH = H;

  buildHierarchy();

  var idToIdx = {};
  for (var i = 0; i < N; i++) idToIdx[graphNodes[i].id] = i;

  // ── Compute container sizes ──
  // Each root container gets space proportional to child count + 1 (for itself)
  var containers = []; // { id, children[], size, x, y, w, h }
  for (var r = 0; r < hierarchy.roots.length; r++) {
    var rid = hierarchy.roots[r];
    var kids = hierarchy.children[rid] || [];
    // Include sub-children
    var allKids = [];
    var queue = [].concat(kids);
    while (queue.length) {
      var k = queue.shift();
      allKids.push(k);
      if (hierarchy.children[k]) queue = queue.concat(hierarchy.children[k]);
    }
    containers.push({ id: rid, children: allKids, directChildren: kids, size: allKids.length + 1 });
  }

  // Orphan container
  if (hierarchy.orphans.length > 0) {
    containers.push({ id: '__orphans__', children: hierarchy.orphans, directChildren: hierarchy.orphans, size: hierarchy.orphans.length, isOrphan: true });
  }

  if (containers.length === 0) {
    // No hierarchy found — treat each cluster as a container
    var clusterMap = {};
    for (var i = 0; i < N; i++) {
      var cl = graphNodes[i].cluster >= 0 ? graphNodes[i].cluster : 0;
      if (!clusterMap[cl]) clusterMap[cl] = [];
      clusterMap[cl].push(graphNodes[i].id);
    }
    for (var cl in clusterMap) {
      var members = clusterMap[cl];
      if (members.length === 0) continue;
      // Use highest degree as container label
      var bestId = members[0], bestDeg = 0;
      for (var i = 0; i < members.length; i++) {
        var deg = 0;
        for (var e = 0; e < graphEdges.length; e++) {
          if (graphEdges[e].from === members[i] || graphEdges[e].to === members[i]) deg++;
        }
        if (deg > bestDeg) { bestDeg = deg; bestId = members[i]; }
      }
      var kids = members.filter(function(m) { return m !== bestId; });
      containers.push({ id: bestId, children: kids, directChildren: kids, size: members.length });
    }
  }

  // Sort containers by size (biggest first for better space usage)
  containers.sort(function(a, b) { return b.size - a.size; });

  // ── Treemap layout: position containers ──
  // Size = total VISIBLE DESCENDANTS (all leaves in the subtree)
  function countVisibleDescendants(nodeId) {
    var kids = hierarchy.children[nodeId];
    if (!kids || kids.length === 0) return 1; // leaf = 1
    var total = 0;
    for (var k = 0; k < kids.length; k++) {
      total += countVisibleDescendants(kids[k]);
    }
    return total;
  }

  for (var c = 0; c < containers.length; c++) {
    if (containers[c].isOrphan) {
      // Orphan container: size = number of orphan children
      containers[c].visibleChildCount = containers[c].children.length;
      containers[c].size = containers[c].children.length;
    } else {
      var totalDesc = countVisibleDescendants(containers[c].id);
      containers[c].visibleChildCount = Math.max(1, totalDesc);
      containers[c].size = totalDesc;
    }
  }

  var totalSize = 0;
  for (var c = 0; c < containers.length; c++) totalSize += containers[c].size;

  var pad = 10;
  var gap = 8;
  var availW = GW - 2 * pad;
  var availH = GH - 2 * pad - 10; // leave room for subtitle

  // Squarified treemap: pack rectangles to minimize aspect ratios
  function layoutRow(items, rowTotalSize, x, y, w, h, isHorizontal) {
    var offset = 0;
    for (var i = 0; i < items.length; i++) {
      var frac = items[i].size / rowTotalSize;
      if (isHorizontal) {
        var itemW = frac * w;
        items[i].x = x + offset; items[i].y = y;
        items[i].w = itemW - gap; items[i].h = h - gap;
        offset += itemW;
      } else {
        var itemH = frac * h;
        items[i].x = x; items[i].y = y + offset;
        items[i].w = w - gap; items[i].h = itemH - gap;
        offset += itemH;
      }
    }
  }

  // Use squarified treemap algorithm
  function squarify(items, x, y, w, h) {
    if (items.length === 0) return;
    if (items.length === 1) {
      items[0].x = x; items[0].y = y;
      items[0].w = w - gap; items[0].h = h - gap;
      return;
    }

    var isHorizontal = w >= h;
    var total = 0;
    for (var i = 0; i < items.length; i++) total += items[i].size;

    // Try different split points, pick best aspect ratio
    var bestSplit = 1, bestWorst = Infinity;
    for (var s = 1; s < items.length; s++) {
      var leftSize = 0;
      for (var i = 0; i < s; i++) leftSize += items[i].size;
      var leftFrac = leftSize / total;

      var worstAR = 0;
      var stripSize = isHorizontal ? w * leftFrac : h * leftFrac;
      var crossSize = isHorizontal ? h : w;
      for (var i = 0; i < s; i++) {
        var itemFrac = items[i].size / leftSize;
        var itemCross = itemFrac * crossSize;
        var ar = Math.max(stripSize / Math.max(itemCross, 1), itemCross / Math.max(stripSize, 1));
        worstAR = Math.max(worstAR, ar);
      }
      if (worstAR < bestWorst) { bestWorst = worstAR; bestSplit = s; }
    }

    var leftItems = items.slice(0, bestSplit);
    var rightItems = items.slice(bestSplit);
    var leftSize = 0;
    for (var i = 0; i < leftItems.length; i++) leftSize += leftItems[i].size;
    var leftFrac = leftSize / total;

    if (isHorizontal) {
      var splitX = x + w * leftFrac;
      layoutRow(leftItems, leftSize, x, y, w * leftFrac, h, false);
      squarify(rightItems, splitX, y, w * (1 - leftFrac), h);
    } else {
      var splitY = y + h * leftFrac;
      layoutRow(leftItems, leftSize, x, y, w, h * leftFrac, true);
      squarify(rightItems, x, splitY, w, h * (1 - leftFrac));
    }
  }

  // ── Order containers to minimize cross-container edge lengths ──
  // Containers that share many edges should be adjacent in the treemap.
  // Build a inter-container edge weight matrix, then use greedy nearest-neighbor ordering.
  if (containers.length > 2) {
    var contIds = {};
    for (var c = 0; c < containers.length; c++) contIds[containers[c].id] = c;
    // For each node, find which container it belongs to
    var nodeToContainer = {};
    for (var c = 0; c < containers.length; c++) {
      var allDesc = [containers[c].id].concat(containers[c].children || []);
      // Also include all deeper descendants
      var queue = [].concat(containers[c].children || []);
      while (queue.length > 0) {
        var kid = queue.shift();
        if (hierarchy.children[kid]) {
          for (var k = 0; k < hierarchy.children[kid].length; k++) {
            allDesc.push(hierarchy.children[kid][k]);
            queue.push(hierarchy.children[kid][k]);
          }
        }
      }
      for (var d = 0; d < allDesc.length; d++) nodeToContainer[allDesc[d]] = c;
    }
    // Orphans belong to the orphan container
    for (var i = 0; i < (hierarchy.orphans || []).length; i++) {
      for (var c = 0; c < containers.length; c++) {
        if (containers[c].isOrphan) { nodeToContainer[hierarchy.orphans[i]] = c; break; }
      }
    }

    // Count cross-container edges
    var edgeWeight = [];
    for (var i = 0; i < containers.length; i++) {
      edgeWeight[i] = [];
      for (var j = 0; j < containers.length; j++) edgeWeight[i][j] = 0;
    }
    for (var e = 0; e < graphEdges.length; e++) {
      var ci = nodeToContainer[graphEdges[e].from];
      var cj = nodeToContainer[graphEdges[e].to];
      if (ci !== undefined && cj !== undefined && ci !== cj) {
        edgeWeight[ci][cj] += 1;
        edgeWeight[cj][ci] += 1;
      }
    }

    // Greedy nearest-neighbor ordering: start with the largest container,
    // then always pick the most-connected unvisited container
    var ordered = [];
    var visited = {};
    // Start with the largest
    var startIdx = 0;
    for (var c = 1; c < containers.length; c++) {
      if (containers[c].size > containers[startIdx].size) startIdx = c;
    }
    ordered.push(containers[startIdx]);
    visited[startIdx] = true;

    while (ordered.length < containers.length) {
      var last = ordered.length - 1;
      var lastIdx = -1;
      for (var c = 0; c < containers.length; c++) {
        if (containers[c] === ordered[last]) { lastIdx = c; break; }
      }

      var bestNext = -1, bestWeight = -1;
      for (var c = 0; c < containers.length; c++) {
        if (visited[c]) continue;
        var w = lastIdx >= 0 ? edgeWeight[lastIdx][c] : 0;
        // Also consider connection to any already-placed container
        for (var p = 0; p < ordered.length; p++) {
          var pIdx = -1;
          for (var q = 0; q < containers.length; q++) {
            if (containers[q] === ordered[p]) { pIdx = q; break; }
          }
          if (pIdx >= 0) w += edgeWeight[pIdx][c] * 0.5;
        }
        if (w > bestWeight || (w === bestWeight && containers[c].size > (bestNext >= 0 ? containers[bestNext].size : 0))) {
          bestWeight = w; bestNext = c;
        }
      }
      if (bestNext < 0) {
        // Pick any unvisited
        for (var c = 0; c < containers.length; c++) {
          if (!visited[c]) { bestNext = c; break; }
        }
      }
      ordered.push(containers[bestNext]);
      visited[bestNext] = true;
    }
    containers = ordered;
  }

  squarify(containers, pad, pad, availW, availH);

  // ── Tier 2a: Flow-axis container placement (post-treemap topological reorder) ──
  // Compute topological depth of each container from inter-container edges,
  // then nudge container X positions so flow runs left→right while keeping treemap sizes.
  if (containers.length > 2) {
    // Rebuild nodeToContainer mapping (may already exist from ordering step, but ensure it is fresh)
    var n2c = {};
    for (var c = 0; c < containers.length; c++) {
      var allD = [containers[c].id].concat(containers[c].children || []);
      var q2 = [].concat(containers[c].children || []);
      while (q2.length > 0) {
        var kk = q2.shift();
        if (hierarchy.children[kk]) {
          for (var ki = 0; ki < hierarchy.children[kk].length; ki++) {
            allD.push(hierarchy.children[kk][ki]);
            q2.push(hierarchy.children[kk][ki]);
          }
        }
      }
      for (var di = 0; di < allD.length; di++) n2c[allD[di]] = c;
    }
    for (var oi = 0; oi < (hierarchy.orphans || []).length; oi++) {
      for (var ci2 = 0; ci2 < containers.length; ci2++) {
        if (containers[ci2].isOrphan) { n2c[hierarchy.orphans[oi]] = ci2; break; }
      }
    }

    // Count directed inter-container edges (from→to implies flow)
    var inDeg = [], outDeg = [];
    for (var c = 0; c < containers.length; c++) { inDeg[c] = 0; outDeg[c] = 0; }
    var interEdges = [];
    for (var ei2 = 0; ei2 < graphEdges.length; ei2++) {
      var sc = n2c[graphEdges[ei2].from], tc = n2c[graphEdges[ei2].to];
      if (sc !== undefined && tc !== undefined && sc !== tc) {
        outDeg[sc]++;
        inDeg[tc]++;
        interEdges.push({ from: sc, to: tc });
      }
    }

    // BFS topological depth: sources (inDeg==0 from inter-container edges) get depth 0
    var topoDepth = [];
    for (var c = 0; c < containers.length; c++) topoDepth[c] = 0;
    var bfsQueue = [];
    for (var c = 0; c < containers.length; c++) {
      if (inDeg[c] === 0) bfsQueue.push(c);
    }
    var bfsVisited = {};
    while (bfsQueue.length > 0) {
      var cur = bfsQueue.shift();
      if (bfsVisited[cur]) continue;
      bfsVisited[cur] = true;
      for (var ie = 0; ie < interEdges.length; ie++) {
        if (interEdges[ie].from === cur) {
          var tgt = interEdges[ie].to;
          topoDepth[tgt] = Math.max(topoDepth[tgt], topoDepth[cur] + 1);
          if (!bfsVisited[tgt]) bfsQueue.push(tgt);
        }
      }
    }

    // Group containers into columns by depth
    var maxDepth = 0;
    for (var c = 0; c < containers.length; c++) maxDepth = Math.max(maxDepth, topoDepth[c]);

    if (maxDepth > 0) {
      var columns = [];
      for (var d = 0; d <= maxDepth; d++) columns[d] = [];
      for (var c = 0; c < containers.length; c++) columns[topoDepth[c]].push(c);

      // Target X center for each column (evenly across available width)
      var colCenters = [];
      for (var d = 0; d <= maxDepth; d++) {
        colCenters[d] = pad + (d + 0.5) * (availW / (maxDepth + 1));
      }

      // Nudge each container's X toward its column center (blend 40% topo, 60% treemap)
      var blendFactor = 0.4;
      for (var c = 0; c < containers.length; c++) {
        if (containers[c].x === undefined) continue;
        var currentCx = containers[c].x + containers[c].w / 2;
        var targetCx = colCenters[topoDepth[c]];
        var newCx = currentCx * (1 - blendFactor) + targetCx * blendFactor;
        var newX = newCx - containers[c].w / 2;
        // Clamp to stay within bounds
        newX = Math.max(pad, Math.min(pad + availW - containers[c].w, newX));
        containers[c].x = newX;
      }
    }
  }

  // ── Enforce minimum container dimensions based on child count ──
  var minPerChild = 100; // minimum pixels per child (width or height)
  var headerH = 22;
  for (var c = 0; c < containers.length; c++) {
    var cont = containers[c];
    if (!cont.w) continue;
    var nVis = cont.visibleChildCount || 1;
    var cols = Math.max(1, Math.ceil(Math.sqrt(nVis)));
    var rows = Math.max(1, Math.ceil(nVis / cols));
    var neededW = cols * minPerChild + 12;
    var neededH = rows * minPerChild + headerH + 12;
    // Only expand, never shrink
    if (cont.w < neededW) cont.w = neededW;
    if (cont.h < neededH) cont.h = neededH;
  }

  // ── Position children inside containers ──
  for (var c = 0; c < containers.length; c++) {
    var cont = containers[c];
    if (!cont.w || !cont.h) continue;

    var headerH = 22; // space for container label
    var childPad = 6;
    var innerX = cont.x + childPad;
    var innerY = cont.y + headerH;
    var innerW = Math.max(40, cont.w - 2 * childPad);
    var innerH = Math.max(30, cont.h - headerH - childPad);

    // Position the container's own node at top-center
    if (!cont.isOrphan && idToIdx[cont.id] !== undefined) {
      graphNodes[idToIdx[cont.id]].x = cont.x + cont.w / 2;
      graphNodes[idToIdx[cont.id]].y = cont.y + 10;
      graphNodes[idToIdx[cont.id]]._isContainer = true;
      graphNodes[idToIdx[cont.id]]._container = cont;
    }

    var kids = cont.directChildren || cont.children;
    var nKids = kids.length;
    if (nKids === 0) continue;

    // Check for sub-containers vs leaf children
    var subContainers = [];
    var leafChildren = [];
    for (var k = 0; k < kids.length; k++) {
      if (hierarchy.children[kids[k]] && hierarchy.children[kids[k]].length > 0) {
        subContainers.push(kids[k]);
      } else {
        leafChildren.push(kids[k]);
      }
    }

    if (subContainers.length > 0) {
      // Sub-containers get top portion
      var subFrac = Math.min(0.65, 0.4 + subContainers.length * 0.1);
      var subH = innerH * subFrac;
      var subW = innerW / Math.max(subContainers.length, 1);

      for (var s = 0; s < subContainers.length; s++) {
        var subId = subContainers[s];
        var subKids = hierarchy.children[subId] || [];

        if (idToIdx[subId] !== undefined) {
          graphNodes[idToIdx[subId]].x = innerX + s * subW + subW / 2;
          graphNodes[idToIdx[subId]].y = innerY + 8;
          graphNodes[idToIdx[subId]]._isContainer = true;
          graphNodes[idToIdx[subId]]._subContainer = {
            x: innerX + s * subW + 2,
            y: innerY,
            w: subW - 4,
            h: subH - 2,
            id: subId
          };
        }

        // Collect ALL descendants of this sub-container (flatten 3rd level)
        var allSubDesc = [];
        var subQueue = [].concat(subKids);
        while (subQueue.length > 0) {
          var kid = subQueue.shift();
          allSubDesc.push(kid);
          if (hierarchy.children[kid]) {
            subQueue = subQueue.concat(hierarchy.children[kid]);
          }
        }
        // Filter to only leaf nodes (those without children) — they get rendered
        var subLeaves = allSubDesc.filter(function(kid) {
          return !hierarchy.children[kid] || hierarchy.children[kid].length === 0;
        });

        // Grid-position all leaves inside the sub-container area
        // Start below the sub-container label (18px for label + 8px gap)
        var sX = innerX + s * subW + 8;
        var sY = innerY + 34;
        var sW = Math.max(40, subW - 16);
        var sH = Math.max(30, subH - 42);
        var sMinCell = 95;
        var sCols = Math.max(1, Math.min(subLeaves.length, Math.floor(sW / sMinCell)));
        var sRows = Math.max(1, Math.ceil(subLeaves.length / sCols));

        for (var sk = 0; sk < subLeaves.length; sk++) {
          var idx = idToIdx[subLeaves[sk]];
          if (idx === undefined) continue;
          graphNodes[idx].x = sX + (sk % sCols + 0.5) * (sW / sCols);
          graphNodes[idx].y = sY + (Math.floor(sk / sCols) + 0.5) * (sH / sRows);
        }
        // Mark intermediate containers as positioned (ghost them)
        var subContainerKids = allSubDesc.filter(function(kid) {
          return hierarchy.children[kid] && hierarchy.children[kid].length > 0;
        });
        for (var sc = 0; sc < subContainerKids.length; sc++) {
          var idx = idToIdx[subContainerKids[sc]];
          if (idx !== undefined) {
            graphNodes[idx]._isContainer = true;
            graphNodes[idx].x = sX + sW / 2;
            graphNodes[idx].y = sY - 2;
          }
        }
      }

      // Leaf children in bottom portion
      var leafY = innerY + subH + 4;
      var leafH = Math.max(20, innerH - subH - 4);
      var lCols = Math.max(1, Math.ceil(Math.sqrt(leafChildren.length * (innerW / Math.max(leafH, 1)))));
      for (var lk = 0; lk < leafChildren.length; lk++) {
        var idx = idToIdx[leafChildren[lk]];
        if (idx === undefined) continue;
        graphNodes[idx].x = innerX + (lk % lCols + 0.5) * (innerW / lCols);
        graphNodes[idx].y = leafY + (Math.floor(lk / lCols) + 0.5) * (leafH / Math.max(1, Math.ceil(leafChildren.length / lCols)));
      }
    } else if (nKids >= 3) {
      // ── Tier 2b: Center-periphery inner layout for 3+ children ──
      // Find the node with the highest degree — place it at center
      var bestHub2 = 0, bestDeg2 = 0;
      for (var k = 0; k < kids.length; k++) {
        var deg2 = 0;
        for (var e2 = 0; e2 < graphEdges.length; e2++) {
          if (graphEdges[e2].from === kids[k] || graphEdges[e2].to === kids[k]) deg2++;
        }
        if (deg2 > bestDeg2) { bestDeg2 = deg2; bestHub2 = k; }
      }
      // Place hub at center
      var cx2 = innerX + innerW / 2;
      var cy2 = innerY + innerH / 2;
      var hubIdx2 = idToIdx[kids[bestHub2]];
      if (hubIdx2 !== undefined) {
        graphNodes[hubIdx2].x = cx2;
        graphNodes[hubIdx2].y = cy2;
      }
      // Arrange others in ellipse around center
      var orbitKids = [];
      for (var k = 0; k < kids.length; k++) {
        if (k !== bestHub2) orbitKids.push(kids[k]);
      }
      var rx2 = Math.max(50, (innerW - 70) / 2);
      var ry2 = Math.max(40, (innerH - 60) / 2);
      for (var ok = 0; ok < orbitKids.length; ok++) {
        var angle2 = (ok / orbitKids.length) * Math.PI * 2 - Math.PI / 2;
        var idx = idToIdx[orbitKids[ok]];
        if (idx === undefined) continue;
        graphNodes[idx].x = cx2 + rx2 * Math.cos(angle2);
        graphNodes[idx].y = cy2 + ry2 * Math.sin(angle2);
      }
    } else {
      // Small containers (1-2 kids): simple grid
      var minCellW = 100, minCellH = 100;
      var cols = Math.max(1, Math.min(nKids, Math.floor(innerW / minCellW)));
      var rowsN = Math.max(1, Math.ceil(nKids / cols));
      var cellW = Math.max(minCellW, innerW / cols);
      var cellH = Math.max(minCellH, innerH / rowsN);

      for (var k = 0; k < kids.length; k++) {
        var idx = idToIdx[kids[k]];
        if (idx === undefined) continue;
        graphNodes[idx].x = innerX + (k % cols + 0.5) * cellW;
        graphNodes[idx].y = innerY + (Math.floor(k / cols) + 0.5) * cellH;
      }
    }
  }

  // ── Final overlap resolution: spread any remaining overlapping nodes ──
  // Only targets nodes within the same container
  var minSep = 105; // accounts for node visual + label height below
  for (var c = 0; c < containers.length; c++) {
    var cont = containers[c];
    if (!cont.w) continue;
    var allKids = (cont.children || []).filter(function(kid) {
      var idx = idToIdx[kid];
      return idx !== undefined && !graphNodes[idx]._isContainer;
    });
    if (allKids.length < 2) continue;

    for (var pass = 0; pass < 40; pass++) {
      var moved = false;
      for (var i = 0; i < allKids.length; i++) {
        var ni = idToIdx[allKids[i]];
        for (var j = i + 1; j < allKids.length; j++) {
          var nj = idToIdx[allKids[j]];
          var dx = graphNodes[ni].x - graphNodes[nj].x;
          var dy = graphNodes[ni].y - graphNodes[nj].y;
          var d = Math.sqrt(dx * dx + dy * dy) || 0.1;
          if (d < minSep) {
            var push = (minSep - d) / 2 + 1;
            var px = dx === 0 ? (Math.random() - 0.5) * 20 : (dx / d) * push;
            var py = dy === 0 ? (Math.random() - 0.5) * 20 : (dy / d) * push;
            graphNodes[ni].x += px; graphNodes[ni].y += py;
            graphNodes[nj].x -= px; graphNodes[nj].y -= py;
            moved = true;
          }
        }
      }
      // Clamp to container bounds
      for (var k = 0; k < allKids.length; k++) {
        var idx = idToIdx[allKids[k]];
        graphNodes[idx].x = Math.max(cont.x + 35, Math.min(cont.x + cont.w - 35, graphNodes[idx].x));
        graphNodes[idx].y = Math.max(cont.y + 26, Math.min(cont.y + cont.h - 14, graphNodes[idx].y));
      }
      if (!moved) break;
    }
  }

  // ── Compute bounds from containers (not just nodes) ──
  var gMinX = 0, gMinY = 0, gMaxX = GW, gMaxY = GH;
  // Use container extents for global bounds
  for (var c = 0; c < containers.length; c++) {
    if (containers[c].x !== undefined) {
      gMinX = Math.min(gMinX, containers[c].x);
      gMinY = Math.min(gMinY, containers[c].y);
      gMaxX = Math.max(gMaxX, containers[c].x + (containers[c].w || 0) + gap);
      gMaxY = Math.max(gMaxY, containers[c].y + (containers[c].h || 0) + gap);
    }
  }
  // Also include node positions
  for (var i = 0; i < N; i++) {
    if (!graphNodes[i].x) graphNodes[i].x = GW / 2;
    if (!graphNodes[i].y) graphNodes[i].y = GH / 2;
  }
  graphBounds = {
    x: gMinX, y: gMinY,
    w: gMaxX - gMinX, h: gMaxY - gMinY,
    cx: (gMinX + gMaxX) / 2, cy: (gMinY + gMaxY) / 2
  };

  // Store containers for rendering
  layoutContainers = containers;

  // Compute cluster bounds from container positions
  var NC = clusters.length || 0;
  for (var ci = 0; ci < NC; ci++) {
    var minX = GW, minY = GH, maxX = 0, maxY = 0;
    for (var i = 0; i < N; i++) {
      if (graphNodes[i].cluster === ci) {
        minX = Math.min(minX, graphNodes[i].x);
        minY = Math.min(minY, graphNodes[i].y);
        maxX = Math.max(maxX, graphNodes[i].x);
        maxY = Math.max(maxY, graphNodes[i].y);
      }
    }
    clusters[ci].bounds = { x: minX - 60, y: minY - 60, w: (maxX - minX) + 120, h: (maxY - minY) + 120 };
    clusters[ci].cx = (minX + maxX) / 2;
    clusters[ci].cy = (minY + maxY) / 2;
  }
}

function boundsForNodeIds(nodeIds) {
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  var found = 0;
  for (var i = 0; i < nodeIds.length; i++) {
    var n = idToNode[nodeIds[i]];
    if (!n) continue;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
    found++;
  }
  if (!found) return null;
  // Include container bounds if nodes are in containers
  for (var i = 0; i < nodeIds.length; i++) {
    var cid = hierarchy.containerOf[nodeIds[i]] || hierarchy.parentOf[nodeIds[i]];
    if (cid && idToNode[cid]) {
      minX = Math.min(minX, idToNode[cid].x - 80);
      minY = Math.min(minY, idToNode[cid].y - 40);
      maxX = Math.max(maxX, idToNode[cid].x + 80);
      maxY = Math.max(maxY, idToNode[cid].y + 40);
    }
  }
  return {
    x: minX - 60, y: minY - 60,
    w: (maxX - minX) + 120, h: (maxY - minY) + 120,
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2
  };
}

// ─── Camera animation (PerspectiveCamera — distance-based zoom) ───
function setCameraTarget(cx, cy, dist) {
  dist = Math.max(200, Math.min(dist, 3500));
  cameraTarget = {
    tx: cx, ty: -cy, // orbit target (scene center)
    cx: cx,
    cy: -cy - dist * Math.sin(CAMERA_TILT),
    cz: dist * Math.cos(CAMERA_TILT)
  };
}

function zoomToOverview() {
  if (!graphBounds) return;
  var bw = Math.max(graphBounds.w, 1);
  var bh = Math.max(graphBounds.h, 1);
  // Compute distance to fit entire graph in view at 45° FOV
  var fitH = bh / (2 * Math.tan(Math.PI / 8)); // half-FOV = 22.5°
  var fitW = bw / (2 * Math.tan(Math.PI / 8) * (W / H));
  var dist = Math.max(fitH, fitW) * 1.15;
  dist = Math.max(800, Math.min(dist, 3000));
  setCameraTarget(graphBounds.cx, graphBounds.cy, dist);
}

function zoomToCluster(clusterIdx) {
  if (clusterIdx < 0 || clusterIdx >= clusters.length || !clusters[clusterIdx].bounds) {
    zoomToOverview(); return;
  }
  var b = clusters[clusterIdx].bounds;
  var fitH = b.h / (2 * Math.tan(Math.PI / 8));
  var fitW = b.w / (2 * Math.tan(Math.PI / 8) * (W / H));
  var dist = Math.max(fitH, fitW) * 1.1;
  dist = Math.max(350, Math.min(dist, 1800));
  setCameraTarget(b.cx, b.cy, dist);
}

function zoomToEdge(edgeIdx, focusNodeIds) {
  var bounds = boundsForNodeIds(focusNodeIds || []);
  if (!bounds) { zoomToOverview(); return; }
  var fitH = bounds.h / (2 * Math.tan(Math.PI / 8));
  var fitW = bounds.w / (2 * Math.tan(Math.PI / 8) * (W / H));
  var dist = Math.max(fitH, fitW) * 1.05;
  dist = Math.max(300, Math.min(dist, 1400));
  setCameraTarget(bounds.cx, bounds.cy, dist);
}

// ─── LOD system (distance-based, aggressive declutter) ───
function updateLOD() {
  if (!camera) return;
  var dist = camera.position.length(); // distance from origin
  var newLOD;
  if (dist > 1200) newLOD = 1;      // Overview: containers only
  else if (dist > 550) newLOD = 2;   // Regional: containers + nodes
  else newLOD = 3;                    // Detail: everything

  if (newLOD === currentLOD) return;
  currentLOD = newLOD;

  // Nodes: hidden at LOD 1, visible at LOD 2+
  for (var id in nodeCss2dObjects) {
    nodeCss2dObjects[id].visible = currentLOD >= 2;
  }
  // Edges: hidden at LOD 1, visible at LOD 2+
  for (var i = 0; i < edgeLines.length; i++) {
    if (edgeLines[i]) edgeLines[i].visible = currentLOD >= 2;
  }
  // Edge labels: only at LOD 3
  for (var i = 0; i < edgeLabelObjects.length; i++) {
    if (edgeLabelObjects[i]) edgeLabelObjects[i].visible = currentLOD >= 3;
  }
  // Sub-container labels: hidden at LOD 1
  for (var cid in containerMeshes) {
    var cm = containerMeshes[cid];
    if (cm.labelDiv.className.indexOf('sub') >= 0) {
      cm.labelObj.visible = currentLOD >= 2;
    }
  }
}

// ── Edge routing: compute bezier control point to avoid obstacle nodes ──
function routeEdge(fn, tn, allNodes) {
  var x1 = fn.x, y1 = fn.y, x2 = tn.x, y2 = tn.y;
  var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  var edgeLen = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)) || 1;

  // Perpendicular direction to the edge
  var px = -(y2 - y1) / edgeLen;
  var py = (x2 - x1) / edgeLen;

  // Check each node for proximity to the straight-line edge
  var totalOffset = 0;
  var obstacleCount = 0;
  var threshold = 90; // nodes closer than this to the edge line are obstacles

  for (var i = 0; i < allNodes.length; i++) {
    var n = allNodes[i];
    if (n.id === fn.id || n.id === tn.id) continue;

    // Project node onto edge line to check if it's between endpoints
    var dx = n.x - x1, dy = n.y - y1;
    var t = (dx * (x2 - x1) + dy * (y2 - y1)) / (edgeLen * edgeLen);
    if (t < 0.05 || t > 0.95) continue; // node is beyond edge endpoints

    // Distance from node to edge line
    var closestX = x1 + t * (x2 - x1);
    var closestY = y1 + t * (y2 - y1);
    var dist = Math.sqrt((n.x - closestX) * (n.x - closestX) + (n.y - closestY) * (n.y - closestY));

    if (dist < threshold) {
      // Which side of the edge is this node? (sign of cross product)
      var side = (n.x - x1) * py - (n.y - y1) * px;
      // Push the curve to the OPPOSITE side
      var pushStrength = (threshold - dist) / threshold;
      totalOffset += (side > 0 ? -1 : 1) * pushStrength * 120;
      obstacleCount++;
    }
  }

  if (obstacleCount === 0) {
    // No obstacles — use a slight curve for visual elegance
    var offset = edgeLen * 0.05;
    return { cx: mx + px * offset, cy: my + py * offset, straight: true };
  }

  // Average offset direction, ensure minimum curve
  var avgOffset = totalOffset / obstacleCount;
  if (Math.abs(avgOffset) < 60) avgOffset = (avgOffset >= 0 ? 60 : -60);
  return { cx: mx + px * avgOffset, cy: my + py * avgOffset, straight: false };
}

// ── Tier 3a: Deterministic blob path generator ──
function blobPath(cx, cy, w, h, seed) {
  // Blob must FULLY CONTAIN the rectangle (cx-w/2, cy-h/2, w, h).
  // Use noise >= 1.0 so the blob is always at least as large as the rect.
  // Add padding so children are well inside the blob boundary.
  var padW = w * 0.12 + 20;
  var padH = h * 0.12 + 20;
  var bw = w + padW;
  var bh = h + padH;
  var points = [];
  var N = 10;
  for (var i = 0; i < N; i++) {
    var angle = (i / N) * Math.PI * 2;
    var noise = 1.0 + 0.06 * Math.sin(seed * 7.3 + i * 2.7);
    points.push({
      x: cx + (bw / 2) * Math.cos(angle) * noise,
      y: cy + (bh / 2) * Math.sin(angle) * noise
    });
  }
  var d = 'M ' + points[0].x + ',' + points[0].y;
  for (var i = 0; i < N; i++) {
    var curr = points[i];
    var next = points[(i + 1) % N];
    var prev = points[(i - 1 + N) % N];
    var nextNext = points[(i + 2) % N];
    var cp1x = curr.x + (next.x - prev.x) / 6;
    var cp1y = curr.y + (next.y - prev.y) / 6;
    var cp2x = next.x - (nextNext.x - curr.x) / 6;
    var cp2y = next.y - (nextNext.y - curr.y) / 6;
    d += ' C ' + cp1x + ',' + cp1y + ' ' + cp2x + ',' + cp2y + ' ' + next.x + ',' + next.y;
  }
  d += ' Z';
  return d;
}

// ── Tier 3c: Classify edge verb into visual type ──
function classifyEdgeType(verb) {
  if (!verb) return 'relates';
  var v = verb.toLowerCase();
  if (/\b(contains?|part.?of|includes?|has|compris)\b/.test(v)) return 'contains';
  if (/\b(produces?|generates?|feeds?|creates?|outputs?|yields?|emits?|returns?)\b/.test(v)) return 'produces';
  if (/\b(uses?|employs?|utiliz|appli|leverag|takes?|requires?|depends?|needs?|accepts?)\b/.test(v)) return 'uses';
  return 'relates';
}

// ── Tier 3a: Tone color map for blob fills ──
var toneColorMap = {
  attention: '15,120,145',
  architecture: '20,100,160',
  math: '120,50,140',
  process: '180,100,20',
  data: '30,120,50',
  result: '160,130,10',
  orphan: '80,80,90'
};

// ── Classify containers by semantic role for shape/color ──
function classifyKind(label, id) {
  var s = ((label || '') + ' ' + (id || '')).toLowerCase();
  if (/\b(attention|self.?att|multi.?head|cross.?att|focus|query|key|value|head)\b/.test(s)) return 'attention';
  if (/\b(transform|encoder|decoder|layer|stack|block|architect|network|model|module|embed|position)\b/.test(s)) return 'architecture';
  if (/\b(formula|equation|math|softmax|sqrt|matrix|vector|dot.?product|variance|norm|scale)\b/.test(s)) return 'math';
  if (/\b(train|optim|loss|gradient|learn|dropout|step|batch|regulariz|sequence)\b/.test(s)) return 'process';
  if (/\b(input|output|data|token|vocab|embed|represent|encoding|vector)\b/.test(s)) return 'data';
  if (/\b(bleu|score|result|performance|benchmark|translat|accuracy|perplexity|compar)\b/.test(s)) return 'result';
  return 'architecture';
}

// ── Create THREE.Shape from blob points ──
function blobShape(cx, cy, w, h, seed) {
  // Cap padding so large containers don't become enormous blobs
  var padW = Math.min(w * 0.12 + 20, 60);
  var padH = Math.min(h * 0.12 + 20, 60);
  var bw = w + padW;
  var bh = h + padH;
  var pts = [];
  var N = 10;
  for (var i = 0; i < N; i++) {
    var angle = (i / N) * Math.PI * 2;
    var noise = 1.0 + 0.06 * Math.sin(seed * 7.3 + i * 2.7);
    pts.push({
      x: cx + (bw / 2) * Math.cos(angle) * noise,
      y: -(cy + (bh / 2) * Math.sin(angle) * noise)
    });
  }
  var shape = new THREE.Shape();
  shape.moveTo(pts[0].x, pts[0].y);
  for (var i = 0; i < N; i++) {
    var curr = pts[i];
    var next = pts[(i + 1) % N];
    var prev = pts[(i - 1 + N) % N];
    var nextNext = pts[(i + 2) % N];
    var cp1x = curr.x + (next.x - prev.x) / 6;
    var cp1y = curr.y + (next.y - prev.y) / 6;
    var cp2x = next.x - (nextNext.x - curr.x) / 6;
    var cp2y = next.y - (nextNext.y - curr.y) / 6;
    shape.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, next.x, next.y);
  }
  return shape;
}

function renderGraph() {
  idToNode = {};
  for (var i = 0; i < graphNodes.length; i++) idToNode[graphNodes[i].id] = graphNodes[i];

  // ── Render containers as Three.js blob meshes ──
  var containers = layoutContainers || [];
  for (var c = 0; c < containers.length; c++) {
    var cont = containers[c];
    var kind = cont.isOrphan ? 'orphan' : classifyKind(idToNode[cont.id] ? idToNode[cont.id].label : '', cont.id);
    var blobTone = toneColorMap[kind] || toneColorMap.architecture;
    var toneParts = blobTone.split(',').map(Number);
    var toneColor = new THREE.Color(toneParts[0]/255, toneParts[1]/255, toneParts[2]/255);

    // Compute bounding box from child positions
    var bMinX = cont.x, bMinY = cont.y, bMaxX = cont.x + cont.w, bMaxY = cont.y + cont.h;
    var allDesc = (cont.children || []);
    for (var di = 0; di < allDesc.length; di++) {
      var dn = idToNode[allDesc[di]];
      if (dn) {
        bMinX = Math.min(bMinX, dn.x - 50);
        bMinY = Math.min(bMinY, dn.y - 45);
        bMaxX = Math.max(bMaxX, dn.x + 50);
        bMaxY = Math.max(bMaxY, dn.y + 55);
      }
    }
    var bCx = (bMinX + bMaxX) / 2;
    var bCy = (bMinY + bMaxY) / 2;
    var bW = bMaxX - bMinX;
    var bH = bMaxY - bMinY;

    var blobSeed = 0;
    for (var si = 0; si < cont.id.length; si++) blobSeed += cont.id.charCodeAt(si);

    var shape = blobShape(bCx, bCy, bW, bH, blobSeed);
    var group = new THREE.Group();

    // Fill mesh — scale opacity down for large containers so they don't dominate
    var blobArea = bW * bH;
    var fillOpacity = blobArea > 200000 ? 0.06 : blobArea > 80000 ? 0.09 : 0.14;
    var fillGeo = new THREE.ShapeGeometry(shape);
    var fillMat = new THREE.MeshBasicMaterial({
      color: toneColor, transparent: true, opacity: fillOpacity, side: THREE.DoubleSide, depthWrite: false
    });
    var fillMesh = new THREE.Mesh(fillGeo, fillMat);
    fillMesh.position.z = 0; // container layer — ground plane
    group.add(fillMesh);

    // Outline
    var outlinePts = shape.getPoints(50);
    var outlineVecs = [];
    for (var pi = 0; pi < outlinePts.length; pi++) {
      outlineVecs.push(new THREE.Vector3(outlinePts[pi].x, outlinePts[pi].y, 0));
    }
    if (outlineVecs.length > 0) outlineVecs.push(outlineVecs[0].clone());
    var outlineGeo = new THREE.BufferGeometry().setFromPoints(outlineVecs);
    var outlineMat = new THREE.LineBasicMaterial({
      color: toneColor, transparent: true, opacity: 0.5
    });
    var outline = new THREE.Line(outlineGeo, outlineMat);
    group.add(outline);

    // Container label as CSS2DObject
    var node = idToNode[cont.id];
    var labelText = cont.isOrphan ? 'Other Concepts' : (node ? (node.label || cont.id) : cont.id);
    var lblDiv = document.createElement('div');
    lblDiv.className = 'gcontainer-label';
    lblDiv.textContent = labelText;
    lblDiv.setAttribute('data-cont-id', cont.id);
    var lblObj = new CSS2DObject(lblDiv);
    lblObj.position.set(bCx, -(bMinY - 10), 10);
    group.add(lblObj);

    scene.add(group);
    containerMeshes[cont.id] = { group: group, fill: fillMesh, outline: outline, labelObj: lblObj, labelDiv: lblDiv, tone: toneColor, kind: kind, restOpacity: fillOpacity };

    // Sub-containers
    for (var k = 0; k < (cont.directChildren || []).length; k++) {
      var kid = cont.directChildren[k];
      var kidNode = idToNode[kid];
      if (kidNode && kidNode._subContainer) {
        var sc = kidNode._subContainer;
        var subKind = classifyKind(kidNode.label, kid);
        var subToneStr = toneColorMap[subKind] || toneColorMap.architecture;
        var subParts = subToneStr.split(',').map(Number);
        var subColor = new THREE.Color(subParts[0]/255, subParts[1]/255, subParts[2]/255);

        var subSeed = 0;
        for (var si2 = 0; si2 < sc.id.length; si2++) subSeed += sc.id.charCodeAt(si2);
        var subShape = blobShape(sc.x + sc.w / 2, sc.y + sc.h / 2, sc.w, sc.h, subSeed);
        var subGroup = new THREE.Group();

        var subFillGeo = new THREE.ShapeGeometry(subShape);
        var subFillMat = new THREE.MeshBasicMaterial({
          color: subColor, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false
        });
        var subFill = new THREE.Mesh(subFillGeo, subFillMat);
        subFill.position.z = 30; // sub-containers float above main containers
        subGroup.add(subFill);

        var subOutPts = subShape.getPoints(50);
        var subOutVecs = [];
        for (var spi = 0; spi < subOutPts.length; spi++) subOutVecs.push(new THREE.Vector3(subOutPts[spi].x, subOutPts[spi].y, 30));
        if (subOutVecs.length > 0) subOutVecs.push(subOutVecs[0].clone());
        var subOutGeo = new THREE.BufferGeometry().setFromPoints(subOutVecs);
        var subOutMat = new THREE.LineBasicMaterial({ color: subColor, transparent: true, opacity: 0.4 });
        var subOut = new THREE.Line(subOutGeo, subOutMat);
        subGroup.add(subOut);

        var subLblDiv = document.createElement('div');
        subLblDiv.className = 'gcontainer-label sub';
        subLblDiv.textContent = kidNode.label || kid;
        subLblDiv.setAttribute('data-cont-id', sc.id);
        var subLblObj = new CSS2DObject(subLblDiv);
        subLblObj.position.set(sc.x + sc.w / 2, -(sc.y - 5), 35);
        subGroup.add(subLblObj);

        scene.add(subGroup);
        containerMeshes[sc.id] = { group: subGroup, fill: subFill, outline: subOut, labelObj: subLblObj, labelDiv: subLblDiv, tone: subColor, kind: subKind };
      }
    }
  }

  // ── Render edges as THREE.Line with QuadraticBezierCurve3 ──
  for (var e = 0; e < graphEdges.length; e++) {
    var edge = graphEdges[e];
    var fn = idToNode[edge.from];
    var tn = idToNode[edge.to];
    if (!fn || !tn) { edgeLines.push(null); edgeCurves.push(null); edgeLabelObjects.push(null); continue; }

    var route = routeEdge(fn, tn, graphNodes);
    var curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(fn.x, -fn.y, 100),  // start at node height
      new THREE.Vector3(route.cx, -route.cy, 40), // dip toward container layer
      new THREE.Vector3(tn.x, -tn.y, 100)   // end at node height
    );
    var curvePts = curve.getPoints(30);
    var lineGeo = new THREE.BufferGeometry().setFromPoints(curvePts);
    var edgeType = classifyEdgeType(edge.verb);
    var lineOpacity = edgeType === 'contains' ? 0.15 : 0.25;
    var lineMat = new THREE.LineBasicMaterial({
      color: 0x333333, transparent: true, opacity: lineOpacity
    });
    if (edgeType === 'contains' || edgeType === 'relates') lineMat.dashSize = 4; // visual hint
    var line = new THREE.Line(lineGeo, lineMat);
    line.userData = { edgeType: edgeType, defaultOpacity: lineOpacity };
    scene.add(line);
    edgeLines.push(line);
    edgeCurves.push(curve);

    // Edge label as CSS2DObject
    var labelX = (fn.x + 2 * route.cx + tn.x) / 4;
    var labelY = -((fn.y + 2 * route.cy + tn.y) / 4 - 8);
    var lbl = document.createElement('div');
    lbl.className = 'edge-label hidden';
    if (edge.verbSvg) {
      var icon = document.createElement('div');
      icon.className = 'edge-label-icon';
      icon.innerHTML = edge.verbSvg;
      lbl.appendChild(icon);
    }
    var text = document.createElement('div');
    text.className = 'edge-label-text';
    text.textContent = edge.verb || '';
    lbl.appendChild(text);
    var lblObj = new CSS2DObject(lbl);
    lblObj.position.set(labelX, labelY, 80);
    lblObj.visible = false;
    scene.add(lblObj);
    edgeLabelObjects.push(lblObj);
  }

  // ── Render nodes as CSS2DObjects ──
  for (var i = 0; i < graphNodes.length; i++) {
    var n = graphNodes[i];
    var isContainerHeader = n._isContainer;
    var zDepth = 100;  // nodes float above containers
    var parentId = hierarchy.parentOf[n.id];
    if (parentId) zDepth = 120; // deeper children float higher

    if (isContainerHeader) {
      // Ghost node — invisible CSS2DObject for edge endpoint lookup
      var ghostDiv = document.createElement('div');
      ghostDiv.style.width = '0';
      ghostDiv.style.height = '0';
      var ghostObj = new CSS2DObject(ghostDiv);
      ghostObj.position.set(n.x, -n.y, 10);
      scene.add(ghostObj);
      nodeCss2dObjects[n.id] = ghostObj;
      nodeElements[n.id] = ghostDiv;
    } else {
      var nodeDiv = document.createElement('div');
      nodeDiv.className = 'gnode';
      nodeDiv.id = 'gnode-' + n.id;
      nodeDiv.innerHTML = '<div class="gnode-visual">' + (n.visual || '') + '</div>' +
        '<div class="gnode-label">' + (n.label || '') + '</div>';
      var nodeObj = new CSS2DObject(nodeDiv);
      nodeObj.position.set(n.x, -n.y, zDepth);
      scene.add(nodeObj);
      nodeCss2dObjects[n.id] = nodeObj;
      nodeElements[n.id] = nodeDiv;
    }
  }

  zoomToOverview();
}

// ─── Spotlight: highlight current triple via Three.js materials ───
var accentColor = new THREE.Color('${C.accent}');
var defaultEdgeColor = new THREE.Color(0x333333);

function spotlightEdge(idx) {
  if (idx === currentEdgeIdx) return;
  currentEdgeIdx = idx;

  // ── Reset all nodes — hide everything, spotlight will reveal what's needed ──
  for (var id in nodeElements) {
    var el = nodeElements[id];
    if (!el) continue;
    el.className = seenNodes[id] ? 'gnode seen' : 'gnode hidden';
    if (nodeCss2dObjects[id]) nodeCss2dObjects[id].visible = false;
  }

  // ── Hide ALL edges — only the active one + neighbors will be shown ──
  for (var i = 0; i < edgeLines.length; i++) {
    if (!edgeLines[i]) continue;
    edgeLines[i].visible = false;
  }
  for (var i = 0; i < edgeLabelObjects.length; i++) {
    if (!edgeLabelObjects[i]) continue;
    edgeLabelObjects[i].element.className = 'edge-label hidden';
    edgeLabelObjects[i].visible = false;
  }

  // ── Reset container materials to resting state (visible but muted) ──
  for (var cid in containerMeshes) {
    var cm = containerMeshes[cid];
    cm.fill.material.opacity = cm.restOpacity || 0.10;
    cm.fill.material.color.copy(cm.tone);
    cm.outline.material.opacity = 0.35;
    cm.outline.material.color.copy(cm.tone);
    cm.labelDiv.className = cm.labelDiv.className.indexOf('sub') >= 0 ? 'gcontainer-label sub' : 'gcontainer-label';
    cm.fill.material.needsUpdate = true;
    cm.outline.material.needsUpdate = true;
  }

  if (idx < 0 || idx >= graphEdges.length) {
    currentCluster = -1;
    // Show all edges and nodes in resting state for overview
    for (var i = 0; i < edgeLines.length; i++) { if (edgeLines[i]) edgeLines[i].visible = true; }
    for (var id in nodeElements) {
      if (nodeElements[id]) nodeElements[id].className = seenNodes[id] ? 'gnode seen' : 'gnode';
      if (nodeCss2dObjects[id]) nodeCss2dObjects[id].visible = true;
    }
    zoomToOverview();
    return;
  }

  var edge = graphEdges[idx];
  var edgeCluster = edge.cluster !== undefined ? edge.cluster : 0;

  // Track visited nodes
  seenNodes[edge.from] = true;
  seenNodes[edge.to] = true;

  // ── Active nodes — large and bright, force visible ──
  if (nodeElements[edge.from]) nodeElements[edge.from].className = 'gnode active';
  if (nodeElements[edge.to]) nodeElements[edge.to].className = 'gnode active';
  if (nodeCss2dObjects[edge.from]) nodeCss2dObjects[edge.from].visible = true;
  if (nodeCss2dObjects[edge.to]) nodeCss2dObjects[edge.to].visible = true;

  // ── Active containers ──
  var fromContainer = hierarchy.containerOf[edge.from] || hierarchy.parentOf[edge.from];
  var toContainer = hierarchy.containerOf[edge.to] || hierarchy.parentOf[edge.to];

  function activateContainer(contId) {
    var cm = containerMeshes[contId];
    if (!cm) return;
    cm.fill.material.color.copy(accentColor);
    cm.fill.material.opacity = Math.min(0.15, (cm.restOpacity || 0.14) + 0.03);
    cm.outline.material.color.copy(accentColor);
    cm.outline.material.opacity = 0.9;
    cm.labelDiv.className = cm.labelDiv.className.replace(/ ?active/, '') + ' active';
    cm.fill.material.needsUpdate = true;
    cm.outline.material.needsUpdate = true;
  }

  if (fromContainer) activateContainer(fromContainer);
  if (toContainer && toContainer !== fromContainer) activateContainer(toContainer);

  var fromParent = hierarchy.parentOf[edge.from];
  var toParent = hierarchy.parentOf[edge.to];
  if (fromParent && fromParent !== fromContainer && containerMeshes[fromParent]) {
    containerMeshes[fromParent].outline.material.opacity = 0.5;
    containerMeshes[fromParent].outline.material.needsUpdate = true;
  }
  if (toParent && toParent !== toContainer && containerMeshes[toParent]) {
    containerMeshes[toParent].outline.material.opacity = 0.5;
    containerMeshes[toParent].outline.material.needsUpdate = true;
  }

  // ── Show only nodes in the active containers (not all 97) ──
  function showContainerNodes(contId) {
    var kids = hierarchy.children[contId];
    if (!kids) return;
    for (var k = 0; k < kids.length; k++) {
      var kid = kids[k];
      if (nodeElements[kid] && nodeElements[kid].className.indexOf('active') < 0) {
        nodeElements[kid].className = 'gnode in-cluster';
      }
      if (nodeCss2dObjects[kid]) nodeCss2dObjects[kid].visible = true;
      showContainerNodes(kid);
    }
  }
  if (fromContainer) showContainerNodes(fromContainer);
  if (toContainer && toContainer !== fromContainer) showContainerNodes(toContainer);

  // ── Show only edges within the active cluster + the active edge ──
  // Active edge: full highlight
  if (edgeLines[idx]) {
    edgeLines[idx].visible = true;
    edgeLines[idx].material.opacity = 1;
    edgeLines[idx].material.color.copy(accentColor);
    edgeLines[idx].material.needsUpdate = true;
    emitParticles(idx);
  }
  if (edgeLabelObjects[idx]) {
    edgeLabelObjects[idx].element.className = 'edge-label active';
    edgeLabelObjects[idx].visible = true;
  }

  // Show same-cluster edges (dimmed)
  for (var i = 0; i < graphEdges.length; i++) {
    if (i === idx || !edgeLines[i]) continue;
    var e = graphEdges[i];
    var sameCluster = (e.cluster === edgeCluster);
    var touchesActive = (e.from === edge.from || e.from === edge.to || e.to === edge.from || e.to === edge.to);
    if (sameCluster || touchesActive) {
      edgeLines[i].visible = true;
      edgeLines[i].material.opacity = 0.12;
      edgeLines[i].material.color.copy(defaultEdgeColor);
      edgeLines[i].material.needsUpdate = true;
    }
  }

  currentCluster = edgeCluster;

  // Gentle camera pan toward the active edge region (not a full zoom, just a nudge)
  var focusIds = [edge.from, edge.to];
  var fb = boundsForNodeIds(focusIds);
  if (fb && graphBounds) {
    // Blend between overview center and edge center — 40% toward the active edge
    var blendX = graphBounds.cx * 0.6 + fb.cx * 0.4;
    var blendY = graphBounds.cy * 0.6 + fb.cy * 0.4;
    // Keep overview zoom distance but shift the center
    var bw = Math.max(graphBounds.w, 1);
    var bh = Math.max(graphBounds.h, 1);
    var fitH = bh / (2 * Math.tan(Math.PI / 8));
    var fitW = bw / (2 * Math.tan(Math.PI / 8) * (W / H));
    var dist = Math.max(fitH, fitW) * 1.05;
    dist = Math.max(800, Math.min(dist, 3000));
    setCameraTarget(blendX, blendY, dist);
  }
}

function edgeForTime(t) {
  var best = -1;
  for (var i = 0; i < graphEdges.length; i++) {
    if (graphEdges[i].time <= t) best = i;
    else break;
  }
  return best;
}

function setSubtitle(text) {
  document.getElementById('subtitle').textContent = text || '';
}

function updateRefPanel(idx) {
  var panel = document.getElementById('ref-panel');
  if (!panel) return;
  var ep = (idx >= 0 && idx < sceneEpisodes.length) ? sceneEpisodes[idx] : null;
  var refs = ep && ep.references ? ep.references : null;
  if (!refs) { panel.className = ''; panel.innerHTML = ''; return; }
  var formulaIds = refs.formulaIds || [];
  var figIdx = refs.figureIdx;
  var items = [];
  for (var f = 0; f < formulaIds.length; f++) {
    var formula = null;
    for (var fi = 0; fi < refFormulas.length; fi++) {
      if (refFormulas[fi].id === formulaIds[f]) { formula = refFormulas[fi]; break; }
    }
    if (!formula) continue;
    var div = document.createElement('div');
    div.className = 'ref-formula';
    var nameSpan = document.createElement('div');
    nameSpan.className = 'ref-formula-name';
    nameSpan.textContent = formula.name || formula.id;
    div.appendChild(nameSpan);
    var mathDiv = document.createElement('div');
    try { katex.render(formula.latex, mathDiv, { displayMode: true, throwOnError: false }); }
    catch(e) { mathDiv.textContent = formula.latex; }
    div.appendChild(mathDiv);
    items.push(div);
  }
  if (figIdx !== null && figIdx !== undefined && refFigures[String(figIdx)]) {
    var figDiv = document.createElement('div');
    figDiv.className = 'ref-figure';
    var img = document.createElement('img');
    img.src = refFigures[String(figIdx)];
    img.alt = 'Figure ' + (figIdx + 1);
    figDiv.appendChild(img);
    var label = document.createElement('div');
    label.className = 'ref-fig-label';
    label.textContent = 'Figure ' + (figIdx + 1);
    figDiv.appendChild(label);
    items.push(figDiv);
  }
  panel.innerHTML = '';
  if (items.length === 0) { panel.className = ''; return; }
  for (var i = 0; i < items.length; i++) panel.appendChild(items[i]);
  panel.className = 'visible';
}

var curPlayingEdge = -1;

// ── Edge particle animation via THREE.Points ──
var activeParticles = [];

function emitParticles(edgeIdx) {
  if (edgeIdx < 0 || edgeIdx >= edgeCurves.length || !edgeCurves[edgeIdx]) return;
  var curve = edgeCurves[edgeIdx];

  for (var p = 0; p < 3; p++) {
    (function(delay) {
      setTimeout(function() {
        var dotGeo = new THREE.BufferGeometry();
        dotGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
        var dotMat = new THREE.PointsMaterial({
          color: accentColor, size: 6, transparent: true, opacity: 0,
          sizeAttenuation: false, depthWrite: false
        });
        var dot = new THREE.Points(dotGeo, dotMat);
        scene.add(dot);

        var startT = performance.now();
        var dur = 1000;
        function tick() {
          var t = Math.min(1, (performance.now() - startT) / dur);
          var pt = curve.getPoint(t);
          dot.position.copy(pt);
          dot.position.z = 110;
          dotMat.opacity = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1;
          dotMat.needsUpdate = true;
          if (t < 1) requestAnimationFrame(tick);
          else { scene.remove(dot); dotGeo.dispose(); dotMat.dispose(); }
        }
        requestAnimationFrame(tick);
      }, delay);
    })(p * 350);
  }
}

// ── Per-edge audio: play clip for edge, advance when done ──
function playEdge(idx) {
  if (idx < 0 || idx >= graphEdges.length) {
    playing = false;
    updatePlayBtn();
    enterInteractiveMode();
    return;
  }
  curPlayingEdge = idx;
  spotlightEdge(idx);

  // Show subtitle and reference panel
  if (idx < graphSubs.length) setSubtitle(graphSubs[idx].text);
  updateRefPanel(idx);

  // Update progress
  document.getElementById('progress-fill').style.width = ((idx + 1) / graphEdges.length * 100) + '%';
  var cumDur = 0;
  for (var i = 0; i <= idx; i++) {
    var ea = document.getElementById('ea-' + i);
    if (ea) cumDur += ea.duration || 2;
  }
  var mins = Math.floor(cumDur / 60);
  var secs = Math.floor(cumDur % 60);
  document.getElementById('timer').textContent = mins + ':' + String(secs).padStart(2, '0');

  // Stop any currently playing audio
  if (curEdgeAudio) { curEdgeAudio.pause(); curEdgeAudio = null; }

  // Play this edge's audio clip
  var ea = document.getElementById('ea-' + idx);
  if (ea && playing) {
    ea.currentTime = 0;
    ea.onended = function() {
      if (playing) playEdge(idx + 1);
    };
    ea.play().catch(function() {
      // If audio fails, advance after 2s
      if (playing) setTimeout(function() { if (playing) playEdge(idx + 1); }, 2000);
    });
    curEdgeAudio = ea;
  } else if (playing) {
    // No audio for this edge — advance after 1.5s
    setTimeout(function() { if (playing) playEdge(idx + 1); }, 1500);
  }
}

// Fallback tick for single-audio mode (backwards compat)
var subIdx = 0;
function tick() {
  if (hasPerEdgeAudio) return; // per-edge mode doesn't use tick
  var elapsed = audio ? audio.currentTime : (Date.now() - startTime) / 1000 + pauseOffset;
  while (subIdx < graphSubs.length && graphSubs[subIdx].time <= elapsed) {
    setSubtitle(graphSubs[subIdx].text);
    subIdx++;
  }
  while (cmdIdx < commands.length && commands[cmdIdx].time <= elapsed) { cmdIdx++; }
  spotlightEdge(edgeForTime(elapsed));
  updateRefPanel(edgeForTime(elapsed));
  var mins = Math.floor(elapsed / 60);
  var secs = Math.floor(elapsed % 60);
  document.getElementById('timer').textContent = mins + ':' + String(secs).padStart(2, '0');
  document.getElementById('progress-fill').style.width = (elapsed / duration * 100) + '%';
  if (playing && (audio ? !audio.ended : elapsed < duration)) {
    animFrame = requestAnimationFrame(tick);
  } else if (audio ? audio.ended : elapsed >= duration) {
    playing = false; updatePlayBtn();
    enterInteractiveMode();
  }
}

function togglePlay() {
  playing = !playing;
  updatePlayBtn();
  if (playing) {
    if (hasPerEdgeAudio) {
      // Per-edge mode: play from current edge
      playEdge(curPlayingEdge < 0 ? 0 : curPlayingEdge);
    } else {
      if (audio) { audio.play().catch(function(){}); }
      else { startTime = Date.now(); }
      animFrame = requestAnimationFrame(tick);
    }
  } else {
    if (curEdgeAudio) { curEdgeAudio.pause(); }
    if (audio) { audio.pause(); pauseOffset = audio.currentTime; }
    else { pauseOffset += (Date.now() - startTime) / 1000; }
    cancelAnimationFrame(animFrame);
  }
}

function updatePlayBtn() {
  var b = document.getElementById('btn-play');
  b.innerHTML = playing ? '&#9646;&#9646; Pause' : '&#9654; Play';
  b.className = 'btn' + (playing ? ' active' : '');
}

function restart() {
  playing = false;
  updatePlayBtn();
  cancelAnimationFrame(animFrame);
  cmdIdx = 0;
  subIdx = 0;
  pauseOffset = 0;
  currentEdgeIdx = -1;
  currentCluster = -1;
  curPlayingEdge = -1;
  seenNodes = {};
  narrationComplete = false;
  document.getElementById('replay-btn').style.display = 'none';
  // Remove interactive click handlers
  for (var nid in nodeElements) {
    if (nodeElements[nid]) nodeElements[nid].onclick = null;
  }
  if (activeTooltip) { activeTooltip.remove(); activeTooltip = null; }
  if (curEdgeAudio) { curEdgeAudio.pause(); curEdgeAudio = null; }
  if (audio) audio.currentTime = 0;
  setSubtitle('');
  updateRefPanel(-1);
  document.getElementById('timer').textContent = '0:00';
  document.getElementById('progress-fill').style.width = '0%';
  spotlightEdge(graphEdges.length > 0 ? 0 : -1);
}

function seek(e) {
  var rect = e.currentTarget.getBoundingClientRect();
  var pct = (e.clientX - rect.left) / rect.width;
  var targetTime = pct * duration;
  cmdIdx = 0;
  subIdx = 0;
  currentEdgeIdx = -1;
  currentCluster = -1;
  if (audio) audio.currentTime = targetTime;
  else { pauseOffset = targetTime; startTime = Date.now(); }
  while (subIdx < graphSubs.length && graphSubs[subIdx].time <= targetTime) {
    setSubtitle(graphSubs[subIdx].text);
    subIdx++;
  }
  while (cmdIdx < commands.length && commands[cmdIdx].time <= targetTime) { cmdIdx++;
  }
  spotlightEdge(edgeForTime(targetTime));
}

// ── Tier 4b: Interactive mode after narration ends ──
function enterInteractiveMode() {
  if (narrationComplete) return;
  narrationComplete = true;
  updateRefPanel(-1);
  zoomToOverview();

  // Show all nodes at moderate opacity
  for (var nid in nodeElements) {
    if (nodeElements[nid]) {
      nodeElements[nid].className = 'gnode seen';
    }
  }

  document.getElementById('replay-btn').style.display = 'block';

  // Build edge map per node
  var nodeEdgeMap = {};
  for (var i = 0; i < graphNodes.length; i++) nodeEdgeMap[graphNodes[i].id] = [];
  for (var e = 0; e < graphEdges.length; e++) {
    if (nodeEdgeMap[graphEdges[e].from]) nodeEdgeMap[graphEdges[e].from].push(e);
    if (nodeEdgeMap[graphEdges[e].to]) nodeEdgeMap[graphEdges[e].to].push(e);
  }

  // Build subtitle map per node
  var nodeSubMap = {};
  for (var e = 0; e < graphEdges.length; e++) {
    var sub = (e < graphSubs.length) ? graphSubs[e].text : '';
    if (!nodeSubMap[graphEdges[e].from]) nodeSubMap[graphEdges[e].from] = [];
    if (!nodeSubMap[graphEdges[e].to]) nodeSubMap[graphEdges[e].to] = [];
    if (sub && nodeSubMap[graphEdges[e].from].indexOf(sub) < 0) nodeSubMap[graphEdges[e].from].push(sub);
    if (sub && nodeSubMap[graphEdges[e].to].indexOf(sub) < 0) nodeSubMap[graphEdges[e].to].push(sub);
  }

  // Add click handlers
  for (var i = 0; i < graphNodes.length; i++) {
    (function(nid) {
      var el = nodeElements[nid];
      if (!el) return;
      el.style.cursor = 'pointer';
      el.onclick = function(ev) {
        ev.stopPropagation();
        if (activeTooltip) { activeTooltip.remove(); activeTooltip = null; }

        // Reset all
        for (var id in nodeElements) {
          if (nodeElements[id]) nodeElements[id].className = 'gnode seen';
        }
        for (var j = 0; j < edgeLines.length; j++) {
          if (!edgeLines[j]) continue;
          edgeLines[j].material.opacity = edgeLines[j].userData.defaultOpacity;
          edgeLines[j].material.color.copy(defaultEdgeColor);
          edgeLines[j].material.needsUpdate = true;
        }

        // Highlight this node
        el.className = 'gnode active';

        // Highlight connected edges + neighbors
        var edges = nodeEdgeMap[nid] || [];
        for (var j = 0; j < edges.length; j++) {
          var eIdx = edges[j];
          if (edgeLines[eIdx]) {
            edgeLines[eIdx].material.opacity = 1;
            edgeLines[eIdx].material.color.copy(accentColor);
            edgeLines[eIdx].material.needsUpdate = true;
          }
          var neighbor = graphEdges[eIdx].from === nid ? graphEdges[eIdx].to : graphEdges[eIdx].from;
          if (nodeElements[neighbor]) nodeElements[neighbor].className = 'gnode neighbor';
        }

        // Tooltip
        var subs = nodeSubMap[nid] || [];
        if (subs.length > 0) {
          var tip = document.createElement('div');
          tip.className = 'gnode-tooltip';
          tip.textContent = subs[0];
          var tipObj = new CSS2DObject(tip);
          var nn = idToNode[nid];
          if (nn) tipObj.position.set(nn.x, -nn.y + 30, 50);
          scene.add(tipObj);
          activeTooltip = tipObj;
        }
      };
    })(graphNodes[i].id);
  }

  // Click on empty space to deselect
  webglRenderer.domElement.addEventListener('click', function(ev) {
    if (!narrationComplete) return;
    // Only deselect if clicking on empty space (not a node)
    if (ev.target !== webglRenderer.domElement) return;
    if (activeTooltip) { scene.remove(activeTooltip); activeTooltip = null; }
    for (var id in nodeElements) {
      if (nodeElements[id]) nodeElements[id].className = 'gnode seen';
    }
    for (var j = 0; j < edgeLines.length; j++) {
      if (!edgeLines[j]) continue;
      edgeLines[j].material.opacity = edgeLines[j].userData.defaultOpacity;
      edgeLines[j].material.color.copy(defaultEdgeColor);
      edgeLines[j].material.needsUpdate = true;
    }
  });
}

// ── Minimap ──
var minimapCanvas = document.getElementById('minimap');
var minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;

function drawMinimap() {
  if (!minimapCtx || !graphBounds || !camera) return;
  var mc = minimapCtx;
  var mw = 150, mh = 100;
  mc.clearRect(0, 0, mw, mh);

  var bx = graphBounds.x, by = graphBounds.y;
  var bw = Math.max(graphBounds.w, 1), bh = Math.max(graphBounds.h, 1);
  var sx = mw / bw, sy = mh / bh;
  var scale = Math.min(sx, sy) * 0.9;
  var ox = (mw - bw * scale) / 2;
  var oy = (mh - bh * scale) / 2;

  // Draw containers
  var containers = layoutContainers || [];
  for (var c = 0; c < containers.length; c++) {
    var cont = containers[c];
    if (!cont.w) continue;
    var rx = ox + (cont.x - bx) * scale;
    var ry = oy + (cont.y - by) * scale;
    var rw = cont.w * scale;
    var rh = cont.h * scale;
    mc.strokeStyle = 'rgba(79,195,247,0.4)';
    mc.lineWidth = 1;
    mc.strokeRect(rx, ry, rw, rh);
    mc.fillStyle = 'rgba(79,195,247,0.08)';
    mc.fillRect(rx, ry, rw, rh);
  }

  // Viewport from PerspectiveCamera
  var camDist = camera.position.z || 1000;
  var vFov = camera.fov * Math.PI / 180;
  var vh = 2 * Math.tan(vFov / 2) * camDist;
  var vw = vh * camera.aspect;
  var vx = controls.target.x - vw / 2;
  var vy = -controls.target.y - vh / 2; // negate back to layout coords
  var vrx = ox + (vx - bx) * scale;
  var vry = oy + (vy - by) * scale;
  var vrw = vw * scale;
  var vrh = vh * scale;
  mc.strokeStyle = 'rgba(255,183,77,0.7)';
  mc.lineWidth = 1.5;
  mc.strokeRect(vrx, vry, vrw, vrh);
}

// ─── Continuous render loop ───
function animate() {
  requestAnimationFrame(animate);

  // Smooth camera + orbit target animation
  if (cameraTarget) {
    var lerpSpeed = 0.06;
    var dx = cameraTarget.cx - camera.position.x;
    var dy = cameraTarget.cy - camera.position.y;
    var dz = cameraTarget.cz - camera.position.z;
    var dtx = cameraTarget.tx - controls.target.x;
    var dty = cameraTarget.ty - controls.target.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || Math.abs(dz) > 1) {
      camera.position.x += dx * lerpSpeed;
      camera.position.y += dy * lerpSpeed;
      camera.position.z += dz * lerpSpeed;
      controls.target.x += dtx * lerpSpeed;
      controls.target.y += dty * lerpSpeed;
      controls.target.z = 0;
    }
  }

  controls.update();
  webglRenderer.render(scene, camera);
  css2dRenderer.render(scene, camera);
  drawMinimap();
}

// ─── Window exports for inline HTML handlers + iframe API ───
window.togglePlay = togglePlay;
window.restart = restart;
window.seek = seek;
window.spotlightEdge = spotlightEdge;
window.setSubtitle = setSubtitle;
window.enterInteractiveMode = enterInteractiveMode;

// ─── Message handler ───
window.addEventListener('message', function(e) {
  if (e.data === 'play') { if (!playing) togglePlay(); }
  else if (e.data === 'pause') { if (playing) togglePlay(); }
  else if (e.data === 'restart') { restart(); }
  else if (e.data === 'autoplay') { restart(); togglePlay(); }
});

// ─── Initialize ───
initScene();
layoutGraph();
renderGraph();
zoomToOverview();
animate();

if (window.parent !== window) {
  setTimeout(function() { restart(); togglePlay(); }, 2500);
}
<\/script></body></html>`;
}

// ═══════════════════════════════════════
// SEMANTIC PARSER — structured entity extraction pipeline
// ═══════════════════════════════════════

/**
 * Generate commands using the visual semantic parser.
 * Every concept in the narration gets a proper visual representation.
 *
 * This is the v2 pipeline:
 *   sentences → entity extraction (LLM) → concept-to-visual (deterministic) → scene graph → commands
 */
export async function generateSemanticCommands(narration, context = '', options = {}) {
  return parseNarrationToCommands(narration, context, options);
}

// ═══════════════════════════════════════
// CONVENIENCE: narration text → streaming player HTML
// ═══════════════════════════════════════

/**
 * @param {object} options
 * @param {boolean} options.semantic - Use semantic parser (default: true). Set false for legacy LLM-only pipeline.
 */
export async function translateToStreamingVisual(narration, title = '', audioBase64 = null, audioDuration = 0, context = '', options = {}) {
  const { semantic = true, ...passthrough } = options;
  let commands;
  if (semantic) {
    commands = await generateSemanticCommands(narration, context, passthrough);
  } else {
    commands = await generateCommands(narration, context, passthrough);
  }
  return compileStreamingPlayer(commands, title, audioBase64, audioDuration);
}
