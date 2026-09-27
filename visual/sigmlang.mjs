/**
 * SigmLang — A Compositional Visual Compiler
 *
 * Text → Parse → Visual IR (nested JSON) → SVG
 *
 * Core idea: Verbs are CONTAINERS that wrap ANY visual object.
 *   rotate({ car }) → the car rotates
 *   rotate({ apple }) → the apple rotates
 *   highlight({ rotate({ car }) }) → a highlighted rotating car
 *
 * Three layers:
 *   1. NOUNS — visual objects (box, circle, sequence, icon, text, group)
 *   2. VERBS — transform containers (rotate, move, pulse, flow, fade, grow, shrink, highlight)
 *   3. RELATIONS — composition operators (inside, beside, above, connect, sequence, parallel)
 *
 * Everything is a JSON object. Objects nest arbitrarily deep.
 */

// ═══════════════════════════════════════
// THEME
// ═══════════════════════════════════════

const C = {
  bg: '#1a1a2e', text: '#e0e0e0', primary: '#4FC3F7', accent: '#FFB74D',
  success: '#81C784', danger: '#EF9A9A', purple: '#CE93D8', muted: '#6a6a7a'
};

// ═══════════════════════════════════════
// NOUN RENDERERS — visual objects
// ═══════════════════════════════════════

