/**
 * MathSign — A Visual Sign Language for Machines to Communicate Math
 *
 * 15 visual atoms + 8 spatial relations + 8 animation verbs.
 * LLM emits tiny JSON (~50-200 tokens). This engine renders in <1ms.
 *
 * NO code generation. NO LLM-generated HTML. Just data → SVG.
 */

// ═══════════════════════════════════════
// THEME
// ═══════════════════════════════════════

const C = {
  bg: '#1a1a2e', text: '#e0e0e0', primary: '#4FC3F7', accent: '#FFB74D',
  success: '#81C784', danger: '#EF9A9A', purple: '#CE93D8', muted: '#6a6a7a',
  dim: 'rgba(255,255,255,0.15)', grid: 'rgba(255,255,255,0.08)'
};

const PALETTE = [C.primary, C.accent, C.success, C.danger, C.purple, '#80DEEA', '#F48FB1', '#AED581'];

// ═══════════════════════════════════════
// LAYOUT ENGINE
// ═══════════════════════════════════════

function autoLayout(signs, layoutHint) {
  const objects = {};
  const childOf = {};

  // First pass: create all objects with default positions
  let nextX = 80, nextY = 80;
  let hasCustomPositions = false;
  for (const s of signs) {
    if (!s.id) continue;
    objects[s.id] = { x: 0, y: 0, w: 0, h: 0, ...s };
    // If the sign has custom positions from a schema, apply them
    if (s._x !== undefined || s._y !== undefined) {
      objects[s.id].x = s._x || 0;
      objects[s.id].y = s._y || 0;
      hasCustomPositions = true;
    }
  }

  // If all positions were set by a schema, skip auto-layout
  if (hasCustomPositions) return objects;

  // Collect nodes and edges for tree layout
  const nodeIds = signs.filter(s => s.sign === 'point' || s.sign === 'circle' || s.sign === 'box').map(s => s.id);
  const edges = signs.filter(s => s.sign === 'line' || s.sign === 'arrow');

  if (layoutHint === 'tree' && nodeIds.length > 0) {
    layoutAsTree(objects, nodeIds, edges);
  } else if (layoutHint === 'horizontal') {
    layoutHorizontal(objects, signs);
  } else if (layoutHint === 'vertical') {
    layoutVertical(objects, signs);
  } else {
    layoutAuto(objects, signs);
  }

  // Apply spatial relations
  for (const s of signs) {
    if (s.sign === 'inside' && objects[s.child] && objects[s.parent]) {
      objects[s.child].x = objects[s.parent].x;
      objects[s.child].y = objects[s.parent].y;
      if (objects[s.child].r && objects[s.parent].r) {
        objects[s.child].r = Math.min(objects[s.child].r, objects[s.parent].r * 0.55);
      }
    }
    if (s.sign === 'above' && objects[s.child] && objects[s.parent]) {
      objects[s.child].x = objects[s.parent].x;
      objects[s.child].y = objects[s.parent].y - (objects[s.parent].h || 60) - 30;
    }
  }

  return objects;
}

function layoutAsTree(objects, nodeIds, edges) {
  const children = {};
  const hasParent = new Set();
  for (const e of edges) {
    if (!children[e.from]) children[e.from] = [];
    children[e.from].push(e.to);
    hasParent.add(e.to);
  }
  const root = nodeIds.find(id => !hasParent.has(id)) || nodeIds[0];

  const levels = {};
  const queue = [{ id: root, level: 0 }];
  const visited = new Set();
  const levelNodes = {};

  while (queue.length > 0) {
    const { id, level } = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    levels[id] = level;
    if (!levelNodes[level]) levelNodes[level] = [];
    levelNodes[level].push(id);
    for (const c of (children[id] || [])) queue.push({ id: c, level: level + 1 });
  }

  const maxLevel = Math.max(...Object.values(levels), 0);
  for (const [level, ids] of Object.entries(levelNodes)) {
    const l = parseInt(level);
    const spacing = 700 / (ids.length + 1);
    ids.forEach((id, i) => {
      if (objects[id]) {
        objects[id].x = 50 + spacing * (i + 1);
        objects[id].y = 60 + l * Math.min(100, 400 / (maxLevel + 1));
      }
    });
  }
  // Place unvisited nodes
  for (const id of nodeIds) {
    if (!visited.has(id) && objects[id]) {
      objects[id].x = 400;
      objects[id].y = 400;
    }
  }
}

