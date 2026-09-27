/**
 * Concept Schemas — Pre-built MathSign templates for common concepts.
 *
 * When the narrator says "RNN", the system doesn't just show a box labeled "RNN" —
 * it shows the SCHEMA of an RNN: connected cells with recurrent loops.
 *
 * Each schema is a function that returns a MathSign spec (signs + layout).
 * The visual TRANSFERS the concept, not just names it.
 */

// ═══════════════════════════════════════
// NEURAL NETWORK SCHEMAS
// ═══════════════════════════════════════

export const SCHEMAS = {

  // ── RNN: Chain of cells with recurrent arrows ──
  rnn: (title = 'Recurrent Neural Network') => ({
    title,
    layout: 'horizontal',
    signs: [
      { sign: 'box', id: 'x1', label: 'x₁', w: 50, h: 40, color: '#81C784' },
      { sign: 'box', id: 'x2', label: 'x₂', w: 50, h: 40, color: '#81C784' },
      { sign: 'box', id: 'x3', label: 'x₃', w: 50, h: 40, color: '#81C784' },
      { sign: 'box', id: 'xn', label: 'xₙ', w: 50, h: 40, color: '#81C784' },
      { sign: 'box', id: 'h1', label: 'h₁', w: 55, h: 45, color: '#4FC3F7' },
      { sign: 'box', id: 'h2', label: 'h₂', w: 55, h: 45, color: '#4FC3F7' },
      { sign: 'box', id: 'h3', label: 'h₃', w: 55, h: 45, color: '#4FC3F7' },
      { sign: 'box', id: 'hn', label: 'hₙ', w: 55, h: 45, color: '#4FC3F7' },
      { sign: 'arrow', from: 'x1', to: 'h1' },
      { sign: 'arrow', from: 'x2', to: 'h2' },
      { sign: 'arrow', from: 'x3', to: 'h3' },
      { sign: 'arrow', from: 'xn', to: 'hn' },
      { sign: 'arrow', from: 'h1', to: 'h2', label: 'state' },
      { sign: 'arrow', from: 'h2', to: 'h3', label: 'state' },
      { sign: 'arrow', from: 'h3', to: 'hn', label: '...' },
      { sign: 'label', target: 'x1', text: 'Input', position: 'below' },
      { sign: 'label', target: 'h1', text: 'Hidden State', position: 'above' },
      { sign: 'formula', id: 'seq', text: 'Sequential: each step waits for previous', size: 14 }
    ],
    _customLayout: (objects) => {
      // Custom: inputs on bottom, hidden states on top, connected
      const gap = 120;
      ['x1','x2','x3','xn'].forEach((id, i) => {
        if (objects[id]) { objects[id].x = 80 + i * gap; objects[id].y = 320; objects[id].w = 50; objects[id].h = 40; }
      });
      ['h1','h2','h3','hn'].forEach((id, i) => {
        if (objects[id]) { objects[id].x = 80 + i * gap; objects[id].y = 200; objects[id].w = 55; objects[id].h = 45; }
      });
      if (objects['seq']) { objects['seq'].x = 280; objects['seq'].y = 400; }
    }
  }),

  // ── LSTM: RNN cell with gates ──
  lstm: (title = 'LSTM Cell') => ({
    title,
    layout: 'vertical',
    signs: [
      { sign: 'box', id: 'cell', label: 'Cell State', w: 250, h: 40, color: '#CE93D8' },
      { sign: 'box', id: 'forget', label: 'Forget Gate', w: 100, h: 35, color: '#EF9A9A' },
      { sign: 'box', id: 'input', label: 'Input Gate', w: 100, h: 35, color: '#81C784' },
      { sign: 'box', id: 'output', label: 'Output Gate', w: 100, h: 35, color: '#4FC3F7' },
      { sign: 'arrow', from: 'forget', to: 'cell' },
      { sign: 'arrow', from: 'input', to: 'cell' },
      { sign: 'arrow', from: 'cell', to: 'output' },
      { sign: 'box', id: 'ht', label: 'hₜ (output)', w: 100, h: 35, color: '#FFB74D' }
    ]
  }),

  // ── Encoder-Decoder ──
  encoder_decoder: (title = 'Encoder-Decoder Architecture') => ({
    title,
    layout: 'horizontal',
    signs: [
      { sign: 'box', id: 'input', label: 'Input Sequence', w: 120, color: '#81C784' },
      { sign: 'arrow', from: 'input', to: 'enc' },
      { sign: 'box', id: 'enc', label: 'Encoder', w: 100, h: 70, color: '#4FC3F7' },
      { sign: 'arrow', from: 'enc', to: 'z', label: 'context' },
      { sign: 'circle', id: 'z', label: 'z', r: 30, color: '#CE93D8' },
      { sign: 'arrow', from: 'z', to: 'dec' },
      { sign: 'box', id: 'dec', label: 'Decoder', w: 100, h: 70, color: '#FFB74D' },
      { sign: 'arrow', from: 'dec', to: 'output' },
      { sign: 'box', id: 'output', label: 'Output Sequence', w: 120, color: '#81C784' }
    ]
  }),

  // ── Transformer Block ──
  transformer: (title = 'Transformer Architecture') => ({
    title,
    layout: 'vertical',
    signs: [
      { sign: 'box', id: 'emb', label: 'Input Embedding + Position', w: 220, color: '#81C784' },
      { sign: 'arrow', from: 'emb', to: 'sa' },
      { sign: 'box', id: 'sa', label: 'Multi-Head Self-Attention', w: 220, h: 50, color: '#4FC3F7' },
      { sign: 'arrow', from: 'sa', to: 'an1' },
      { sign: 'box', id: 'an1', label: 'Add & Normalize', w: 220, color: '#CE93D8' },
      { sign: 'arrow', from: 'an1', to: 'ff' },
      { sign: 'box', id: 'ff', label: 'Feed-Forward Network', w: 220, h: 50, color: '#FFB74D' },
      { sign: 'arrow', from: 'ff', to: 'an2' },
      { sign: 'box', id: 'an2', label: 'Add & Normalize', w: 220, color: '#CE93D8' },
      { sign: 'arrow', from: 'an2', to: 'out' },
      { sign: 'box', id: 'out', label: 'Output', w: 220, color: '#81C784' }
    ]
  }),

  // ── Self-Attention Mechanism ──
  self_attention: (title = 'Self-Attention Mechanism') => ({
    title,
    layout: 'horizontal',
    signs: [
      { sign: 'box', id: 'x', label: 'Input X', w: 80, color: '#81C784' },
      { sign: 'arrow', from: 'x', to: 'q' },
      { sign: 'arrow', from: 'x', to: 'k' },
      { sign: 'arrow', from: 'x', to: 'v' },
      { sign: 'box', id: 'q', label: 'Q (Query)', w: 90, color: '#4FC3F7' },
      { sign: 'box', id: 'k', label: 'K (Key)', w: 90, color: '#FFB74D' },
      { sign: 'box', id: 'v', label: 'V (Value)', w: 90, color: '#CE93D8' },
      { sign: 'arrow', from: 'q', to: 'attn' },
      { sign: 'arrow', from: 'k', to: 'attn' },
      { sign: 'box', id: 'attn', label: 'Attention Weights', w: 130, color: '#EF9A9A' },
      { sign: 'arrow', from: 'attn', to: 'out' },
      { sign: 'arrow', from: 'v', to: 'out' },
      { sign: 'box', id: 'out', label: 'Output', w: 80, color: '#81C784' }
    ],
    _customLayout: (objects) => {
      if (objects.x) { objects.x.x = 60; objects.x.y = 220; objects.x.w = 80; objects.x.h = 50; }
      if (objects.q) { objects.q.x = 230; objects.q.y = 120; objects.q.w = 90; objects.q.h = 40; }
      if (objects.k) { objects.k.x = 230; objects.k.y = 220; objects.k.w = 90; objects.k.h = 40; }
      if (objects.v) { objects.v.x = 230; objects.v.y = 320; objects.v.w = 90; objects.v.h = 40; }
      if (objects.attn) { objects.attn.x = 430; objects.attn.y = 170; objects.attn.w = 130; objects.attn.h = 40; }
      if (objects.out) { objects.out.x = 600; objects.out.y = 220; objects.out.w = 80; objects.out.h = 50; }
    }
  }),

  // ── Multi-Head Attention ──
  multihead_attention: (title = 'Multi-Head Attention') => ({
    title,
    layout: 'horizontal',
    signs: [
      { sign: 'box', id: 'input', label: 'Input', w: 80, color: '#81C784' },
      { sign: 'arrow', from: 'input', to: 'h1' },
      { sign: 'arrow', from: 'input', to: 'h2' },
      { sign: 'arrow', from: 'input', to: 'h3' },
      { sign: 'box', id: 'h1', label: 'Head 1', w: 80, h: 40, color: '#4FC3F7' },
      { sign: 'box', id: 'h2', label: 'Head 2', w: 80, h: 40, color: '#FFB74D' },
      { sign: 'box', id: 'h3', label: 'Head h', w: 80, h: 40, color: '#CE93D8' },
      { sign: 'arrow', from: 'h1', to: 'concat' },
      { sign: 'arrow', from: 'h2', to: 'concat' },
      { sign: 'arrow', from: 'h3', to: 'concat' },
      { sign: 'box', id: 'concat', label: 'Concat', w: 80, color: '#EF9A9A' },
      { sign: 'arrow', from: 'concat', to: 'proj' },
      { sign: 'box', id: 'proj', label: 'Linear W°', w: 90, color: '#81C784' }
    ],
    _customLayout: (objects) => {
      if (objects.input) { objects.input.x = 60; objects.input.y = 220; objects.input.w = 80; objects.input.h = 50; }
      if (objects.h1) { objects.h1.x = 260; objects.h1.y = 120; objects.h1.w = 80; objects.h1.h = 40; }
      if (objects.h2) { objects.h2.x = 260; objects.h2.y = 220; objects.h2.w = 80; objects.h2.h = 40; }
      if (objects.h3) { objects.h3.x = 260; objects.h3.y = 320; objects.h3.w = 80; objects.h3.h = 40; }
      if (objects.concat) { objects.concat.x = 450; objects.concat.y = 220; objects.concat.w = 80; objects.concat.h = 50; }
      if (objects.proj) { objects.proj.x = 620; objects.proj.y = 220; objects.proj.w = 90; objects.proj.h = 50; }
    }
  }),

  // ── Feed-Forward Network ──
  feed_forward: (title = 'Position-wise Feed-Forward Network') => ({
    title,
    layout: 'horizontal',
    signs: [
      { sign: 'box', id: 'x', label: 'x', w: 60, color: '#81C784' },
      { sign: 'arrow', from: 'x', to: 'w1' },
      { sign: 'box', id: 'w1', label: 'W₁ · x + b₁', w: 110, color: '#4FC3F7' },
      { sign: 'arrow', from: 'w1', to: 'relu' },
      { sign: 'box', id: 'relu', label: 'ReLU', w: 70, color: '#FFB74D' },
      { sign: 'arrow', from: 'relu', to: 'w2' },
      { sign: 'box', id: 'w2', label: 'W₂ · x + b₂', w: 110, color: '#4FC3F7' },
      { sign: 'arrow', from: 'w2', to: 'out' },
      { sign: 'box', id: 'out', label: 'output', w: 70, color: '#81C784' }
    ]
  }),

  // ── Positional Encoding ──
  positional_encoding: (title = 'Positional Encoding') => ({
    title,
    layout: 'horizontal',
    signs: [
      { sign: 'box', id: 'tok', label: 'Token Embedding', w: 140, color: '#4FC3F7' },
      { sign: 'formula', id: 'plus', text: '+' },
      { sign: 'box', id: 'pos', label: 'Position Encoding', w: 140, color: '#FFB74D' },
      { sign: 'formula', id: 'eq', text: '=' },
      { sign: 'box', id: 'out', label: 'Input Representation', w: 150, color: '#81C784' }
    ]
  }),

  // ── Sequential vs Parallel ──
  sequential_vs_parallel: (title = 'Sequential vs Parallel Processing') => ({
    title,
    layout: 'vertical',
    signs: [
      { sign: 'label', target: 'seq_title', text: 'Sequential (RNN)', position: 'above' },
      { sign: 'box', id: 'seq_title', label: '', w: 1, h: 1 },
      { sign: 'box', id: 's1', label: 'Step 1', w: 70, h: 35, color: '#EF9A9A' },
      { sign: 'arrow', from: 's1', to: 's2' },
      { sign: 'box', id: 's2', label: 'Step 2', w: 70, h: 35, color: '#EF9A9A' },
      { sign: 'arrow', from: 's2', to: 's3' },
      { sign: 'box', id: 's3', label: 'Step 3', w: 70, h: 35, color: '#EF9A9A' },
      { sign: 'box', id: 'p1', label: 'Step 1', w: 70, h: 35, color: '#81C784' },
      { sign: 'box', id: 'p2', label: 'Step 2', w: 70, h: 35, color: '#81C784' },
      { sign: 'box', id: 'p3', label: 'Step 3', w: 70, h: 35, color: '#81C784' }
    ],
    _customLayout: (objects) => {
      // Sequential: left column, chained
      ['s1','s2','s3'].forEach((id, i) => {
        if (objects[id]) { objects[id].x = 150; objects[id].y = 100 + i * 80; objects[id].w = 70; objects[id].h = 35; }
      });
      // Parallel: right column, all at same y
      ['p1','p2','p3'].forEach((id, i) => {
        if (objects[id]) { objects[id].x = 400 + i * 100; objects[id].y = 180; objects[id].w = 70; objects[id].h = 35; }
      });
      if (objects.seq_title) { objects.seq_title.x = 150; objects.seq_title.y = 50; objects.seq_title.w = 1; objects.seq_title.h = 1; }
    }
  }),

  // ── BLEU Score comparison ──
  bleu_scores: (title = 'BLEU Score Results') => ({
    title,
    layout: 'horizontal',
    signs: [
      { sign: 'bar', id: 'en_de', value: 28.4, max: 45, label: 'EN→DE', color: '#4FC3F7' },
      { sign: 'bar', id: 'en_fr', value: 41.0, max: 45, label: 'EN→FR', color: '#FFB74D' }
    ]
  }),

  // ── Training efficiency ──
  training_speed: (title = 'Training Efficiency') => ({
    title,
    layout: 'horizontal',
    signs: [
      { sign: 'box', id: 'old', label: 'Previous SOTA', w: 130, color: '#EF9A9A' },
      { sign: 'formula', id: 'days1', text: 'Days of training' },
      { sign: 'box', id: 'new', label: 'Transformer', w: 130, color: '#81C784' },
      { sign: 'formula', id: 'days2', text: '3.5 days, 8 GPUs' }
    ]
  })
};

