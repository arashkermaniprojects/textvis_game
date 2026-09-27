/**
 * Visual Alphabet — Deterministic SVG drawings for every concept type.
 *
 * CORE PRINCIPLE: NO WORDS. Only pictures.
 * When the narrator says "matrix", we SHOW a grid with brackets.
 * When they say "RNN", we SHOW a recurrent loop.
 * When they say "hexagon", we DRAW a hexagon.
 *
 * The SVG is the MEANING. The label (if any) goes below as a tiny caption
 * added by the streaming player — NOT inside the SVG.
 *
 * NO LLM NEEDED. Concept name → SVG drawing in <1ms.
 */

const C = {
  bg: '#1a1a2e', text: '#fff', primary: '#4FC3F7', accent: '#FFB74D',
  success: '#81C784', danger: '#EF9A9A', purple: '#CE93D8', muted: '#6a6a7a',
  dim: 'rgba(255,255,255,0.08)', stroke: 'rgba(255,255,255,0.5)'
};

// ═══════════════════════════════════════
// SHAPES — geometric primitives
// ═══════════════════════════════════════

function hexagon(label, opts = {}) {
  const w = 90, h = 85, cx = 45, cy = 42, r = 36;
  const color = opts.color || C.primary;
  const pts = Array.from({length: 6}, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <polygon points="${pts}" fill="${C.dim}" stroke="${color}" stroke-width="2.5"/>
  </svg>`;
}

function triangle(label, opts = {}) {
  const color = opts.color || C.accent;
  return `<svg width="80" height="75" viewBox="0 0 80 75"><polygon points="40,4 76,70 4,70" fill="${C.dim}" stroke="${color}" stroke-width="2.5"/></svg>`;
}

function diamond(label, opts = {}) {
  const color = opts.color || C.accent;
  return `<svg width="80" height="80" viewBox="0 0 80 80"><polygon points="40,4 76,40 40,76 4,40" fill="${C.dim}" stroke="${color}" stroke-width="2.5"/></svg>`;
}

function pentagon(label, opts = {}) {
  const cx = 40, cy = 42, r = 34, color = opts.color || C.purple;
  const pts = Array.from({length: 5}, (_, i) => {
    const a = (2 * Math.PI / 5) * i - Math.PI / 2;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(' ');
  return `<svg width="80" height="80" viewBox="0 0 80 80"><polygon points="${pts}" fill="${C.dim}" stroke="${color}" stroke-width="2.5"/></svg>`;
}

function star(label, opts = {}) {
  const cx = 40, cy = 40, outer = 34, inner = 15, color = opts.color || C.accent;
  const pts = Array.from({length: 10}, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(' ');
  return `<svg width="80" height="80" viewBox="0 0 80 80"><polygon points="${pts}" fill="${C.dim}" stroke="${color}" stroke-width="2"/></svg>`;
}

function circle(label, opts = {}) {
  const color = opts.color || C.primary;
  return `<svg width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" fill="${C.dim}" stroke="${color}" stroke-width="2.5"/></svg>`;
}

function ellipse(label, opts = {}) {
  const color = opts.color || C.primary;
  return `<svg width="110" height="70" viewBox="0 0 110 70"><ellipse cx="55" cy="35" rx="50" ry="28" fill="${C.dim}" stroke="${color}" stroke-width="2.5"/></svg>`;
}

// ═══════════════════════════════════════
// DATA STRUCTURES
// ═══════════════════════════════════════

function matrix(label, opts = {}) {
  const rows = opts.rows || 3, cols = opts.cols || 3;
  const cellW = 22, cellH = 18;
  const gw = cols * cellW, gh = rows * cellH;
  const w = gw + 24, h = gh + 12;
  const ox = 12, oy = 6;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  // Brackets
  svg += `<path d="M${ox+5},${oy} L${ox},${oy} L${ox},${oy+gh} L${ox+5},${oy+gh}" fill="none" stroke="${C.text}" stroke-width="2"/>`;
  svg += `<path d="M${ox+gw-5},${oy} L${ox+gw},${oy} L${ox+gw},${oy+gh} L${ox+gw-5},${oy+gh}" fill="none" stroke="${C.text}" stroke-width="2"/>`;
  const colors = [C.primary, C.accent, C.success, C.purple];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const alpha = (0.15 + ((r + c) % 3) * 0.15).toFixed(2);
      svg += `<rect x="${ox+c*cellW+1}" y="${oy+r*cellH+1}" width="${cellW-2}" height="${cellH-2}" rx="2" fill="${colors[(r+c)%4]}" opacity="${alpha}"/>`;
    }
  }
  svg += `</svg>`;
  return svg;
}

function vector(label, opts = {}) {
  const n = opts.size || 5;
  const cellH = 16, cellW = 22;
  const w = cellW + 20, h = n * cellH + 10;
  const ox = 10, oy = 5;
  const colors = [C.primary, C.accent, C.success, C.purple, C.danger];
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  svg += `<path d="M${ox+3},${oy} L${ox},${oy} L${ox},${oy+n*cellH} L${ox+3},${oy+n*cellH}" fill="none" stroke="${C.text}" stroke-width="2"/>`;
  svg += `<path d="M${ox+cellW-3},${oy} L${ox+cellW},${oy} L${ox+cellW},${oy+n*cellH} L${ox+cellW-3},${oy+n*cellH}" fill="none" stroke="${C.text}" stroke-width="2"/>`;
  for (let i = 0; i < n; i++) {
    const alpha = (0.2 + i * 0.12).toFixed(2);
    svg += `<rect x="${ox+1}" y="${oy+i*cellH+1}" width="${cellW-2}" height="${cellH-2}" rx="2" fill="${colors[i%5]}" opacity="${alpha}"/>`;
  }
  svg += `</svg>`;
  return svg;
}

function array_seq(label, opts = {}) {
  const n = opts.size || 5;
  const cellW = 22, cellH = 20;
  const w = n * cellW + 10, h = cellH + 10;
  const colors = [C.primary, C.accent, C.success, C.purple, C.danger];
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  for (let i = 0; i < n; i++) {
    svg += `<rect x="${5+i*cellW}" y="5" width="${cellW-2}" height="${cellH}" rx="3" fill="${colors[i%5]}" opacity="0.35" stroke="${colors[i%5]}" stroke-width="1.5"/>`;
  }
  svg += `</svg>`;
  return svg;
}

function table(label, opts = {}) {
  return matrix(label, { rows: opts.rows || 3, cols: opts.cols || 4 });
}

function embedding(label, opts = {}) {
  const rows = 4, cols = 6, cellW = 14, cellH = 12;
  const w = cols * cellW + 10, h = rows * cellH + 10;
  const colors = [C.primary, C.accent, C.success, C.purple, C.danger, '#80DEEA'];
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Deterministic pattern based on position (not random — same every time)
      const alpha = (0.15 + ((r * 7 + c * 3) % 10) * 0.07).toFixed(2);
      svg += `<rect x="${5+c*cellW}" y="${5+r*cellH}" width="${cellW-2}" height="${cellH-2}" rx="2" fill="${colors[(r+c)%colors.length]}" opacity="${alpha}"/>`;
    }
  }
  svg += `</svg>`;
  return svg;
}

// ═══════════════════════════════════════
// NEURAL NETWORK COMPONENTS
// ═══════════════════════════════════════

function neuron(label, opts = {}) {
  const w = 120, h = 70, cx = 65, cy = 35;
  const color = opts.color || C.primary;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  // Input dendrites
  for (let i = 0; i < 3; i++) {
    const iy = 12 + i * 23;
    svg += `<line x1="6" y1="${iy}" x2="${cx-18}" y2="${cy}" stroke="${C.stroke}" stroke-width="1.5"/>`;
    svg += `<circle cx="6" cy="${iy}" r="3" fill="${C.primary}" opacity="0.5"/>`;
  }
  // Soma
  svg += `<circle cx="${cx}" cy="${cy}" r="18" fill="${C.dim}" stroke="${color}" stroke-width="2.5"/>`;
  svg += `<text x="${cx}" y="${cy+6}" text-anchor="middle" fill="${C.text}" font-size="16">Σ</text>`;
  // Axon
  svg += `<line x1="${cx+18}" y1="${cy}" x2="${w-8}" y2="${cy}" stroke="${color}" stroke-width="2"/>`;
  svg += `<polygon points="${w-10},${cy-4} ${w-2},${cy} ${w-10},${cy+4}" fill="${color}"/>`;
  svg += `</svg>`;
  return svg;
}