function measureSign(s) {
  const labelLen = (s.label || '').length;
  const texLen = (s.tex || s.text || '').length;
  switch (s.sign) {
    case 'image':   return { w: s.w || 600, h: s.h || 400 };
    case 'grid':    return { w: (s.cols || 2) * 52 + 20, h: (s.rows || 2) * 42 + 20 };
    case 'circle':  { const d = (s.r || 60) * 2 + 20; return { w: d, h: d }; }
    case 'box':     return { w: s.w || Math.max(80, labelLen * 9 + 30), h: s.h || 50 };
    case 'formula': return { w: Math.max(60, texLen * 10 + 20), h: 50 };
    case 'bar':     return { w: 70, h: 250 };
    case 'point':   { const d = (s.r || 22) * 2 + 10; return { w: d, h: d }; }
    case 'number':  return { w: Math.max(40, String(s.value || '').length * 14), h: 30 };
    default:        return { w: 60, h: 50 };
  }
}

function layoutHorizontal(objects, signs) {
  let x = 60;
  for (const s of signs) {
    if (!s.id || !objects[s.id]) continue;
    // Skip relation/connector signs
    if (['inside', 'above', 'beside', 'between', 'connect', 'group', 'align', 'stack', 'line', 'arrow'].includes(s.sign)) continue;
    const sz = measureSign(s);
    objects[s.id].x = x + sz.w / 2;
    objects[s.id].y = 220;
    objects[s.id].w = sz.w;
    objects[s.id].h = sz.h;
    x += sz.w + 40;
  }
}

function layoutVertical(objects, signs) {
  let y = 60;
  for (const s of signs) {
    if (!s.id || !objects[s.id]) continue;
    // Skip relation signs (they don't need positioning)
    if (['inside', 'above', 'beside', 'between', 'connect', 'group', 'align', 'stack', 'line', 'arrow'].includes(s.sign)) continue;
    const sz = measureSign(s);
    objects[s.id].x = 400;
    objects[s.id].y = y + sz.h / 2;
    objects[s.id].w = sz.w;
    objects[s.id].h = sz.h;
    y += sz.h + 50; // Enough room for arrow shaft to be visible
  }
}

function layoutAuto(objects, signs) {
  const hasEdges = signs.some(s => s.sign === 'line' || s.sign === 'arrow');
  const nodeIds = signs.filter(s => ['point', 'circle', 'box'].includes(s.sign)).map(s => s.id);
  const formulaCount = signs.filter(s => s.sign === 'formula' || s.sign === 'number').length;
  const barCount = signs.filter(s => s.sign === 'bar').length;

  if (hasEdges && nodeIds.length > 2) {
    // Graph/tree structure
    layoutAsTree(objects, nodeIds, signs.filter(s => s.sign === 'line' || s.sign === 'arrow'));
  } else if (formulaCount > 1 && barCount === 0 && nodeIds.length === 0) {
    // Multiple formulas/text with no shapes → stack vertically
    layoutVertical(objects, signs);
  } else if (barCount > 0) {
    // Bar chart → horizontal with special bar baseline
    layoutHorizontal(objects, signs);
  } else if (hasEdges) {
    // Boxes with arrows → vertical if linear chain
    layoutVertical(objects, signs);
  } else {
    layoutHorizontal(objects, signs);
  }
}

// ═══════════════════════════════════════
// SVG ATOM RENDERERS
// ═══════════════════════════════════════

/**
 * Calculate line start/end points at the EDGE of shapes, not their centers.
 */