/**
 * Find the best matching schema for a scene based on title/hint keywords.
 */
export function findSchema(title, hint, type) {
  // Match on TITLE first (most specific), then hint
  const t = title.toLowerCase();
  const h = (hint || '').toLowerCase();

  // Title-based matching (high priority — title IS the concept)
  if (/multi.head\s+attention/i.test(t)) return SCHEMAS.multihead_attention;
  if (/scaled\s+dot.product|self.attention\s+formula/i.test(t)) return SCHEMAS.self_attention;
  if (/feed.forward/i.test(t)) return SCHEMAS.feed_forward;
  if (/positional\s+encod/i.test(t)) return SCHEMAS.positional_encoding;
  if (/transformer\s+(architect|layer|stack|structure|overview)/i.test(t)) return SCHEMAS.transformer;
  if (/encoder.decoder/i.test(t)) return SCHEMAS.encoder_decoder;
  if (/encoder\s+stack/i.test(t)) return SCHEMAS.transformer; // Encoder stack = show transformer
  if (/decoder\s+stack/i.test(t)) return SCHEMAS.transformer; // Decoder stack = show transformer too
  if (/lstm\s+cell/i.test(t)) return SCHEMAS.lstm;
  if (/\brnn\b|recurrent\s+neural/i.test(t)) return SCHEMAS.rnn;
  if (/why\s+rnn|problem\s+with\s+(rnn|sequential|recurrent)|sequential\s+model/i.test(t)) return SCHEMAS.rnn;
  if (/sequential\s+vs|parallel.*process|paralleliz/i.test(t)) return SCHEMAS.sequential_vs_parallel;
  if (/bleu|translation\s+result/i.test(t)) return SCHEMAS.bleu_scores;
  if (/training\s+(efficien|speed|cost|breakthrough)/i.test(t)) return SCHEMAS.training_speed;

  // Hint-based matching (lower priority)
  if (/multi.head/i.test(h)) return SCHEMAS.multihead_attention;
  if (/self.attention|scaled\s+dot/i.test(h)) return SCHEMAS.self_attention;
  if (/rnn|recurrent/i.test(h) && !/attention/i.test(t)) return SCHEMAS.rnn;

  // Type-based fallback
  if (type === 'comparison' && /parallel/i.test(t + h)) return SCHEMAS.sequential_vs_parallel;

  return null;
}
