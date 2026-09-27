/**
 * Visual Semantic Parser
 *
 * NLP → Entity Extraction → Concept-to-Visual Mapping → Scene Graph → Streaming Commands
 *
 * The goal: EVERY concept mentioned in speech gets a visual representation.
 * "matrices" → show a matrix grid. "projection" → show an arrow labeled W.
 * "Multi-Head Attention contains Q, K, V" → big box with small boxes inside.
 *
 * Pipeline:
 *   1. extractEntities(sentence, context)  → typed entities from LLM
 *   2. conceptToVisual(entity)             → deterministic MathSign visual spec
 *   3. SceneGraph.update(entities)         → incremental scene with containment
 *   4. SceneGraph.diffCommands(time)       → streaming commands for the player
 */

import { drawConcept, hasVisual, getVerbStyle, getVerbCSS, drawVerb, VISUAL_ALPHABET, VERB_ANIMATIONS } from './visual-alphabet.mjs';
import { compose, getRelation, RELATION_TYPES } from './visual-grammar.mjs';
import { composeSVO, entitiesToSVOs } from './svo-composer.mjs';
import { generateText, extractJsonObject } from '../llm/openai-client.mjs';

// ═══════════════════════════════════════
// CONCEPT VOCABULARY — deterministic visual mappings
// ═══════════════════════════════════════

const C = {
  bg: '#1a1a2e', text: '#e0e0e0', primary: '#4FC3F7', accent: '#FFB74D',
  success: '#81C784', danger: '#EF9A9A', purple: '#CE93D8', muted: '#6a6a7a'
};

/**
 * Map a typed entity to a visual node spec for the streaming player.
 * Uses the Visual Alphabet — each concept type renders as its ACTUAL visual form.
 *   "matrix" → real grid with brackets, not a box labeled "Matrix"
 *   "rnn" → cell with recurrent loop, not a box labeled "RNN"
 */
export function conceptToVisual(entity) {
  const type = entity.type || 'default';

  // Special case: flow entities are connections, not visual objects
  if (type === 'flow') {
    return { cmd: 'connect', from: entity.from, to: entity.to, label: entity.label || '' };
  }

  // Special case: formula — pinned at center, not pushed by tunnel
  if (type === 'formula') {
    return { cmd: 'add', id: entity.id || `formula_inline_${Date.now()}`, type: 'formula', tex: entity.tex || entity.label, label: entity.label, pinned: true };
  }

  // Use the Visual Alphabet to generate an inline SVG for this concept
  const svgHtml = drawConcept(type, entity.label, {});

  return {
    cmd: 'add',
    id: entity.id,
    type: 'visual',
    visual: svgHtml,
    label: entity.label,
  };
}

// ═══════════════════════════════════════
// ENTITY EXTRACTION — LLM structured output
// ═══════════════════════════════════════

const CONCEPT_TYPES = Object.keys(VISUAL_ALPHABET).filter(k => k !== 'default').join(', ');
const VERB_TYPES = Object.keys(VERB_ANIMATIONS).join(', ');

/**
 * Extract typed entities from a batch of sentences.
 * Returns a map: sentenceIndex → [entity, entity, ...]
 */
