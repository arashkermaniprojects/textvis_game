/**
 * Layout Optimizer — Penalty-based scoring for visual sign placement.
 *
 * Four penalties, weighted and combined:
 *
 *   1. IMPORTANCE PENALTY: Missing important words from the narration
 *      - Each technical term has an importance score
 *      - Penalty = sum of importance scores for missing terms
 *
 *   2. DISTANCE PENALTY: How far each item is from canvas center
 *      - Penalty = sum of (distance_from_center)² for each item
 *      - Quadratic: items far from center are heavily penalized
 *
 *   3. COUNT PENALTY: Number of items on screen (exponential after 2)
 *      - 1 item: penalty = 0
 *      - 2 items: penalty = 1
 *      - 3 items: penalty = 4
 *      - 4 items: penalty = 16
 *      - 5 items: penalty = 64
 *
 *   4. OVERLAP PENALTY: Items too close to each other
 *      - For each pair, if distance < minGap: penalty += (minGap - distance)²
 *
 * The optimizer runs AFTER command generation and:
 *   a) Removes low-importance items to reduce count penalty
 *   b) Repositions items to minimize distance penalty
 *   c) Ensures minimum gap to avoid overlap
 */

/**
 * Score a set of visual commands. Lower = better.
 */
export function scoreLayout(commands, narration) {
  // Extract what's on screen at each moment
  const snapshots = simulateState(commands);
  let totalPenalty = 0;

  for (const snap of snapshots) {
    const n = snap.items.length;

    // P1: Count penalty (exponential after 2)
    const countPenalty = n <= 2 ? n * 0.5 : Math.pow(2, n - 1);

    // P2: Distance from center (quadratic)
    let distPenalty = 0;
    for (const item of snap.items) {
      const dx = (item.x - 50) / 50; // normalized -1..1
      const dy = (item.y - 50) / 50;
      distPenalty += (dx * dx + dy * dy) * 10;
    }

    // P3: Overlap penalty (quadratic closeness)
    let overlapPenalty = 0;
    const minGap = 20; // percentage
    for (let a = 0; a < snap.items.length; a++) {
      for (let b = a + 1; b < snap.items.length; b++) {
        const dx = Math.abs(snap.items[a].x - snap.items[b].x);
        const dy = Math.abs(snap.items[a].y - snap.items[b].y);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minGap) {
          overlapPenalty += Math.pow(minGap - dist, 2);
        }
      }
    }

    totalPenalty += countPenalty * 3 + distPenalty * 2 + overlapPenalty * 5;
  }

  // P4: Importance penalty — missing key terms from narration
  const importancePenalty = computeImportancePenalty(commands, narration);
  totalPenalty += importancePenalty * 4;

  return { total: Math.round(totalPenalty), snapshots: snapshots.length };
}

/**
 * Simulate visual state over time — returns snapshots at each change point.
 */
function simulateState(commands) {
  const state = new Map(); // id → { x, y }
  const snapshots = [];

  for (const c of commands) {
    if (c.cmd === 'add') {
      state.set(c.id, { x: c.x || 50, y: c.y || 50, id: c.id, label: c.label });
    } else if (c.cmd === 'remove') {
      state.delete(c.id);
    } else if (c.cmd === 'clear') {
      state.clear();
    }
    // Take snapshot at every state change
    if (['add', 'remove', 'clear'].includes(c.cmd)) {
      snapshots.push({ time: c.time || 0, items: [...state.values()] });
    }
  }
  return snapshots;
}

/**
 * Compute importance penalty — how much key content is missing.
 */
function computeImportancePenalty(commands, narration) {
  if (!narration) return 0;

  // Technical terms with importance weights
  const termImportance = {
    // Core architecture (very high importance)
    transformer: 10, attention: 10, 'self-attention': 10, 'self_attention': 10,
    encoder: 9, decoder: 9, 'multi-head': 8, 'feed-forward': 7, feedforward: 7,

    // Key components
    query: 7, key: 7, value: 7, softmax: 7, normalization: 6, layer: 6,
    embedding: 6, residual: 6, 'dot-product': 6, 'dot product': 6,

    // Operations/concepts
    parallel: 8, sequential: 7, bottleneck: 7, recurrent: 7, recurrence: 7,
    convolution: 6, convolutional: 6, rnn: 8, lstm: 8,

    // Math
    matrix: 6, vector: 6, weight: 5, dimension: 5, score: 5,

    // Training
    training: 5, inference: 5, gradient: 5, loss: 5, optimization: 5,

    // Specific named items
    'h₁': 6, 'h₂': 6, 'h₃': 6, h1: 6, h2: 6, h3: 6,
    'representation z': 7, 'representation': 6,
  };

  // Find which important terms appear in the narration
  const lower = narration.toLowerCase();
  let totalImportance = 0;
  let missingImportance = 0;

  // Get all visual labels shown
  const shownLabels = commands
    .filter(c => c.cmd === 'add')
    .map(c => (c.label || c.id || '').toLowerCase());

  for (const [term, weight] of Object.entries(termImportance)) {
    if (lower.includes(term)) {
      totalImportance += weight;
      const isShown = shownLabels.some(l => l.includes(term) || term.includes(l));
      if (!isShown) {
        missingImportance += weight;
      }
    }
  }

  return missingImportance;
}

/**
 * Optimize commands — reduce count, center items, prevent overlap.
 *
 * This is the PERMANENT fix. It runs after all command generation and
 * applies the four penalties to produce a clean, focused layout.
 */