function edgePoints(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / dist, uy = dy / dist;

  const PAD = 4; // Small gap — arrowhead marker handles the rest

  let x1, y1;
  if (from.w && from.h) {
    const hw = from.w / 2 + PAD, hh = from.h / 2 + PAD;
    const sx = Math.abs(ux) > 0.001 ? hw / Math.abs(ux) : Infinity;
    const sy = Math.abs(uy) > 0.001 ? hh / Math.abs(uy) : Infinity;
    const t = Math.min(sx, sy);
    x1 = from.x + ux * t;
    y1 = from.y + uy * t;
  } else {
    const r = (from.r || 22) + PAD;
    x1 = from.x + ux * r;
    y1 = from.y + uy * r;
  }

  let x2, y2;
  if (to.w && to.h) {
    const hw = to.w / 2 + PAD, hh = to.h / 2 + PAD;
    const sx = Math.abs(ux) > 0.001 ? hw / Math.abs(ux) : Infinity;
    const sy = Math.abs(uy) > 0.001 ? hh / Math.abs(uy) : Infinity;
    const t = Math.min(sx, sy);
    x2 = to.x - ux * t;
    y2 = to.y - uy * t;
  } else {
    const r = (to.r || 22) + PAD;
    x2 = to.x - ux * r;
    y2 = to.y - uy * r;
  }

  return { x1, y1, x2, y2 };
}