export async function extractEntities(sentences, context = '') {
  const numbered = sentences.map((s, i) => `${i + 1}. "${s.text}"`).join('\n');

  const raw = await generateText({
    prompt: `Visual semantic parser. RELATIONSHIPS FIRST — understanding IS the relationships between concepts, not the concepts themselves.

SENTENCES:
${numbered}

CONTEXT: ${context || 'Technical/scientific content'}

NOUN TYPES: ${CONCEPT_TYPES}

VERB RULES — Use the EXACT SPECIFIC verb from the sentence. Do NOT generalize.
- If the sentence says "replaces", use "replaces" — not "eliminates"
- If the sentence says "enables", use "enables" — not "creates"
- If the sentence says "outperforms", use "outperforms" — not "compares"
- Keep the PRECISE verb that conveys the SPECIFIC relationship
- For relations: use the verb that BEST describes how subject relates to object

GOOD verbs (specific, informative): replaces, enables, requires, outperforms, eliminates, computes, transforms, captures, prevents, contains, produces, achieves, operates_on, feeds_into, consists_of, constrains, scales_with, reduces, improves, leverages, projects, attends_to, normalizes
BAD verbs (too generic): does, has, is, uses, makes, gets — AVOID these. Find the specific action.

CRITICAL RULES:
1. Extract ALL important nouns — every concept the narrator mentions that carries meaning. If they say "representation z", extract z as a noun. If they say "feed-forward network", extract it. Do NOT drop concepts. Named items (h₁, h₂, h₃ / Q, K, V) must each be separate entities.
2. NEVER extract meta-words: "diagram", "figure", "arrows", "screen", "image", "example", "illustration", "table", "chart", "paper", "section", "slide", "picture". These refer to the presentation itself, not to the content.
3. EVERY verb in the sentence gets an action entity.
4. INLINE FORMULAS: If the sentence contains a mathematical expression (e.g. "LayerNorm(x + Sublayer(x))" or "O(n² · d)"), extract it as: { "type": "formula", "tex": "\\text{LayerNorm}(x + \\text{Sublayer}(x))" }. Convert to LaTeX notation.
5. LABELS — what the viewer reads on screen. Every entity MUST have a label that is a complete, human-readable noun phrase (2–6 words). The label is independent of the id and must stand on its own without context.
   - Reconstruct the FULL concept the way the narrator would say it out loud. If the sentence is about translating between two languages, the label is "English-French translation" — not "english-french", not "translation", not "en_fr".
   - Promote modifiers and prepositional context into the label: "X of Y" → "Y X" or "X of Y"; "X between A and B" → "A-B X"; "X for Y" → "X for Y". Never strip the qualifier that gives the noun its meaning.
   - Use natural capitalization (Title Case for proper nouns and named methods, Sentence case otherwise). Use spaces and hyphens — NEVER underscores, NEVER snake_case, NEVER lowercase slugs.
   - No abbreviations the viewer wouldn't immediately recognize. Expand them: "pos enc" → "Positional encoding"; "lr" → "Learning rate"; "kg" → "Knowledge graph"; "rnn" → "Recurrent neural network".
   - A label that is one bare lowercase token (e.g. "attention", "translation", "loss") is almost always wrong — ask yourself "attention to what? translation of what? loss of what?" and put the answer in the label.
6. IDs: short snake_case, used ONLY for wiring nodes together across sentences. Reuse the SAME id whenever the same concept reappears. Ids may be terse; labels must not.
7. USE THE MOST SPECIFIC noun type. Critical mappings:
   - "faster/efficient/speed" → type="faster"
   - "slower/slow" → type="slower"
   - "less/fewer/smaller" → type="less"
   - "more/greater/larger" → type="greater"
   - "dimension/dim" → type="dimension"
   - "length" → type="length"
   - "complexity/order/O()" → type="complexity"
   - "representation/feature/encoding" → type="representation"
   - "architecture/structure/model" → type="architecture"
   - "bottleneck/constraint" → type="bottleneck"
   - "parallel/parallelization" → type="parallelization"
   - "self-attention" → type="self_attention"
   - "recurrence/sequential" → type="recurrence"
   - "layer" → type="layer"
   - "input" → type="input"
   - "output" → type="output"
   - "weight/parameter" → type="weight"
   - "training" → type="training"
   - "square root/sqrt" → type="sqrt"
   - "squared/n²/d²" → type="squared"
   - "person/human/individual" → type="person"
   - "researcher/scientist/author/expert" → type="researcher"
   - "group/team/community/population" → type="group"
   - "teacher/professor/instructor" → type="teacher"
   - "student/learner" → type="student"
   - "king/leader/ruler" → type="king"
   - "queen" → type="queen"
   - "speech/language/communication" → type="speech"
   - "word/text/sentence" → type="word"
   - "document/paper/article/publication" → type="document"
   - "question/inquiry" → type="question"
   - "idea/concept/thought/hypothesis" → type="idea"
   - "time/duration/period/epoch" → type="time"
   - "goal/objective/target" → type="goal"
   - "problem/challenge/limitation" → type="problem"
   - "solution/method/approach/technique" → type="solution"
   - "success/achievement/breakthrough" → type="success"
   - "warning/danger/risk/error/failure" → type="warning"
   - "rule/law/principle" → type="rule"
   - "evidence/proof/data/experiment" → type="evidence"
   - "relationship/connection/link" → type="relationship"
   - "category/class/type/kind" → type="category"
   - "world/environment/context/domain" → type="world"
   - "energy/power/force" → type="energy"

8. RELATIONSHIPS ARE THE MOST IMPORTANT OUTPUT. Every sentence MUST have at least one relation.
   The visual language shows HOW concepts relate — that's where understanding lives.
   Relation types: ${RELATION_TYPES.join(', ')}
   - "Attention REPLACES recurrence" → relation: "replaces", subject: "attention", object: "recurrence"
   - "Encoder CONTAINS attention layers" → relation: "contains", subject: "encoder", object: "attn_layers"
   - "Input PRODUCES output" → relation: "produces", subject: "input", object: "output"
   - "Self-attention is FASTER than recurrence" → relation: "better_than", subject: "self_attn", object: "recurrence"
   - "Each state DEPENDS ON the previous" → relation: "depends_on", subject: "state", object: "prev_state"
   - "Data TRANSFORMS into embeddings" → relation: "transforms_into", subject: "data", object: "embeddings"
   - "A then B then C" → relation: "sequence_of", subject: "a", object: "b"
   - "Layers run in parallel" → relation: "parallel", subject: "layer1", object: "layer2"
   If you don't include a relation, the visual will show isolated flashcards with no meaning.

Return JSON (note how every label is a complete noun phrase, not a slug):
{
  "entities": [
    { "sentence": 1, "id": "self_attn",   "label": "Self-attention mechanism",     "type": "self_attention" },
    { "sentence": 1, "id": "recurrence",  "label": "Recurrent processing",          "type": "recurrence" },
    { "sentence": 1, "type": "action", "verb": "eliminate", "target": "recurrence" },
    { "sentence": 1, "type": "relation", "relation": "replaces", "subject": "self_attn", "object": "recurrence" },
    { "sentence": 2, "id": "en_fr_trans", "label": "English-French translation",    "type": "solution" },
    { "sentence": 2, "id": "bleu_score",  "label": "BLEU evaluation score",         "type": "evidence" },
    { "sentence": 2, "type": "relation", "relation": "produces", "subject": "en_fr_trans", "object": "bleu_score" }
  ],
  "sections": [
    { "start": 1, "end": 3, "topic": "From recurrence to attention" }
  ]
}

Notice: ids are terse (en_fr_trans), but labels are full descriptive phrases ("English-French translation"). NEVER swap them.

Return ONLY valid JSON.`
    ,
    maxTokens: 3000
  });

  return extractJsonObject(raw) || { entities: [], sections: [] };
}