function rnn(label, opts = {}) {
  // RNN = box with a self-loop arrow. Recognizable by the recurrent connection.
  const w = 110, h = 85;
  const bx = 20, by = 18, bw = 60, bh = 40;
  const color = opts.color || C.primary;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  // Cell body
  svg += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="8" fill="${C.dim}" stroke="${color}" stroke-width="2.5"/>`;
  // Input arrow (bottom)
  svg += `<line x1="${bx+bw/2}" y1="${by+bh}" x2="${bx+bw/2}" y2="${h-4}" stroke="${C.stroke}" stroke-width="2"/>`;
  svg += `<polygon points="${bx+bw/2-4},${by+bh} ${bx+bw/2},${by+bh-6} ${bx+bw/2+4},${by+bh}" fill="${C.stroke}"/>`;
  // Output arrow (top)
  svg += `<line x1="${bx+bw/2}" y1="${by}" x2="${bx+bw/2}" y2="4" stroke="${C.stroke}" stroke-width="2"/>`;
  svg += `<polygon points="${bx+bw/2-4},6 ${bx+bw/2},0 ${bx+bw/2+4},6" fill="${C.stroke}"/>`;
  // THE RECURRENT LOOP — the defining visual of an RNN
  svg += `<path d="M${bx+bw},${by+bh/2} Q${bx+bw+22},${by+bh/2} ${bx+bw+22},${by-4} Q${bx+bw+22},${by-14} ${bx+bw/2+8},${by}" fill="none" stroke="${C.accent}" stroke-width="2.5"/>`;
  svg += `<polygon points="${bx+bw/2+12},${by-3} ${bx+bw/2+6},${by} ${bx+bw/2+12},${by+3}" fill="${C.accent}"/>`;
  svg += `</svg>`;
  return svg;
}

function lstm(label, opts = {}) {
  // LSTM = cell with THREE colored gates + cell state line on top. Self-explanatory.
  const w = 140, h = 80;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  // Outer cell
  svg += `<rect x="10" y="10" width="120" height="55" rx="8" fill="${C.dim}" stroke="${C.primary}" stroke-width="2"/>`;
  // Three gates — colored differently (the visual signature of LSTM)
  const gates = [
    { x: 32, color: C.danger },   // forget (red)
    { x: 65, color: C.success },  // input (green)
    { x: 98, color: C.accent },   // output (orange)
  ];
  for (const g of gates) {
    svg += `<rect x="${g.x-10}" y="22" width="20" height="18" rx="3" fill="${C.dim}" stroke="${g.color}" stroke-width="2"/>`;
    // Sigma symbol inside each gate
    svg += `<text x="${g.x}" y="35" text-anchor="middle" fill="${g.color}" font-size="11">σ</text>`;
  }
  // Cell state line (horizontal through top — THE defining LSTM feature)
  svg += `<line x1="8" y1="15" x2="132" y2="15" stroke="${C.purple}" stroke-width="3"/>`;
  svg += `<polygon points="128,12 134,15 128,18" fill="${C.purple}"/>`;
  // Input/output arrows
  svg += `<line x1="65" y1="65" x2="65" y2="76" stroke="${C.stroke}" stroke-width="1.5"/>`;
  svg += `<line x1="65" y1="10" x2="65" y2="2" stroke="${C.stroke}" stroke-width="1.5"/>`;
  svg += `<polygon points="62,3 65,0 68,3" fill="${C.stroke}"/>`;
  svg += `</svg>`;
  return svg;
}

function transformer_block(label, opts = {}) {
  // Transformer = stacked colored bars (alternating attention + FFN + norm) with skip connections
  const w = 100, h = 95;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  const layers = [
    { y: 5, color: C.success },    // norm
    { y: 24, color: C.accent },    // FFN
    { y: 43, color: C.success },   // norm
    { y: 62, color: C.purple },    // attention
  ];
  for (const l of layers) {
    svg += `<rect x="12" y="${l.y}" width="76" height="16" rx="4" fill="${C.dim}" stroke="${l.color}" stroke-width="1.5"/>`;
  }
  // Skip connections (the curved bypasses)
  svg += `<path d="M10,32 L4,32 L4,13 L10,13" fill="none" stroke="${C.accent}" stroke-width="1.5" stroke-dasharray="3,2"/>`;
  svg += `<path d="M10,70 L4,70 L4,51 L10,51" fill="none" stroke="${C.accent}" stroke-width="1.5" stroke-dasharray="3,2"/>`;
  // Input/output arrows
  svg += `<line x1="50" y1="80" x2="50" y2="90" stroke="${C.stroke}" stroke-width="1.5"/>`;
  svg += `<polygon points="47,80 50,74 53,80" fill="${C.stroke}"/>`;
  svg += `</svg>`;
  return svg;
}

function attention_mechanism(label, opts = {}) {
  // Attention = three colored inputs converging to a focal point. No text needed.
  const w = 110, h = 80;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  // Three input sources (Q=blue, K=orange, V=green) — the visual signature
  const inputs = [
    { x: 15, color: C.primary },
    { x: 50, color: C.accent },
    { x: 85, color: C.success },
  ];
  for (const b of inputs) {
    svg += `<rect x="${b.x}" y="52" width="18" height="16" rx="3" fill="${C.dim}" stroke="${b.color}" stroke-width="2"/>`;
    svg += `<line x1="${b.x+9}" y1="52" x2="55" y2="30" stroke="${b.color}" stroke-width="1.5" opacity="0.7"/>`;
  }
  // Focal point — EMBODIED: spotlight beam scans across inputs
  svg += `<circle cx="55" cy="24" r="14" fill="${C.dim}" stroke="${C.purple}" stroke-width="2.5"/>`;
  svg += `<ellipse cx="55" cy="24" rx="8" ry="5" fill="none" stroke="${C.text}" stroke-width="1.5"/>`;
  // Pupil that scans left-right — you SEE attention shifting
  svg += `<circle cx="55" cy="24" r="2.5" fill="${C.text}">
    <animate attributeName="cx" values="51;55;59;55;51" dur="2s" repeatCount="indefinite"/>
  </circle>`;
  // Spotlight beam from eye to inputs — sweeps across
  svg += `<line x1="55" y1="30" x2="24" y2="52" stroke="${C.accent}" stroke-width="1" opacity="0.4">
    <animate attributeName="x2" values="15;50;85;50;15" dur="2s" repeatCount="indefinite"/>
  </line>`;
  svg += `<line x1="55" y1="10" x2="55" y2="2" stroke="${C.purple}" stroke-width="2"/>`;
  svg += `<polygon points="52,4 55,0 58,4" fill="${C.purple}"/>`;
  svg += `</svg>`;
  return svg;
}

function encoder_block(label, opts = {}) {
  // Encoder = stacked layers with arrow going IN from bottom. Blue tones.
  const w = 80, h = 85;
  const color = opts.color || C.primary;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  for (let i = 0; i < 4; i++) {
    const y = 5 + i * 16;
    svg += `<rect x="10" y="${y}" width="60" height="13" rx="3" fill="${color}" opacity="${0.3 + i * 0.18}" stroke="${color}" stroke-width="1"/>`;
  }
  // Input arrow (bottom → in)
  svg += `<line x1="40" y1="72" x2="40" y2="82" stroke="${C.stroke}" stroke-width="2"/>`;
  svg += `<polygon points="37,72 40,66 43,72" fill="${C.stroke}"/>`;
  svg += `</svg>`;
  return svg;
}

function decoder_block(label, opts = {}) {
  // Decoder = stacked layers with arrow going OUT from top. Orange tones.
  const w = 80, h = 85;
  const color = opts.color || C.accent;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  for (let i = 0; i < 4; i++) {
    const y = 15 + i * 16;
    svg += `<rect x="10" y="${y}" width="60" height="13" rx="3" fill="${color}" opacity="${0.3 + i * 0.18}" stroke="${color}" stroke-width="1"/>`;
  }
  // Output arrow (top → out)
  svg += `<line x1="40" y1="15" x2="40" y2="4" stroke="${C.stroke}" stroke-width="2"/>`;
  svg += `<polygon points="37,6 40,0 43,6" fill="${C.stroke}"/>`;
  svg += `</svg>`;
  return svg;
}

function feedforward_net(label, opts = {}) {
  // FFN = layers of connected dots. THE classic neural network visual.
  const w = 120, h = 75;
  const layers = [3, 5, 4, 2];
  const layerX = layers.map((_, i) => 15 + i * 32);
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  for (let l = 0; l < layers.length - 1; l++) {
    for (let i = 0; i < layers[l]; i++) {
      for (let j = 0; j < layers[l+1]; j++) {
        const y1 = 10 + i * (55 / Math.max(layers[l]-1, 1));
        const y2 = 10 + j * (55 / Math.max(layers[l+1]-1, 1));
        svg += `<line x1="${layerX[l]}" y1="${y1}" x2="${layerX[l+1]}" y2="${y2}" stroke="${C.stroke}" stroke-width="0.5" opacity="0.3"/>`;
      }
    }
  }
  for (let l = 0; l < layers.length; l++) {
    for (let i = 0; i < layers[l]; i++) {
      const y = 10 + i * (55 / Math.max(layers[l]-1, 1));
      svg += `<circle cx="${layerX[l]}" cy="${y}" r="5" fill="${l === 0 ? C.primary : l === layers.length-1 ? C.accent : C.success}" stroke="${C.text}" stroke-width="1"/>`;
    }
  }
  svg += `</svg>`;
  return svg;
}

function softmax_viz(label, opts = {}) {
  // Softmax = probability distribution bars. One tall, others short.
  const w = 90, h = 60;
  const bars = [0.05, 0.1, 0.6, 0.15, 0.1];
  const barW = 12, gap = 4;
  const ox = 10;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  for (let i = 0; i < bars.length; i++) {
    const bh = bars[i] * 45 / 0.6;
    const x = ox + i * (barW + gap);
    const color = bars[i] === Math.max(...bars) ? C.accent : C.primary;
    svg += `<rect x="${x}" y="${52-bh}" width="${barW}" height="${bh}" rx="2" fill="${color}" opacity="0.8"/>`;
  }
  // Baseline
  svg += `<line x1="8" y1="54" x2="82" y2="54" stroke="${C.muted}" stroke-width="1"/>`;
  svg += `</svg>`;
  return svg;
}

function normalization_viz(label, opts = {}) {
  // Normalization = bell curve with center line
  const w = 100, h = 55;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  let path = 'M 5,45';
  for (let x = 0; x <= 90; x += 2) {
    const t = (x - 45) / 15;
    const y = 45 - 32 * Math.exp(-t * t / 2);
    path += ` L${5 + x},${y}`;
  }
  svg += `<path d="${path}" fill="none" stroke="${C.primary}" stroke-width="2.5"/>`;
  svg += `<line x1="50" y1="12" x2="50" y2="47" stroke="${C.accent}" stroke-width="1.5" stroke-dasharray="4,3"/>`;
  svg += `<line x1="3" y1="47" x2="97" y2="47" stroke="${C.muted}" stroke-width="1"/>`;
  svg += `</svg>`;
  return svg;
}

function distribution_viz(label, opts = {}) {
  return normalization_viz(label, opts);
}

function residual_connection(label, opts = {}) {
  // Residual = box with a skip-connection arc + plus circle. No text.
  const w = 110, h = 65;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  // Main path box
  svg += `<rect x="30" y="22" width="40" height="24" rx="5" fill="${C.dim}" stroke="${C.primary}" stroke-width="2"/>`;
  // Input arrow
  svg += `<line x1="8" y1="34" x2="28" y2="34" stroke="${C.stroke}" stroke-width="1.5"/>`;
  svg += `<polygon points="26,31 30,34 26,37" fill="${C.stroke}"/>`;
  // Output arrow
  svg += `<line x1="72" y1="34" x2="92" y2="34" stroke="${C.stroke}" stroke-width="1.5"/>`;
  svg += `<polygon points="90,31 95,34 90,37" fill="${C.stroke}"/>`;
  // THE SKIP CONNECTION — the defining arc
  svg += `<path d="M8,34 Q8,8 50,8 Q92,8 92,34" fill="none" stroke="${C.accent}" stroke-width="2.5" stroke-dasharray="5,3"/>`;
  // Plus circle
  svg += `<circle cx="92" cy="34" r="7" fill="${C.dim}" stroke="${C.accent}" stroke-width="1.5"/>`;
  svg += `<text x="92" y="38" text-anchor="middle" fill="${C.accent}" font-size="12" font-weight="700">+</text>`;
  svg += `</svg>`;
  return svg;
}

function convolution_viz(label, opts = {}) {
  // Convolution = grid with sliding kernel → smaller output grid
  const w = 115, h = 65;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    svg += `<rect x="${5+c*12}" y="${5+r*12}" width="10" height="10" rx="1" fill="${C.dim}" stroke="${C.stroke}" stroke-width="0.5"/>`;
  }
  svg += `<rect x="5" y="5" width="34" height="34" rx="2" fill="none" stroke="${C.accent}" stroke-width="2"/>`;
  svg += `<line x1="56" y1="28" x2="68" y2="28" stroke="${C.stroke}" stroke-width="1.5"/>`;
  svg += `<polygon points="66,25 72,28 66,31" fill="${C.stroke}"/>`;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    svg += `<rect x="${75+c*12}" y="${10+r*12}" width="10" height="10" rx="1" fill="${C.primary}" opacity="0.4" stroke="${C.primary}" stroke-width="0.5"/>`;
  }
  svg += `</svg>`;
  return svg;
}

function pooling_viz(label, opts = {}) {
  // Pooling = big grid → small grid (reduction)
  const w = 105, h = 60;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const hl = (r < 2 && c < 2);
    svg += `<rect x="${5+c*11}" y="${5+r*11}" width="9" height="9" rx="1" fill="${hl ? C.accent+'44' : C.dim}" stroke="${C.stroke}" stroke-width="0.5"/>`;
  }
  svg += `<line x1="52" y1="28" x2="64" y2="28" stroke="${C.stroke}" stroke-width="1.5"/>`;
  svg += `<polygon points="62,25 68,28 62,31" fill="${C.stroke}"/>`;
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
    svg += `<rect x="${72+c*14}" y="${12+r*14}" width="12" height="12" rx="1" fill="${C.primary}" opacity="0.5" stroke="${C.primary}" stroke-width="0.5"/>`;
  }
  svg += `</svg>`;
  return svg;
}

function dropout_viz(label, opts = {}) {
  // Dropout = grid of neurons, some crossed out
  const w = 90, h = 55;
  const n = 12;
  const dropped = new Set([2, 5, 8, 11]);
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  for (let i = 0; i < n; i++) {
    const x = 10 + (i % 6) * 13;
    const y = 10 + Math.floor(i / 6) * 18;
    const isDrop = dropped.has(i);
    svg += `<circle cx="${x}" cy="${y}" r="5" fill="${isDrop ? 'none' : C.primary}" stroke="${isDrop ? C.danger : C.primary}" stroke-width="${isDrop ? '1.5' : '1'}" ${isDrop ? 'stroke-dasharray="3,2"' : ''} opacity="${isDrop ? 0.4 : 0.8}"/>`;
    if (isDrop) svg += `<line x1="${x-3}" y1="${y-3}" x2="${x+3}" y2="${y+3}" stroke="${C.danger}" stroke-width="1.5"/>`;
  }
  svg += `</svg>`;
  return svg;
}

// ═══════════════════════════════════════
// ABSTRACT / FLOW
// ═══════════════════════════════════════

function pipeline_viz(label, opts = {}) {
  // Pipeline = connected boxes (no text, just shapes + arrows)
  const n = 4, w = n * 30 + 10, h = 35;
  const colors = [C.primary, C.accent, C.success, C.purple];
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  for (let i = 0; i < n; i++) {
    const x = 5 + i * 30;
    svg += `<rect x="${x}" y="6" width="22" height="22" rx="4" fill="${C.dim}" stroke="${colors[i]}" stroke-width="1.5"/>`;
    if (i < n - 1) {
      svg += `<line x1="${x+24}" y1="17" x2="${x+28}" y2="17" stroke="${C.stroke}" stroke-width="1.5"/>`;
      svg += `<polygon points="${x+27},14 ${x+31},17 ${x+27},20" fill="${C.stroke}"/>`;
    }
  }
  svg += `</svg>`;
  return svg;
}

function loop_viz(label, opts = {}) {
  // Loop = circular arrow
  const w = 70, h = 65, cx = 35, cy = 30, r = 22;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  svg += `<path d="M${cx+r},${cy} A${r},${r} 0 1,1 ${cx+r-3},${cy-6}" fill="none" stroke="${C.accent}" stroke-width="2.5"/>`;
  svg += `<polygon points="${cx+r+1},${cy-8} ${cx+r-3},${cy+1} ${cx+r+5},${cy-1}" fill="${C.accent}"/>`;
  svg += `</svg>`;
  return svg;
}

function gradient_viz(label, opts = {}) {
  // Gradient = colored bar from red to green with ∇ symbol
  const w = 90, h = 40;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  svg += `<defs><linearGradient id="gr_${Math.random().toString(36).slice(2,6)}" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%" style="stop-color:${C.danger};stop-opacity:0.8"/>
    <stop offset="100%" style="stop-color:${C.success};stop-opacity:0.8"/>
  </linearGradient></defs>`;
  svg += `<rect x="5" y="8" width="80" height="18" rx="4" fill="url(#gr_${Math.random().toString(36).slice(2,6)})"/>`;
  svg += `<text x="45" y="22" text-anchor="middle" fill="${C.text}" font-size="14" font-weight="700">∇</text>`;
  svg += `</svg>`;
  return svg;
}

function mask_viz(label, opts = {}) {
  // Mask = triangular grid pattern (lower triangle visible, upper crossed out)
  const w = 70, h = 60, n = 5;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const masked = c > r;
    svg += `<rect x="${5+c*12}" y="${5+r*10}" width="10" height="8" rx="1" fill="${masked ? C.danger+'33' : C.primary+'55'}" stroke="${C.stroke}" stroke-width="0.5"/>`;
    if (masked) svg += `<line x1="${6+c*12}" y1="${6+r*10}" x2="${14+c*12}" y2="${12+r*10}" stroke="${C.danger}" stroke-width="1" opacity="0.5"/>`;
  }
  svg += `</svg>`;
  return svg;
}

// ═══════════════════════════════════════
// VERB ANIMATIONS — motions that modify visual objects
//
// Like sign language: verbs are MOVEMENTS.
//   "transforms" → shape morphs
//   "flows"      → horizontal drift
//   "rotates"    → spinning
//   "pulses"     → heartbeat glow
//   "splits"     → divides into pieces
//   "merges"     → converges into one
//   "propagates" → wave ripple
//   "computes"   → gear spinning
//   "learns"     → growing connections
//
// Each verb returns a CSS class name + keyframe definition.
// The streaming player injects the CSS and applies the class.
// ═══════════════════════════════════════

/**
 * All verb CSS animations. The player injects these once, then
 * applies the class to the target object.
 */
export const VERB_ANIMATIONS = {
  // ── Motion verbs ──
  flow: {
    css: `@keyframes va-flow { 0%,100%{transform:translateX(0)} 50%{transform:translateX(12px)} }`,
    class: 'va-flow',
    style: 'animation:va-flow 2s ease-in-out infinite',
  },
  move: {
    css: `@keyframes va-move { 0%{transform:translateX(-8px)} 100%{transform:translateX(8px)} }`,
    class: 'va-move',
    style: 'animation:va-move 1.5s ease-in-out alternate infinite',
  },
  rotate: {
    css: `@keyframes va-rotate { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`,
    class: 'va-rotate',
    style: 'animation:va-rotate 3s linear infinite',
  },
  spin: {
    css: `@keyframes va-spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`,
    class: 'va-spin',
    style: 'animation:va-spin 1.5s linear infinite',
  },
  oscillate: {
    css: `@keyframes va-osc { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }`,
    class: 'va-osc',
    style: 'animation:va-osc 1.8s ease-in-out infinite',
  },
  bounce: {
    css: `@keyframes va-bounce { 0%,100%{transform:translateY(0)} 40%{transform:translateY(-12px)} 60%{transform:translateY(-4px)} }`,
    class: 'va-bounce',
    style: 'animation:va-bounce 1.2s ease-in-out infinite',
  },
  shake: {
    css: `@keyframes va-shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-4px)} 40%{transform:translateX(4px)} 60%{transform:translateX(-3px)} 80%{transform:translateX(3px)} }`,
    class: 'va-shake',
    style: 'animation:va-shake 0.6s ease-in-out infinite',
  },

  // ── Emphasis verbs ──
  pulse: {
    css: `@keyframes va-pulse { 0%,100%{filter:drop-shadow(0 0 2px rgba(255,183,77,0.3))} 50%{filter:drop-shadow(0 0 14px rgba(255,183,77,0.7))} }`,
    class: 'va-pulse',
    style: 'animation:va-pulse 1.5s ease-in-out infinite',
  },
  glow: {
    css: `@keyframes va-glow { 0%,100%{filter:brightness(1)} 50%{filter:brightness(1.5) drop-shadow(0 0 10px rgba(79,195,247,0.6))} }`,
    class: 'va-glow',
    style: 'animation:va-glow 2s ease-in-out infinite',
  },
  highlight: {
    css: `@keyframes va-highlight { 0%{box-shadow:0 0 0 rgba(255,183,77,0)} 50%{box-shadow:0 0 20px rgba(255,183,77,0.6)} 100%{box-shadow:0 0 0 rgba(255,183,77,0)} }`,
    class: 'va-highlight',
    style: 'animation:va-highlight 2s ease-in-out infinite',
  },
  flash: {
    css: `@keyframes va-flash { 0%,50%,100%{opacity:1} 25%,75%{opacity:0.3} }`,
    class: 'va-flash',
    style: 'animation:va-flash 1s ease-in-out infinite',
  },

  // ── Transform verbs ──
  grow: {
    css: `@keyframes va-grow { from{transform:scale(0.3);opacity:0} to{transform:scale(1);opacity:1} }`,
    class: 'va-grow',
    style: 'animation:va-grow 0.8s ease-out forwards',
  },
  shrink: {
    css: `@keyframes va-shrink { from{transform:scale(1);opacity:1} to{transform:scale(0.3);opacity:0} }`,
    class: 'va-shrink',
    style: 'animation:va-shrink 0.8s ease-in forwards',
  },
  expand: {
    css: `@keyframes va-expand { 0%,100%{transform:scale(1)} 50%{transform:scale(1.15)} }`,
    class: 'va-expand',
    style: 'animation:va-expand 2s ease-in-out infinite',
  },
  compress: {
    css: `@keyframes va-compress { 0%,100%{transform:scale(1)} 50%{transform:scale(0.85)} }`,
    class: 'va-compress',
    style: 'animation:va-compress 2s ease-in-out infinite',
  },
  morph: {
    css: `@keyframes va-morph { 0%,100%{border-radius:8px;transform:scale(1)} 50%{border-radius:50%;transform:scale(1.05)} }`,
    class: 'va-morph',
    style: 'animation:va-morph 3s ease-in-out infinite',
  },
  transform: {
    css: `@keyframes va-transform { 0%{transform:scale(1) rotate(0deg)} 25%{transform:scale(1.1) rotate(3deg)} 50%{transform:scale(0.95) rotate(-2deg)} 75%{transform:scale(1.05) rotate(1deg)} 100%{transform:scale(1) rotate(0deg)} }`,
    class: 'va-transform',
    style: 'animation:va-transform 2.5s ease-in-out infinite',
  },

  // ── Process verbs ──
  compute: {
    css: `@keyframes va-compute { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`,
    class: 'va-compute',
    style: 'animation:va-compute 2s linear infinite',
  },
  process: {
    css: `@keyframes va-process { 0%,100%{border-left-color:rgba(79,195,247,0.8)} 25%{border-top-color:rgba(79,195,247,0.8)} 50%{border-right-color:rgba(79,195,247,0.8)} 75%{border-bottom-color:rgba(79,195,247,0.8)} }`,
    class: 'va-process',
    style: 'animation:va-process 1.5s linear infinite;border:2px solid rgba(255,255,255,0.1);border-radius:50%',
  },
  propagate: {
    css: `@keyframes va-propagate { 0%{clip-path:inset(0 100% 0 0)} 100%{clip-path:inset(0 0 0 0)} }`,
    class: 'va-propagate',
    style: 'animation:va-propagate 2s ease-out infinite',
  },
  iterate: {
    css: `@keyframes va-iterate { 0%{opacity:0.5;transform:translateX(-5px)} 50%{opacity:1;transform:translateX(5px)} 100%{opacity:0.5;transform:translateX(-5px)} }`,
    class: 'va-iterate',
    style: 'animation:va-iterate 1.8s ease-in-out infinite',
  },

  // ── Composition verbs ──
  split: {
    css: `@keyframes va-split { 0%,100%{transform:scaleX(1)} 50%{transform:scaleX(1.3)} }`,
    class: 'va-split',
    style: 'animation:va-split 2s ease-in-out infinite',
  },
  merge: {
    css: `@keyframes va-merge { 0%,100%{transform:scaleX(1)} 50%{transform:scaleX(0.7)} }`,
    class: 'va-merge',
    style: 'animation:va-merge 2s ease-in-out infinite',
  },
  connect: {
    css: `@keyframes va-connect { 0%{stroke-dashoffset:30} 100%{stroke-dashoffset:0} }`,
    class: 'va-connect',
    style: 'animation:va-connect 1s linear forwards',
  },

  // ── Appearance verbs ──
  fade_in: {
    css: `@keyframes va-fadein { from{opacity:0} to{opacity:1} }`,
    class: 'va-fadein',
    style: 'animation:va-fadein 1s ease-out forwards',
  },
  fade_out: {
    css: `@keyframes va-fadeout { from{opacity:1} to{opacity:0} }`,
    class: 'va-fadeout',
    style: 'animation:va-fadeout 1s ease-in forwards',
  },
  appear: {
    css: `@keyframes va-appear { 0%{transform:scale(0);opacity:0} 60%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }`,
    class: 'va-appear',
    style: 'animation:va-appear 0.5s ease-out forwards',
  },

  // ── Attention/focus verbs ──
  attend: {
    css: `@keyframes va-attend { 0%,100%{transform:scale(1);filter:none} 50%{transform:scale(1.08);filter:drop-shadow(0 0 8px rgba(206,147,216,0.6))} }`,
    class: 'va-attend',
    style: 'animation:va-attend 2s ease-in-out infinite',
  },
  focus: {
    css: `@keyframes va-focus { 0%,100%{outline:2px solid transparent;outline-offset:4px} 50%{outline:2px solid rgba(255,183,77,0.6);outline-offset:8px} }`,
    class: 'va-focus',
    style: 'animation:va-focus 2s ease-in-out infinite',
  },
  select: {
    css: `@keyframes va-select { 0%{box-shadow:0 0 0 0 rgba(129,199,132,0.4)} 70%{box-shadow:0 0 0 10px rgba(129,199,132,0)} 100%{box-shadow:0 0 0 0 rgba(129,199,132,0)} }`,
    class: 'va-select',
    style: 'animation:va-select 1.5s ease-out infinite',
  },
};

/**
 * Get the CSS for all verb animations (inject once into the page).
 */
export function getVerbCSS() {
  return Object.values(VERB_ANIMATIONS).map(v => v.css).join('\n');
}

/**
 * Apply a verb animation to a concept. Returns the style attribute string.
 */
export function getVerbStyle(verb) {
  const v = VERB_ANIMATIONS[verb] || VERB_ANIMATIONS[verb.replace(/s$|ing$|ed$/, '')] || null;
  return v ? v.style : '';
}

// ═══════════════════════════════════════
// MATH / QUANTITY VISUALS
// ═══════════════════════════════════════

function squared_viz() {
  // x² — exponent visual
  return `<svg width="50" height="45" viewBox="0 0 50 45">
    <text x="15" y="32" fill="${C.text}" font-size="24" font-weight="600">x</text>
    <text x="32" y="18" fill="${C.accent}" font-size="16" font-weight="700">2</text>
  </svg>`;
}

function sqrt_viz() {
  // √ — square root visual
  return `<svg width="60" height="45" viewBox="0 0 60 45">
    <path d="M5,30 L15,30 L22,40 L35,8 L55,8" fill="none" stroke="${C.text}" stroke-width="2.5"/>
  </svg>`;
}

function dimension_viz() {
  // d — axis with tick marks
  return `<svg width="80" height="45" viewBox="0 0 80 45">
    <line x1="8" y1="30" x2="72" y2="30" stroke="${C.primary}" stroke-width="2"/>
    <polygon points="70,27 76,30 70,33" fill="${C.primary}"/>
    ${[0,1,2,3,4].map(i => `<line x1="${15+i*13}" y1="27" x2="${15+i*13}" y2="33" stroke="${C.text}" stroke-width="1.5"/>`).join('')}
  </svg>`;
}

function length_viz() {
  // ruler with marks
  return `<svg width="80" height="35" viewBox="0 0 80 35">
    <rect x="5" y="8" width="70" height="14" rx="2" fill="${C.dim}" stroke="${C.primary}" stroke-width="1.5"/>
    ${[0,1,2,3,4,5,6].map(i => `<line x1="${10+i*10}" y1="8" x2="${10+i*10}" y2="${i%2===0?18:14}" stroke="${C.text}" stroke-width="1"/>`).join('')}
    <line x1="5" y1="28" x2="75" y2="28" stroke="${C.accent}" stroke-width="1.5"/>
    <polygon points="73,25 78,28 73,31" fill="${C.accent}"/>
    <polygon points="8,25 3,28 8,31" fill="${C.accent}"/>
  </svg>`;
}

function complexity_viz() {
  // O() — tangled lines vs simple line
  return `<svg width="90" height="50" viewBox="0 0 90 50">
    <path d="M5,40 Q15,5 25,25 Q35,45 45,15 Q55,40 65,10 Q75,35 85,20" fill="none" stroke="${C.danger}" stroke-width="2" opacity="0.7"/>
    <line x1="5" y1="42" x2="85" y2="42" stroke="${C.muted}" stroke-width="1"/>
    <text x="45" y="12" text-anchor="middle" fill="${C.accent}" font-size="11" font-weight="700">O()</text>
  </svg>`;
}

function ratio_viz() {
  // fraction bar
  return `<svg width="50" height="50" viewBox="0 0 50 50">
    <circle cx="25" cy="12" r="6" fill="${C.primary}" opacity="0.6"/>
    <line x1="10" y1="25" x2="40" y2="25" stroke="${C.text}" stroke-width="2"/>
    <circle cx="25" cy="38" r="6" fill="${C.accent}" opacity="0.6"/>
  </svg>`;
}

function quantity_viz(label, opts = {}) {
  // dots representing a number/amount
  const n = opts.count || 3;
  const w = n * 16 + 10, h = 30;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  for (let i = 0; i < n; i++) {
    svg += `<circle cx="${8+i*16}" cy="15" r="6" fill="${C.primary}" opacity="${0.5 + i*0.15}"/>`;
  }
  svg += `</svg>`;
  return svg;
}

// ═══════════════════════════════════════
// COMPARISON VISUALS
// ═══════════════════════════════════════

function faster_viz() {
  // speed gauge — needle pointing high
  return `<svg width="70" height="50" viewBox="0 0 70 50">
    <path d="M10,40 A30,30 0 0,1 60,40" fill="none" stroke="${C.muted}" stroke-width="3"/>
    <line x1="35" y1="40" x2="52" y2="18" stroke="${C.success}" stroke-width="2.5"/>
    <circle cx="35" cy="40" r="3" fill="${C.success}"/>
  </svg>`;
}

function slower_viz() {
  // speed gauge — needle pointing low
  return `<svg width="70" height="50" viewBox="0 0 70 50">
    <path d="M10,40 A30,30 0 0,1 60,40" fill="none" stroke="${C.muted}" stroke-width="3"/>
    <line x1="35" y1="40" x2="18" y2="22" stroke="${C.danger}" stroke-width="2.5"/>
    <circle cx="35" cy="40" r="3" fill="${C.danger}"/>
  </svg>`;
}

function greater_viz() {
  // > arrow comparison
  return `<svg width="50" height="40" viewBox="0 0 50 40">
    <polyline points="10,8 35,20 10,32" fill="none" stroke="${C.success}" stroke-width="3" stroke-linejoin="round"/>
  </svg>`;
}

function less_viz() {
  // < arrow comparison
  return `<svg width="50" height="40" viewBox="0 0 50 40">
    <polyline points="35,8 10,20 35,32" fill="none" stroke="${C.danger}" stroke-width="3" stroke-linejoin="round"/>
  </svg>`;
}

function equal_viz() {
  // = sign
  return `<svg width="45" height="35" viewBox="0 0 45 35">
    <line x1="8" y1="12" x2="37" y2="12" stroke="${C.text}" stroke-width="3"/>
    <line x1="8" y1="23" x2="37" y2="23" stroke="${C.text}" stroke-width="3"/>
  </svg>`;
}

// ═══════════════════════════════════════
// ABSTRACT / STRUCTURAL VISUALS
// ═══════════════════════════════════════

function architecture_viz() {
  // blueprint — layered blocks with connections
  return `<svg width="90" height="70" viewBox="0 0 90 70">
    <rect x="25" y="5" width="40" height="14" rx="3" fill="${C.dim}" stroke="${C.primary}" stroke-width="1.5"/>
    <rect x="15" y="25" width="28" height="14" rx="3" fill="${C.dim}" stroke="${C.accent}" stroke-width="1.5"/>
    <rect x="47" y="25" width="28" height="14" rx="3" fill="${C.dim}" stroke="${C.success}" stroke-width="1.5"/>
    <rect x="25" y="45" width="40" height="14" rx="3" fill="${C.dim}" stroke="${C.purple}" stroke-width="1.5"/>
    <line x1="35" y1="19" x2="29" y2="25" stroke="${C.stroke}" stroke-width="1"/>
    <line x1="55" y1="19" x2="61" y2="25" stroke="${C.stroke}" stroke-width="1"/>
    <line x1="29" y1="39" x2="35" y2="45" stroke="${C.stroke}" stroke-width="1"/>
    <line x1="61" y1="39" x2="55" y2="45" stroke="${C.stroke}" stroke-width="1"/>
  </svg>`;
}

function layer_viz() {
  // single horizontal bar (one layer)
  return `<svg width="100" height="30" viewBox="0 0 100 30">
    <rect x="5" y="6" width="90" height="18" rx="4" fill="${C.dim}" stroke="${C.primary}" stroke-width="2"/>
  </svg>`;
}

function bottleneck_viz() {
  // EMBODIED: items squeeze through narrow gap — you FEEL the constriction
  return `<svg width="80" height="55" viewBox="0 0 80 55">
    <path d="M5,5 L75,5 L55,50 L25,50 Z" fill="${C.dim}" stroke="${C.danger}" stroke-width="2"/>
    <circle cx="20" cy="15" r="4" fill="${C.primary}">
      <animate attributeName="cx" values="20;40;40" dur="2s" repeatCount="indefinite"/>
      <animate attributeName="cy" values="15;38;38" dur="2s" repeatCount="indefinite"/>
      <animate attributeName="r" values="4;2;2" dur="2s" repeatCount="indefinite"/>
    </circle>
    <circle cx="60" cy="15" r="4" fill="${C.accent}">
      <animate attributeName="cx" values="60;40;40" dur="2s" begin="0.3s" repeatCount="indefinite"/>
      <animate attributeName="cy" values="15;38;38" dur="2s" begin="0.3s" repeatCount="indefinite"/>
      <animate attributeName="r" values="4;2;2" dur="2s" begin="0.3s" repeatCount="indefinite"/>
    </circle>
    <circle cx="40" cy="12" r="4" fill="${C.success}">
      <animate attributeName="cy" values="12;38;38" dur="2s" begin="0.6s" repeatCount="indefinite"/>
      <animate attributeName="r" values="4;2;2" dur="2s" begin="0.6s" repeatCount="indefinite"/>
    </circle>
  </svg>`;
}

function parallelization_viz() {
  // EMBODIED: multiple items move SIMULTANEOUSLY — you see concurrency happening
  const colors = [C.primary, C.accent, C.success, C.purple];
  let svg = `<svg width="90" height="55" viewBox="0 0 90 55">`;
  for (let i = 0; i < 4; i++) {
    svg += `<line x1="8" y1="${10+i*12}" x2="72" y2="${10+i*12}" stroke="${colors[i]}" stroke-width="3" opacity="0.4"/>`;
    svg += `<circle cx="15" cy="${10+i*12}" r="4" fill="${colors[i]}">
      <animate attributeName="cx" values="15;70;15" dur="1.5s" repeatCount="indefinite"/>
    </circle>`;
  }
  svg += `</svg>`;
  return svg;
}

function dependency_viz() {
  // chain links
  return `<svg width="80" height="35" viewBox="0 0 80 35">
    ${[0,1,2].map(i => `<ellipse cx="${15+i*25}" cy="17" rx="12" ry="10" fill="none" stroke="${C.accent}" stroke-width="2"/>`).join('')}
  </svg>`;
}

function recurrence_viz() {
  // EMBODIED: items queue up, each WAITING for previous — you feel the blocking
  return `<svg width="120" height="50" viewBox="0 0 120 50">
    <circle cx="20" cy="25" r="8" fill="${C.success}">
      <animate attributeName="opacity" values="1;0.3;0.3;0.3;1" dur="3s" repeatCount="indefinite"/>
    </circle>
    <circle cx="45" cy="25" r="8" fill="${C.accent}" opacity="0.3">
      <animate attributeName="opacity" values="0.3;1;0.3;0.3;0.3" dur="3s" repeatCount="indefinite"/>
    </circle>
    <circle cx="70" cy="25" r="8" fill="${C.primary}" opacity="0.3">
      <animate attributeName="opacity" values="0.3;0.3;1;0.3;0.3" dur="3s" repeatCount="indefinite"/>
    </circle>
    <circle cx="95" cy="25" r="8" fill="${C.purple}" opacity="0.3">
      <animate attributeName="opacity" values="0.3;0.3;0.3;1;0.3" dur="3s" repeatCount="indefinite"/>
    </circle>
    <line x1="30" y1="25" x2="37" y2="25" stroke="${C.stroke}" stroke-width="1.5" stroke-dasharray="3,2"/>
    <line x1="55" y1="25" x2="62" y2="25" stroke="${C.stroke}" stroke-width="1.5" stroke-dasharray="3,2"/>
    <line x1="80" y1="25" x2="87" y2="25" stroke="${C.stroke}" stroke-width="1.5" stroke-dasharray="3,2"/>
  </svg>`;
}

function input_viz() {
  // arrow pointing into a slot
  return `<svg width="70" height="45" viewBox="0 0 70 45">
    <rect x="30" y="5" width="35" height="35" rx="5" fill="${C.dim}" stroke="${C.success}" stroke-width="2"/>
    <line x1="5" y1="22" x2="28" y2="22" stroke="${C.success}" stroke-width="2.5"/>
    <polygon points="26,18 32,22 26,26" fill="${C.success}"/>
  </svg>`;
}

function output_viz() {
  // arrow pointing out of a slot
  return `<svg width="70" height="45" viewBox="0 0 70 45">
    <rect x="5" y="5" width="35" height="35" rx="5" fill="${C.dim}" stroke="${C.accent}" stroke-width="2"/>
    <line x1="42" y1="22" x2="60" y2="22" stroke="${C.accent}" stroke-width="2.5"/>
    <polygon points="58,18 65,22 58,26" fill="${C.accent}"/>
  </svg>`;
}

function weight_viz() {
  // balance scale
  return `<svg width="60" height="50" viewBox="0 0 60 50">
    <line x1="30" y1="5" x2="30" y2="35" stroke="${C.muted}" stroke-width="2"/>
    <line x1="10" y1="15" x2="50" y2="15" stroke="${C.accent}" stroke-width="2"/>
    <polygon points="27,5 30,0 33,5" fill="${C.muted}"/>
    <circle cx="10" cy="15" r="5" fill="${C.primary}" opacity="0.6"/>
    <circle cx="50" cy="15" r="5" fill="${C.success}" opacity="0.6"/>
    <polygon points="25,37 35,37 30,42" fill="${C.muted}"/>
  </svg>`;
}

function score_viz() {
  // gauge/meter
  return `<svg width="60" height="45" viewBox="0 0 60 45">
    <path d="M8,35 A25,25 0 0,1 52,35" fill="none" stroke="${C.muted}" stroke-width="3"/>
    <path d="M8,35 A25,25 0 0,1 42,12" fill="none" stroke="${C.success}" stroke-width="3"/>
    <circle cx="30" cy="35" r="3" fill="${C.accent}"/>
  </svg>`;
}

function parameter_viz() {
  // θ in a circle
  return `<svg width="45" height="45" viewBox="0 0 45 45">
    <circle cx="22" cy="22" r="16" fill="${C.dim}" stroke="${C.purple}" stroke-width="2"/>
    <text x="22" y="28" text-anchor="middle" fill="${C.purple}" font-size="18">θ</text>
  </svg>`;
}

function self_attention_viz() {
  // attention pointing at itself (loop + eye)
  return `<svg width="80" height="65" viewBox="0 0 80 65">
    <rect x="15" y="20" width="50" height="30" rx="6" fill="${C.dim}" stroke="${C.purple}" stroke-width="2"/>
    <ellipse cx="40" cy="35" rx="10" ry="6" fill="none" stroke="${C.text}" stroke-width="1.5"/>
    <circle cx="40" cy="35" r="3" fill="${C.text}"/>
    <path d="M65,35 Q75,35 75,15 Q75,5 40,8" fill="none" stroke="${C.accent}" stroke-width="2" stroke-dasharray="4,3"/>
    <polygon points="43,5 38,9 43,12" fill="${C.accent}"/>
  </svg>`;
}

function training_viz() {
  // descending loss curve
  return `<svg width="80" height="50" viewBox="0 0 80 50">
    <line x1="10" y1="42" x2="70" y2="42" stroke="${C.muted}" stroke-width="1"/>
    <line x1="10" y1="5" x2="10" y2="42" stroke="${C.muted}" stroke-width="1"/>
    <path d="M12,10 Q25,12 35,25 Q50,38 68,40" fill="none" stroke="${C.success}" stroke-width="2.5"/>
  </svg>`;
}

function intelligence_viz() {
  // brain/network shape
  return `<svg width="65" height="55" viewBox="0 0 65 55">
    <path d="M32,5 Q50,5 52,18 Q55,30 45,35 Q50,42 42,48 Q32,52 22,48 Q14,42 18,35 Q8,30 12,18 Q14,5 32,5" fill="${C.dim}" stroke="${C.purple}" stroke-width="2"/>
    <circle cx="25" cy="20" r="3" fill="${C.primary}" opacity="0.7"/>
    <circle cx="38" cy="18" r="3" fill="${C.accent}" opacity="0.7"/>
    <circle cx="32" cy="32" r="3" fill="${C.success}" opacity="0.7"/>
    <line x1="25" y1="20" x2="38" y2="18" stroke="${C.stroke}" stroke-width="1"/>
    <line x1="38" y1="18" x2="32" y2="32" stroke="${C.stroke}" stroke-width="1"/>
    <line x1="25" y1="20" x2="32" y2="32" stroke="${C.stroke}" stroke-width="1"/>
  </svg>`;
}

function representation_viz() {
  // abstract encoding — colored grid pattern
  const w = 70, h = 40;
  const colors = [C.primary, C.accent, C.success, C.purple, C.danger];
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
    svg += `<rect x="${5+c*13}" y="${5+r*11}" width="11" height="9" rx="2" fill="${colors[(r*2+c)%5]}" opacity="${(0.2 + ((r+c)%4)*0.2).toFixed(1)}"/>`;
  }
  svg += `</svg>`;
  return svg;
}

// ═══════════════════════════════════════
// MISC CONCEPTS — function, mechanism, grid, multiply, square
// ═══════════════════════════════════════

function function_viz(label, opts = {}) {
  // Box with f(x) sigmoid-like curve inside, input arrow on left, output arrow on right
  const w = 80, h = 50;
  const color = opts.color || C.primary;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect x="18" y="5" width="44" height="40" rx="5" fill="${C.dim}" stroke="${color}" stroke-width="2"/>
    <path d="M24,35 C30,35 32,15 40,15 C48,15 50,35 56,35" fill="none" stroke="${C.accent}" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="2" y1="25" x2="16" y2="25" stroke="${C.stroke}" stroke-width="1.5"/>
    <polygon points="14,22 18,25 14,28" fill="${C.stroke}"/>
    <line x1="64" y1="25" x2="78" y2="25" stroke="${C.stroke}" stroke-width="1.5"/>
    <polygon points="74,22 78,25 74,28" fill="${C.stroke}"/>
  </svg>`;
}