function renderAtom(s, objects) {
  const o = objects[s.id] || {};
  const x = o.x || 0, y = o.y || 0;
  const color = s.color || C.primary;
  const id = s.id || '';

  switch (s.sign) {
    case 'point': {
      const r = s.r || 22;
      o.r = r; // Store for edge calculations
      return `<g id="${id}" data-sign="point">
        <circle cx="${x}" cy="${y}" r="${r}" fill="${color}" stroke="${C.text}" stroke-width="2" style="transition:fill .3s,opacity .3s"/>
        ${s.label ? `<text x="${x}" y="${y + 5}" text-anchor="middle" fill="#fff" font-size="15" font-weight="700">${s.label}</text>` : ''}
      </g>`;
    }
    case 'circle': {
      const r = s.r || 60;
      return `<g id="${id}" data-sign="circle">
        <circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="2.5" stroke-dasharray="${s.dashed ? '8,4' : 'none'}" style="transition:stroke .3s,opacity .3s"/>
        ${s.label ? `<text x="${x}" y="${y - r - 8}" text-anchor="middle" fill="${C.text}" font-size="14" font-weight="600">${s.label}</text>` : ''}
      </g>`;
    }
    case 'box': {
      // Auto-size box to fit label text
      const labelLen = (s.label || '').length;
      const w = s.w || Math.max(80, labelLen * 9 + 30);
      const h = s.h || 50;
      // Store computed size for arrow edge calculations
      o.w = w; o.h = h;
      return `<g id="${id}" data-sign="box">
        <rect x="${x - w/2}" y="${y - h/2}" width="${w}" height="${h}" rx="8" fill="${s.fill || C.dim}" stroke="${color}" stroke-width="2" style="transition:fill .3s,opacity .3s"/>
        ${s.label ? `<text x="${x}" y="${y + 5}" text-anchor="middle" fill="${C.text}" font-size="13" font-weight="600">${s.label}</text>` : ''}
      </g>`;
    }
    case 'line': {
      const from = objects[s.from], to = objects[s.to];
      if (!from || !to) return '';
      const { x1, y1, x2, y2 } = edgePoints(from, to);
      return `<line id="${id || `line-${s.from}-${s.to}`}" data-sign="line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" ${s.dashed ? 'stroke-dasharray="6,3"' : ''} style="transition:stroke .3s,opacity .3s"/>`;
    }
    case 'arrow': {
      const from = objects[s.from], to = objects[s.to];
      if (!from || !to) return '';
      // Offset to connect at box/point edges, not centers
      const { x1, y1, x2, y2 } = edgePoints(from, to);
      return `<line id="${id || `arrow-${s.from}-${s.to}`}" data-sign="arrow" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" marker-end="url(#arrowhead)" style="transition:stroke .3s,opacity .3s"/>
        ${s.label ? `<text x="${(x1+x2)/2}" y="${(y1+y2)/2 - 10}" text-anchor="middle" fill="${C.muted}" font-size="12">${s.label}</text>` : ''}`;
    }
    case 'label': {
      const target = objects[s.target];
      if (!target) return `<text x="400" y="30" text-anchor="middle" fill="${C.text}" font-size="14">${s.text}</text>`;
      const pos = s.position || 'above';
      const tx = target.x, ty = pos === 'above' ? target.y - 40 : pos === 'below' ? target.y + 40 : target.y;
      return `<text x="${tx}" y="${ty}" text-anchor="middle" fill="${C.text}" font-size="13">${s.text}</text>`;
    }
    case 'number': {
      return `<text id="${id}" data-sign="number" x="${x}" y="${y}" text-anchor="middle" fill="${C.accent}" font-size="${s.size || 20}" font-weight="700" style="transition:fill .3s">${s.value}</text>`;
    }
    case 'formula': {
      const raw = s.tex || s.text || '';
      const fontSize = s.size || 20;
      // Detect REAL LaTeX: must have actual math commands, not just plain English
      const isLatex = /\\(frac|sqrt|sum|prod|int|text|mathbf|left|right|cdot|times|alpha|beta|gamma|sigma|infty|leq|geq|neq|approx|rightarrow|Rightarrow)|[_^]{/.test(raw);

      if (isLatex) {
        const tex = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const fWidth = Math.min(700, Math.max(300, raw.length * 8));
        return `<foreignObject id="${id}" data-sign="formula" x="${x - fWidth/2}" y="${y - 35}" width="${fWidth}" height="90" style="transition:opacity .3s">
          <div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:${C.text};font-size:${fontSize}px">
            <span class="katex-formula" data-tex="${tex.replace(/"/g, '&quot;')}">${tex}</span>
          </div>
        </foreignObject>`;
      } else {
        // Plain text — render as SVG text, properly sized
        o.w = Math.max(60, raw.length * 10);
        return `<text id="${id}" data-sign="formula" x="${x}" y="${y + 6}" text-anchor="middle" fill="${C.text}" font-size="${fontSize}" font-weight="600" style="transition:fill .3s">${raw}</text>`;
      }
    }
    case 'grid': {
      return renderGrid(s, x, y);
    }
    case 'bar': {
      // Bars grow upward from a fixed baseline
      const baseline = 380; // Bottom of chart area
      const maxH = 220;
      const barMax = s.max || Math.max(s.value * 1.3, 50);
      const barH = Math.min(maxH, (s.value / barMax) * maxH);
      const barW = 50;
      return `<g id="${id}" data-sign="bar">
        <rect x="${x - barW/2}" y="${baseline - barH}" width="${barW}" height="${barH}" rx="6" fill="${color}" style="transition:height .5s,fill .3s"/>
        <text x="${x}" y="${baseline - barH - 10}" text-anchor="middle" fill="${C.text}" font-size="14" font-weight="700">${s.value}</text>
        <text x="${x}" y="${baseline + 22}" text-anchor="middle" fill="${C.muted}" font-size="12">${s.label || ''}</text>
      </g>`;
    }
    case 'axis': {
      const len = s.length || 300;
      const horiz = s.direction !== 'vertical';
      const x2 = horiz ? x + len : x, y2 = horiz ? y : y + len;
      return `<g id="${id}" data-sign="axis">
        <line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${C.muted}" stroke-width="1.5" marker-end="url(#arrowhead-dim)"/>
        ${s.label ? `<text x="${(x+x2)/2}" y="${horiz ? y + 25 : y}" text-anchor="middle" fill="${C.muted}" font-size="12">${s.label}</text>` : ''}
      </g>`;
    }
    case 'wave': {
      const amp = s.amplitude || 30, freq = s.freq || 0.05, len = s.length || 300;
      let d = `M${x},${y}`;
      for (let i = 1; i <= len; i += 2) {
        d += ` L${x + i},${y + amp * Math.sin(i * freq * 2 * Math.PI)}`;
      }
      return `<path id="${id}" data-sign="wave" d="${d}" fill="none" stroke="${color}" stroke-width="2" style="transition:stroke .3s"/>`;
    }
    case 'brace': {
      const from = objects[s.from], to = objects[s.to];
      if (!from || !to) return '';
      const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
      const offset = s.side === 'below' ? 25 : -25;
      return `<g id="${id}">
        <path d="M${from.x},${from.y + offset} Q${mx},${my + offset * 2} ${to.x},${to.y + offset}" fill="none" stroke="${C.muted}" stroke-width="1.5"/>
        ${s.label ? `<text x="${mx}" y="${my + offset * 2.5}" text-anchor="middle" fill="${C.muted}" font-size="12">${s.label}</text>` : ''}
      </g>`;
    }
    case 'image': {
      // Images are handled specially in renderMathSign — this is a fallback
      return `<text x="${x}" y="${y}" text-anchor="middle" fill="${C.muted}" font-size="14">[Image: ${s.label || 'figure'}]</text>`;
    }
    case 'angle': {
      return `<g id="${id}"><path d="M${x + 30},${y} A30,30 0 0,1 ${x},${y - 30}" fill="none" stroke="${color}" stroke-width="2"/>
        ${s.label ? `<text x="${x + 18}" y="${y - 18}" fill="${C.text}" font-size="12">${s.label}</text>` : ''}</g>`;
    }
    default:
      return '';
  }
}

function renderGrid(s, cx, cy) {
  const rows = s.rows || 2, cols = s.cols || 2;
  const cellW = s.cellSize || 50, cellH = s.cellSize || 40;
  const w = cols * cellW, h = rows * cellH;
  const x0 = cx - w / 2, y0 = cy - h / 2;
  const id = s.id || 'grid';
  let svg = `<g id="${id}" data-sign="grid">`;

  // Brackets
  svg += `<path d="M${x0 + 8},${y0} L${x0},${y0} L${x0},${y0 + h} L${x0 + 8},${y0 + h}" fill="none" stroke="${C.text}" stroke-width="2"/>`;
  svg += `<path d="M${x0 + w - 8},${y0} L${x0 + w},${y0} L${x0 + w},${y0 + h} L${x0 + w - 8},${y0 + h}" fill="none" stroke="${C.text}" stroke-width="2"/>`;

  // Label
  if (s.label) svg += `<text x="${cx}" y="${y0 - 10}" text-anchor="middle" fill="${C.muted}" font-size="14" font-weight="600">${s.label}</text>`;

  // Cells
  const values = s.values || [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx2 = x0 + c * cellW + cellW / 2;
      const cy2 = y0 + r * cellH + cellH / 2;
      svg += `<rect id="${id}-cell-${r}-${c}" x="${x0 + c * cellW + 4}" y="${y0 + r * cellH + 4}" width="${cellW - 8}" height="${cellH - 8}" rx="4" fill="${C.dim}" style="transition:fill .3s"/>`;
      const val = values[r]?.[c] ?? '';
      svg += `<text id="${id}-val-${r}-${c}" x="${cx2}" y="${cy2 + 5}" text-anchor="middle" fill="${C.text}" font-size="16" font-weight="600">${val}</text>`;
    }
  }

  svg += `</g>`;
  return svg;
}