// ═══════════════════════════════════════
// SCENE GRAPH — incremental state manager
// ═══════════════════════════════════════

export class SceneGraph {
  constructor() {
    this.nodes = new Map();      // id → { entity, visual, addedAt, lastMentioned }
    this.connections = [];        // [{ from, to, label }]
    this.currentSection = null;
    this.nextX = 100;
    this.nextY = 100;
    this.maxOnScreen = 999;      // no limit — pulses self-remove via CSS animation
    this.addCounter = 0;        // monotonic counter for add order
  }

  /**
   * Generate commands for a sentence using SVO triangle structure.
   *
   * Each sentence produces exactly ONE visual: an SVO triangle showing
   * Subject (shape+label) — Verb (gesture+label) — Object (shape+label).
   * Previous sentence's triangle is removed before the new one appears.
   */
  generateCommands(sentenceIdx, sentenceEntities, time, sectionTopic = null) {
    const commands = [];

    // Section change — just track it, don't clear. Pulses self-remove via animation.
    if (sectionTopic) this.currentSection = sectionTopic;

    // Build ALL SVOs from this sentence's entities
    const svos = entitiesToSVOs(sentenceEntities);
    if (!svos || svos.length === 0) return commands;

    // DON'T remove old pulses — let them finish their tunnel journey naturally.
    // The CSS animation handles their full lifecycle (auto-remove on animationend).
    // Just clear tracking so new pulses can be added.
    this.nodes.clear();

    // Build GRAPH commands — each SVO becomes nodes + edge
    const svoGap = 2.5;
    let totalDelay = 0;
    let pulseIdx = 0;

    function toCleanLabel(value, fallback = '') {
      return String(value ?? fallback).replace(/_/g, ' ').trim();
    }

    function toSafeId(value, fallback) {
      return String(value ?? fallback)
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '') || 'node';
    }