function mechanism_viz(label, opts = {}) {
  // Two interlocking gears — circles with teeth touching
  const w = 80, h = 55;
  const color1 = opts.color || C.accent;
  const color2 = C.primary;
  // Gear 1 (left)
  const g1x = 28, g1y = 28, g1r = 14;
  // Gear 2 (right, offset so teeth interlock)
  const g2x = 52, g2y = 28, g2r = 12;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  // Gear 1 teeth
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    const tx = g1x + (g1r + 4) * Math.cos(a);
    const ty = g1y + (g1r + 4) * Math.sin(a);
    svg += `<rect x="${(tx - 3).toFixed(1)}" y="${(ty - 3).toFixed(1)}" width="6" height="6" rx="1" fill="${color1}" opacity="0.7" transform="rotate(${(a * 180 / Math.PI).toFixed(0)} ${tx.toFixed(1)} ${ty.toFixed(1)})"/>`;
  }
  svg += `<circle cx="${g1x}" cy="${g1y}" r="${g1r}" fill="${C.dim}" stroke="${color1}" stroke-width="2"/>`;
  svg += `<circle cx="${g1x}" cy="${g1y}" r="3" fill="${color1}" opacity="0.6"/>`;
  // Gear 2 teeth
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    const tx = g2x + (g2r + 4) * Math.cos(a);
    const ty = g2y + (g2r + 4) * Math.sin(a);
    svg += `<rect x="${(tx - 3).toFixed(1)}" y="${(ty - 3).toFixed(1)}" width="6" height="6" rx="1" fill="${color2}" opacity="0.7" transform="rotate(${(a * 180 / Math.PI).toFixed(0)} ${tx.toFixed(1)} ${ty.toFixed(1)})"/>`;
  }
  svg += `<circle cx="${g2x}" cy="${g2y}" r="${g2r}" fill="${C.dim}" stroke="${color2}" stroke-width="2"/>`;
  svg += `<circle cx="${g2x}" cy="${g2y}" r="3" fill="${color2}" opacity="0.6"/>`;
  svg += `</svg>`;
  return svg;
}