// ═══════════════════════════════════════
// ANIMATION ENGINE
// ═══════════════════════════════════════

function generateAnimationJS(steps, speed) {
  if (!steps || steps.length === 0) return '';

  return `
const steps = ${JSON.stringify(steps)};
let currentStep = -1;
const speed = ${speed || 800};

function applyAction(a) {
  const el = document.getElementById(a.target);
  console.log('[MathSign] applyAction:', a.verb, a.target, el ? 'FOUND' : 'NOT FOUND');
  if (!el) return;
  switch (a.verb) {
    case 'highlight': {
      // For <g> elements, find the first shape child and color it
      const shapes = el.querySelectorAll('circle,rect,line,path');
      console.log('[MathSign] highlight shapes found:', shapes.length);
      if (shapes.length > 0) {
        shapes.forEach(c => {
          if (c.tagName === 'line' || c.tagName === 'path') {
            c.setAttribute('stroke', a.color || '${C.accent}');
            c.setAttribute('stroke-width', '4');
          } else {
            c.setAttribute('fill', a.color || '${C.accent}');
          }
        });
      } else {
        // If no shapes, try coloring the element itself (e.g., text)
        el.setAttribute('fill', a.color || '${C.accent}');
      }
      break;
    }
    case 'fade':
      el.style.opacity = String(a.opacity ?? 0.25);
      // Also desaturate — change color to visited/dim
      const fadedShapes = el.querySelectorAll('circle,rect');
      fadedShapes.forEach(c => c.setAttribute('fill', a.color || '${C.success}'));
      break;
    case 'pulse': {
      el.style.transform = 'scale(1.25)'; el.style.transformOrigin = 'center';
      setTimeout(() => { el.style.transform = 'scale(1)'; }, 300);
      break;
    }
    case 'grow': el.style.opacity = '1'; el.style.transform = 'scale(1)'; break;
    case 'shrink': el.style.opacity = '0'; el.style.transform = 'scale(0)'; break;
    case 'set': {
      // Set a grid cell value
      const valEl = document.getElementById(a.target + '-val-' + a.row + '-' + a.col);
      const cellEl = document.getElementById(a.target + '-cell-' + a.row + '-' + a.col);
      if (valEl) valEl.textContent = a.value;
      if (cellEl) cellEl.setAttribute('fill', a.cellColor || '${C.success}33');
      break;
    }
    case 'highlightRow': {
      const rows = a.rows ?? (a.row !== undefined ? [a.row] : []);
      for (const r of rows) {
        const cols = parseInt(document.getElementById(a.target)?.dataset?.cols || 10);
        for (let c = 0; c < cols; c++) {
          const cell = document.getElementById(a.target + '-cell-' + r + '-' + c);
          if (cell) cell.setAttribute('fill', a.color || '${C.accent}33');
        }
      }
      break;
    }
    case 'highlightCol': {
      const cols = a.cols ?? (a.col !== undefined ? [a.col] : []);
      for (const c of cols) {
        const rows2 = parseInt(document.getElementById(a.target)?.dataset?.rows || 10);
        for (let r = 0; r < rows2; r++) {
          const cell = document.getElementById(a.target + '-cell-' + r + '-' + c);
          if (cell) cell.setAttribute('fill', a.color || '${C.primary}33');
        }
      }
      break;
    }
    case 'resetColors': {
      document.querySelectorAll('[data-sign="point"] circle').forEach(c => c.setAttribute('fill', '${C.primary}'));
      document.querySelectorAll('[data-sign="box"] rect').forEach(r => r.setAttribute('fill', '${C.dim}'));
      document.querySelectorAll('[data-sign="grid"] rect').forEach(r => r.setAttribute('fill', '${C.dim}'));
      document.querySelectorAll('[data-sign="line"]').forEach(l => { l.setAttribute('stroke', '${C.dim}'); l.setAttribute('stroke-width', '2'); });
      document.querySelectorAll('[data-sign]').forEach(g => g.style.opacity = '1');
      break;
    }
  }
}

function runStep() {
  currentStep++;
  if (currentStep >= steps.length) {
    document.getElementById('status').textContent = 'Done!';
    return;
  }
  const step = steps[currentStep];
  document.getElementById('status').textContent = (currentStep + 1) + '/' + steps.length + ': ' + (step.description || '');
  for (const a of (step.actions || [])) applyAction(a);
  setTimeout(runStep, speed);
}

function replay() {
  currentStep = -1;
  // Reset all
  applyAction({ verb: 'resetColors', target: '' });
  document.querySelectorAll('[id$="-val-"]').forEach(e => { /* keep */ });
  setTimeout(runStep, 400);
}

setTimeout(runStep, 600);
`;
}