    for (const svo of svos) {
      const sLabel = svo.subject ? toCleanLabel(svo.subject.label, svo.subject.id || 'subject') : null;
      const oLabel = svo.object ? toCleanLabel(svo.object.label, svo.object.id || 'object') : null;
      const vLabel = svo.verb ? toCleanLabel(svo.verb, 'relates to') : null;

      // Emit graph nodes for subject and object
      if (svo.subject) {
        const svg = drawConcept(svo.subject.type || 'default', sLabel);
        commands.push({
          time: time + totalDelay,
          cmd: 'graph_node',
          id: toSafeId(svo.subject.id, sLabel),
          label: sLabel,
          visual: svg,
          nodeType: svo.subject.type || 'default'
        });
      }
      if (svo.object) {
        const svg = drawConcept(svo.object.type || 'default', oLabel);
        commands.push({
          time: time + totalDelay,
          cmd: 'graph_node',
          id: toSafeId(svo.object.id, oLabel),
          label: oLabel,
          visual: svg,
          nodeType: svo.object.type || 'default'
        });
      }

      // Emit graph edge (the predicate connecting subject → object)
      if (svo.subject && svo.object && svo.verb) {
        const verbSvg = drawVerb(String(svo.verb));
        const sId = toSafeId(svo.subject.id, sLabel);
        const oId = toSafeId(svo.object.id, oLabel);
        commands.push({
          time: time + totalDelay,
          cmd: 'graph_edge',
          from: sId, to: oId,
          verb: vLabel,
          verbSvg: verbSvg,
          edgeId: `e_${sentenceIdx}_${pulseIdx}`
        });
      }

      this.addCounter++;
      totalDelay += svoGap;
      pulseIdx++;
    }

    return commands;
  }

  /**
   * Find a position for a new entity using percentage-based coordinates (0-100).
   *
   * Layout rules:
   * - Children of the same parent are placed HORIZONTALLY next to each other, below the parent.
   * - Top-level entities fill a grid row by row.
   * - Everything stays within safe bounds (5%-92% x, 5%-80% y).
   */
  _findPosition(entity) {
    // CENTER-FIRST: everything as close to center as possible.
    // Minimum distance to avoid overlap, penalize distance from center.

    const cx = 50, cy = 50;
    const n = this.nodes.size;

    if (n === 0) return { x: cx, y: cy };

    // Place items in a tight ring around center.
    // Minimum spacing: 15% (~90px on 600px canvas — just enough to not overlap)
    const minSpacing = 15;

    // Arrange in a circle of radius = minSpacing, centered on cx,cy
    // Golden angle gives best non-overlapping distribution
    const angle = n * 137.508 * Math.PI / 180;
    const ring = Math.ceil(n / 4); // which ring (1st ring = 4 items, 2nd = 8, etc)
    const r = ring * minSpacing;

    return {
      x: Math.max(15, Math.min(85, cx + r * Math.cos(angle) * 0.6)),
      y: Math.max(20, Math.min(80, cy + r * Math.sin(angle) * 0.4))
    };
  }
}

// ═══════════════════════════════════════
// MASTER PIPELINE — narration → streaming commands
// ═══════════════════════════════════════

const WPM = 155;

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