function n_squared_viz(label, opts = {}) {
  // Grid of dots n x n showing quadratic growth
  const n = 4;
  const w = 70, h = 60;
  const gap = 11, dotR = 3;
  const ox = (w - (n - 1) * gap) / 2;
  const oy = (h - (n - 1) * gap) / 2;
  const color = opts.color || C.accent;
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const opacity = (0.3 + ((r + c) % 3) * 0.25).toFixed(2);
      svg += `<circle cx="${(ox + c * gap).toFixed(1)}" cy="${(oy + r * gap).toFixed(1)}" r="${dotR}" fill="${color}" opacity="${opacity}"/>`;
    }
  }
  // Faint bounding box to suggest the n x n area
  svg += `<rect x="${(ox - dotR - 2).toFixed(1)}" y="${(oy - dotR - 2).toFixed(1)}" width="${((n - 1) * gap + 2 * dotR + 4).toFixed(1)}" height="${((n - 1) * gap + 2 * dotR + 4).toFixed(1)}" rx="3" fill="none" stroke="${C.muted}" stroke-width="1" stroke-dasharray="3,2"/>`;
  svg += `</svg>`;
  return svg;
}

function multiplication_viz(label, opts = {}) {
  // X symbol between two small squares
  const w = 70, h = 40;
  const color = opts.color || C.primary;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect x="5" y="10" width="18" height="18" rx="3" fill="${C.dim}" stroke="${color}" stroke-width="2"/>
    <line x1="30" y1="13" x2="40" y2="27" stroke="${C.accent}" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="40" y1="13" x2="30" y2="27" stroke="${C.accent}" stroke-width="2.5" stroke-linecap="round"/>
    <rect x="47" y="10" width="18" height="18" rx="3" fill="${C.dim}" stroke="${C.success}" stroke-width="2"/>
  </svg>`;
}

function square_viz(label, opts = {}) {
  // A square shape (geometric)
  const color = opts.color || C.primary;
  return `<svg width="80" height="80" viewBox="0 0 80 80">
    <rect x="8" y="8" width="64" height="64" fill="${C.dim}" stroke="${color}" stroke-width="2.5"/>
  </svg>`;
}

// ═══════════════════════════════════════
// GENERIC LABELED BOX (fallback)
// ═══════════════════════════════════════

function generic_concept(label, opts = {}) {
  // Generate a UNIQUE visual per label using hash → shape + color
  // So different concepts that both fall to "default" still look distinct
  const str = (label || 'x').toLowerCase();
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  h = Math.abs(h);

  // Pick color from palette based on hash
  const palette = ['#4FC3F7','#FFB74D','#81C784','#CE93D8','#EF9A9A','#90CAF9','#FFF176','#80CBC4'];
  const color = opts.color || palette[h % palette.length];
  // Pick shape variant (0-5)
  const shape = h % 6;

  const w = 65, ht = 50;
  let inner = '';
  switch (shape) {
    case 0: // Circle
      inner = `<circle cx="32" cy="22" r="16" fill="${C.dim}" stroke="${color}" stroke-width="2"/>
        <circle cx="32" cy="22" r="6" fill="${color}" opacity="0.5"/>`;
      break;
    case 1: // Diamond
      inner = `<polygon points="32,6 52,22 32,38 12,22" fill="${C.dim}" stroke="${color}" stroke-width="2"/>
        <circle cx="32" cy="22" r="4" fill="${color}" opacity="0.6"/>`;
      break;
    case 2: // Hexagon
      inner = `<polygon points="32,6 50,14 50,30 32,38 14,30 14,14" fill="${C.dim}" stroke="${color}" stroke-width="2"/>
        <circle cx="32" cy="22" r="5" fill="${color}" opacity="0.4"/>`;
      break;
    case 3: // Rounded rectangle
      inner = `<rect x="6" y="8" width="52" height="28" rx="6" fill="${C.dim}" stroke="${color}" stroke-width="2"/>
        <line x1="18" y1="22" x2="46" y2="22" stroke="${color}" stroke-width="2" opacity="0.5"/>`;
      break;
    case 4: // Pentagon
      inner = `<polygon points="32,6 52,18 46,38 18,38 12,18" fill="${C.dim}" stroke="${color}" stroke-width="2"/>
        <circle cx="32" cy="24" r="4" fill="${color}" opacity="0.5"/>`;
      break;
    case 5: // Capsule with unique dots
      const d1 = (h >> 3) % 4 + 2;
      const d2 = (h >> 5) % 4 + 2;
      inner = `<rect x="4" y="8" width="56" height="28" rx="14" fill="${C.dim}" stroke="${color}" stroke-width="2"/>
        <circle cx="22" cy="22" r="${d1}" fill="${color}" opacity="0.5"/>
        <circle cx="42" cy="22" r="${d2}" fill="${color}" opacity="0.7"/>`;
      break;
  }
  return `<svg width="${w}" height="${ht}" viewBox="0 0 ${w} 44">${inner}</svg>`;
}

// ═══════════════════════════════════════
// PEOPLE, COMMUNICATION, ABSTRACT (expanded vocabulary)
// ═══════════════════════════════════════

// ─── Person: simple stick figure with round head ───
function person_viz(label, opts = {}) {
  const color = opts.color || C.primary;
  return `<svg width="50" height="70" viewBox="0 0 50 70">
    <circle cx="25" cy="14" r="10" fill="${C.dim}" stroke="${color}" stroke-width="2"/>
    <line x1="25" y1="24" x2="25" y2="48" stroke="${color}" stroke-width="2.5"/>
    <line x1="25" y1="32" x2="10" y2="42" stroke="${color}" stroke-width="2"/>
    <line x1="25" y1="32" x2="40" y2="42" stroke="${color}" stroke-width="2"/>
    <line x1="25" y1="48" x2="14" y2="64" stroke="${color}" stroke-width="2"/>
    <line x1="25" y1="48" x2="36" y2="64" stroke="${color}" stroke-width="2"/>
  </svg>`;
}

// ─── Researcher: person with glasses ───
function researcher_viz(label, opts = {}) {
  const color = opts.color || '#4FC3F7';
  return `<svg width="50" height="70" viewBox="0 0 50 70">
    <circle cx="25" cy="14" r="10" fill="${C.dim}" stroke="${color}" stroke-width="2"/>
    <circle cx="20" cy="13" r="4" fill="none" stroke="${C.accent}" stroke-width="1.5"/>
    <circle cx="30" cy="13" r="4" fill="none" stroke="${C.accent}" stroke-width="1.5"/>
    <line x1="24" y1="13" x2="26" y2="13" stroke="${C.accent}" stroke-width="1"/>
    <line x1="25" y1="24" x2="25" y2="48" stroke="${color}" stroke-width="2.5"/>
    <line x1="25" y1="32" x2="10" y2="42" stroke="${color}" stroke-width="2"/>
    <line x1="25" y1="32" x2="40" y2="42" stroke="${color}" stroke-width="2"/>
    <line x1="25" y1="48" x2="14" y2="64" stroke="${color}" stroke-width="2"/>
    <line x1="25" y1="48" x2="36" y2="64" stroke="${color}" stroke-width="2"/>
  </svg>`;
}

// ─── Group: three overlapping person silhouettes ───
function group_viz(label, opts = {}) {
  return `<svg width="80" height="60" viewBox="0 0 80 60">
    <circle cx="25" cy="16" r="8" fill="${C.dim}" stroke="${C.muted}" stroke-width="1.5"/>
    <line x1="25" y1="24" x2="25" y2="42" stroke="${C.muted}" stroke-width="2"/>
    <line x1="25" y1="30" x2="16" y2="38" stroke="${C.muted}" stroke-width="1.5"/>
    <line x1="25" y1="30" x2="34" y2="38" stroke="${C.muted}" stroke-width="1.5"/>
    <circle cx="40" cy="12" r="8" fill="${C.dim}" stroke="${C.primary}" stroke-width="2"/>
    <line x1="40" y1="20" x2="40" y2="40" stroke="${C.primary}" stroke-width="2.5"/>
    <line x1="40" y1="26" x2="30" y2="36" stroke="${C.primary}" stroke-width="2"/>
    <line x1="40" y1="26" x2="50" y2="36" stroke="${C.primary}" stroke-width="2"/>
    <circle cx="55" cy="16" r="8" fill="${C.dim}" stroke="${C.accent}" stroke-width="1.5"/>
    <line x1="55" y1="24" x2="55" y2="42" stroke="${C.accent}" stroke-width="2"/>
    <line x1="55" y1="30" x2="46" y2="38" stroke="${C.accent}" stroke-width="1.5"/>
    <line x1="55" y1="30" x2="64" y2="38" stroke="${C.accent}" stroke-width="1.5"/>
  </svg>`;
}

// ─── King: crown + short lines (mustache) ───
function king_viz(label, opts = {}) {
  return `<svg width="60" height="65" viewBox="0 0 60 65">
    <polygon points="12,28 16,10 22,22 30,6 38,22 44,10 48,28" fill="${C.accent}" opacity="0.3" stroke="${C.accent}" stroke-width="2"/>
    <circle cx="30" cy="38" r="12" fill="${C.dim}" stroke="${C.primary}" stroke-width="2"/>
    <line x1="22" y1="42" x2="18" y2="46" stroke="${C.accent}" stroke-width="2" stroke-linecap="round"/>
    <line x1="38" y1="42" x2="42" y2="46" stroke="${C.accent}" stroke-width="2" stroke-linecap="round"/>
    <circle cx="26" cy="36" r="1.5" fill="${C.text}"/>
    <circle cx="34" cy="36" r="1.5" fill="${C.text}"/>
  </svg>`;
}

// ─── Queen: crown + long flowing lines (hair) ───
function queen_viz(label, opts = {}) {
  return `<svg width="60" height="70" viewBox="0 0 60 70">
    <polygon points="15,28 19,12 25,22 30,8 35,22 41,12 45,28" fill="${C.purple}" opacity="0.3" stroke="${C.purple}" stroke-width="2"/>
    <circle cx="30" cy="38" r="12" fill="${C.dim}" stroke="${C.purple}" stroke-width="2"/>
    <path d="M18,34 Q14,50 16,62" fill="none" stroke="${C.accent}" stroke-width="2"/>
    <path d="M42,34 Q46,50 44,62" fill="none" stroke="${C.accent}" stroke-width="2"/>
    <path d="M20,36 Q16,52 20,64" fill="none" stroke="${C.accent}" stroke-width="1.5" opacity="0.6"/>
    <path d="M40,36 Q44,52 40,64" fill="none" stroke="${C.accent}" stroke-width="1.5" opacity="0.6"/>
    <circle cx="26" cy="36" r="1.5" fill="${C.text}"/>
    <circle cx="34" cy="36" r="1.5" fill="${C.text}"/>
  </svg>`;
}

// ─── Teacher: person with pointer/board ───
function teacher_viz(label, opts = {}) {
  return `<svg width="70" height="65" viewBox="0 0 70 65">
    <rect x="35" y="5" width="30" height="22" rx="2" fill="${C.dim}" stroke="${C.muted}" stroke-width="1.5"/>
    <line x1="40" y1="11" x2="60" y2="11" stroke="${C.muted}" stroke-width="1" opacity="0.5"/>
    <line x1="40" y1="16" x2="55" y2="16" stroke="${C.muted}" stroke-width="1" opacity="0.5"/>
    <line x1="40" y1="21" x2="58" y2="21" stroke="${C.muted}" stroke-width="1" opacity="0.5"/>
    <circle cx="18" cy="14" r="9" fill="${C.dim}" stroke="${C.primary}" stroke-width="2"/>
    <line x1="18" y1="23" x2="18" y2="44" stroke="${C.primary}" stroke-width="2.5"/>
    <line x1="18" y1="30" x2="35" y2="18" stroke="${C.accent}" stroke-width="2"/>
    <line x1="18" y1="30" x2="8" y2="40" stroke="${C.primary}" stroke-width="2"/>
    <line x1="18" y1="44" x2="10" y2="58" stroke="${C.primary}" stroke-width="2"/>
    <line x1="18" y1="44" x2="26" y2="58" stroke="${C.primary}" stroke-width="2"/>
  </svg>`;
}

// ─── Student: person with book ───
function student_viz(label, opts = {}) {
  return `<svg width="55" height="65" viewBox="0 0 55 65">
    <circle cx="22" cy="14" r="9" fill="${C.dim}" stroke="${C.success}" stroke-width="2"/>
    <line x1="22" y1="23" x2="22" y2="44" stroke="${C.success}" stroke-width="2.5"/>
    <line x1="22" y1="30" x2="12" y2="40" stroke="${C.success}" stroke-width="2"/>
    <line x1="22" y1="30" x2="32" y2="38" stroke="${C.success}" stroke-width="2"/>
    <rect x="32" y="32" width="14" height="18" rx="2" fill="${C.dim}" stroke="${C.accent}" stroke-width="1.5"/>
    <line x1="39" y1="32" x2="39" y2="50" stroke="${C.accent}" stroke-width="1"/>
    <line x1="22" y1="44" x2="14" y2="58" stroke="${C.success}" stroke-width="2"/>
    <line x1="22" y1="44" x2="30" y2="58" stroke="${C.success}" stroke-width="2"/>
  </svg>`;
}

// ─── Speech Scroll (Aztec-inspired tlahtolli): curling scroll from mouth ───
function speech_scroll_viz(label, opts = {}) {
  return `<svg width="70" height="55" viewBox="0 0 70 55">
    <circle cx="16" cy="20" r="10" fill="${C.dim}" stroke="${C.primary}" stroke-width="2"/>
    <ellipse cx="16" cy="24" rx="4" ry="2" fill="${C.accent}" opacity="0.6"/>
    <path d="M26,20 Q34,10 42,14 Q50,18 48,26 Q46,34 38,32 Q34,30 36,26" fill="none" stroke="${C.accent}" stroke-width="2.5" stroke-linecap="round">
      <animate attributeName="stroke-dasharray" values="0,100;60,100" dur="1.5s" fill="freeze"/>
    </path>
    <path d="M36,26 Q38,22 42,24" fill="none" stroke="${C.accent}" stroke-width="2" stroke-linecap="round">
      <animate attributeName="stroke-dasharray" values="0,20;12,20" dur="1.5s" begin="1s" fill="freeze"/>
    </path>
    <circle cx="50" cy="12" r="2" fill="${C.accent}" opacity="0.4">
      <animate attributeName="r" values="1;2.5;1" dur="2s" repeatCount="indefinite"/>
    </circle>
    <circle cx="58" cy="8" r="1.5" fill="${C.accent}" opacity="0.3">
      <animate attributeName="r" values="0.5;2;0.5" dur="2s" begin="0.3s" repeatCount="indefinite"/>
    </circle>
  </svg>`;
}

// ─── Word/Text: horizontal lines suggesting text ───
function word_viz(label, opts = {}) {
  return `<svg width="60" height="40" viewBox="0 0 60 40">
    <rect x="3" y="3" width="54" height="34" rx="4" fill="${C.dim}" stroke="${C.muted}" stroke-width="1.5"/>
    <line x1="10" y1="12" x2="40" y2="12" stroke="${C.text}" stroke-width="2" opacity="0.7"/>
    <line x1="10" y1="20" x2="50" y2="20" stroke="${C.text}" stroke-width="2" opacity="0.5"/>
    <line x1="10" y1="28" x2="35" y2="28" stroke="${C.text}" stroke-width="2" opacity="0.3"/>
  </svg>`;
}

// ─── Document/Paper: page with folded corner ───
function document_viz(label, opts = {}) {
  return `<svg width="50" height="60" viewBox="0 0 50 60">
    <polygon points="5,3 35,3 45,13 45,57 5,57" fill="${C.dim}" stroke="${C.primary}" stroke-width="2"/>
    <polyline points="35,3 35,13 45,13" fill="none" stroke="${C.primary}" stroke-width="1.5"/>
    <line x1="12" y1="22" x2="38" y2="22" stroke="${C.text}" stroke-width="1.5" opacity="0.5"/>
    <line x1="12" y1="30" x2="38" y2="30" stroke="${C.text}" stroke-width="1.5" opacity="0.4"/>
    <line x1="12" y1="38" x2="32" y2="38" stroke="${C.text}" stroke-width="1.5" opacity="0.3"/>
    <line x1="12" y1="46" x2="36" y2="46" stroke="${C.text}" stroke-width="1.5" opacity="0.2"/>
  </svg>`;
}

// ─── Question: thought bubble with ? ───
function question_viz(label, opts = {}) {
  return `<svg width="50" height="55" viewBox="0 0 50 55">
    <ellipse cx="25" cy="22" rx="20" ry="18" fill="${C.dim}" stroke="${C.accent}" stroke-width="2"/>
    <circle cx="18" cy="44" r="3" fill="${C.accent}" opacity="0.5"/>
    <circle cx="14" cy="50" r="2" fill="${C.accent}" opacity="0.3"/>
    <text x="25" y="30" text-anchor="middle" fill="${C.accent}" font-size="22" font-weight="700">?</text>
  </svg>`;
}

// ─── Idea: lightbulb ───
function idea_viz(label, opts = {}) {
  return `<svg width="50" height="60" viewBox="0 0 50 60">
    <path d="M25,5 Q42,5 42,22 Q42,32 32,36 L32,44 L18,44 L18,36 Q8,32 8,22 Q8,5 25,5Z" fill="${C.dim}" stroke="${C.accent}" stroke-width="2"/>
    <line x1="20" y1="44" x2="20" y2="50" stroke="${C.accent}" stroke-width="1.5"/>
    <line x1="30" y1="44" x2="30" y2="50" stroke="${C.accent}" stroke-width="1.5"/>
    <line x1="18" y1="50" x2="32" y2="50" stroke="${C.accent}" stroke-width="2" stroke-linecap="round"/>
    <line x1="25" y1="16" x2="25" y2="30" stroke="${C.accent}" stroke-width="2"/>
    <line x1="18" y1="23" x2="32" y2="23" stroke="${C.accent}" stroke-width="2"/>
    <animate attributeName="opacity" values="0.7;1;0.7" dur="2s" repeatCount="indefinite"/>
  </svg>`;
}

// ─── Time: clock face ───
function time_viz(label, opts = {}) {
  return `<svg width="50" height="50" viewBox="0 0 50 50">
    <circle cx="25" cy="25" r="20" fill="${C.dim}" stroke="${C.primary}" stroke-width="2"/>
    <line x1="25" y1="25" x2="25" y2="12" stroke="${C.text}" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="25" y1="25" x2="35" y2="25" stroke="${C.text}" stroke-width="2" stroke-linecap="round">
      <animateTransform attributeName="transform" type="rotate" values="0,25,25;360,25,25" dur="6s" repeatCount="indefinite"/>
    </line>
    <circle cx="25" cy="25" r="2" fill="${C.accent}"/>
  </svg>`;
}

// ─── Goal: target/bullseye ───
function goal_viz(label, opts = {}) {
  return `<svg width="50" height="50" viewBox="0 0 50 50">
    <circle cx="25" cy="25" r="20" fill="none" stroke="${C.danger}" stroke-width="2"/>
    <circle cx="25" cy="25" r="13" fill="none" stroke="${C.accent}" stroke-width="2"/>
    <circle cx="25" cy="25" r="6" fill="${C.success}" opacity="0.6"/>
    <circle cx="25" cy="25" r="2" fill="${C.text}"/>
  </svg>`;
}

// ─── Problem: warning triangle ───
function problem_viz(label, opts = {}) {
  return `<svg width="55" height="50" viewBox="0 0 55 50">
    <polygon points="27,5 50,45 4,45" fill="${C.dim}" stroke="${C.accent}" stroke-width="2"/>
    <text x="27" y="38" text-anchor="middle" fill="${C.accent}" font-size="22" font-weight="700">!</text>
  </svg>`;
}

// ─── Solution: key ───
function solution_viz(label, opts = {}) {
  return `<svg width="60" height="35" viewBox="0 0 60 35">
    <circle cx="14" cy="17" r="10" fill="${C.dim}" stroke="${C.success}" stroke-width="2"/>
    <circle cx="14" cy="17" r="4" fill="none" stroke="${C.success}" stroke-width="1.5"/>
    <line x1="24" y1="17" x2="52" y2="17" stroke="${C.success}" stroke-width="2.5"/>
    <line x1="44" y1="17" x2="44" y2="24" stroke="${C.success}" stroke-width="2"/>
    <line x1="50" y1="17" x2="50" y2="24" stroke="${C.success}" stroke-width="2"/>
  </svg>`;
}

// ─── Success: trophy/star burst ───
function success_viz(label, opts = {}) {
  return `<svg width="50" height="55" viewBox="0 0 50 55">
    <polygon points="25,4 29,18 44,18 32,26 36,40 25,32 14,40 18,26 6,18 21,18" fill="${C.accent}" opacity="0.4" stroke="${C.accent}" stroke-width="1.5"/>
    <circle cx="25" cy="22" r="6" fill="${C.success}" opacity="0.6">
      <animate attributeName="r" values="5;7;5" dur="2s" repeatCount="indefinite"/>
    </circle>
  </svg>`;
}

// ─── Warning: exclamation in triangle ───
function warning_viz(label, opts = {}) {
  return `<svg width="55" height="50" viewBox="0 0 55 50">
    <polygon points="27,3 52,47 2,47" fill="${C.dim}" stroke="${C.danger}" stroke-width="2.5"/>
    <line x1="27" y1="18" x2="27" y2="32" stroke="${C.danger}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="27" cy="39" r="2.5" fill="${C.danger}"/>
    <animate attributeName="opacity" values="0.7;1;0.7" dur="1.5s" repeatCount="indefinite"/>
  </svg>`;
}

// ─── Rule/Principle: gavel ───
function rule_viz(label, opts = {}) {
  return `<svg width="55" height="45" viewBox="0 0 55 45">
    <rect x="18" y="6" width="20" height="12" rx="3" fill="${C.dim}" stroke="${C.primary}" stroke-width="2"/>
    <line x1="28" y1="18" x2="28" y2="32" stroke="${C.primary}" stroke-width="3"/>
    <line x1="12" y1="36" x2="44" y2="36" stroke="${C.primary}" stroke-width="3" stroke-linecap="round"/>
    <line x1="8" y1="40" x2="48" y2="40" stroke="${C.muted}" stroke-width="2"/>
  </svg>`;
}

// ─── Evidence: magnifying glass ───
function evidence_viz(label, opts = {}) {
  return `<svg width="50" height="55" viewBox="0 0 50 55">
    <circle cx="22" cy="22" r="14" fill="${C.dim}" stroke="${C.primary}" stroke-width="2"/>
    <circle cx="22" cy="22" r="8" fill="none" stroke="${C.primary}" stroke-width="1.5" opacity="0.5"/>
    <line x1="32" y1="32" x2="44" y2="48" stroke="${C.primary}" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
}