const NOUNS = {
  box: (node, ctx) => {
    const w = node.w || Math.max(80, (node.label || '').length * 9 + 30);
    const h = node.h || 50;
    const color = node.color || C.primary;
    const x = ctx.x, y = ctx.y;
    ctx.bounds = { x: x - w/2, y: y - h/2, w, h };
    return `<g id="${ctx.id}" class="noun noun-box" data-type="box">
      <rect x="${x - w/2}" y="${y - h/2}" width="${w}" height="${h}" rx="8" fill="${node.fill || 'rgba(255,255,255,0.06)'}" stroke="${color}" stroke-width="2"/>
      ${node.label ? `<text x="${x}" y="${y + 5}" text-anchor="middle" fill="${C.text}" font-size="13" font-weight="600">${node.label}</text>` : ''}
      ${node.icon ? `<text x="${x}" y="${y - (h/2 - 16)}" text-anchor="middle" font-size="18">${node.icon}</text>` : ''}
    </g>`;
  },

  circle: (node, ctx) => {
    const r = node.r || 30;
    const color = node.color || C.primary;
    ctx.bounds = { x: ctx.x - r, y: ctx.y - r, w: r * 2, h: r * 2 };
    return `<g id="${ctx.id}" class="noun noun-circle" data-type="circle">
      <circle cx="${ctx.x}" cy="${ctx.y}" r="${r}" fill="${node.fill || 'none'}" stroke="${color}" stroke-width="2"/>
      ${node.label ? `<text x="${ctx.x}" y="${ctx.y + 5}" text-anchor="middle" fill="${C.text}" font-size="13" font-weight="600">${node.label}</text>` : ''}
    </g>`;
  },

  text: (node, ctx) => {
    const size = node.size || 16;
    ctx.bounds = { x: ctx.x - 100, y: ctx.y - size/2, w: 200, h: size + 10 };
    return `<text id="${ctx.id}" class="noun noun-text" x="${ctx.x}" y="${ctx.y + size/3}" text-anchor="middle" fill="${node.color || C.text}" font-size="${size}" font-weight="${node.bold ? '700' : '400'}">${node.content || node.label || ''}</text>`;
  },

  icon: (node, ctx) => {
    const size = node.size || 32;
    ctx.bounds = { x: ctx.x - size/2, y: ctx.y - size/2, w: size, h: size };
    return `<text id="${ctx.id}" class="noun noun-icon" x="${ctx.x}" y="${ctx.y + size/3}" text-anchor="middle" font-size="${size}">${node.emoji || '📦'}</text>`;
  },

  sequence: (node, ctx) => {
    const items = node.items || [];
    const gap = node.gap || 8;
    const cellW = node.cellW || 45;
    const cellH = node.cellH || 35;
    const totalW = items.length * cellW + (items.length - 1) * gap;
    const startX = ctx.x - totalW / 2;
    ctx.bounds = { x: startX, y: ctx.y - cellH/2, w: totalW, h: cellH };

    let svg = `<g id="${ctx.id}" class="noun noun-sequence" data-type="sequence">`;
    items.forEach((item, i) => {
      const cx = startX + i * (cellW + gap) + cellW / 2;
      svg += `<rect x="${cx - cellW/2}" y="${ctx.y - cellH/2}" width="${cellW}" height="${cellH}" rx="4" fill="rgba(255,255,255,0.06)" stroke="${node.color || C.primary}" stroke-width="1.5"/>`;
      svg += `<text x="${cx}" y="${ctx.y + 5}" text-anchor="middle" fill="${C.text}" font-size="13" font-weight="600">${item}</text>`;
    });
    svg += `</g>`;
    return svg;
  },

  group: (node, ctx) => {
    // A group renders its children with relative layout
    const children = node.children || [];
    if (children.length === 0) return '';

    const layout = node.layout || 'horizontal';
    let svg = `<g id="${ctx.id}" class="noun noun-group" data-type="group">`;
    let childX = ctx.x - (children.length - 1) * 70;
    let childY = ctx.y - (children.length - 1) * 35;

    children.forEach((child, i) => {
      const childCtx = {
        id: `${ctx.id}_c${i}`,
        x: layout === 'horizontal' ? childX + i * 140 : ctx.x,
        y: layout === 'vertical' ? childY + i * 70 : ctx.y
      };
      svg += renderNode(child, childCtx);
    });

    svg += `</g>`;
    return svg;
  },

  formula: (node, ctx) => {
    const tex = node.tex || node.content || '';
    const size = node.size || 20;
    const isLatex = /\\[a-z]|[_^{]/.test(tex);
    ctx.bounds = { x: ctx.x - 200, y: ctx.y - 30, w: 400, h: 60 };

    if (isLatex) {
      const escaped = tex.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      return `<foreignObject id="${ctx.id}" class="noun noun-formula" x="${ctx.x - 250}" y="${ctx.y - 30}" width="500" height="70">
        <div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:${size}px">
          <span class="katex-formula" data-tex="${escaped.replace(/"/g, '&quot;')}">${escaped}</span>
        </div>
      </foreignObject>`;
    }
    return `<text id="${ctx.id}" class="noun noun-formula" x="${ctx.x}" y="${ctx.y + 6}" text-anchor="middle" fill="${C.text}" font-size="${size}" font-weight="600">${tex}</text>`;
  }
};

// ═══════════════════════════════════════
// VERB RENDERERS — transform containers
// Every verb wraps a child and applies a transform.
// ═══════════════════════════════════════

const VERBS = {
  // Rotation: wraps child in a rotating <g>
  rotate: (node, ctx) => {
    const deg = node.degrees || 360;
    const dur = node.duration || 2000;
    const childSvg = renderNode(node.child, ctx);
    return `<g class="verb verb-rotate" style="transform-origin:${ctx.x}px ${ctx.y}px;animation:sigml-rotate ${dur}ms linear infinite">
      ${childSvg}
    </g>`;
  },

  // Highlight: wraps child, pulses color
  highlight: (node, ctx) => {
    const color = node.color || C.accent;
    const childSvg = renderNode(node.child, ctx);
    return `<g class="verb verb-highlight" style="filter:drop-shadow(0 0 8px ${color})">
      ${childSvg}
    </g>`;
  },

  // Pulse: wraps child, color/brightness pulse (NOT size — size pulse is unnerving)
  pulse: (node, ctx) => {
    const dur = node.duration || 2000;
    const childSvg = renderNode(node.child, ctx);
    return `<g class="verb verb-pulse" style="animation:sigml-glow ${dur}ms ease-in-out infinite">
      ${childSvg}
    </g>`;
  },

  // Flow: wraps child, moves horizontally (like data flowing)
  flow: (node, ctx) => {
    const dx = node.dx || 100;
    const dur = node.duration || 2000;
    const childSvg = renderNode(node.child, ctx);
    return `<g class="verb verb-flow" style="animation:sigml-flow-${ctx.id} ${dur}ms ease-in-out infinite">
      ${childSvg}
    </g>`;
  },

  // Fade: wraps child, fades in and out
  fade: (node, ctx) => {
    const dur = node.duration || 2000;
    const childSvg = renderNode(node.child, ctx);
    return `<g class="verb verb-fade" style="animation:sigml-fade ${dur}ms ease-in-out infinite">
      ${childSvg}
    </g>`;
  },

  // Grow: wraps child, fades in
  grow: (node, ctx) => {
    const dur = node.duration || 800;
    const childSvg = renderNode(node.child, ctx);
    return `<g class="verb verb-grow" style="animation:sigml-grow ${dur}ms ease-out forwards">
      ${childSvg}
    </g>`;
  },

  // Shrink: wraps child, fades out
  shrink: (node, ctx) => {
    const dur = node.duration || 800;
    const childSvg = renderNode(node.child, ctx);
    return `<g class="verb verb-shrink" style="animation:sigml-shrink ${dur}ms ease-in forwards">
      ${childSvg}
    </g>`;
  },

  // Emphasize: wraps child with a colored border glow
  emphasize: (node, ctx) => {
    const color = node.color || C.accent;
    const childSvg = renderNode(node.child, ctx);
    const b = ctx.bounds || { x: ctx.x - 50, y: ctx.y - 30, w: 100, h: 60 };
    return `<g class="verb verb-emphasize">
      <rect x="${b.x - 6}" y="${b.y - 6}" width="${b.w + 12}" height="${b.h + 12}" rx="12" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="8,4" style="animation:sigml-dash 1s linear infinite"/>
      ${childSvg}
    </g>`;
  }
};

// ═══════════════════════════════════════
// RELATION RENDERERS — composition operators
// ═══════════════════════════════════════

const RELATIONS = {
  // beside: place children horizontally with proper spacing
  beside: (node, ctx) => {
    const children = node.children || [];
    const gap = node.gap || 30;
    let svg = `<g id="${ctx.id}" class="rel rel-beside">`;
    // Estimate width of each child
    const widths = children.map(c => estimateWidth(c));
    const totalW = widths.reduce((s, w) => s + w, 0) + (children.length - 1) * gap;
    let x = ctx.x - totalW / 2;
    children.forEach((child, i) => {
      const w = widths[i];
      const childCtx = { id: `${ctx.id}_${i}`, x: x + w / 2, y: ctx.y };
      svg += renderNode(child, childCtx);
      x += w + gap;
    });
    svg += `</g>`;
    return svg;
  },

  // above: stack children vertically
  above: (node, ctx) => {
    const children = node.children || [];
    const gap = node.gap || 50;
    let svg = `<g id="${ctx.id}" class="rel rel-above">`;
    children.forEach((child, i) => {
      const childCtx = {
        id: `${ctx.id}_${i}`,
        x: ctx.x,
        y: ctx.y - ((children.length - 1) * gap / 2) + i * gap
      };
      svg += renderNode(child, childCtx);
    });
    svg += `</g>`;
    return svg;
  },

  // connect: render two children with an arrow between them
  connect: (node, ctx) => {
    const from = node.from;
    const to = node.to;
    const label = node.label || '';
    const fromCtx = { id: `${ctx.id}_from`, x: ctx.x - 120, y: ctx.y };
    const toCtx = { id: `${ctx.id}_to`, x: ctx.x + 120, y: ctx.y };

    let svg = `<g id="${ctx.id}" class="rel rel-connect">`;
    svg += renderNode(from, fromCtx);
    svg += renderNode(to, toCtx);
    // Arrow
    svg += `<line x1="${fromCtx.x + 50}" y1="${ctx.y}" x2="${toCtx.x - 50}" y2="${ctx.y}" stroke="${C.primary}" stroke-width="2" marker-end="url(#sigml-arrow)"/>`;
    if (label) svg += `<text x="${ctx.x}" y="${ctx.y - 12}" text-anchor="middle" fill="${C.muted}" font-size="11">${label}</text>`;
    svg += `</g>`;
    return svg;
  },

  // inside: render child inside parent
  inside: (node, ctx) => {
    const parentCtx = { id: `${ctx.id}_p`, x: ctx.x, y: ctx.y };
    const childCtx = { id: `${ctx.id}_c`, x: ctx.x, y: ctx.y };
    let svg = `<g id="${ctx.id}" class="rel rel-inside">`;
    svg += renderNode(node.parent, parentCtx);
    svg += renderNode(node.child, childCtx);
    svg += `</g>`;
    return svg;
  },

  // parallel: show children side by side with a "parallel" visual indicator
  parallel: (node, ctx) => {
    const children = node.children || [];
    const gap = node.gap || 30;
    let svg = `<g id="${ctx.id}" class="rel rel-parallel">`;
    children.forEach((child, i) => {
      const childCtx = {
        id: `${ctx.id}_${i}`,
        x: ctx.x - ((children.length - 1) * (80 + gap) / 2) + i * (80 + gap),
        y: ctx.y
      };
      svg += renderNode(child, childCtx);
    });
    svg += `</g>`;
    return svg;
  },

  // sequence_flow: children connected by arrows in order
  sequence_flow: (node, ctx) => {
    const children = node.children || [];
    const gap = node.gap || 40;
    const direction = node.direction || 'horizontal';
    let svg = `<g id="${ctx.id}" class="rel rel-seqflow">`;

    const positions = [];
    if (direction === 'horizontal') {
      const widths = children.map(c => estimateWidth(c));
      const totalW = widths.reduce((s, w) => s + w, 0) + (children.length - 1) * gap;
      let x = ctx.x - totalW / 2;
      children.forEach((child, i) => {
        const w = widths[i];
        const childCtx = { id: `${ctx.id}_${i}`, x: x + w / 2, y: ctx.y };
        positions.push({ ...childCtx, hw: w / 2 });
        svg += renderNode(child, childCtx);
        x += w + gap;
      });
    } else {
      const heights = children.map(c => estimateHeight(c));
      const totalH = heights.reduce((s, h) => s + h, 0) + (children.length - 1) * gap;
      let y = ctx.y - totalH / 2;
      children.forEach((child, i) => {
        const h = heights[i];
        const childCtx = { id: `${ctx.id}_${i}`, x: ctx.x, y: y + h / 2 };
        positions.push({ ...childCtx, hh: h / 2 });
        svg += renderNode(child, childCtx);
        y += h + gap;
      });
    }

    // Arrows between consecutive children
    for (let i = 0; i < positions.length - 1; i++) {
      const from = positions[i], to = positions[i + 1];
      if (direction === 'horizontal') {
        const x1 = from.x + (from.hw || 40) + 4;
        const x2 = to.x - (to.hw || 40) - 4;
        if (x2 > x1 + 10) svg += `<line x1="${x1}" y1="${from.y}" x2="${x2}" y2="${to.y}" stroke="${C.primary}" stroke-width="2" marker-end="url(#sigml-arrow)"/>`;
      } else {
        const y1 = from.y + (from.hh || 25) + 4;
        const y2 = to.y - (to.hh || 25) - 4;
        if (y2 > y1 + 10) svg += `<line x1="${from.x}" y1="${y1}" x2="${to.x}" y2="${y2}" stroke="${C.primary}" stroke-width="2" marker-end="url(#sigml-arrow)"/>`;
      }
    }

    svg += `</g>`;
    return svg;
  }
};

// ═══════════════════════════════════════
// RECURSIVE RENDERER — walks the JSON tree
// ═══════════════════════════════════════

function estimateWidth(node) {
  if (!node) return 60;
  if (typeof node === 'string') return Math.max(60, node.length * 9);
  if (node.w) return node.w + 20;
  const label = node.label || node.content || '';
  switch (node.type) {
    case 'box': return Math.max(80, label.length * 9 + 30);
    case 'circle': return (node.r || 30) * 2 + 10;
    case 'sequence': return (node.items?.length || 3) * ((node.cellW || 45) + (node.gap || 8));
    case 'formula': return Math.max(100, (node.tex || node.content || '').length * 9);
    case 'text': return Math.max(60, label.length * 9);
    case 'icon': return (node.size || 32) + 10;
    // Verbs: delegate to child
    case 'rotate': case 'highlight': case 'pulse': case 'flow': case 'fade':
    case 'grow': case 'shrink': case 'emphasize':
      return estimateWidth(node.child) + 20;
    // Relations: sum children
    case 'beside': case 'sequence_flow': case 'parallel':
      return (node.children || []).reduce((s, c) => s + estimateWidth(c) + 30, 0);
    case 'above':
      return Math.max(...(node.children || [{ type: 'text' }]).map(c => estimateWidth(c)), 60);
    default: return Math.max(80, label.length * 9 + 30);
  }
}

function estimateHeight(node) {
  if (!node) return 50;
  if (typeof node === 'string') return 30;
  if (node.h) return node.h + 10;
  switch (node.type) {
    case 'box': return (node.h || 50) + 10;
    case 'circle': return (node.r || 30) * 2 + 10;
    case 'sequence': return (node.cellH || 35) + 10;
    case 'formula': return 50;
    case 'text': return 30;
    case 'rotate': case 'highlight': case 'pulse': case 'flow': case 'fade':
    case 'grow': case 'shrink': case 'emphasize':
      return estimateHeight(node.child);
    case 'above':
      return (node.children || []).reduce((s, c) => s + estimateHeight(c) + 30, 0);
    case 'beside': case 'sequence_flow': case 'parallel':
      return Math.max(...(node.children || [{ type: 'text' }]).map(c => estimateHeight(c)), 50);
    default: return 50;
  }
}

function renderNode(node, ctx) {
  if (!node) return '';
  if (typeof node === 'string') {
    // Shorthand: plain string = text noun
    return NOUNS.text({ content: node }, ctx);
  }

  const type = node.type;

  // Check if it's a noun
  if (NOUNS[type]) return NOUNS[type](node, ctx);

  // Check if it's a verb (has a "child" to wrap)
  if (VERBS[type]) return VERBS[type](node, ctx);

  // Check if it's a relation (has "children", "from/to", "parent/child")
  if (RELATIONS[type]) return RELATIONS[type](node, ctx);

  // Unknown type — render as a box with the type as label
  return NOUNS.box({ label: type, ...node }, ctx);
}

// ═══════════════════════════════════════
// MASTER COMPILE — JSON IR → complete HTML
// ═══════════════════════════════════════

export function compile(ir) {
  const { root, title = '' } = ir;

  // Auto-size viewBox based on content
  const contentW = estimateWidth(root) + 80;
  const contentH = estimateHeight(root) + 80;
  const width = Math.max(800, contentW);
  const height = Math.max(400, contentH);

  const ctx = { id: 'root', x: width / 2, y: height / 2 };
  const svg = renderNode(root, ctx);

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:${C.bg};display:flex;flex-direction:column;align-items:center}
svg{flex:1;width:100%;min-height:0}
.title{color:${C.muted};font-size:13px;padding:6px;font-family:-apple-system,sans-serif;flex-shrink:0}
.noun rect,.noun circle{transition:fill .3s,stroke .3s}
.katex{color:#fff !important}
.katex .base,.katex .mord,.katex .mrel,.katex .mbin,.katex .mop{color:#fff !important}

@keyframes sigml-rotate { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
@keyframes sigml-pulse { 0%,100%{opacity:1;filter:brightness(1)} 50%{opacity:0.7;filter:brightness(1.4)} }
@keyframes sigml-fade { 0%,100%{opacity:1} 50%{opacity:0.3} }
@keyframes sigml-grow { from{opacity:0} to{opacity:1} }
@keyframes sigml-shrink { from{opacity:1} to{opacity:0} }
@keyframes sigml-dash { to{stroke-dashoffset:-16} }
@keyframes sigml-glow { 0%,100%{filter:drop-shadow(0 0 4px rgba(79,195,247,0.3))} 50%{filter:drop-shadow(0 0 12px rgba(255,183,77,0.6))} }
</style></head><body>
${title ? `<div class="title">${title}</div>` : ''}
<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="sigml-arrow" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="${C.primary}"/>
    </marker>
  </defs>
  ${svg}
</svg>
<script>
document.querySelectorAll('.katex-formula').forEach(el => {
  try { katex.render(el.dataset.tex, el, {displayMode:true,throwOnError:false}); } catch(e) {}
});
<\/script>
</body></html>`;
}

// ═══════════════════════════════════════
// TEXT → IR PARSER (simplified NLP)
// Extracts objects, verbs, relations from text
// ═══════════════════════════════════════

const VERB_MAP = {
  // motion
  'rotate': 'rotate', 'rotates': 'rotate', 'rotating': 'rotate', 'spin': 'rotate', 'spins': 'rotate',
  'move': 'flow', 'moves': 'flow', 'moving': 'flow', 'flow': 'flow', 'flows': 'flow', 'pass': 'flow', 'passes': 'flow',
  'transform': 'flow', 'transforms': 'flow', 'convert': 'flow', 'converts': 'flow',
  'send': 'flow', 'sends': 'flow', 'feed': 'flow', 'feeds': 'flow',
  // visibility
  'grow': 'grow', 'grows': 'grow', 'appear': 'grow', 'appears': 'grow', 'emerge': 'grow',
  'shrink': 'shrink', 'shrinks': 'shrink', 'disappear': 'shrink', 'vanish': 'shrink',
  'fade': 'fade', 'fades': 'fade', 'dim': 'fade',
  // emphasis
  'highlight': 'highlight', 'emphasize': 'emphasize', 'focus': 'highlight',
  'pulse': 'pulse', 'blink': 'pulse', 'flash': 'pulse',
  // connection
  'connect': 'connect', 'connects': 'connect', 'link': 'connect', 'links': 'connect',
  'map': 'connect', 'maps': 'connect',
  // containment
  'contain': 'inside', 'contains': 'inside', 'include': 'inside', 'includes': 'inside', 'wrap': 'inside',
};

const ICON_MAP = {
  'good': '👍', 'bad': '👎', 'happy': '😊', 'sad': '😢', 'angry': '😠',
  'fast': '⚡', 'slow': '🐌', 'error': '❌', 'success': '✅', 'warning': '⚠️',
  'idea': '💡', 'question': '❓', 'star': '⭐', 'fire': '🔥', 'rocket': '🚀',
  'brain': '🧠', 'gear': '⚙️', 'lock': '🔒', 'key': '🔑', 'eye': '👁️',
  'input': '📥', 'output': '📤', 'data': '📊', 'code': '💻', 'network': '🌐',
  'encoder': '⚙️', 'decoder': '🔓', 'attention': '👁️', 'transformer': '🤖',
  'layer': '📐', 'neuron': '🧠', 'weight': '⚖️', 'loss': '📉', 'accuracy': '📈',
};

/**
 * Parse a simple text description into a SigmLang IR.
 * This is a simplified parser — the LLM can also output IR directly.
 */
export function parseText(text) {
  const words = text.split(/\s+/);
  const objects = [];
  const verbs = [];

  // Extract quoted noun phrases and recognized verbs
  const nounPhrases = text.match(/"([^"]+)"|'([^']+)'|\[([^\]]+)\]|<([^>]+)>/g) || [];
  for (const phrase of nounPhrases) {
    const clean = phrase.replace(/["\[\]<>']/g, '').trim();
    if (clean) objects.push(clean);
  }

  // Find verbs
  for (const word of words) {
    const lower = word.toLowerCase().replace(/[.,;:!?]/g, '');
    if (VERB_MAP[lower]) verbs.push(VERB_MAP[lower]);
  }

  // If no explicit objects found, extract capitalized noun phrases
  if (objects.length === 0) {
    const caps = text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
    objects.push(...caps.slice(0, 5));
  }

  // Build IR
  if (objects.length === 0 && verbs.length === 0) {
    return { root: { type: 'text', content: text }, title: '' };
  }

  // If we have a verb and objects, wrap objects in the verb
  if (verbs.length > 0 && objects.length >= 2) {
    return {
      root: {
        type: 'sequence_flow',
        children: objects.map((obj, i) => {
          const node = { type: 'box', label: obj, icon: findIcon(obj) };
          if (i === 0 && verbs[0]) return { type: verbs[0], child: node };
          return node;
        })
      },
      title: text.substring(0, 60)
    };
  }

  // Just objects — lay them out
  if (objects.length >= 2) {
    return {
      root: {
        type: 'sequence_flow',
        children: objects.map(obj => ({ type: 'box', label: obj, icon: findIcon(obj) }))
      },
      title: text.substring(0, 60)
    };
  }

  // Single object, possibly with verb
  const singleObj = { type: 'box', label: objects[0] || text, icon: findIcon(objects[0] || '') };
  if (verbs.length > 0) {
    return { root: { type: verbs[0], child: singleObj }, title: text.substring(0, 60) };
  }

  return { root: singleObj, title: text.substring(0, 60) };
}

function findIcon(text) {
  const lower = text.toLowerCase();
  for (const [key, icon] of Object.entries(ICON_MAP)) {
    if (lower.includes(key)) return icon;
  }
  return null;
}

// ═══════════════════════════════════════
// CONVENIENCE: text → HTML in one call
// ═══════════════════════════════════════

export function renderText(text, title) {
  const ir = parseText(text);
  if (title) ir.title = title;
  return compile(ir);
}