export function optimizeCommands(commands, narration) {
  let optimized = [...commands];

  // STEP 1: Remove junk/low-importance items to reduce count
  optimized = reduceCount(optimized, narration);

  // STEP 2: Reposition all items toward center
  optimized = centerItems(optimized);

  // STEP 3: No max enforcement — pulses manage their own lifecycle via CSS animation
  // optimized = enforceMaxOnScreen(optimized, 2);

  // STEP 4: Resolve overlaps (run LAST so it sees the final state)
  optimized = resolveOverlaps(optimized);

  return optimized;
}

/**
 * STEP 1: Remove low-importance items when there are too many per sentence.
 */
function reduceCount(commands, narration) {
  // Group add commands by approximate time window (same sentence)
  const WINDOW = 3; // seconds
  const addGroups = [];
  let currentGroup = [];
  let groupStart = 0;

  for (const c of commands) {
    if (c.cmd === 'add' && c.type === 'visual') {
      if (currentGroup.length === 0 || (c.time || 0) - groupStart < WINDOW) {
        currentGroup.push(c);
        if (currentGroup.length === 1) groupStart = c.time || 0;
      } else {
        addGroups.push([...currentGroup]);
        currentGroup = [c];
        groupStart = c.time || 0;
      }
    }
  }
  if (currentGroup.length > 0) addGroups.push(currentGroup);

  // For each group with >3 adds, keep only the 3 most important
  const termImportance = computeTermImportance(narration);
  const idsToRemove = new Set();

  for (const group of addGroups) {
    if (group.length <= 3) continue;
    // Score each by importance
    const scored = group.map(c => ({
      cmd: c,
      score: termImportance[(c.label || '').toLowerCase()] || 1
    }));
    scored.sort((a, b) => b.score - a.score);
    // Keep top 3, remove rest
    for (let i = 3; i < scored.length; i++) {
      idsToRemove.add(scored[i].cmd.id);
    }
  }

  if (idsToRemove.size === 0) return commands;

  return commands.filter(c => {
    if (c.cmd === 'add' && idsToRemove.has(c.id)) return false;
    if (c.cmd === 'verb' && idsToRemove.has(c.id)) return false;
    if (c.cmd === 'highlight' && idsToRemove.has(c.id)) return false;
    return true;
  });
}

function computeTermImportance(narration) {
  const weights = {};
  const lower = (narration || '').toLowerCase();
  const terms = lower.match(/\b[a-z][a-z-]+\b/g) || [];
  const technicalTerms = new Set([
    'transformer', 'attention', 'encoder', 'decoder', 'rnn', 'lstm',
    'softmax', 'normalization', 'embedding', 'feedforward', 'feed-forward',
    'matrix', 'vector', 'query', 'key', 'value', 'layer', 'head',
    'parallel', 'sequential', 'bottleneck', 'recurrent', 'convolution',
    'self-attention', 'residual', 'gradient', 'weight', 'training',
    'representation', 'architecture', 'mechanism', 'function',
  ]);
  for (const t of terms) {
    weights[t] = technicalTerms.has(t) ? 8 : 1;
  }
  return weights;
}

/**
 * STEP 2: Move all items as close to center (50%, 50%) as possible.
 */
function centerItems(commands) {
  return commands.map(c => {
    if (c.cmd === 'add' && (c.x !== undefined || c.y !== undefined)) {
      return { ...c, x: 50, y: 50 }; // Everything starts at center
    }
    return c;
  });
}

/**
 * STEP 4: Global overlap resolver.
 * At each time point, if there are N items on screen, spread them
 * in a horizontal line centered at (50%, 50%), with MIN_GAP between them.
 */
function resolveOverlaps(commands) {
  const MIN_GAP = 15; // percentage — just enough to not overlap, keep items close
  const state = new Map(); // id → true (on screen)

  // Build map of id → command index for position updates
  const addIndices = {};
  commands.forEach((c, i) => {
    if (c.cmd === 'add') addIndices[c.id] = i;
  });

  const result = [...commands];

  for (let i = 0; i < result.length; i++) {
    const c = result[i];
    if (c.cmd === 'add') state.set(c.id, true);
    if (c.cmd === 'remove') state.delete(c.id);
    if (c.cmd === 'clear') state.clear();

    // After each state change, re-spread all on-screen items
    const onScreen = [...state.keys()];
    if (onScreen.length <= 1) continue;

    const totalWidth = (onScreen.length - 1) * MIN_GAP;
    const startX = 50 - totalWidth / 2;

    for (let j = 0; j < onScreen.length; j++) {
      const id = onScreen[j];
      const cmdIdx = addIndices[id];
      if (cmdIdx !== undefined && result[cmdIdx]) {
        result[cmdIdx] = { ...result[cmdIdx], x: Math.max(15, Math.min(85, startX + j * MIN_GAP)), y: 50 };
      }
    }
  }

  return result;
}

/**
 * STEP 4: Enforce max items on screen at any moment.
 * Injects remove commands for oldest items when over limit.
 */
function enforceMaxOnScreen(commands, maxItems) {
  const state = new Map(); // id → addTime
  const extra = [];

  for (const c of commands) {
    if (c.cmd === 'add') state.set(c.id, c.time || 0);
    if (c.cmd === 'remove') state.delete(c.id);
    if (c.cmd === 'clear') state.clear();

    while (state.size > maxItems) {
      let oldestId = null, oldestTime = Infinity;
      for (const [id, t] of state) {
        if (t < oldestTime) { oldestTime = t; oldestId = id; }
      }
      if (oldestId) {
        extra.push({ time: (c.time || 0) - 0.05, cmd: 'remove', id: oldestId });
        state.delete(oldestId);
      } else break;
    }
  }

  return [...commands, ...extra].sort((a, b) => (a.time || 0) - (b.time || 0));
}