// ─── Relationship: two nodes with line ───
function relationship_viz(label, opts = {}) {
  return `<svg width="60" height="35" viewBox="0 0 60 35">
    <circle cx="12" cy="17" r="8" fill="${C.dim}" stroke="${C.primary}" stroke-width="2"/>
    <circle cx="48" cy="17" r="8" fill="${C.dim}" stroke="${C.accent}" stroke-width="2"/>
    <line x1="20" y1="17" x2="40" y2="17" stroke="${C.success}" stroke-width="2" stroke-dasharray="4,3">
      <animate attributeName="stroke-dashoffset" values="7;0" dur="1s" repeatCount="indefinite"/>
    </line>
  </svg>`;
}

// ─── Category: nested circles (Venn-like) ───
function category_viz(label, opts = {}) {
  return `<svg width="60" height="45" viewBox="0 0 60 45">
    <rect x="3" y="3" width="54" height="38" rx="8" fill="none" stroke="${C.muted}" stroke-width="1.5" stroke-dasharray="4,3"/>
    <circle cx="20" cy="22" r="8" fill="${C.primary}" opacity="0.2" stroke="${C.primary}" stroke-width="1.5"/>
    <circle cx="32" cy="22" r="8" fill="${C.accent}" opacity="0.2" stroke="${C.accent}" stroke-width="1.5"/>
    <circle cx="44" cy="22" r="8" fill="${C.success}" opacity="0.2" stroke="${C.success}" stroke-width="1.5"/>
  </svg>`;
}

