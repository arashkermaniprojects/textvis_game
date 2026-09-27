/**
 * Visual Grammar — Composition rules for the visual sign language.
 *
 * Signs alone are vocabulary. Grammar makes them into sentences.
 *
 * In spoken language: "Attention REPLACES recurrence"
 * In visual language: recurrence shrinks and fades while attention grows in its place
 *
 * Each grammar rule takes two or more sign SVGs and composes them
 * into a single visual SENTENCE — a composed SVG that conveys the relationship.
 *
 * Grammar rules (relationships between concepts):
 *   REPLACES    — A grows, B crosses out and fades
 *   CONTAINS    — B appears physically inside A
 *   PRODUCES    — animated flow arrow from A to B
 *   BETTER_THAN — A is big/bright, B is small/dim
 *   DEPENDS_ON  — chain links A to B, B anchors A
 *   SIMILAR_TO  — A and B side by side, same size, ≈ between
 *   TRANSFORMS  — A morphs into B through intermediate state
 *   SEQUENCE    — A → B → C in a chain
 *   PARALLEL    — A and B side by side with parallel bars
 *   OPPOSES     — A and B face each other with ≠ between
 */

const C = {
  bg: '#1a1a2e', text: '#fff', primary: '#4FC3F7', accent: '#FFB74D',
  success: '#81C784', danger: '#EF9A9A', purple: '#CE93D8', muted: '#6a6a7a',
  dim: 'rgba(255,255,255,0.08)', stroke: 'rgba(255,255,255,0.5)'
};

/**
 * Compose a visual sentence from a relationship + two sign SVGs.
 *
 * @param {string} relation — the grammar rule to apply
 * @param {string} svgA — the first sign's SVG (subject)
 * @param {string} svgB — the second sign's SVG (object)
 * @param {string} labelA — caption for A
 * @param {string} labelB — caption for B
 * @returns {string} composed SVG/HTML showing the relationship
 */
export function compose(relation, svgA, svgB, labelA = '', labelB = '') {
  const rule = GRAMMAR_RULES[relation] || GRAMMAR_RULES.default;
  return rule(svgA, svgB, labelA, labelB);
}

// ═══════════════════════════════════════
// GRAMMAR RULES — each produces a composed visual
// ═══════════════════════════════════════

