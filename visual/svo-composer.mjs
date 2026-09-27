/**
 * SVO Composer — Renders Subject-Verb-Object triangles.
 *
 * Every sentence becomes a triangle:
 *
 *         verb
 *        /    \
 *   subject   object
 *
 * Complex sentences nest recursively (max depth 2):
 *
 *         transforms
 *        /          \
 *    encoder       input
 *                    |
 *                 produces
 *                /        \
 *           embedding    tokens
 *
 * The triangle sits at the center of the canvas.
 * Only 1 triangle on screen at a time.
 */

import { drawConcept } from './visual-alphabet.mjs';
import { drawVerb } from './visual-alphabet.mjs';

const C = {
  primary: '#4FC3F7', accent: '#FFB74D', success: '#81C784',
  muted: '#6a6a7a', text: '#fff', stroke: 'rgba(255,255,255,0.4)',
  bg: '#1a1a2e', dim: 'rgba(255,255,255,0.08)'
};

/**
 * Compose an SVO as a compact horizontal flow:
 *
 *   [Subject] → (Verb) → ⟨Object⟩
 *
 * - Subject shape on the left with label underneath
 * - Arrow → Verb in a circle (animated) with label
 * - Arrow → Object shape on the right inside a rounded bubble
 * - Everything compact, reads left to right, centered on canvas
 *
 * For recursion: the object bubble can contain a smaller nested SVO.
 */
export function composeSVO(svo, depth = 0) {
  if (!svo) return '';

  const scale = depth === 0 ? 1 : 0.65;

  // Draw shapes
  const subjectSvg = svo.subject?.type ? drawConcept(svo.subject.type, svo.subject.label) : '';
  const objectSvg = svo.object?.type ? drawConcept(svo.object.type, svo.object.label) : '';
  const verbIndicator = svo.verb ? drawVerb(svo.verb) : '';

  const subLabel = (svo.subject?.label || '').replace(/_/g, ' ');
  const objLabel = (svo.object?.label || '').replace(/_/g, ' ');
  // Clean verb label: replace underscores with spaces, capitalize
  const verbLabel = (svo.verb || '').replace(/_/g, ' ');

  // No nesting — nested SVOs become sequential tunnel frames (handled by scene graph)

  // Horizontal pulse: [Subject] [Verb] [Object] — one unit, no borders
  return `<div style="
    display:inline-flex;
    align-items:center;
    gap:24px;
  ">
    <div style="text-align:center">
      <div style="display:inline-block">${subjectSvg}</div>
      <div style="color:${C.text};font-size:12px;opacity:0.8;margin-top:3px">${subLabel}</div>
    </div>
    <div style="color:${C.accent};font-size:22px;font-weight:700;white-space:nowrap${svo.negated ? ';text-decoration:line-through;text-decoration-color:'+C.danger : ''}">${verbLabel}</div>
    ${svo.object ? `<div style="text-align:center">
      <div style="display:inline-block">${objectSvg}</div>
      <div style="color:${C.text};font-size:12px;opacity:0.8;margin-top:3px">${objLabel}</div>
    </div>` : ''}
  </div>`;
}

/**
 * Parse LLM-extracted entities into SVO triples.
 * Returns an array of SVO objects per sentence.
 */
export function entitiesToSVOs(sentenceEntities) {
  const nouns = sentenceEntities.filter(e => e.type !== 'flow' && e.type !== 'action' && e.type !== 'relation');
  const actions = sentenceEntities.filter(e => e.type === 'action');
  const relations = sentenceEntities.filter(e => e.type === 'relation');

  const svos = [];

  // From explicit relations (subject-verb-object)
  for (const rel of relations) {
    if (rel.subject && rel.object) {
      const subject = nouns.find(n => n.id === rel.subject) || { id: rel.subject, label: rel.subject, type: 'default' };
      const object = nouns.find(n => n.id === rel.object) || { id: rel.object, label: rel.object, type: 'default' };
      svos.push({
        subject,
        verb: rel.relation || 'relates',
        object,
      });
    }
  }

  // From actions with targets — try to pair with another noun
  for (const action of actions) {
    if (!action.target || !action.verb) continue;
    // Already covered by a relation?
    if (svos.some(s => s.subject?.id === action.target || s.object?.id === action.target)) continue;

    const target = nouns.find(n => n.id === action.target) || { id: action.target, label: action.target, type: 'default' };
    // Find another noun in this sentence that's not the target
    const otherNoun = nouns.find(n => n.id !== action.target);

    if (otherNoun) {
      svos.push({
        subject: target,
        verb: action.verb,
        object: otherNoun,
      });
    } else {
      // Single noun with verb — just show subject + verb (no object)
      svos.push({
        subject: target,
        verb: action.verb,
        object: null,
      });
    }
  }

  // If no SVO found but we have 2+ nouns, create a default "relates" SVO
  if (svos.length === 0 && nouns.length >= 2) {
    svos.push({
      subject: nouns[0],
      verb: 'relates',
      object: nouns[1],
    });
  }

  // If only 1 noun, no SVO — just return it standalone
  if (svos.length === 0 && nouns.length === 1) {
    svos.push({
      subject: nouns[0],
      verb: null,
      object: null,
    });
  }

  // Add standalone nouns that aren't in any SVO yet
  const coveredIds = new Set();
  for (const s of svos) {
    if (s.subject?.id) coveredIds.add(s.subject.id);
    if (s.object?.id) coveredIds.add(s.object.id);
  }
  for (const noun of nouns) {
    if (!coveredIds.has(noun.id)) {
      svos.push({ subject: noun, verb: null, object: null });
    }
  }

  // Return ALL SVOs — each becomes a pulse sequence in the tunnel
  return svos;
}