// ─── World: simple globe ───
function world_viz(label, opts = {}) {
  return `<svg width="50" height="50" viewBox="0 0 50 50">
    <circle cx="25" cy="25" r="20" fill="${C.dim}" stroke="${C.primary}" stroke-width="2"/>
    <ellipse cx="25" cy="25" rx="10" ry="20" fill="none" stroke="${C.primary}" stroke-width="1" opacity="0.5"/>
    <line x1="5" y1="18" x2="45" y2="18" stroke="${C.primary}" stroke-width="1" opacity="0.4"/>
    <line x1="5" y1="32" x2="45" y2="32" stroke="${C.primary}" stroke-width="1" opacity="0.4"/>
  </svg>`;
}

// ─── Energy: lightning bolt ───
function energy_viz(label, opts = {}) {
  return `<svg width="40" height="60" viewBox="0 0 40 60">
    <polygon points="24,2 10,28 20,28 14,58 34,24 22,24" fill="${C.accent}" opacity="0.5" stroke="${C.accent}" stroke-width="2">
      <animate attributeName="opacity" values="0.4;0.9;0.4" dur="1.5s" repeatCount="indefinite"/>
    </polygon>
  </svg>`;
}


// ═══════════════════════════════════════
// MASTER REGISTRY — concept type → draw function
// ═══════════════════════════════════════