const GRAMMAR_RULES = {

  // A REPLACES B — B is crossed out, A grows in its place
  replaces: (svgA, svgB, labelA, labelB) => `
    <div style="display:flex;align-items:center;gap:8px;position:relative">
      <div style="opacity:0.3;filter:grayscale(1);position:relative">
        ${svgB}
        <svg style="position:absolute;top:0;left:0;width:100%;height:100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line x1="10" y1="10" x2="90" y2="90" stroke="${C.danger}" stroke-width="4"/>
          <line x1="90" y1="10" x2="10" y2="90" stroke="${C.danger}" stroke-width="4"/>
        </svg>
        ${labelB ? `<div style="font-size:9px;color:${C.muted};text-align:center;text-decoration:line-through">${labelB}</div>` : ''}
      </div>
      <svg width="30" height="20" viewBox="0 0 30 20">
        <line x1="2" y1="10" x2="22" y2="10" stroke="${C.accent}" stroke-width="2.5"/>
        <polygon points="20,6 28,10 20,14" fill="${C.accent}"/>
      </svg>
      <div style="filter:drop-shadow(0 0 6px ${C.success}55)">
        ${svgA}
        ${labelA ? `<div style="font-size:9px;color:${C.success};text-align:center">${labelA}</div>` : ''}
      </div>
    </div>`,

  // A CONTAINS B — B appears inside A's border
  contains: (svgA, svgB, labelA, labelB) => `
    <div style="position:relative;border:2px solid ${C.primary};border-radius:12px;padding:8px 12px;background:${C.dim}">
      <div style="position:absolute;top:-8px;left:8px;font-size:9px;color:${C.primary};background:${C.bg};padding:0 4px">${labelA || ''}</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:6px;padding-top:4px">
        ${svgB}
      </div>
      ${labelB ? `<div style="font-size:8px;color:${C.muted};text-align:center;margin-top:2px">${labelB}</div>` : ''}
    </div>`,

  // A PRODUCES B — flow arrow from A to B
  produces: (svgA, svgB, labelA, labelB) => `
    <div style="display:flex;align-items:center;gap:4px">
      <div style="text-align:center">
        ${svgA}
        ${labelA ? `<div style="font-size:9px;color:${C.muted}">${labelA}</div>` : ''}
      </div>
      <svg width="40" height="24" viewBox="0 0 40 24">
        <line x1="2" y1="12" x2="30" y2="12" stroke="${C.accent}" stroke-width="2" stroke-dasharray="4,3">
          <animate attributeName="stroke-dashoffset" values="14;0" dur="1s" repeatCount="indefinite"/>
        </line>
        <polygon points="28,8 36,12 28,16" fill="${C.accent}"/>
      </svg>
      <div style="text-align:center">
        ${svgB}
        ${labelB ? `<div style="font-size:9px;color:${C.muted}">${labelB}</div>` : ''}
      </div>
    </div>`,

  // A is BETTER THAN B — A big and bright, B small and dim
  better_than: (svgA, svgB, labelA, labelB) => `
    <div style="display:flex;align-items:flex-end;gap:12px">
      <div style="transform:scale(1.15);filter:drop-shadow(0 0 8px ${C.success}44);text-align:center">
        ${svgA}
        ${labelA ? `<div style="font-size:9px;color:${C.success}">${labelA}</div>` : ''}
      </div>
      <svg width="24" height="24" viewBox="0 0 24 24">
        <polyline points="4,8 16,12 4,16" fill="none" stroke="${C.success}" stroke-width="3" stroke-linejoin="round"/>
      </svg>
      <div style="transform:scale(0.75);opacity:0.5;text-align:center">
        ${svgB}
        ${labelB ? `<div style="font-size:9px;color:${C.muted}">${labelB}</div>` : ''}
      </div>
    </div>`,

  // A DEPENDS ON B — B anchors, A is chained to it
  depends_on: (svgA, svgB, labelA, labelB) => `
    <div style="display:flex;align-items:center;gap:4px">
      <div style="text-align:center">
        ${svgA}
        ${labelA ? `<div style="font-size:9px;color:${C.muted}">${labelA}</div>` : ''}
      </div>
      <svg width="36" height="20" viewBox="0 0 36 20">
        <ellipse cx="10" cy="10" rx="8" ry="6" fill="none" stroke="${C.accent}" stroke-width="2"/>
        <ellipse cx="26" cy="10" rx="8" ry="6" fill="none" stroke="${C.accent}" stroke-width="2"/>
      </svg>
      <div style="text-align:center;filter:drop-shadow(0 0 4px ${C.primary}33)">
        ${svgB}
        ${labelB ? `<div style="font-size:9px;color:${C.primary}">${labelB}</div>` : ''}
      </div>
    </div>`,

  // A is SIMILAR TO B — side by side with ≈
  similar_to: (svgA, svgB, labelA, labelB) => `
    <div style="display:flex;align-items:center;gap:6px">
      <div style="text-align:center">
        ${svgA}
        ${labelA ? `<div style="font-size:9px;color:${C.muted}">${labelA}</div>` : ''}
      </div>
      <svg width="24" height="24" viewBox="0 0 24 24">
        <line x1="4" y1="9" x2="20" y2="9" stroke="${C.text}" stroke-width="2"/>
        <line x1="4" y1="15" x2="20" y2="15" stroke="${C.text}" stroke-width="2"/>
      </svg>
      <div style="text-align:center">
        ${svgB}
        ${labelB ? `<div style="font-size:9px;color:${C.muted}">${labelB}</div>` : ''}
      </div>
    </div>`,

  // A TRANSFORMS into B — A morphs through a transition
  transforms_into: (svgA, svgB, labelA, labelB) => `
    <div style="display:flex;align-items:center;gap:4px">
      <div style="text-align:center;opacity:0.6">
        ${svgA}
        ${labelA ? `<div style="font-size:9px;color:${C.muted}">${labelA}</div>` : ''}
      </div>
      <svg width="36" height="28" viewBox="0 0 36 28">
        <rect x="2" y="6" width="10" height="16" rx="2" fill="none" stroke="${C.purple}" stroke-width="1.5">
          <animate attributeName="rx" values="2;8;2" dur="2s" repeatCount="indefinite"/>
        </rect>
        <polygon points="14,12 18,14 14,16" fill="${C.muted}"/>
        <circle cx="28" cy="14" r="8" fill="none" stroke="${C.purple}" stroke-width="1.5">
          <animate attributeName="r" values="6;8;6" dur="2s" repeatCount="indefinite"/>
        </circle>
      </svg>
      <div style="text-align:center;filter:drop-shadow(0 0 4px ${C.purple}44)">
        ${svgB}
        ${labelB ? `<div style="font-size:9px;color:${C.purple}">${labelB}</div>` : ''}
      </div>
    </div>`,

  // A → B → C SEQUENCE — chain of elements
  sequence_of: (svgA, svgB, labelA, labelB) => `
    <div style="display:flex;align-items:center;gap:2px">
      <div style="text-align:center">
        ${svgA}
        ${labelA ? `<div style="font-size:9px;color:${C.muted}">${labelA}</div>` : ''}
      </div>
      <svg width="24" height="16" viewBox="0 0 24 16">
        <line x1="2" y1="8" x2="16" y2="8" stroke="${C.stroke}" stroke-width="1.5"/>
        <polygon points="15,5 21,8 15,11" fill="${C.stroke}"/>
      </svg>
      <div style="text-align:center">
        ${svgB}
        ${labelB ? `<div style="font-size:9px;color:${C.muted}">${labelB}</div>` : ''}
      </div>
    </div>`,

  // A and B in PARALLEL
  parallel: (svgA, svgB, labelA, labelB) => `
    <div style="display:flex;gap:16px;align-items:center">
      <div style="border-left:3px solid ${C.primary};padding-left:6px;text-align:center">
        ${svgA}
        ${labelA ? `<div style="font-size:9px;color:${C.muted}">${labelA}</div>` : ''}
      </div>
      <div style="border-left:3px solid ${C.accent};padding-left:6px;text-align:center">
        ${svgB}
        ${labelB ? `<div style="font-size:9px;color:${C.muted}">${labelB}</div>` : ''}
      </div>
    </div>`,

  // A OPPOSES B — face to face with ≠
  opposes: (svgA, svgB, labelA, labelB) => `
    <div style="display:flex;align-items:center;gap:6px">
      <div style="text-align:center">
        ${svgA}
        ${labelA ? `<div style="font-size:9px;color:${C.primary}">${labelA}</div>` : ''}
      </div>
      <svg width="28" height="28" viewBox="0 0 28 28">
        <line x1="6" y1="10" x2="22" y2="10" stroke="${C.danger}" stroke-width="2.5"/>
        <line x1="6" y1="18" x2="22" y2="18" stroke="${C.danger}" stroke-width="2.5"/>
        <line x1="8" y1="6" x2="20" y2="22" stroke="${C.danger}" stroke-width="2.5"/>
      </svg>
      <div style="text-align:center">
        ${svgB}
        ${labelB ? `<div style="font-size:9px;color:${C.danger}">${labelB}</div>` : ''}
      </div>
    </div>`,

  // Fallback — just side by side
  default: (svgA, svgB, labelA, labelB) => `
    <div style="display:flex;align-items:center;gap:10px">
      <div style="text-align:center">${svgA}${labelA ? `<div style="font-size:9px;color:${C.muted}">${labelA}</div>` : ''}</div>
      <div style="text-align:center">${svgB}${labelB ? `<div style="font-size:9px;color:${C.muted}">${labelB}</div>` : ''}</div>
    </div>`,
};