// ═══════════════════════════════════════
// MASTER RENDER
// ═══════════════════════════════════════

export function renderMathSign(spec) {
  const { signs = [], steps = [], layout, title = '', speed = 800 } = spec;

  // SPECIAL CASE: If the scene is just an image, render a full-bleed HTML page
  const imageSigns = signs.filter(s => s.sign === 'image');
  if (imageSigns.length > 0 && imageSigns[0].src) {
    const img = imageSigns[0];
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:${C.bg};display:flex;flex-direction:column;align-items:center;justify-content:center}
img{max-width:95%;max-height:calc(100vh - 60px);object-fit:contain;border-radius:8px}
.caption{color:${C.muted};font-size:13px;padding:8px;font-family:-apple-system,sans-serif}
</style></head><body>
${title ? `<div class="caption">${title}</div>` : ''}
<img src="${img.src}" alt="${img.label || 'Figure'}"/>
${img.label ? `<div class="caption">${img.label}</div>` : ''}
</body></html>`;
  }

  // Layout
  const objects = autoLayout(signs, layout);

  // Compute viewBox from actual positioned objects
  let maxX = 100, maxY = 100;
  for (const o of Object.values(objects)) {
    maxX = Math.max(maxX, (o.x || 0) + (o.w || 80) / 2 + 40);
    maxY = Math.max(maxY, (o.y || 0) + (o.h || 80) / 2 + 40);
  }
  const W = Math.max(800, maxX + 60);
  const H = Math.max(300, maxY + 80);

  // Render atoms (skip relation signs AND line/arrow which render separately with edgePoints)
  const relationSigns = new Set(['inside', 'above', 'beside', 'between', 'connect', 'group', 'align', 'stack']);
  const atomsSvg = signs
    .filter(s => !relationSigns.has(s.sign))
    .map(s => renderAtom(s, objects))
    .join('\n');

  const animJS = generateAnimationJS(steps, speed);

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"><\/script>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:${C.bg};color:${C.text};font-family:-apple-system,sans-serif;width:100%;height:100%;display:flex;flex-direction:column;align-items:center}
  svg{flex:1;width:100%;min-height:0}
  .controls-bar{display:flex;gap:10px;align-items:center;justify-content:center;padding:8px 16px;width:100%;flex-shrink:0}
  .status{background:rgba(0,0,0,0.5);padding:6px 16px;border-radius:10px;font-size:13px;color:${C.accent};border:1px solid rgba(255,183,77,0.2)}
  .replay-btn{background:rgba(79,195,247,0.15);border:1px solid ${C.primary};color:${C.primary};padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600}
  .replay-btn:hover{background:rgba(79,195,247,0.3)}
  [data-sign] *{transition:fill .3s,stroke .3s,opacity .3s}
  .katex{color:#fff !important}
  .katex .base,.katex .mord,.katex .mrel,.katex .mbin,.katex .mop{color:#fff !important}
  .katex .katex-html{font-size:26px}
</style></head><body>
${title ? `<div style="text-align:center;padding:6px;font-size:13px;color:${C.muted};flex-shrink:0">${title}</div>` : ''}
<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="arrowhead" markerWidth="12" markerHeight="8" refX="12" refY="4" orient="auto">
      <polygon points="0 0, 12 4, 0 8" fill="${C.primary}"/>
    </marker>
    <marker id="arrowhead-dim" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <polygon points="0 0, 8 3, 0 6" fill="${C.muted}"/>
    </marker>
  </defs>
  ${atomsSvg}
</svg>
<div class="controls-bar">
  <div class="status" id="status">${steps.length > 0 ? 'Starting...' : 'Ready'}</div>
  ${steps.length > 0 ? '<button class="replay-btn" onclick="replay()">Replay</button>' : ''}
</div>
<script>${animJS}
// Render all KaTeX formulas
document.querySelectorAll('.katex-formula').forEach(el => {
  try {
    katex.render(el.dataset.tex, el, { throwOnError: false, displayMode: true });
  } catch(e) { console.warn('KaTeX error:', e); }
});
</script>
</body></html>`;
}