export const VISUAL_ALPHABET = {
  // Shapes
  hexagon, triangle, diamond, pentagon, star, circle, ellipse,
  square: square_viz,

  // Data structures
  matrix, vector, table, embedding,
  array: array_seq, sequence: array_seq, token: array_seq,
  tensor: (l, o) => matrix(l, { rows: 3, cols: 4, ...o }),

  // Neural network
  neuron, rnn, lstm,
  transformer: transformer_block, transformer_block,
  attention: attention_mechanism, attention_mechanism,
  self_attention: self_attention_viz,
  head: (l, o) => attention_mechanism(l || 'Head', o),
  encoder: encoder_block, decoder: decoder_block,
  feedforward: feedforward_net, network: feedforward_net,
  softmax: softmax_viz,
  normalization: normalization_viz, layer_norm: normalization_viz, batch_norm: normalization_viz,
  distribution: distribution_viz,
  residual: residual_connection,
  convolution: convolution_viz, conv: convolution_viz,
  pooling: pooling_viz,
  dropout: dropout_viz,
  mask: mask_viz,
  training: training_viz,

  // Math / quantity
  squared: squared_viz, exponent: squared_viz,
  n_squared: n_squared_viz, d_squared: n_squared_viz,
  multiplication: multiplication_viz, times: multiplication_viz, product: multiplication_viz,
  sqrt: sqrt_viz, square_root: sqrt_viz,
  dimension: dimension_viz, dim: dimension_viz,
  length: length_viz,
  complexity: complexity_viz, order: complexity_viz,
  ratio: ratio_viz, fraction: ratio_viz, division: ratio_viz,
  quantity: quantity_viz, count: quantity_viz, number: quantity_viz,
  multiple: (l) => quantity_viz(l, { count: 4 }),
  single: (l) => quantity_viz(l, { count: 1 }),

  // Comparison
  faster: faster_viz, speed: faster_viz, efficient: faster_viz,
  slower: slower_viz, slow: slower_viz, inefficient: slower_viz,
  greater: greater_viz, more: greater_viz, increase: greater_viz, larger: greater_viz, bigger: greater_viz,
  less: less_viz, fewer: less_viz, decrease: less_viz, smaller: less_viz,
  equal: equal_viz, same: equal_viz, equivalent: equal_viz,

  // Misc concepts
  function: function_viz,
  mechanism: mechanism_viz,

  // Abstract / structural
  architecture: architecture_viz, structure: architecture_viz, system: architecture_viz, model: architecture_viz,
  layer: layer_viz, block: layer_viz,
  bottleneck: bottleneck_viz, constraint: bottleneck_viz,
  parallelization: parallelization_viz, parallel: parallelization_viz, concurrent: parallelization_viz,
  dependency: dependency_viz, chain: dependency_viz,
  recurrence: recurrence_viz, sequential: recurrence_viz,
  input: input_viz,
  output: output_viz,
  weight: weight_viz, parameter: parameter_viz,
  score: score_viz, metric: score_viz, result: score_viz,
  intelligence: intelligence_viz, brain: intelligence_viz,
  representation: representation_viz, feature: representation_viz, encoding: representation_viz,

  // Abstract / flow
  pipeline: pipeline_viz,
  loop: loop_viz,
  gradient: gradient_viz,

  // ─── People & Roles ───
  person: person_viz, human: person_viz, user: person_viz, individual: person_viz,
  researcher: researcher_viz, scientist: researcher_viz, author: researcher_viz, expert: researcher_viz,
  group: group_viz, team: group_viz, community: group_viz, population: group_viz, audience: group_viz,
  king: king_viz, leader: king_viz, ruler: king_viz,
  queen: queen_viz,
  teacher: teacher_viz, professor: teacher_viz, instructor: teacher_viz,
  student: student_viz, learner: student_viz,

  // ─── Communication & Language (Aztec-inspired) ───
  speech: speech_scroll_viz, language: speech_scroll_viz, communication: speech_scroll_viz,
  word: word_viz, text: word_viz, sentence: word_viz, phrase: word_viz,
  document: document_viz, paper: document_viz, article: document_viz, report: document_viz, publication: document_viz,
  question: question_viz, query_text: question_viz, inquiry: question_viz,

  // ─── Abstract Concepts (expanded) ───
  idea: idea_viz, concept: idea_viz, thought: idea_viz, insight: idea_viz, hypothesis: idea_viz,
  time: time_viz, duration: time_viz, period: time_viz, epoch: time_viz,
  goal: goal_viz, objective: goal_viz, target: goal_viz,
  problem: problem_viz, challenge: problem_viz, issue: problem_viz, limitation: problem_viz,
  solution: solution_viz, answer: solution_viz, approach: solution_viz, method: solution_viz, technique: solution_viz,
  success: success_viz, achievement: success_viz, breakthrough: success_viz, improvement: success_viz,
  warning: warning_viz, danger: warning_viz, risk: warning_viz, error: warning_viz, failure: warning_viz,
  rule: rule_viz, law: rule_viz, principle: rule_viz, constraint_rule: rule_viz,
  evidence: evidence_viz, proof: evidence_viz, data: evidence_viz, experiment: evidence_viz,
  relationship: relationship_viz, connection: relationship_viz, link: relationship_viz, bond: relationship_viz,
  category: category_viz, class: category_viz, type_concept: category_viz, kind: category_viz,

  // ─── Nature & World ───
  world: world_viz, environment: world_viz, context: world_viz, domain: world_viz,
  energy: energy_viz, power: energy_viz, force: energy_viz,

  // Fallback
  default: generic_concept,
};

/**
 * Draw a concept. Returns an HTML string (inline SVG).
 *
 * @param {string} type - concept type (e.g. "matrix", "rnn", "hexagon")
 * @param {string} label - display label
 * @param {object} opts - optional parameters (rows, cols, values, color, etc.)
 * @returns {string} HTML/SVG string
 */
export function drawConcept(type, label, opts = {}) {
  const draw = VISUAL_ALPHABET[type] || VISUAL_ALPHABET.default;
  return draw(label, opts);
}

/**
 * Check if a concept type has a real visual representation (not just a box).
 */
export function hasVisual(type) {
  return type in VISUAL_ALPHABET && type !== 'default';
}

/**
 * Draw a verb indicator — a small animated SVG that sits NEXT to the object.
 * Like a hand gesture in sign language pointing at the noun.
 *
 * @param {string} verb - verb name (e.g. "flow", "rotate", "pulse")
 * @returns {string} small animated SVG HTML string (~30x30px)
 */