/**
 * All available grammar rules.
 */
export const RELATION_TYPES = Object.keys(GRAMMAR_RULES).filter(k => k !== 'default');

/**
 * Map natural language relationship verbs to grammar rules.
 */
export const RELATION_MAP = {
  // Substitution
  replaces: 'replaces', replaced: 'replaces', instead: 'replaces', substitute: 'replaces',
  eliminates: 'replaces', removes: 'replaces', supersedes: 'replaces', supplants: 'replaces',

  // Containment
  contains: 'contains', includes: 'contains', has: 'contains', comprises: 'contains',
  consists: 'contains', made_of: 'contains', composed_of: 'contains', wraps: 'contains',

  // Production/causation
  produces: 'produces', generates: 'produces', creates: 'produces', outputs: 'produces',
  yields: 'produces', results_in: 'produces', leads_to: 'produces', causes: 'produces',

  // Comparison
  better: 'better_than', outperforms: 'better_than', exceeds: 'better_than',
  faster: 'better_than', more_efficient: 'better_than', improves: 'better_than',
  beats: 'better_than', surpasses: 'better_than',

  // Dependency
  depends: 'depends_on', requires: 'depends_on', needs: 'depends_on',
  relies: 'depends_on', waits: 'depends_on', blocked_by: 'depends_on',

  // Similarity
  similar: 'similar_to', like: 'similar_to', analogous: 'similar_to',
  equivalent: 'similar_to', same_as: 'similar_to', resembles: 'similar_to',

  // Transformation
  transforms: 'transforms_into', converts: 'transforms_into', maps: 'transforms_into',
  encodes: 'transforms_into', decodes: 'transforms_into', projects: 'transforms_into',

  // Sequence
  then: 'sequence_of', followed_by: 'sequence_of', after: 'sequence_of',
  feeds: 'sequence_of', flows_to: 'sequence_of', passes_to: 'sequence_of',

  // Parallel
  parallel: 'parallel', concurrent: 'parallel', simultaneous: 'parallel',
  alongside: 'parallel', together: 'parallel', independently: 'parallel',

  // Opposition
  opposes: 'opposes', versus: 'opposes', unlike: 'opposes',
  contrasts: 'opposes', differs: 'opposes', conflicts: 'opposes',
};

/**
 * Look up the grammar rule for a relationship verb.
 */
export function getRelation(verb) {
  return RELATION_MAP[verb] || RELATION_MAP[verb.replace(/s$|ed$|ing$/, '')] || null;
}