/**
 * Full pipeline: narration text → array of streaming commands.
 *
 * 1. Split narration into timed sentences
 * 2. Batch-extract entities from all sentences via LLM
 * 3. For each sentence, update scene graph and collect commands
 * 4. Return sorted command list for the streaming player
 */
export async function parseNarrationToCommands(narration, context = '', options = {}) {
  const { formulaLatex = null, formulaAll = null, figureBase64 = null, figureLabel = '' } = options;
  const sentences = splitIntoTimedSentences(narration);

  console.log(`[SemanticParser] ${sentences.length} sentences, extracting entities...`);

  // Step 1: Extract entities, then VERIFY they capture the meaning
  let extraction = await extractEntities(sentences, context);
  let { entities, sections } = extraction;

  // SEMANTIC VERIFICATION: check if extracted entities cover the key concepts
  // Extract key technical terms from the narration
  const technicalTerms = narration.toLowerCase().match(
    /\b(transformer|attention|self-attention|encoder|decoder|rnn|lstm|feedforward|feed-forward|softmax|normalization|embedding|token|layer|parallel|sequential|bottleneck|recurrent|recurrence|matrix|vector|query|key|value|gradient|weight|bias|neuron|convolution|pooling|dropout|representation|dependency|dependencies|inference|training|architecture)\b/g
  ) || [];
  const uniqueTerms = [...new Set(technicalTerms)];
  const extractedLabels = entities.filter(e => e.type !== 'flow' && e.type !== 'action' && e.type !== 'relation')
    .map(e => (e.label || '').toLowerCase());
  const missingTerms = uniqueTerms.filter(t => !extractedLabels.some(l => l.includes(t) || t.includes(l)));

  if (missingTerms.length > 0 && missingTerms.length >= uniqueTerms.length * 0.4) {
    // Too many key terms missing — re-extract with explicit guidance
    console.log(`[SemanticParser] Missing key terms: ${missingTerms.join(', ')} — re-extracting`);
    extraction = await extractEntities(sentences, context + `. IMPORTANT: You MUST include these concepts as entities: ${missingTerms.join(', ')}`);
    entities = extraction.entities;
    sections = extraction.sections;
  }

  console.log(`[SemanticParser] Extracted ${entities.length} entities in ${sections.length} sections`);

  // Step 2: Group entities by sentence, enforce limits
  const entitiesBySentence = {};
  for (const e of entities) {
    const idx = e.sentence;
    if (!entitiesBySentence[idx]) entitiesBySentence[idx] = [];
    entitiesBySentence[idx].push(e);
  }

  // POST-PROCESSING: filter junk entities and enforce cap
  const JUNK_LABELS = new Set([
    'step', 'next step', 'previous step', 'time', 'problem', 'solution',
    'way', 'thing', 'part', 'side', 'point', 'case', 'example', 'result',
    'powerful hardware', 'hardware', 'painfully slow', 'slow', 'fast',
    'long sequences', 'short sequences', 'entire sequence',
    'next', 'previous', 'current', 'first', 'second', 'third',
    'limitation', 'advantage', 'disadvantage', 'issue', 'nature',
    'design', 'ability', 'power', 'information', 'data',
    'word', 'words', 'sentence', 'sentences', 'distance', 'positions',
    'shift', 'improvement', 'minor improvement', 'paradigm shift',
    'today', 'model', 'models', 'breakthrough', 'connection', 'connections',
  ]);
  for (const key of Object.keys(entitiesBySentence)) {
    let all = entitiesBySentence[key];
    // Remove junk/generic entities
    all = all.filter(e => {
      if (e.type === 'flow' || e.type === 'action' || e.type === 'relation') return true;
      const label = (e.label || '').toLowerCase();
      return !JUNK_LABELS.has(label);
    });
    // Hard cap: max 3 nouns per sentence — keep most specific types
    const nouns = all.filter(e => e.type !== 'flow' && e.type !== 'action' && e.type !== 'relation');
    const others = all.filter(e => e.type === 'flow' || e.type === 'action' || e.type === 'relation');
    entitiesBySentence[key] = [...nouns.slice(0, 3), ...others];
  }

  // Build section lookup: sentenceIdx → section topic
  const sectionLookup = {};
  for (const sec of sections) {
    for (let i = sec.start; i <= sec.end; i++) {
      sectionLookup[i] = sec.topic;
    }
  }

  // Step 3: Build commands via scene graph
  const graph = new SceneGraph();
  const allCommands = [];

  // ── FIGURES: show first, pinned on left side ──
  // Figures are big content — give the reader time to look
  let contentDelay = 0; // extra seconds before narration entities start

  if (figureBase64) {
    allCommands.push({ time: 0, cmd: 'image', id: 'figure', src: figureBase64, label: figureLabel, x: 250, y: 250, pinned: true });
    contentDelay += 3; // 3 seconds to view the figure before narration visuals begin
  }

  // ── FORMULAS: show ALL formulas, each as a separate pinned card ──
  // Formula display time: ~2s per formula (more for complex ones)
  const allFormulas = formulaAll || (formulaLatex ? [formulaLatex] : []);
  for (let fi = 0; fi < allFormulas.length; fi++) {
    const tex = allFormulas[fi];
    if (!tex) continue;
    const formulaTime = contentDelay + fi * 2.5; // stagger formulas 2.5s apart
    allCommands.push({
      time: formulaTime,
      cmd: 'add',
      id: `formula_${fi}`,
      type: 'formula',
      tex: tex,
      pinned: true, // don't push out of tunnel
      x: 50, y: 50
    });
    // Extra viewing time proportional to formula complexity
    const formulaComplexity = tex.length > 80 ? 4 : tex.length > 40 ? 3 : 2;
    contentDelay = formulaTime + formulaComplexity;
  }

  // ── DEDUP: Remove formula entities that duplicate pre-pinned formulas ──
  const pinnedTexSet = new Set(allFormulas.map(f => f.toLowerCase().trim()));
  for (const key of Object.keys(entitiesBySentence)) {
    entitiesBySentence[key] = entitiesBySentence[key].filter(e => {
      if (e.type === 'formula' && e.tex) {
        const normalized = e.tex.toLowerCase().trim();
        if (pinnedTexSet.has(normalized) || [...pinnedTexSet].some(p => normalized.includes(p.substring(0, 20)) || p.includes(normalized.substring(0, 20)))) {
          return false; // duplicate — already pinned
        }
      }
      return true;
    });
  }

  // Tell the scene graph how much vertical space is reserved for pinned items
  graph.pinnedTopOffset = allFormulas.length > 0 ? 25 : (figureBase64 ? 15 : 0);

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const sentenceEntities = entitiesBySentence[i + 1] || []; // 1-indexed
    const sectionTopic = sectionLookup[i + 1] || null;

    // Shift sentence timing by contentDelay (wait for figures/formulas to be viewed first)
    const adjustedTime = sentence.startTime + contentDelay;

    // Subtitle for this sentence
    allCommands.push({ time: adjustedTime, cmd: 'subtitle', text: sentence.text });

    // Scene graph diff → commands
    const cmds = graph.generateCommands(i, sentenceEntities, adjustedTime, sectionTopic);
    allCommands.push(...cmds);
  }

  // Fallback: if no entities extracted at all, at least show subtitles
  if (entities.length === 0) {
    console.warn('[SemanticParser] No entities extracted, falling back to subtitles only');
    return sentences.map(s => ({ time: s.startTime, cmd: 'subtitle', text: s.text }));
  }

  // Completeness report
  const uniqueEntities = new Set(entities.filter(e => e.type !== 'flow').map(e => e.id));
  const visualCommands = allCommands.filter(c => c.cmd === 'add');
  console.log(`[SemanticParser] Completeness: ${visualCommands.length} visuals for ${uniqueEntities.size} unique concepts`);

  // Apply layout optimizer — the 4 penalties
  const { optimizeCommands: optimize } = await import('./layout-optimizer.mjs');
  const optimized = optimize(allCommands.sort((a, b) => (a.time || 0) - (b.time || 0)), narration);
  return optimized;
}