export function drawVerb(verb) {
  const v = verb.replace(/s$|ing$|ed$/, '');
  switch (v) {
    case 'flow': case 'move': case 'pass': case 'send': case 'feed': case 'obtain': case 'take': case 'get':
      // Horizontal arrow bouncing right
      return `<svg width="28" height="20" viewBox="0 0 28 20"><line x1="2" y1="10" x2="20" y2="10" stroke="${C.accent}" stroke-width="2"/><polygon points="18,6 26,10 18,14" fill="${C.accent}"><animateTransform attributeName="transform" type="translate" values="0,0;4,0;0,0" dur="1s" repeatCount="indefinite"/></polygon></svg>`;

    case 'rotate': case 'spin': case 'compute':
      // Spinning circular arrow
      return `<svg width="26" height="26" viewBox="0 0 26 26"><path d="M18,5 A9,9 0 1,1 5,10" fill="none" stroke="${C.accent}" stroke-width="2"/><polygon points="4,6 8,10 2,11" fill="${C.accent}"><animateTransform attributeName="transform" type="rotate" values="0,13,13;360,13,13" dur="1.5s" repeatCount="indefinite"/></polygon></svg>`;

    case 'pulse': case 'glow': case 'highlight': case 'flash': case 'attend': case 'focus':
      // Pulsing ring
      return `<svg width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="8" fill="none" stroke="${C.accent}" stroke-width="2"><animate attributeName="r" values="6;11;6" dur="1.2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.8;0.2;0.8" dur="1.2s" repeatCount="indefinite"/></circle></svg>`;

    case 'grow': case 'expand': case 'appear':
      // Expanding arrows outward
      return `<svg width="26" height="26" viewBox="0 0 26 26"><line x1="13" y1="13" x2="13" y2="3" stroke="${C.success}" stroke-width="1.5"><animate attributeName="y2" values="8;3;8" dur="1.5s" repeatCount="indefinite"/></line><line x1="13" y1="13" x2="23" y2="13" stroke="${C.success}" stroke-width="1.5"><animate attributeName="x2" values="18;23;18" dur="1.5s" repeatCount="indefinite"/></line><line x1="13" y1="13" x2="13" y2="23" stroke="${C.success}" stroke-width="1.5"><animate attributeName="y2" values="18;23;18" dur="1.5s" repeatCount="indefinite"/></line><line x1="13" y1="13" x2="3" y2="13" stroke="${C.success}" stroke-width="1.5"><animate attributeName="x2" values="8;3;8" dur="1.5s" repeatCount="indefinite"/></line></svg>`;

    case 'shrink': case 'compress': case 'reduce':
      // Contracting arrows inward
      return `<svg width="26" height="26" viewBox="0 0 26 26"><line x1="3" y1="3" x2="10" y2="10" stroke="${C.danger}" stroke-width="1.5"><animate attributeName="x1" values="3;7;3" dur="1.5s" repeatCount="indefinite"/><animate attributeName="y1" values="3;7;3" dur="1.5s" repeatCount="indefinite"/></line><line x1="23" y1="3" x2="16" y2="10" stroke="${C.danger}" stroke-width="1.5"><animate attributeName="x1" values="23;19;23" dur="1.5s" repeatCount="indefinite"/></line><line x1="3" y1="23" x2="10" y2="16" stroke="${C.danger}" stroke-width="1.5"><animate attributeName="y1" values="23;19;23" dur="1.5s" repeatCount="indefinite"/></line><line x1="23" y1="23" x2="16" y2="16" stroke="${C.danger}" stroke-width="1.5"><animate attributeName="x1" values="23;19;23" dur="1.5s" repeatCount="indefinite"/></line></svg>`;

    case 'iterate': case 'loop': case 'repeat': case 'propagate':
      // Looping arrow
      return `<svg width="28" height="22" viewBox="0 0 28 22"><path d="M4,11 Q4,3 14,3 Q24,3 24,11 Q24,19 14,19 Q8,19 6,15" fill="none" stroke="${C.accent}" stroke-width="2"/><polygon points="4,17 6,13 8,17" fill="${C.accent}"><animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite"/></polygon></svg>`;

    case 'transform': case 'morph': case 'convert': case 'reshape': case 'apply':
      // Morphing shape
      return `<svg width="28" height="22" viewBox="0 0 28 22"><rect x="2" y="4" width="10" height="14" rx="2" fill="none" stroke="${C.purple}" stroke-width="1.5"><animate attributeName="rx" values="2;7;2" dur="2s" repeatCount="indefinite"/></rect><line x1="14" y1="11" x2="16" y2="11" stroke="${C.muted}" stroke-width="1"/><polygon points="16,9 19,11 16,13" fill="${C.muted}"/><circle cx="23" cy="11" r="5" fill="none" stroke="${C.purple}" stroke-width="1.5"><animate attributeName="r" values="5;4;5" dur="2s" repeatCount="indefinite"/></circle></svg>`;

    case 'connect': case 'link': case 'merge':
      // Two dots with growing line between them
      return `<svg width="28" height="16" viewBox="0 0 28 16"><circle cx="4" cy="8" r="3" fill="${C.primary}"/><circle cx="24" cy="8" r="3" fill="${C.primary}"/><line x1="7" y1="8" x2="21" y2="8" stroke="${C.accent}" stroke-width="2" stroke-dasharray="3,2"><animate attributeName="stroke-dashoffset" values="10;0" dur="1s" repeatCount="indefinite"/></line></svg>`;

    case 'split': case 'diverge': case 'branch':
      // One dot splitting to two
      return `<svg width="28" height="24" viewBox="0 0 28 24"><circle cx="6" cy="12" r="3" fill="${C.primary}"/><line x1="9" y1="12" x2="18" y2="5" stroke="${C.accent}" stroke-width="1.5"/><line x1="9" y1="12" x2="18" y2="19" stroke="${C.accent}" stroke-width="1.5"/><circle cx="21" cy="5" r="3" fill="${C.accent}"/><circle cx="21" cy="19" r="3" fill="${C.accent}"/></svg>`;

    case 'bounce': case 'oscillate': case 'shake':
      // Zigzag wave
      return `<svg width="28" height="20" viewBox="0 0 28 20"><polyline points="2,10 7,3 12,17 17,3 22,17 27,10" fill="none" stroke="${C.accent}" stroke-width="2"><animate attributeName="opacity" values="1;0.4;1" dur="0.8s" repeatCount="indefinite"/></polyline></svg>`;

    case 'process':
      // Gear teeth
      return `<svg width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="5" fill="none" stroke="${C.primary}" stroke-width="2"/><circle cx="13" cy="13" r="9" fill="none" stroke="${C.primary}" stroke-width="1" stroke-dasharray="3,3"><animateTransform attributeName="transform" type="rotate" values="0,13,13;360,13,13" dur="3s" repeatCount="indefinite"/></circle></svg>`;

    case 'select': case 'weight': case 'prioritize': case 'query':
      // Crosshair / target
      return `<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="none" stroke="${C.accent}" stroke-width="1.5"/><line x1="12" y1="2" x2="12" y2="8" stroke="${C.accent}" stroke-width="1.5"/><line x1="12" y1="16" x2="12" y2="22" stroke="${C.accent}" stroke-width="1.5"/><line x1="2" y1="12" x2="8" y2="12" stroke="${C.accent}" stroke-width="1.5"/><line x1="16" y1="12" x2="22" y2="12" stroke="${C.accent}" stroke-width="1.5"/></svg>`;

    case 'replace': case 'substitut': case 'supplant': case 'overrid': case 'swap':
      // Aztec-inspired: old crossed out, new rises — two shapes with X on left, glow on right
      return `<svg width="40" height="28" viewBox="0 0 40 28"><rect x="2" y="6" width="14" height="14" rx="3" fill="${C.dim}" stroke="${C.danger}" stroke-width="1.5" opacity="0.5"/><line x1="3" y1="7" x2="15" y2="19" stroke="${C.danger}" stroke-width="2.5"/><line x1="15" y1="7" x2="3" y2="19" stroke="${C.danger}" stroke-width="2.5"/><polygon points="22,10 26,14 22,18" fill="${C.accent}"><animateTransform attributeName="transform" type="translate" values="0,0;4,0;0,0" dur="0.8s" repeatCount="indefinite"/></polygon><rect x="28" y="6" width="10" height="14" rx="3" fill="${C.success}" opacity="0.6"><animate attributeName="opacity" values="0.3;0.8;0.3" dur="1.5s" repeatCount="indefinite"/></rect></svg>`;

    case 'contain': case 'include': case 'enclos': case 'compris': case 'hold': case 'hous':
      // Container: outer bracket enclosing inner shape
      return `<svg width="36" height="28" viewBox="0 0 36 28"><rect x="3" y="2" width="30" height="24" rx="5" fill="none" stroke="${C.primary}" stroke-width="2.5" stroke-dasharray="5,3"><animate attributeName="stroke-dashoffset" values="8;0" dur="2s" repeatCount="indefinite"/></rect><rect x="11" y="8" width="14" height="12" rx="3" fill="${C.primary}" opacity="0.4"/></svg>`;

    case 'oppose': case 'oppos': case 'contradict': case 'conflict': case 'clash': case 'counter':
      // Two arrows colliding head-on
      return `<svg width="36" height="24" viewBox="0 0 36 24"><polygon points="2,12 10,6 10,18" fill="${C.danger}" opacity="0.7"><animateTransform attributeName="transform" type="translate" values="0,0;4,0;0,0" dur="0.8s" repeatCount="indefinite"/></polygon><polygon points="34,12 26,6 26,18" fill="${C.primary}" opacity="0.7"><animateTransform attributeName="transform" type="translate" values="0,0;-4,0;0,0" dur="0.8s" repeatCount="indefinite"/></polygon><line x1="14" y1="12" x2="22" y2="12" stroke="${C.accent}" stroke-width="2"/><text x="18" y="16" text-anchor="middle" fill="${C.accent}" font-size="12" font-weight="700">≠</text></svg>`;

    case 'depend': case 'require': case 'requir': case 'need': case 'rely': case 'base': case 'bas':
      // Chain links — one anchored, one hanging
      return `<svg width="32" height="28" viewBox="0 0 32 28"><ellipse cx="11" cy="10" rx="8" ry="6" fill="none" stroke="${C.primary}" stroke-width="2.5"/><ellipse cx="21" cy="18" rx="8" ry="6" fill="none" stroke="${C.accent}" stroke-width="2.5"/></svg>`;

    case 'similar': case 'resemble': case 'resembl': case 'analogou': case 'like':
      // Approximately-equal symbol
      return `<svg width="28" height="24" viewBox="0 0 28 24"><path d="M4,8 Q10,4 14,8 Q18,12 24,8" fill="none" stroke="${C.primary}" stroke-width="2.5"/><path d="M4,16 Q10,12 14,16 Q18,20 24,16" fill="none" stroke="${C.primary}" stroke-width="2.5"/></svg>`;

    case 'capture': case 'captur': case 'catch': case 'seize': case 'seiz': case 'grab': case 'obtain': case 'acquire': case 'acquir':
      // Hand grasping — reaching fingers
      return `<svg width="32" height="28" viewBox="0 0 32 28"><path d="M6,20 Q6,8 16,6" fill="none" stroke="${C.accent}" stroke-width="2.5" stroke-linecap="round"/><path d="M6,20 Q10,10 20,10" fill="none" stroke="${C.accent}" stroke-width="2" stroke-linecap="round"/><path d="M6,20 Q14,14 22,14" fill="none" stroke="${C.accent}" stroke-width="1.5" stroke-linecap="round"/><circle cx="22" cy="10" r="5" fill="${C.primary}" opacity="0.5"><animate attributeName="r" values="4;6;4" dur="1.5s" repeatCount="indefinite"/></circle></svg>`;

    case 'enable': case 'enabl': case 'allow': case 'permit': case 'facilitate': case 'facilitat': case 'support':
      // Upward lifting arrow — enabling/supporting
      return `<svg width="28" height="28" viewBox="0 0 28 28"><path d="M14,24 L14,8" stroke="${C.success}" stroke-width="3" stroke-linecap="round"/><polygon points="6,12 14,4 22,12" fill="${C.success}" opacity="0.7"><animate attributeName="opacity" values="0.4;0.9;0.4" dur="1.5s" repeatCount="indefinite"/></polygon></svg>`;

    case 'achieve': case 'achiev': case 'succeed': case 'accomplish': case 'reach': case 'attain': case 'improve':
      // Trophy / checkmark
      return `<svg width="28" height="28" viewBox="0 0 28 28"><path d="M6,14 L12,20 L22,8" fill="none" stroke="${C.success}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><animate attributeName="stroke-dasharray" values="0,40;40,40" dur="1s" fill="freeze"/></path></svg>`;

    case 'prevent': case 'block': case 'restrict': case 'limit': case 'inhibit': case 'hinder':
      // Stop / barrier
      return `<svg width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="11" fill="none" stroke="${C.danger}" stroke-width="2.5"/><line x1="6" y1="6" x2="22" y2="22" stroke="${C.danger}" stroke-width="2.5"/></svg>`;

    case 'eliminate': case 'remove': case 'destroy': case 'discard': case 'drop': case 'mask': case 'ignore': case 'suppress': case 'prune': case 'zero_out':
      // X mark / crossing out
      return `<svg width="24" height="24" viewBox="0 0 24 24"><line x1="4" y1="4" x2="20" y2="20" stroke="${C.danger}" stroke-width="3"><animate attributeName="opacity" values="0;1" dur="0.3s" fill="freeze"/></line><line x1="20" y1="4" x2="4" y2="20" stroke="${C.danger}" stroke-width="3"><animate attributeName="opacity" values="0;1" dur="0.3s" fill="freeze"/></line></svg>`;

    case 'speak': case 'say': case 'tell': case 'explain': case 'describe': case 'narrate': case 'discuss': case 'communicate': case 'announce': case 'declare': case 'argue': case 'claim': case 'state': case 'report': case 'mention': case 'express': case 'articulate':
      // Aztec speech scroll (tlahtolli) — curling scroll emanating from source
      return `<svg width="32" height="24" viewBox="0 0 32 24"><path d="M4,16 Q8,4 16,8 Q24,12 22,18 Q20,22 16,20 Q14,18 16,16" fill="none" stroke="${C.accent}" stroke-width="2.5" stroke-linecap="round"><animate attributeName="stroke-dasharray" values="0,60;40,60" dur="1.5s" repeatCount="indefinite"/></path><circle cx="26" cy="6" r="2" fill="${C.accent}" opacity="0.4"><animate attributeName="r" values="1;2.5;1" dur="2s" repeatCount="indefinite"/></circle><circle cx="30" cy="3" r="1.5" fill="${C.accent}" opacity="0.3"><animate attributeName="r" values="0.5;2;0.5" dur="2s" begin="0.3s" repeatCount="indefinite"/></circle></svg>`;

    case 'create': case 'generate': case 'produce': case 'build': case 'construct': case 'form': case 'initialize': case 'introduce': case 'publish': case 'present':
      // Sparkle / star appearing
      return `<svg width="24" height="24" viewBox="0 0 24 24"><polygon points="12,2 14,9 21,9 15,14 17,21 12,17 7,21 9,14 3,9 10,9" fill="${C.success}" opacity="0.7"><animate attributeName="opacity" values="0;0.8;0.4;0.8" dur="1.5s" repeatCount="indefinite"/></polygon></svg>`;

    case 'calculate': case 'multiply': case 'add': case 'subtract': case 'divide': case 'dot_product': case 'sum': case 'evaluate': case 'scale': case 'normaliz':
      // Math operation symbol pulsing
      return `<svg width="24" height="24" viewBox="0 0 24 24"><text x="12" y="17" text-anchor="middle" fill="${C.accent}" font-size="18" font-weight="700">×</text><animate attributeName="opacity" values="0.4;1;0.4" dur="1s" repeatCount="indefinite"/></svg>`;

    case 'compare': case 'contrast': case 'match': case 'differ': case 'outperform': case 'beat': case 'exceed': case 'rival':
      // Balance / scale
      return `<svg width="28" height="22" viewBox="0 0 28 22"><line x1="14" y1="2" x2="14" y2="18" stroke="${C.muted}" stroke-width="1.5"/><line x1="4" y1="8" x2="24" y2="8" stroke="${C.accent}" stroke-width="2"><animateTransform attributeName="transform" type="rotate" values="-5,14,8;5,14,8;-5,14,8" dur="2s" repeatCount="indefinite"/></line><circle cx="4" cy="8" r="3" fill="${C.primary}" opacity="0.6"/><circle cx="24" cy="8" r="3" fill="${C.success}" opacity="0.6"/></svg>`;

    case 'stabilize': case 'normalize': case 'regularize': case 'smooth': case 'balance': case 'calibrate': case 'equilibrate':
      // Wavy line becoming flat
      return `<svg width="28" height="20" viewBox="0 0 28 20"><polyline points="2,10 7,4 12,16 17,6 22,14 27,10" fill="none" stroke="${C.primary}" stroke-width="2"><animate attributeName="points" values="2,10 7,4 12,16 17,6 22,14 27,10;2,10 7,9 12,11 17,9 22,11 27,10" dur="2s" repeatCount="indefinite"/></polyline></svg>`;

    case 'store': case 'save': case 'remember': case 'cache': case 'retain': case 'maintain': case 'preserve': case 'keep': case 'hold':
      // Box with down arrow (storing)
      return `<svg width="24" height="24" viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="12" rx="2" fill="none" stroke="${C.primary}" stroke-width="1.5"/><line x1="12" y1="2" x2="12" y2="14" stroke="${C.accent}" stroke-width="2"/><polygon points="8,11 12,16 16,11" fill="${C.accent}"><animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite"/></polygon></svg>`;

    case 'reveal': case 'show': case 'expose': case 'uncover': case 'discover': case 'find': case 'detect': case 'identify': case 'recognize':
      // Eye opening
      return `<svg width="28" height="20" viewBox="0 0 28 20"><ellipse cx="14" cy="10" rx="10" ry="6" fill="none" stroke="${C.accent}" stroke-width="1.5"><animate attributeName="ry" values="1;6;6;1" dur="2s" repeatCount="indefinite"/></ellipse><circle cx="14" cy="10" r="3" fill="${C.accent}"><animate attributeName="r" values="0;3;3;0" dur="2s" repeatCount="indefinite"/></circle></svg>`;

    case 'transfer': case 'shift': case 'slide': case 'project': case 'map': case 'encode': case 'decode': case 'adapt': case 'modify': case 'change':
      // Arrow curving from one shape to another
      return `<svg width="28" height="20" viewBox="0 0 28 20"><rect x="2" y="6" width="8" height="8" rx="2" fill="none" stroke="${C.primary}" stroke-width="1.5"/><path d="M10,10 Q18,2 22,10" fill="none" stroke="${C.accent}" stroke-width="1.5"/><polygon points="21,7 24,10 21,13" fill="${C.accent}"/><circle cx="24" cy="10" r="4" fill="none" stroke="${C.purple}" stroke-width="1.5"/></svg>`;

    case 'concatenate': case 'join': case 'fuse': case 'aggregate': case 'attach': case 'combine':
      // Multiple bars merging into one
      return `<svg width="28" height="22" viewBox="0 0 28 22"><rect x="2" y="2" width="8" height="6" rx="1" fill="${C.primary}" opacity="0.6"/><rect x="2" y="14" width="8" height="6" rx="1" fill="${C.success}" opacity="0.6"/><line x1="10" y1="5" x2="16" y2="11" stroke="${C.accent}" stroke-width="1.5"/><line x1="10" y1="17" x2="16" y2="11" stroke="${C.accent}" stroke-width="1.5"/><rect x="16" y="6" width="10" height="10" rx="2" fill="${C.accent}" opacity="0.5"/></svg>`;

    case 'separate': case 'decompose': case 'break': case 'partition': case 'divide': case 'fork':
      // One bar splitting into two
      return `<svg width="28" height="22" viewBox="0 0 28 22"><rect x="2" y="6" width="10" height="10" rx="2" fill="${C.primary}" opacity="0.5"/><line x1="12" y1="8" x2="18" y2="4" stroke="${C.accent}" stroke-width="1.5"/><line x1="12" y1="14" x2="18" y2="18" stroke="${C.accent}" stroke-width="1.5"/><rect x="18" y="1" width="8" height="6" rx="1" fill="${C.accent}" opacity="0.6"/><rect x="18" y="15" width="8" height="6" rx="1" fill="${C.danger}" opacity="0.6"/></svg>`;

    case 'amplify': case 'scale_up': case 'boost': case 'enhance': case 'strengthen': case 'accumulate': case 'increase':
      // Upward arrow with growing bars
      return `<svg width="24" height="24" viewBox="0 0 24 24"><rect x="4" y="16" width="4" height="6" fill="${C.success}" opacity="0.5"/><rect x="10" y="10" width="4" height="12" fill="${C.success}" opacity="0.7"/><rect x="16" y="4" width="4" height="18" fill="${C.success}" opacity="0.9"/><animate attributeName="opacity" values="0.5;1;0.5" dur="1.5s" repeatCount="indefinite"/></svg>`;

    case 'diminish': case 'decrease': case 'constrain':
      // Downward arrow with shrinking bars
      return `<svg width="24" height="24" viewBox="0 0 24 24"><rect x="4" y="4" width="4" height="18" fill="${C.danger}" opacity="0.9"/><rect x="10" y="10" width="4" height="12" fill="${C.danger}" opacity="0.7"/><rect x="16" y="16" width="4" height="6" fill="${C.danger}" opacity="0.5"/><animate attributeName="opacity" values="0.5;1;0.5" dur="1.5s" repeatCount="indefinite"/></svg>`;

    case 'recurse': case 'recur': case 'cycle': case 'scan': case 'step': case 'traverse':
      // Stepping dots
      return `<svg width="28" height="16" viewBox="0 0 28 16"><circle cx="5" cy="8" r="3" fill="${C.accent}"><animate attributeName="opacity" values="1;0.2;0.2;0.2;1" dur="1.5s" repeatCount="indefinite"/></circle><circle cx="14" cy="8" r="3" fill="${C.accent}"><animate attributeName="opacity" values="0.2;1;0.2;0.2;0.2" dur="1.5s" repeatCount="indefinite"/></circle><circle cx="23" cy="8" r="3" fill="${C.accent}"><animate attributeName="opacity" values="0.2;0.2;1;0.2;0.2" dur="1.5s" repeatCount="indefinite"/></circle></svg>`;

    case 'learn': case 'train': case 'optimize': case 'update': case 'adjust': case 'tune': case 'fit':
      // Gradient descent curve
      return `<svg width="28" height="22" viewBox="0 0 28 22"><path d="M3,4 Q8,18 14,12 Q20,6 25,4" fill="none" stroke="${C.success}" stroke-width="2"/><circle cx="14" cy="12" r="3" fill="${C.accent}"><animate attributeName="cx" values="8;14;20;14" dur="2s" repeatCount="indefinite"/><animate attributeName="cy" values="14;12;8;12" dur="2s" repeatCount="indefinite"/></circle></svg>`;

    default:
      // Generic action indicator: small blinking dot
      return `<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="4" fill="${C.accent}"><animate attributeName="r" values="3;5;3" dur="1s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.8;0.3;0.8" dur="1s" repeatCount="indefinite"/></circle></svg>`;
  }
}
