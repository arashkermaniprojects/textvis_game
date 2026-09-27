/**
 * Article Watcher v2 — Two-pass architecture for coherent narration.
 *
 * Pass 1: PLAN — LLM reads the whole article, produces a scene outline
 *         (title, type, formula refs, figure refs) for ALL scenes at once.
 * Pass 2: NARRATE — For each scene, generate narration WITH awareness of
 *         the full plan + previous scenes + extracted formulas/figures.
 *
 * This ensures visual-narration alignment and coherent flow.
 */

import { readFile, writeFile, mkdir, readdir as readdirLocal } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { renderMathSign } from '../visual/mathsign.mjs';
import { findSchema } from '../visual/schemas.mjs';
import { compile as sigmlCompile } from '../visual/sigmlang.mjs';
import { generateCommands, generateSemanticCommands, compileStreamingPlayer } from '../visual/streaming-translator.mjs';
import { optimizeCommands, scoreLayout } from '../visual/layout-optimizer.mjs';
import { generateAudio as generateAudioOpenAI } from './tts-agent.mjs';
import { generateAudio as generateAudioKokoro, shutdown as shutdownKokoro } from './kokoro-tts-agent.mjs';
const USE_KOKORO_TTS = process.env.KOKORO_TTS === '1' || process.env.LOCAL_TTS === '1';
const generateAudio = USE_KOKORO_TTS ? generateAudioKokoro : generateAudioOpenAI;
if (USE_KOKORO_TTS) console.log('[tts] using local Kokoro TTS');
import { generateConceptHierarchyLouvain } from './louvain-hierarchy.mjs';
import { generateText, extractJsonArray, extractJsonObject, hasOpenAIKey } from '../llm/openai-client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function slugify(value) {
  return (value || 'article')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_') || 'article';
}

function inferDocumentTitle(articleText, fallback = 'Untitled Article') {
  const lines = articleText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const candidate = lines.find(line => line.length >= 6 && line.length <= 180) || fallback;
  return candidate.replace(/\s+/g, ' ').trim();
}

function cleanFormulaIndexTitle(title) {
  return (title || '')
    .replace(/\s+[—-]\s+Formula Index$/i, '')
    .trim();
}

const ALIGNMENT_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this',
  'these', 'those', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to',
  'of', 'for', 'in', 'on', 'at', 'by', 'with', 'from', 'into', 'onto', 'via',
  'as', 'it', 'its', 'their', 'there', 'here', 'we', 'our', 'can', 'may',
  'might', 'will', 'would', 'should', 'could', 'also', 'such', 'each', 'both',
  'all', 'more', 'most', 'less', 'very', 'paper', 'document', 'article',
  'method', 'approach', 'model', 'system', 'use', 'using', 'used', 'show',
  'shows', 'shown', 'based', 'because', 'which', 'while', 'where', 'when'
]);

const CONTEXTUAL_SENTENCE_START = /^(this|these|those|it|they|such|both|all|we|our|their|its|here|there)\b/i;

function stemAlignmentToken(token) {
  return (token || '')
    .replace(/ies$/i, 'y')
    .replace(/sses$/i, 'ss')
    .replace(/xes$/i, 'x')
    .replace(/zes$/i, 'z')
    .replace(/ments?$/i, 'ment')
    .replace(/ations?$/i, 'ation')
    .replace(/ings?$/i, '')
    .replace(/eds?$/i, '')
    .replace(/s$/i, '');
}

function tokenizeForAlignment(text) {
  return (text || '')
    .toLowerCase()
    .replace(/self-attention/g, 'self attention')
    .replace(/multi-head/g, 'multi head')
    .replace(/dot-product/g, 'dot product')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map(stemAlignmentToken)
    .filter(token => token.length >= 2 && !ALIGNMENT_STOPWORDS.has(token));
}

function normalizeArticleForAlignment(articleText) {
  const lines = String(articleText || '')
    .replace(/\r/g, '')
    .replace(/\f/g, '\n\n')
    .split('\n');

  const paragraphs = [];
  let current = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (current) {
        paragraphs.push(current.trim());
        current = '';
      }
      continue;
    }

    if (!current) {
      current = line;
      continue;
    }

    if (current.endsWith('-') && /^[a-z]/.test(line)) {
      current = current.slice(0, -1) + line;
    } else {
      current += ' ' + line;
    }
  }

  if (current) paragraphs.push(current.trim());

  return paragraphs
    .map(p => p.replace(/[ \t]{2,}/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

function splitParagraphIntoSentences(paragraph) {
  const cleaned = (paragraph || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  return (cleaned.match(/[^.!?]+(?:[.!?]+|$)/g) || [cleaned])
    .map(sentence => sentence.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function cleanSourceTextForSpeech(text) {
  return String(text || '')
    .replace(/\((?:[^()]*\d{4}[^()]*)\)/g, '')
    .replace(/\[(?:\d+(?:\s*,\s*\d+)*)\]/g, '')
    .replace(/\b(?:figure|fig\.?|table|section|equation|eq\.?)\s+\d+[a-z-]*/gi, '')
    .replace(/\bet al\./gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

/**
 * Clean raw pdftotext output before it enters the LLM pipeline.
 * Aggressively removes everything that is NOT article body text:
 * metadata, headers, footers, author info, affiliations, abstracts labels,
 * keywords, correspondence, copyright, references, and all formatting artifacts.
 */
function cleanPdfText(raw) {
  const lines = raw.split('\n');

  // --- Pass 1: detect and remove repeated headers/footers ---
  // Lines appearing 2+ times (with digits normalized) are headers/footers.
  const lineCounts = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 3 || trimmed.length > 150) continue;
    const normalized = trimmed.replace(/\b\d+\b/g, '#').replace(/\s+/g, ' ');
    lineCounts.set(normalized, (lineCounts.get(normalized) || 0) + 1);
  }
  const repeatedPatterns = new Set();
  for (const [pattern, count] of lineCounts) {
    if (count >= 2) repeatedPatterns.add(pattern);
  }

  // --- Pass 2: find where the real body starts ---
  // Skip everything before the abstract/introduction body text.
  // The "abstract" or "introduction" heading marks the start zone, but we
  // skip the heading itself and any author/affiliation block before it.
  let bodyStartIndex = 0;
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const t = lines[i].trim().toLowerCase();
    // Look for abstract or introduction heading
    if (/^(abstract|introduction|background|overview)\s*$/.test(t)) {
      bodyStartIndex = i + 1;  // skip the heading itself
      break;
    }
  }

  // --- Pass 3: line-level filtering ---
  const cleaned = [];
  let inReferences = false;
  let inAcknowledgements = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Skip everything before body start (title, authors, affiliations, etc.)
    if (i < bodyStartIndex) continue;

    // Skip empty lines (preserve paragraph breaks as single blank)
    if (!trimmed) {
      if (cleaned.length && cleaned[cleaned.length - 1] !== '') cleaned.push('');
      continue;
    }

    // Detect end-of-body sections — stop including content
    if (/^references?\s*$/i.test(trimmed) || /^bibliography\s*$/i.test(trimmed)) {
      inReferences = true;
      continue;
    }
    if (/^acknowledgements?\s*$/i.test(trimmed) || /^funding\s*$/i.test(trimmed) ||
        /^competing interests?\s*$/i.test(trimmed) || /^conflict of interest\s*$/i.test(trimmed) ||
        /^authors?\s*contributions?\s*$/i.test(trimmed) || /^declarations?\s*$/i.test(trimmed)) {
      inAcknowledgements = true;
      continue;
    }
    if (inReferences || inAcknowledgements) {
      // A major content heading restarts body (e.g. appendix with real content)
      if (/^appendix\s/i.test(trimmed)) {
        inReferences = false;
        inAcknowledgements = false;
      } else {
        continue;
      }
    }

    // Skip repeated header/footer lines
    const normalized = trimmed.replace(/\b\d+\b/g, '#').replace(/\s+/g, ' ');
    if (repeatedPatterns.has(normalized)) continue;

    // Skip standalone page numbers
    if (/^\d{1,4}$/.test(trimmed)) continue;

    // Skip "Page N", "N of M" lines
    if (/^page\s+\d+/i.test(trimmed) || /^\d+\s+of\s+\d+$/i.test(trimmed)) continue;

    // Skip DOI / URL-only lines
    if (/^(https?:\/\/|doi:|DOI\b|www\.)/.test(trimmed)) continue;

    // Skip journal/copyright/license boilerplate
    if (/^(©|copyright|received:|accepted:|published:|available online|open access|creative commons|licensee|distributed under)/i.test(trimmed)) continue;
    if (/^\*\s*corresponding author/i.test(trimmed)) continue;
    if (/^correspondence:/i.test(trimmed)) continue;

    // Skip standalone section headers that should not be narrated
    if (/^(abstract|keywords?|review|introduction|methods?|results?|discussion|conclusion|summary|background|objectives?)\s*:?\s*$/i.test(trimmed)) continue;

    // Skip keywords lines
    if (/^keywords?\s*:/i.test(trimmed)) continue;

    // Skip affiliation/institution lines
    if (/^[*†‡§¶\d,\s]{0,6}(department|university|institute|school|college|hospital|faculty|center|centre|interdisciplinary)/i.test(trimmed)) continue;

    // Skip lines that are ONLY footnote/superscript markers, emails, or short metadata
    if (/^[*†‡§¶\d,\s]+$/.test(trimmed)) continue;
    if (/^e-?mail\s*:/i.test(trimmed)) continue;
    if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed)) continue;

    // Skip lines that look like "Author1, Author2 and Author3" (short, mostly proper nouns, no verbs)
    if (trimmed.length < 80 && /^[A-Z][a-z]+ [A-Z]\.?\s/.test(trimmed) && !/\b(is|are|was|were|has|have|the|this|that|which|from|with|and the)\b/i.test(trimmed)) continue;

    // Skip "Received: ... / Accepted: ... / Published: ..." date lines
    if (/^(received|accepted|published|submitted|revised)\b.*\d{4}/i.test(trimmed)) continue;

    // Skip figure/table captions that are just labels
    if (/^(figure|fig\.?|table)\s+\d+\s*[.:]/i.test(trimmed) && trimmed.length < 20) continue;

    // Skip lines that are postal addresses / institution addresses (contain zip codes or "India", "USA", etc. as the main content)
    if (/\b\d{4,6}\b.*\b(india|usa|uk|china|germany|france|italy|australia|japan|canada|spain|brazil)\b/i.test(trimmed) && trimmed.length < 120) continue;

    // Skip correspondence/email lines that pdftotext may inline
    if (/\bcorrespondence\b/i.test(trimmed) && trimmed.length < 100) continue;
    if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(trimmed) && trimmed.length < 100) continue;

    // Clean inline artifacts
    let cleanedLine = trimmed
      .replace(/[*†‡§¶]+(\s|$)/g, '$1')
      .replace(/([a-zA-Z])(\d{1,2}(?:\s*,\s*\d{1,2})*)\s*(?=[A-Z,]|$)/g, '$1 ')
      .replace(/\[\d+(?:\s*[-–,]\s*\d+)*\]/g, '')
      .replace(/\((?:[^()]*\d{4}[^()]*)\)/g, '')
      // Remove inline postal addresses (City, State ZIPCODE, Country)
      .replace(/,\s*[A-Z][a-z]+(?:,\s*[A-Z][a-z]+)*\s+\d{4,6}(?:,\s*[A-Z][a-z]+)?\s*$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (cleanedLine.length >= 5) {
      cleaned.push(cleanedLine);
    }
  }

  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildSourceUnits(articleText) {
  const normalized = normalizeArticleForAlignment(articleText);
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean);

  const units = [];
  let globalIndex = 0;

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
    const sentences = splitParagraphIntoSentences(paragraphs[paragraphIndex]);
    for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex++) {
      const text = cleanSourceTextForSpeech(sentences[sentenceIndex]);
      if (!text || text.length < 18) continue;
      if (/^(abstract|references|acknowledgements?)$/i.test(text)) continue;

      const tokens = tokenizeForAlignment(text);
      if (tokens.length === 0) continue;

      units.push({
        index: globalIndex++,
        paragraphIndex,
        sentenceIndex,
        text,
        tokens,
        tokenSet: new Set(tokens)
      });
    }
  }

  return units;
}

function scoreSourceUnit(tripleText, tripleTokens, sourceUnit, sourcePos, triplePos, subjectTokens = null, objectTokens = null) {
  if (!tripleTokens.length || !sourceUnit) {
    return { score: 0, overlap: 0, coverage: 0, bothEndpoints: false };
  }

  const uniqueTripleTokens = [...new Set(tripleTokens)];
  let overlap = 0;
  let weightedOverlap = 0;

  for (const token of uniqueTripleTokens) {
    if (!sourceUnit.tokenSet.has(token)) continue;
    overlap += 1;
    weightedOverlap += token.length >= 7 ? 1.35 : 1;
  }

  if (overlap === 0) {
    return { score: 0, overlap: 0, coverage: 0, bothEndpoints: false };
  }

  // CRITICAL: check whether BOTH subject and object tokens appear in the source.
  // A sentence that mentions only the subject OR only the object is NOT a good
  // match for an SPO triple describing the relationship between them.
  let subjectMatched = true;
  let objectMatched = true;
  if (subjectTokens && subjectTokens.length > 0) {
    subjectMatched = subjectTokens.some(t => sourceUnit.tokenSet.has(t));
  }
  if (objectTokens && objectTokens.length > 0) {
    objectMatched = objectTokens.some(t => sourceUnit.tokenSet.has(t));
  }
  const bothEndpoints = subjectMatched && objectMatched;

  const coverage = overlap / Math.max(uniqueTripleTokens.length, 1);
  const positionScore = 1 - Math.min(1, Math.abs(sourcePos - triplePos));
  const normalizedTriple = tripleText.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const normalizedSource = sourceUnit.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  let phraseBonus = 0;
  if (normalizedTriple && normalizedTriple.length >= 12 && normalizedSource.includes(normalizedTriple)) {
    phraseBonus += 2.2;
  }
  if (overlap >= 3) phraseBonus += 0.8;
  if (uniqueTripleTokens.some(token => token.length >= 8 && sourceUnit.tokenSet.has(token))) {
    phraseBonus += 0.6;
  }

  // Huge bonus if both endpoints appear. Major penalty if only one does.
  let endpointBonus = 0;
  if (subjectTokens && objectTokens) {
    if (bothEndpoints) endpointBonus += 5.0;
    else if (subjectMatched || objectMatched) endpointBonus -= 2.0;  // penalty for half-match
  }

  return {
    score: weightedOverlap * 1.9 + coverage * 2.4 + phraseBonus + positionScore * 0.5 + endpointBonus,
    overlap,
    coverage,
    bothEndpoints
  };
}

function buildSourceExcerpt(sourceUnits, sourceIndex, tripleTokens) {
  const current = sourceUnits[sourceIndex];
  if (!current) return '';

  const parts = [];
  if (
    sourceIndex > 0 &&
    current.paragraphIndex === sourceUnits[sourceIndex - 1]?.paragraphIndex &&
    (CONTEXTUAL_SENTENCE_START.test(current.text) || current.text.length < 70)
  ) {
    parts.push(sourceUnits[sourceIndex - 1].text);
  }

  parts.push(current.text);

  if (
    sourceIndex + 1 < sourceUnits.length &&
    current.paragraphIndex === sourceUnits[sourceIndex + 1]?.paragraphIndex &&
    current.text.length < 90
  ) {
    const next = sourceUnits[sourceIndex + 1];
    const nextOverlap = [...new Set(tripleTokens)].filter(token => next.tokenSet.has(token)).length;
    if (nextOverlap > 0 || CONTEXTUAL_SENTENCE_START.test(next.text)) {
      parts.push(next.text);
    }
  }

  let excerpt = cleanSourceTextForSpeech(parts.join(' '));
  if (excerpt.length > 320) {
    const cut = excerpt.slice(0, 320);
    const boundary = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), cut.lastIndexOf(', '));
    excerpt = (boundary > 140 ? cut.slice(0, boundary + 1) : cut).trim();
  }
  return excerpt;
}

function fallbackNarrationFromSource(tripleText, sourceExcerpt) {
  let spoken = cleanSourceTextForSpeech(sourceExcerpt);
  if (!spoken) spoken = String(tripleText || '').trim();
  if (!spoken) spoken = 'This relation is important in the document.';

  if (spoken.length > 240) {
    const cut = spoken.slice(0, 240);
    const boundary = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), cut.lastIndexOf(', '));
    spoken = (boundary > 120 ? cut.slice(0, boundary + 1) : cut).trim();
  }

  if (!/[.!?]$/.test(spoken)) spoken += '.';
  return spoken;
}

function alignTriplesToSourceText(spoTriples, orderedEdges, articleText, graphNodes = null) {
  const tripleCount = Math.min(spoTriples.length, orderedEdges.length);
  const sourceUnits = buildSourceUnits(articleText);

  if (!tripleCount || sourceUnits.length === 0) {
    return {
      sourceUnits,
      orderedItems: [],
      matchedCount: 0,
      averageScore: 0,
      shouldUseSourceOrder: false
    };
  }

  // Build a node lookup from the optional graphNodes array so we can find
  // subject and object labels separately for stricter alignment scoring.
  const nodeLabelById = {};
  if (Array.isArray(graphNodes)) {
    for (const n of graphNodes) {
      if (n?.id) nodeLabelById[n.id] = n.label || n.id;
    }
  }

  const items = [];

  for (let i = 0; i < tripleCount; i++) {
    const tripleText = String(spoTriples[i]?.text || '').trim();
    const tripleTokens = tokenizeForAlignment(tripleText);

    // Extract subject and object tokens separately from the edge's endpoints.
    const edge = orderedEdges[i];
    const subjectLabel = nodeLabelById[edge?.from] || (edge?.from || '').replace(/_/g, ' ');
    const objectLabel = nodeLabelById[edge?.to] || (edge?.to || '').replace(/_/g, ' ');
    const subjectTokens = tokenizeForAlignment(subjectLabel);
    const objectTokens = tokenizeForAlignment(objectLabel);

    let bestUnit = null;
    let bestScore = 0;
    let bestOverlap = 0;
    let bestBothEndpoints = false;

    for (let j = 0; j < sourceUnits.length; j++) {
      const triplePos = tripleCount > 1 ? i / (tripleCount - 1) : 0;
      const sourcePos = sourceUnits.length > 1 ? j / (sourceUnits.length - 1) : 0;
      const scored = scoreSourceUnit(tripleText, tripleTokens, sourceUnits[j], sourcePos, triplePos, subjectTokens, objectTokens);
      if (scored.score > bestScore) {
        bestScore = scored.score;
        bestOverlap = scored.overlap;
        bestUnit = sourceUnits[j];
        bestBothEndpoints = scored.bothEndpoints;
      }
    }

    const neededOverlap = tripleTokens.length <= 2 ? 1 : 2;
    // Matching now requires BOTH subject and object to appear OR very high overlap.
    const matched = !!bestUnit && (bestBothEndpoints || bestOverlap >= neededOverlap + 1 || bestScore >= 6.5);
    const fallbackIndex = Math.round((i / Math.max(tripleCount - 1, 1)) * Math.max(sourceUnits.length - 1, 0));
    const sourceIndex = bestUnit?.index ?? fallbackIndex;

    items.push({
      originalIndex: i,
      edge: orderedEdges[i],
      text: tripleText || `Relation ${i + 1}`,
      tokens: tripleTokens,
      sourceIndex,
      sourceText: bestUnit?.text || sourceUnits[sourceIndex]?.text || '',
      sourceExcerpt: '',
      alignmentScore: bestScore,
      overlap: bestOverlap,
      matched,
      bothEndpoints: bestBothEndpoints
    });
  }

  for (const item of items) {
    item.sourceExcerpt = buildSourceExcerpt(sourceUnits, item.sourceIndex, item.tokens) || item.sourceText;
  }

  const orderedItems = [...items]
    .sort((a, b) => a.sourceIndex - b.sourceIndex || a.originalIndex - b.originalIndex)
    .map((item, orderedIndex) => ({ ...item, orderedIndex }));

  const matchedCount = items.filter(item => item.matched).length;
  const averageScore = items.reduce((sum, item) => sum + item.alignmentScore, 0) / Math.max(items.length, 1);
  // Short inputs (few triples) can't meet the strict long-paper threshold. Scale with input size.
  const isShortInput = items.length <= 8;
  const minMatches    = isShortInput ? Math.max(1, Math.ceil(items.length * 0.5)) : Math.max(8, Math.floor(items.length * 0.3));
  const minAvgScore   = isShortInput ? 1.2 : 2.4;
  const shouldUseSourceOrder = matchedCount >= minMatches && averageScore >= minAvgScore;

  return {
    sourceUnits,
    items,
    orderedItems,
    matchedCount,
    averageScore,
    shouldUseSourceOrder
  };
}

async function generateGraphOnlyNarrationSentences(spoTriples, documentTitle) {
  // Batch the triples to stay within Qwen's token budget and improve per-triple quality.
  const BATCH = 12;
  const narSentences = [];

  for (let batchStart = 0; batchStart < spoTriples.length; batchStart += BATCH) {
    const batch = spoTriples.slice(batchStart, batchStart + BATCH);
    const spoLines = batch.map((s, i) => {
      // Extract subject, verb, object from the triple text if possible
      const tripleText = s.text || '';
      return `${i + 1}. TRIPLE: "${tripleText}"${s.subject || s.object ? `  (subject: ${s.subject || '?'}, object: ${s.object || '?'})` : ''}`;
    }).join('\n');

    const rawNarration = await generateText({
      prompt: `You are narrating a presentation of "${documentTitle}". For each numbered CONCEPT TRIPLE below, write EXACTLY ONE sentence that explains that specific relationship.

CONCEPT TRIPLES:
${spoLines}

STRICT RULES — your sentence must:
1. Mention BOTH the subject AND the object from the triple explicitly (use their exact words).
2. Make the relationship between them clear using the verb/predicate.
3. Be 12-25 words — one tight, explanatory sentence.
4. Sound natural when read aloud (no abbreviations, no parenthetical asides).
5. Spell out numbers in words if small (e.g. "three" not "3"); leave large figures like years alone.
6. NEVER include author names, journal names, dates, "the authors say", "this paper", "section", "abstract", or any metadata. Focus on the IDEA itself.
7. NEVER use placeholder phrases like "the concept of X" — just state what X does.

Return EXACTLY ${batch.length} numbered sentences (1. ... ${batch.length}. ...), one per line, no code fences.`,
      maxTokens: Math.max(1200, batch.length * 120)
    }) || '';

    const numberedLines = rawNarration.match(/^\d+\.\s*.+$/gm) || [];
    for (let i = 0; i < batch.length; i++) {
      const line = numberedLines[i]?.replace(/^\d+\.\s*/, '').trim();
      narSentences.push(line || batch[i].text);
    }
  }

  return narSentences;
}

async function generateSourceGroundedNarrationSentences(alignedItems, documentTitle) {
  const batchSize = 12;
  const sentences = [];

  for (let i = 0; i < alignedItems.length; i += batchSize) {
    const batch = alignedItems.slice(i, i + batchSize);
    const itemLines = batch.map((item, idx) => {
      const source = item.sourceExcerpt || item.sourceText || item.text;
      const subj = item.edge?.from?.replace(/_/g, ' ') || '';
      const obj = item.edge?.to?.replace(/_/g, ' ') || '';
      return `${idx + 1}. RELATION (SPO): subject="${subj}"  object="${obj}"  full="${item.text}"\n   SOURCE: "${source}"`;
    }).join('\n\n');

    const raw = await generateText({
      prompt: `You are writing spoken narration for a graph traversal of the academic document "${documentTitle}".

For each numbered SPO (subject-predicate-object) relation below, write EXACTLY one numbered sentence that describes THAT specific relationship, using the SOURCE excerpt as factual grounding.

HARD REQUIREMENTS:
- Each sentence MUST mention BOTH the subject AND the object of the SPO (use words from "subject" and "object" fields).
- Each sentence must describe the LINK between subject and object, as supported by the SOURCE.
- If the SOURCE does not directly state the relationship, still describe it using the subject and object, using the SOURCE for factual details.
- 12-25 words per sentence — one tight explanatory sentence.
- EXACTLY ${batch.length} numbered sentences (1. ... ${batch.length}. ...).
- NEVER mention author names, journal names, publication dates, section headers ("Abstract", "Introduction"), "this paper", "the author", or any publication metadata. Only narrate the IDEA.
- Spell out small numbers in words ("four hundred thousand" not "400,000"). Large years are fine.

ITEMS:
${itemLines}`,
      maxTokens: Math.max(1500, batch.length * 110)
    }) || '';

    const numberedLines = raw.match(/^\d+\.\s*.+$/gm) || [];
    for (let j = 0; j < batch.length; j++) {
      const line = numberedLines[j]?.replace(/^\d+\.\s*/, '').trim();
      sentences.push(line || fallbackNarrationFromSource(batch[j].text, batch[j].sourceExcerpt || batch[j].sourceText));
    }
  }

  return sentences;
}

function inferSceneAnchor(label = '', kind = '') {
  const source = `${label} ${kind}`.toLowerCase();
  if (/\boutput\b/.test(source)) return 'output_port';
  if (/\binput\b/.test(source)) return 'input_port';
  if (/\bhand\b/.test(source)) return 'hand';
  if (/\bpaw\b/.test(source)) return 'paw';
  if (/\bhead\b/.test(source)) return 'head';
  if (/\bear\b/.test(source)) return 'ear';
  if (/\beye\b/.test(source)) return 'eye';
  if (/\bencoder\b/.test(source)) return 'encoder';
  if (/\bdecoder\b/.test(source)) return 'decoder';
  if (/\battention\b/.test(source)) return 'attention_core';
  if (/\btoken\b|\bposition\b/.test(source)) return 'inside';
  return 'right';
}

function isHostLike(label = '', kind = '') {
  const source = `${label} ${kind}`.toLowerCase();
  return /^(animal|attention|layer|process)$/.test(kind)
    || /\b(transformer|network|neural network|model|encoder|decoder|stack|module|rabbit|attention|architecture|system)\b/.test(source);
}

function isAttachable(label = '', kind = '') {
  const source = `${label} ${kind}`.toLowerCase();
  return /^(output|input|body_part|attention|layer|vector|distribution|sequence|matrix)$/.test(kind)
    || /\b(output|input|hand|paw|head|ear|eye|attention|layer|token|sequence|embedding|position)\b/.test(source);
}

function parseGroundedHost(label = '') {
  const raw = String(label || '').trim();
  if (!raw) return null;

  const possessive = raw.match(/^(.+?)'s\s+(.+)$/i);
  if (possessive) {
    return {
      hostLabel: possessive[1].trim(),
      targetLabel: possessive[2].trim()
    };
  }

  const ofPattern = raw.match(/^(.+?)\s+of\s+(.+)$/i);
  if (ofPattern) {
    return {
      hostLabel: ofPattern[2].trim(),
      targetLabel: ofPattern[1].trim()
    };
  }

  return null;
}

function inferSceneState(predicate = '', sourceExcerpt = '', fallbackLabel = '') {
  const source = `${predicate} ${sourceExcerpt} ${fallbackLabel}`.toLowerCase();
  if (/\b(pain|painful|hurt|hurts|sore)\b/.test(source)) {
    return { id: 'state', label: 'Pain', tone: 'danger', type: 'pain' };
  }
  if (/\b(mask|masked)\b/.test(source)) {
    return { id: 'state', label: 'Mask', tone: 'danger', type: 'mask' };
  }
  if (/\b(normalize|normalized|stabilize|stable)\b/.test(source)) {
    return { id: 'state', label: 'Normalized', tone: 'success', type: 'stability' };
  }
  if (/\b(highlight|focus|active|attend)\b/.test(source)) {
    return { id: 'state', label: 'Focus', tone: 'accent', type: 'focus' };
  }
  return null;
}

function inferSceneActionRoles(predicate = '', { stateLike = false, targetRef = 'target', hostRef = 'host', resultRef = null } = {}) {
  const source = predicate.toLowerCase();
  if (/\b(contain|include|hold|house|wrap)\b/.test(source)) return { container: hostRef, content: targetRef };
  if (/\b(sequence of|composed of|consists of|made of|built from|assembled from)\b/.test(source)) return { whole: hostRef, part: targetRef };
  if (/\b(focus|attend|select|query|weight)\b/.test(source)) return { agent: hostRef, focus: targetRef };
  if (/\b(prevent|block|mask|constrain|limit|inhibit)\b/.test(source)) return { source: hostRef, blocked: targetRef };
  if (/\b(enable|support|allow|facilitate)\b/.test(source)) return { support: hostRef, target: targetRef };
  if (/\b(produce|demonstrate|show|yield|output)\b/.test(source)) return { source: hostRef, outcome: targetRef };
  if (/\b(improve|enhance|boost|strengthen)\b/.test(source)) return { source: hostRef, target: targetRef };
  if (/\b(reduce|compress|shrink|minimize|lower)\b/.test(source)) return { source: hostRef, target: targetRef };
  if (/\b(normalize|transform|convert|reshape|adapt|update)\b/.test(source)) {
    return resultRef ? { source: hostRef, target: targetRef, result: resultRef } : { source: hostRef, target: targetRef };
  }
  if (/\b(scale|weight)\b/.test(source)) return { factor: hostRef, target: targetRef };
  if (/\b(combine|concatenate|merge|join|aggregate|fuse)\b/.test(source)) {
    return resultRef ? { left: hostRef, right: targetRef, result: resultRef } : { left: hostRef, right: targetRef };
  }
  if (/\b(compare|contrast|outperform|better than|worse than)\b/.test(source)) return { left: hostRef, right: targetRef };
  if (stateLike) return { carrier: targetRef, state: 'state' };
  return { source: hostRef, target: targetRef };
}

function inferSceneResult(predicate = '', sourceExcerpt = '', fromLabel = '', toLabel = '') {
  const source = String(sourceExcerpt || '').trim();
  if (!source) return null;
  if (!/\b(combine|concatenate|merge|join|aggregate|fuse|transform|convert|reshape|adapt|update|form|forms|become|becomes|into)\b/i.test(`${predicate} ${source}`)) {
    return null;
  }

  const patterns = [
    /\b(?:forms?|becomes?|yields?|creates?|produces?)\s+(?:an?\s+|the\s+)?([A-Za-z][A-Za-z0-9\- ]{2,48}?)(?:[.,;]|$)/i,
    /\binto\s+(?:an?\s+|the\s+)?([A-Za-z][A-Za-z0-9\- ]{2,48}?)(?:[.,;]|$)/i
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    const candidate = match?.[1]?.trim();
    if (!candidate) continue;
    const lower = candidate.toLowerCase();
    if (lower === fromLabel.toLowerCase() || lower === toLabel.toLowerCase()) continue;
    return {
      id: 'result',
      label: candidate.replace(/\s+/g, ' '),
      kind: /\b(embedding|representation|vector|output|state|distribution)\b/i.test(candidate) ? 'vector' : 'generic',
      slot: 'upper',
      presentation: 'frame-result'
    };
  }

  return null;
}

function buildSceneInputFromRelation({ edge, narrationSentence = '', sourceExcerpt = '', sourceIndex = null, matched = false }) {
  if (!edge) return null;

  const groundedFrom = parseGroundedHost(edge.fromLabel);
  const groundedTo = parseGroundedHost(edge.toLabel);
  const stateDescriptor = inferSceneState(edge.verb, sourceExcerpt, edge.toLabel);

  let host = null;
  let target = null;

  if (groundedFrom) {
    host = { id: 'host', label: groundedFrom.hostLabel, kind: /rabbit|animal/i.test(groundedFrom.hostLabel) ? 'animal' : 'generic' };
    target = { id: 'target', label: groundedFrom.targetLabel, kind: edge.fromType || 'body_part' };
  } else if (groundedTo) {
    host = { id: 'host', label: groundedTo.hostLabel, kind: /rabbit|animal/i.test(groundedTo.hostLabel) ? 'animal' : 'generic' };
    target = { id: 'target', label: groundedTo.targetLabel, kind: edge.toType || 'body_part' };
  } else if (isHostLike(edge.fromLabel, edge.fromType) && isAttachable(edge.toLabel, edge.toType)) {
    host = { id: 'host', label: edge.fromLabel, kind: edge.fromType || 'generic' };
    target = { id: 'target', label: edge.toLabel, kind: edge.toType || 'generic' };
  } else if (isHostLike(edge.toLabel, edge.toType) && isAttachable(edge.fromLabel, edge.fromType)) {
    host = { id: 'host', label: edge.toLabel, kind: edge.toType || 'generic' };
    target = { id: 'target', label: edge.fromLabel, kind: edge.fromType || 'generic' };
  } else if (isHostLike(edge.fromLabel, edge.fromType)) {
    host = { id: 'host', label: edge.fromLabel, kind: edge.fromType || 'generic' };
    target = { id: 'target', label: edge.toLabel, kind: edge.toType || 'generic' };
  }

  const resultEntity = inferSceneResult(edge.verb, sourceExcerpt, edge.fromLabel, edge.toLabel);
  const roles = inferSceneActionRoles(edge.verb, {
    stateLike: !!stateDescriptor,
    targetRef: 'target',
    hostRef: host ? 'host' : 'left',
    resultRef: resultEntity ? 'result' : null
  });

  if (host) {
    const scene = {
      host,
      entities: [{
        id: 'target',
        label: target.label,
        kind: target.kind,
        attachTo: 'host',
        anchor: inferSceneAnchor(target.label, target.kind),
        presentation: 'attached',
        relation: /\b(hand|paw|head|ear|eye)\b/i.test(target.label) ? 'part_of' : /\b(output|representation|embedding)\b/i.test(target.label) ? 'result_of' : 'attached_to'
      }],
      states: stateDescriptor ? [{ ...stateDescriptor, target: 'target' }] : [],
      focus: [stateDescriptor ? 'target' : (resultEntity ? 'result' : 'target')],
      action: {
        predicate: edge.verb,
        roles
      }
    };

    if (resultEntity) {
      scene.entities.push({
        ...resultEntity,
        attachTo: 'host',
        anchor: 'output_port',
        relation: 'result_of'
      });
    }

    return {
      title: narrationSentence || sourceExcerpt || `${edge.fromLabel} ${edge.verb} ${edge.toLabel}`,
      subtitle: narrationSentence || `${edge.fromLabel} ${edge.verb} ${edge.toLabel}`,
      scene,
      references: null,
      sourceGrounding: {
        matched,
        sourceExcerpt,
        sourceIndex
      }
    };
  }

  return {
    title: narrationSentence || sourceExcerpt || `${edge.fromLabel} ${edge.verb} ${edge.toLabel}`,
    subtitle: narrationSentence || `${edge.fromLabel} ${edge.verb} ${edge.toLabel}`,
    scene: {
      entities: [
        { id: 'left', label: edge.fromLabel, kind: edge.fromType || 'generic', slot: 'left', presentation: 'peer' },
        { id: 'right', label: edge.toLabel, kind: edge.toType || 'generic', slot: 'right', presentation: 'peer' },
        ...(resultEntity ? [{ ...resultEntity }] : [])
      ],
      states: stateDescriptor ? [{ ...stateDescriptor, target: 'right' }] : [],
      focus: [resultEntity ? 'result' : 'right'],
      action: {
        predicate: edge.verb,
        roles: resultEntity
          ? inferSceneActionRoles(edge.verb, { stateLike: !!stateDescriptor, targetRef: 'right', hostRef: 'left', resultRef: 'result' })
          : inferSceneActionRoles(edge.verb, { stateLike: !!stateDescriptor, targetRef: 'right', hostRef: 'left' })
      }
    },
    references: null,
    sourceGrounding: {
      matched,
      sourceExcerpt,
      sourceIndex
    }
  };
}

const REFERENCE_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'into',
  'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'using',
  'with'
]);

function tokenizeReferenceText(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token && token.length > 2 && !REFERENCE_STOP_WORDS.has(token));
}

function dedupeReferenceStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function scoreFormulaReference(text, formula) {
  const haystack = String(text || '').toLowerCase();
  const textTokens = new Set(tokenizeReferenceText(text));
  const idText = String(formula?.id || '').replace(/_/g, ' ');
  const name = String(formula?.name || '');
  const context = String(formula?.context || '');

  let score = 0;
  if (name && haystack.includes(name.toLowerCase())) score += 6;
  if (idText && haystack.includes(idText.toLowerCase())) score += 4;

  for (const token of tokenizeReferenceText(name)) {
    if (textTokens.has(token)) score += 1.9;
  }
  for (const token of tokenizeReferenceText(context)) {
    if (textTokens.has(token)) score += 1.15;
  }
  for (const token of tokenizeReferenceText(idText)) {
    if (textTokens.has(token)) score += 1.45;
  }

  if (/attention/i.test(name) && /\bself attention\b/i.test(haystack)) score += 2.5;
  if (/multi-?head/i.test(name) && /\bheads?\b/i.test(haystack)) score += 2;
  if (/feed-?forward/i.test(name) && /\bfeed\b|\bffn\b/i.test(haystack)) score += 2;
  if (/positional/i.test(name) && /\bposition\b|\bencoding\b/i.test(haystack)) score += 2;
  if (/softmax/i.test(name) && /\bsoftmax\b/i.test(haystack)) score += 2.5;
  return score;
}

function inferReferenceHintsForItem(item, formulas = []) {
  const scene = item.sceneInput?.scene || {};
  const entityLabels = Array.isArray(scene.entities) ? scene.entities.map(entity => entity?.label || '') : [];
  const text = [
    item.narrationSentence,
    item.sourceExcerpt,
    item.sourceText,
    item.text,
    item.edge?.fromLabel,
    item.edge?.toLabel,
    item.edge?.verb,
    scene.host?.label,
    ...entityLabels
  ].filter(Boolean).join(' ');

  const rankedFormulas = formulas
    .map(formula => ({ formula, score: scoreFormulaReference(text, formula) }))
    .filter(entry => entry.score >= 3)
    .sort((left, right) => right.score - left.score);
  const formulaIds = rankedFormulas.length > 0
    ? rankedFormulas
        .filter(entry => entry.score >= Math.max(3, rankedFormulas[0].score - 2.1))
        .slice(0, 2)
        .map(entry => entry.formula.id)
    : [];

  const figureMatch = text.match(/\b(?:figure|fig\.?)\s+(\d+)\b/i);
  const figureIdx = figureMatch ? Math.max(0, Number(figureMatch[1]) - 1) : null;
  const topicHints = dedupeReferenceStrings([
    scene.host?.label,
    ...entityLabels,
    item.edge?.fromLabel,
    item.edge?.toLabel,
    item.text
  ]).slice(0, 6);

  return { formulaIds, figureIdx, topicHints };
}

function sanitizeSceneEpisode(rawEpisode, fallbackEpisode, fallbackSubtitle = '') {
  const base = fallbackEpisode || {};
  const rawScene = rawEpisode?.scene && typeof rawEpisode.scene === 'object' ? rawEpisode.scene : {};

  const host = rawScene.host && typeof rawScene.host === 'object' && rawScene.host.label
    ? {
        id: rawScene.host.id || 'host',
        label: String(rawScene.host.label).trim(),
        kind: String(rawScene.host.kind || 'generic').trim() || 'generic'
      }
    : base.scene?.host || null;

  const entities = Array.isArray(rawScene.entities) && rawScene.entities.length > 0
    ? rawScene.entities
        .filter(entity => entity && entity.label)
        .map((entity, index) => ({
          id: entity.id || `entity_${index + 1}`,
          label: String(entity.label).trim(),
          kind: String(entity.kind || 'generic').trim() || 'generic',
          ...(entity.attachTo ? { attachTo: String(entity.attachTo).trim() } : {}),
          ...(entity.anchor ? { anchor: String(entity.anchor).trim() } : {}),
          ...(entity.presentation ? { presentation: String(entity.presentation).trim() } : {}),
          ...(entity.relation ? { relation: String(entity.relation).trim() } : {}),
          ...(entity.slot ? { slot: String(entity.slot).trim() } : {})
        }))
    : (base.scene?.entities || []);

  const states = Array.isArray(rawScene.states)
    ? rawScene.states
        .filter(state => state && (state.target || state.targetId) && (state.label || state.type))
        .map((state, index) => ({
          id: state.id || `state_${index + 1}`,
          target: String(state.target || state.targetId).trim(),
          label: String(state.label || state.type).trim(),
          tone: String(state.tone || 'accent').trim(),
          type: String(state.type || 'state').trim()
        }))
    : (base.scene?.states || []);

  const focus = Array.isArray(rawScene.focus) && rawScene.focus.length > 0
    ? rawScene.focus.map(item => String(item).trim()).filter(Boolean)
    : (base.scene?.focus || (entities[0] ? [entities[0].id] : []));

  const roles = rawScene.action?.roles && typeof rawScene.action.roles === 'object'
    ? Object.fromEntries(
        Object.entries(rawScene.action.roles)
          .filter(([, value]) => value != null && String(value).trim())
          .map(([key, value]) => [key, String(value).trim()])
      )
    : (base.scene?.action?.roles || {});

  const predicate = String(rawScene.action?.predicate || base.scene?.action?.predicate || base.subtitle || fallbackSubtitle || 'relates').trim();

  return {
    title: String(rawEpisode?.title || base.title || fallbackSubtitle || 'Scene').trim(),
    subtitle: String(rawEpisode?.subtitle || base.subtitle || fallbackSubtitle || '').trim(),
    scene: {
      ...(host ? { host } : {}),
      entities,
      states,
      focus,
      action: {
        predicate,
        roles
      }
    },
    references: rawEpisode?.references || base.references || null,
    sourceGrounding: rawEpisode?.sourceGrounding || base.sourceGrounding || null
  };
}

async function generateSceneEpisodesFromSource(items, narrationSentences, documentTitle, options = {}) {
  const { formulas = [] } = options;
  const batchSize = 10;
  const episodes = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batchItems = items.slice(i, i + batchSize);
    const promptLines = batchItems.map((item, index) => {
      const sentence = narrationSentences[i + index] || item.text || '';
      const relation = item.edge ? `${item.edge.fromLabel || item.edge.from} ${item.edge.verb || 'relates to'} ${item.edge.toLabel || item.edge.to}` : item.text;
      return `${index + 1}. NARRATION: "${sentence}"
SOURCE: "${item.sourceExcerpt || item.sourceText || sentence}"
RELATION HINT: "${relation}"`;
    }).join('\n\n');

    const raw = await generateText({
      prompt: `You are designing human-readable educational scene episodes for an article explainer.

For each numbered item below, produce EXACTLY one JSON object in an array. The goal is NOT to restate a graph edge. The goal is to stage a small visual scene that a human can understand.

SCENE PRINCIPLES:
- Prefer a central host object when the source supports one, such as Transformer, neural network, encoder, decoder, rabbit, hand, output, or sequence.
- Use attached parts or results when something belongs to or emerges from the host.
- Use localized states instead of detached abstract nodes when the sentence describes a condition.
- Use peer objects only when no clear host/attachment structure is present.
- Keep ids simple: host, target, peer2, result, state.

OUTPUT FORMAT:
Return ONLY a JSON array with ${batchItems.length} objects.
Each object must have:
{
  "title": "...",
  "subtitle": "...",
  "references": {
    "formulaIds": ["..."],
    "figureIdx": 0,
    "topicHints": ["..."]
  },
  "scene": {
    "host": { "id": "host", "label": "...", "kind": "layer|attention|animal|generic|output|sequence|vector" } OR omit host,
    "entities": [
      { "id": "target", "label": "...", "kind": "...", "presentation": "attached|peer|frame-result|satellite", "attachTo": "host", "anchor": "output_port|input_port|inside|attention_core|hand|head|ear|eye|encoder|decoder|right", "relation": "result_of|part_of|contained_in|attached_to", "slot": "left|right|upper|lower" }
    ],
    "states": [
      { "id": "state", "target": "host|target|peer2|result", "label": "...", "tone": "accent|success|danger", "type": "focus|stability|pain|mask|state" }
    ],
    "focus": ["host" or "target" or "result"],
    "action": {
      "predicate": "...",
      "roles": { "source": "host", "target": "target" }
    }
  }
}

ITEMS:
${promptLines}`,
      maxTokens: Math.max(2400, batchItems.length * 280)
    }) || '';

    const parsed = extractJsonArray(raw);
    for (let j = 0; j < batchItems.length; j++) {
      const referenceHints = batchItems[j].referenceHints || inferReferenceHintsForItem({
        ...batchItems[j],
        narrationSentence: narrationSentences[i + j]
      }, formulas);
      const fallback = buildSceneInputFromRelation({
        edge: batchItems[j].edge,
        matched: batchItems[j].matched,
        narrationSentence: narrationSentences[i + j],
        sourceExcerpt: batchItems[j].sourceExcerpt || batchItems[j].sourceText || '',
        sourceIndex: batchItems[j].sourceIndex
      });
      fallback.references = referenceHints;
      episodes.push(sanitizeSceneEpisode(parsed?.[j], fallback, narrationSentences[i + j] || batchItems[j].text || ''));
    }
  }

  return episodes;
}

// ═══════════════════════════════════════
// CONCEPT HIERARCHY — LLM-based abstraction
// ═══════════════════════════════════════

/**
 * Ask the LLM to organize extracted concepts into a semantic containment tree.
 *
 * The insight (from ontology learning / Formal Concept Analysis):
 * containment is a SEMANTIC relationship — "Softmax" belongs inside
 * "Attention Mechanism" because of domain knowledge, not graph topology.
 * An LLM that has read the article is the best classifier.
 *
 * @param {Array} nodeList - [{id, label, type}] from dry-run graph
 * @param {Array} edgeList - [{from, to, verb}] from dry-run graph
 * @param {string} articleText - original article text for context
 * @param {string} documentTitle
 * @returns {{ tree: Array }} or null
 */
export async function generateConceptHierarchy(nodeList, edgeList, articleText, documentTitle) {
  if (!nodeList || nodeList.length < 6) return null;

  // Compute degree for each node
  const degree = {};
  for (const e of edgeList) {
    degree[e.from] = (degree[e.from] || 0) + 1;
    degree[e.to] = (degree[e.to] || 0) + 1;
  }

  const nodeLines = nodeList
    .map(n => `  - ${n.id}: "${n.label}" (degree: ${degree[n.id] || 0})`)
    .join('\n');

  const edgeLines = edgeList
    .slice(0, 60) // cap to avoid huge prompts
    .map(e => `  - "${e.from}" --[${e.verb || 'relates'}]--> "${e.to}"`)
    .join('\n');

  const raw = await generateText({
    prompt: `You are organizing concepts from the academic paper "${documentTitle}" into a containment hierarchy for a visual diagram.

The diagram should show a SEMANTIC ABSTRACTION of the paper — like a block diagram of a car showing Engine > (Pistons, Fuel Injector), Transmission > (Gears, Clutch), etc. Things that BELONG INSIDE a bigger thing are placed inside it.

CONCEPTS IN THE GRAPH (${nodeList.length} nodes):
${nodeLines}

RELATIONSHIPS (${edgeList.length} edges):
${edgeLines}

ARTICLE EXCERPT (for context):
"""
${articleText.substring(0, 6000)}
"""

Create a containment tree with 3-6 TOP-LEVEL containers. Each container groups concepts that semantically BELONG INSIDE it (part-of, component-of, stage-of, or aspect-of).

RULES:
1. Use ONLY the exact node IDs from the list above. Do NOT invent new IDs.
2. Every node can appear AT MOST once in the tree.
3. Maximum nesting depth: 3 levels (container > sub-container > leaf).
4. Each container should have 2-8 children. If only 1 child, merge upward.
5. Prefer FEWER, LARGER containers. 3-6 top-level groups is ideal.
6. A container ID should be the node that BEST REPRESENTS that group.
7. Nodes that don't fit any group can be omitted (they'll show as "Other").
8. Group by SEMANTIC meaning, NOT by string similarity or surface tokens.

EXAMPLE of a GOOD hierarchy for a car engineering paper:
{
  "tree": [
    { "id": "engine", "label": "Engine", "children": [
      { "id": "pistons", "label": "Pistons" },
      { "id": "fuel_injection", "label": "Fuel Injection" },
      { "id": "combustion", "label": "Combustion Chamber" }
    ]},
    { "id": "transmission", "label": "Transmission", "children": [
      { "id": "gears", "label": "Gears" },
      { "id": "clutch", "label": "Clutch" }
    ]}
  ]
}

Return ONLY a JSON object with a "tree" array.`,
    maxTokens: 3000,
    temperature: 0.2
  });

  const parsed = extractJsonObject(raw);
  if (!parsed?.tree || !Array.isArray(parsed.tree)) return null;

  // ── Validate: only allow known node IDs, enforce depth, deduplicate ──
  const validIds = new Set(nodeList.map(n => n.id));
  const seen = new Set();

  function validateNode(node, depth) {
    if (!node || typeof node !== 'object') return null;
    const id = String(node.id || '').trim();
    if (!id || !validIds.has(id) || seen.has(id)) return null;
    seen.add(id);

    const result = { id, label: String(node.label || id) };
    if (Array.isArray(node.children) && node.children.length > 0 && depth < 3) {
      result.children = node.children
        .map(c => validateNode(c, depth + 1))
        .filter(Boolean);
      if (result.children.length === 0) delete result.children;
    }
    return result;
  }

  const validatedTree = parsed.tree
    .map(n => validateNode(n, 0))
    .filter(Boolean);

  // Prune containers with only 1 child — merge child into parent level
  function pruneTree(nodes) {
    return nodes.map(n => {
      if (n.children) {
        n.children = pruneTree(n.children);
        if (n.children.length === 1 && !n.children[0].children) {
          // Single leaf child — keep as-is, it's still meaningful
        }
      }
      return n;
    }).filter(Boolean);
  }

  const finalTree = pruneTree(validatedTree);
  if (finalTree.length === 0) return null;

  console.log(`  Hierarchy tree: ${finalTree.length} top-level containers`);
  for (const root of finalTree) {
    const childCount = root.children?.length || 0;
    const grandCount = (root.children || []).reduce((s, c) => s + (c.children?.length || 0), 0);
    console.log(`    ${root.label}: ${childCount} children${grandCount ? ', ' + grandCount + ' grandchildren' : ''}`);
  }

  return { tree: finalTree };
}

// ═══════════════════════════════════════
// PASS 1: PLAN all scenes at once
// ═══════════════════════════════════════

async function planScenes(articleText, formulas, figureCount, documentTitle, options = {}) {
  const { maxScenes = 24 } = options;
  let sceneWindow;
  if (maxScenes === 1)      sceneWindow = `exactly 1`;
  else if (maxScenes <= 3)  sceneWindow = `exactly ${maxScenes}`;
  else if (maxScenes <= 8)  sceneWindow = `${Math.max(1, maxScenes - 2)}-${maxScenes}`;
  else if (maxScenes > 18)  sceneWindow = `${Math.max(14, maxScenes - 4)}-${maxScenes}`;
  else                      sceneWindow = `12-${maxScenes}`;
  const formulaList = formulas.length
    ? formulas.map(f => `  - [${f.id}] ${f.name}: ${f.latex.substring(0, 90)}...`).join('\n')
    : '  (no extracted formulas)';

  // Keep the article window small enough that the 8192-token local context
  // leaves ample room for the plan JSON output (24 scenes × ~90 tokens ≈ 2200).
  const articleHead = articleText.substring(0, 6000);
  const articleTail = articleText.length > 10000 ? articleText.substring(articleText.length - 3000) : '';
  const articleExcerpt = articleTail
    ? `${articleHead}\n[... middle omitted ...]\n${articleTail}`
    : articleHead;

  const promptBody = `You are planning a "watchable" presentation of an academic document. Read the article excerpt and create a scene-by-scene outline grounded in the available formulas and figures.

DOCUMENT TITLE: ${documentTitle}

ARTICLE (abbreviated — beginning + end):
"""
${articleExcerpt}
"""

AVAILABLE FORMULAS (pre-extracted with LaTeX):
${formulaList}

AVAILABLE FIGURES: ${figureCount} extracted figure image(s) from the source PDF.

Create ${sceneWindow} scene${maxScenes === 1 ? '' : 's'}. For each scene, specify:
- title: short scene title — AT MOST 40 CHARACTERS
- type: one of "formula" | "architecture" | "comparison" | "data" | "figure" | "text"
- formulaIds: array of formula IDs from the list above, or []
- figureIdx: figure index (0-based) or null
- textChunk: first 40 characters of the article passage this covers — EXACTLY 40 chars or less
- visualHint: AT MOST 60 CHARACTERS describing the visual

RULES:
1. Scene 1 introduces the document title and main contribution.
2. Early scenes cover motivation and problem framing.
3. Middle scenes cover the core method and algorithm.
4. Later scenes cover experiments, results, and conclusion.
5. EVERY formula scene must reference only formula IDs from the provided list.
6. EVERY figure scene must reference only available figure indices.
7. If no relevant formulas/figures, leave formulaIds [] and figureIdx null.
8. STRICT character limits above — exceeding them will break parsing.
9. NEVER include scenes about: author names, author affiliations, journal names, publication metadata, section headers (like "Abstract", "Introduction", "Methods"), keywords lists, acknowledgements, or any non-content material. Only cover the INTELLECTUAL CONTENT of the paper.

Return COMPACT JSON (one scene per object, no extra whitespace, no code fences):
{"scenes":[{"title":"...","type":"text","formulaIds":[],"figureIdx":null,"textChunk":"...","visualHint":"..."}]}`;

  async function tryPlan(extraInstruction = '') {
    return generateText({
      prompt: extraInstruction ? `${promptBody}\n\n${extraInstruction}` : promptBody,
      maxTokens: 4000
    });
  }

  let raw = await tryPlan();
  let parsed = extractJsonObject(raw);
  if (!parsed?.scenes) {
    // Try repairing a truncated JSON: close dangling scene objects.
    const repaired = repairTruncatedScenePlan(raw);
    if (repaired) parsed = repaired;
  }
  if (!parsed?.scenes) {
    console.warn(`[planScenes] first parse failed; raw length=${raw?.length || 0}. Retrying with strict reminder.`);
    raw = await tryPlan('IMPORTANT: Return ONLY the JSON object, start with { and end with }. Keep all field values SHORT (under 60 chars each).');
    parsed = extractJsonObject(raw) || repairTruncatedScenePlan(raw);
  }
  if (!parsed?.scenes) {
    console.error(`[planScenes] RAW OUTPUT (first 500 chars): ${(raw || '').substring(0, 500)}`);
    throw new Error('Failed to parse scene plan');
  }
  return parsed.scenes;
}

// Best-effort repair for a scene plan whose JSON was truncated mid-object.
// Finds all completed {...} scene objects inside the "scenes" array and
// wraps them in a valid envelope.
function repairTruncatedScenePlan(raw) {
  if (!raw) return null;
  const start = raw.indexOf('"scenes"');
  if (start < 0) return null;
  const arrStart = raw.indexOf('[', start);
  if (arrStart < 0) return null;
  // Walk through the array, extracting each top-level {...} object that has
  // a balanced brace count. Stop at the first unclosed object.
  const completedScenes = [];
  let i = arrStart + 1;
  while (i < raw.length) {
    // skip whitespace and commas
    while (i < raw.length && (raw[i] === ' ' || raw[i] === ',' || raw[i] === '\n' || raw[i] === '\t' || raw[i] === '\r')) i++;
    if (i >= raw.length || raw[i] === ']') break;
    if (raw[i] !== '{') break;
    // find matching close brace, respecting quoted strings
    let depth = 0;
    let inStr = false;
    let esc = false;
    let j = i;
    for (; j < raw.length; j++) {
      const ch = raw[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { j++; break; }
      }
    }
    if (depth !== 0) break;  // unclosed — stop repairing here
    const chunk = raw.substring(i, j);
    try {
      completedScenes.push(JSON.parse(chunk));
    } catch {
      break;
    }
    i = j;
  }
  if (completedScenes.length === 0) return null;
  console.warn(`[planScenes] repaired ${completedScenes.length} scenes from truncated JSON`);
  return { scenes: completedScenes };
}

// ═══════════════════════════════════════
// PASS 2: NARRATE each scene with context
// ═══════════════════════════════════════

async function narrateScene(scene, plan, prevNarrations, articleText, formulas, actualVisualDescription) {
  const planContext = plan.map((s, i) =>
    `${i + 1}. [${s.type}] ${s.title}${s.formulaIds?.length ? ' (formulas: ' + s.formulaIds.join(', ') + ')' : ''}`
  ).join('\n');

  const formulaText = (scene.formulaIds || []).map(id => {
    const f = formulas.find(ff => ff.id === id);
    return f ? `${f.name}: ${f.latex}` : '';
  }).filter(Boolean).join('\n');

  const prevContext = prevNarrations.slice(-3).map((n, i) =>
    `Scene ${prevNarrations.length - 2 + i}: ${n.substring(0, 80)}...`
  ).join('\n');

  const raw = await generateText({
    prompt: `You are narrating scene ${scene.index + 1} of a research paper presentation.

FULL SCENE PLAN (your position marked with >>>):
${plan.map((s, i) => `${i === scene.index ? '>>> ' : '    '}${i + 1}. [${s.type}] ${s.title}`).join('\n')}

THIS SCENE:
- Title: ${scene.title}
- Type: ${scene.type}

WHAT IS ACTUALLY ON SCREEN RIGHT NOW (describe ONLY these elements):
${actualVisualDescription}
${formulaText ? `\nFORMULAS VISIBLE:\n${formulaText}` : ''}
${scene.figureIdx !== null && scene.figureIdx !== undefined ? `\nSHOWING: Original Figure ${scene.figureIdx + 1} from the paper` : ''}

PREVIOUS NARRATIONS:
${prevContext || '(first scene)'}

ALSO generate a SigmLang visual IR (JSON) that shows what should be on screen.

SigmLang uses NOUNS (visual objects) wrapped in VERBS (animations):
- Nouns: { "type": "box", "label": "Name", "icon": "emoji" } | { "type": "circle" } | { "type": "sequence", "items": ["a","b","c"] } | { "type": "text", "content": "words" } | { "type": "formula", "tex": "LaTeX" }
- Verbs (wrap a child): { "type": "rotate|highlight|pulse|flow|fade|grow|emphasize", "child": {noun} }
- Relations: { "type": "sequence_flow", "children": [{noun}, {noun}] } | { "type": "beside", "children": [...] } | { "type": "above", "children": [...] } | { "type": "parallel", "children": [...] }

Example for "Encoder transforms input into representation":
{ "type": "sequence_flow", "children": [
  { "type": "sequence", "items": ["x₁","x₂","xₙ"], "color": "#81C784" },
  { "type": "highlight", "child": { "type": "box", "label": "Encoder", "icon": "⚙️" } },
  { "type": "grow", "child": { "type": "box", "label": "Representation", "icon": "📦" } }
]}

RESPOND IN THIS EXACT FORMAT:
NARRATION: (your 3-4 sentence narration here)
VISUAL_IR: (the JSON object for the visual)

RULES:
- The narration must describe what the VISUAL_IR shows — they must match
- Use verbs like highlight, pulse, grow to make things alive
- Use icons/emojis for key concepts
- Use sequence_flow for processes, beside for comparisons, parallel for concurrent things
- NEVER mention author names, journal names, publication years, section headers, or any publication metadata in the narration. Focus ONLY on the intellectual content and ideas.
- Do NOT say words like "Abstract", "Introduction", "the authors state", "this paper", "in this journal". Instead directly explain the concepts.

Return ONLY the two labeled sections above.`,
    maxTokens: 700
  });

  // Parse NARRATION and VISUAL_IR from response
  const narrationMatch = raw.match(/NARRATION:\s*([\s\S]*?)(?=VISUAL_IR:|$)/i);
  const irMatch = raw.match(/VISUAL_IR:\s*(\{[\s\S]*\})/i);

  const narration = narrationMatch ? narrationMatch[1].trim() : raw.replace(/VISUAL_IR:[\s\S]*/i, '').trim();
  let visualIR = null;
  if (irMatch) {
    try { visualIR = JSON.parse(irMatch[1]); } catch (e) { console.warn('  [IR parse failed]', e.message?.substring(0, 40)); }
  }

  return { narration, visualIR };
}

// ═══════════════════════════════════════
// BUILD VISUAL for each scene
// ═══════════════════════════════════════

function buildSceneVisual(scene, formulas, assets) {
  // Collect what we need to show
  const hasFigure = scene.figureIdx !== null && scene.figureIdx !== undefined && assets?.figures?.has(scene.figureIdx);
  const hasFormulas = scene.formulaIds?.length > 0;

  // ── Both figure AND formula: show side by side (figure left, formula below) ──
  if (hasFigure && hasFormulas) {
    const src = assets.figures.get(scene.figureIdx);
    const formulaHTMLs = scene.formulaIds.map(id => formulas.find(f => f.id === id)).filter(Boolean);
    const renderScript = formulaHTMLs.map((f, i) => {
      const escaped = f.latex.replace(/\\/g, '\\\\');
      return `katex.render("${escaped}", document.getElementById("f${i}"), {displayMode:true,throwOnError:false});`;
    }).join('\n');
    const formulaDivs = formulaHTMLs.map((f, i) => `<div class="formula-card"><div class="fname">${f.name}</div><div id="f${i}"></div></div>`).join('');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"><\/script>
<style>*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#1a1a2e;font-family:-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center}
.cap{color:#6a6a7a;font-size:12px;padding:4px}
.content{flex:1;display:flex;align-items:center;justify-content:center;gap:20px;padding:10px;width:100%;min-height:0}
img{max-width:45%;max-height:90%;object-fit:contain;border-radius:6px;background:#fff;padding:6px}
.formulas{display:flex;flex-direction:column;gap:10px;max-width:50%}
.formula-card{background:rgba(255,255,255,0.04);border:1px solid rgba(79,195,247,0.15);border-radius:10px;padding:14px 24px;text-align:center}
.fname{color:#4FC3F7;font-size:11px;margin-bottom:6px;font-weight:600}
.katex{color:#ffffff !important}
.katex .base{color:#ffffff !important}
.katex .mord,.katex .mrel,.katex .mbin,.katex .mop,.katex .mopen,.katex .mclose,.katex .mpunct,.katex .minner{color:#ffffff !important}
.katex .katex-html{font-size:24px}
</style></head><body>
<div class="cap">${scene.title}</div>
<div class="content">
  <img src="${src}" alt="Figure"/>
  <div class="formulas">${formulaDivs}</div>
</div>
<script>document.addEventListener('DOMContentLoaded',function(){try{${renderScript}}catch(e){}});<\/script>
</body></html>`;
  }

  // ── Figure only ──
  if (hasFigure) {
    const src = assets.figures.get(scene.figureIdx);
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#1a1a2e;display:flex;flex-direction:column;align-items:center;justify-content:center}
img{max-width:92%;max-height:calc(100vh - 50px);object-fit:contain;border-radius:8px;background:#fff;padding:8px}
.cap{color:#6a6a7a;font-size:12px;padding:6px;font-family:-apple-system,sans-serif}
</style></head><body>
<div class="cap">${scene.title}</div>
<img src="${src}" alt="Figure ${scene.figureIdx + 1}"/>
<div class="cap">Figure ${scene.figureIdx + 1}</div>
</body></html>`;
  }

  // ── Formula only ──
  if (hasFormulas) {
    const formulaHTMLs = [];
    for (const id of scene.formulaIds) {
      const f = formulas.find(ff => ff.id === id);
      if (f) {
        formulaHTMLs.push({ name: f.name, latex: f.latex });
      }
    }
    if (formulaHTMLs.length > 0) {
      return buildFormulaPage(scene.title, formulaHTMLs);
    }
  }

  // ── All other scenes: try concept schema first, then generic MathSign ──
  const schemaFn = findSchema(scene.title, scene.visualHint || '', scene.type);

  if (schemaFn) {
    const spec = schemaFn(scene.title);
    // Apply custom layout if the schema defines one
    if (spec._customLayout) {
      const objects = {};
      for (const s of spec.signs) { if (s.id) objects[s.id] = { x: 0, y: 0 }; }
      spec._customLayout(objects);
      // Inject positions into signs
      for (const s of spec.signs) {
        if (s.id && objects[s.id]) {
          s._x = objects[s.id].x;
          s._y = objects[s.id].y;
          if (objects[s.id].w) s.w = objects[s.id].w;
          if (objects[s.id].h) s.h = objects[s.id].h;
        }
      }
    }
    return renderMathSign(spec);
  }

  const signs = buildSignsFromHint(scene);
  return renderMathSign({ title: scene.title, signs, layout: signs.length > 4 ? 'vertical' : 'horizontal' });
}

/**
 * Build a self-contained HTML page with KaTeX-rendered formulas.
 * No escaping issues — KaTeX loads directly, formulas rendered on DOMContentLoaded.
 */
function buildFormulaPage(title, formulas) {
  const formulaDivs = formulas.map((f, i) => `
    <div class="formula-card">
      <div class="formula-name">${f.name}</div>
      <div class="formula-math" id="f${i}"></div>
    </div>`).join('\n');

  const renderScript = formulas.map((f, i) => {
    // Escape backslashes for JS string
    const escaped = f.latex.replace(/\\/g, '\\\\');
    return `katex.render("${escaped}", document.getElementById("f${i}"), {displayMode:true,throwOnError:false});`;
  }).join('\n');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#1a1a2e;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:-apple-system,sans-serif;gap:8px}
.title{color:#6a6a7a;font-size:13px;padding:10px}
.formula-card{background:rgba(255,255,255,0.05);border:1px solid rgba(79,195,247,0.2);border-radius:14px;padding:24px 48px;margin:8px 16px;text-align:center;max-width:90%}
.formula-name{color:#4FC3F7;font-size:13px;margin-bottom:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase}
.formula-math{min-height:40px;display:flex;align-items:center;justify-content:center}
.katex{color:#ffffff !important}
.katex .base{color:#ffffff !important}
.katex .mord,.katex .mrel,.katex .mbin,.katex .mop,.katex .mopen,.katex .mclose,.katex .mpunct,.katex .minner{color:#ffffff !important}
.katex .katex-html{font-size:28px}
</style></head><body>
<div class="title">${title}</div>
${formulaDivs}
<script>
document.addEventListener('DOMContentLoaded', function(){
  try{${renderScript}}catch(e){console.warn('KaTeX:',e);}
});
<\/script>
</body></html>`;
}

/**
 * Build MathSign signs from a scene's type and visualHint.
 * Every scene gets a proper visual — no plain text fallback.
 */
function buildSignsFromHint(scene) {
  const hint = scene.visualHint || scene.title || '';
  const signs = [];

  switch (scene.type) {
    case 'architecture': {
      // The title tells us what architecture — use it, not the hint
      signs.push({ sign: 'box', id: 'title', label: scene.title.substring(0, 30) });
      // Try to extract component names from hint (skip instructional phrases)
      const cleanHint = hint.replace(/show|display|draw|illustrate|depict|with|the|a|an/gi, '').trim();
      const parts = cleanHint.split(/[,→\->]+|and|then|to/i).map(s => s.trim()).filter(s => s.length > 2 && s.length < 35 && !/^[a-z]/.test(s));
      if (parts.length >= 2) {
        for (let i = 0; i < Math.min(parts.length, 5); i++) {
          const id = `c${i}`;
          signs.push({ sign: 'box', id, label: parts[i].substring(0, 25) });
          if (i > 0) signs.push({ sign: 'arrow', from: `c${i-1}`, to: id });
        }
      }
      break;
    }

    case 'comparison': {
      // Title usually has "vs" or the compared items
      const titleParts = scene.title.split(/vs\.?|versus|:|\-/i).map(s => s.trim()).filter(Boolean);
      if (titleParts.length >= 2) {
        signs.push({ sign: 'box', id: 'a', label: titleParts[0].substring(0, 25), color: '#4FC3F7' });
        signs.push({ sign: 'formula', id: 'vs', text: 'vs' });
        signs.push({ sign: 'box', id: 'b', label: titleParts[1].substring(0, 25), color: '#FFB74D' });
      } else {
        signs.push({ sign: 'circle', id: 'main', label: scene.title.substring(0, 30), r: 80 });
      }
      break;
    }

    case 'data': {
      // Extract numbers for bar chart
      const nums = [...hint.matchAll(/(\d+\.?\d*)/g)].map(m => parseFloat(m[1])).filter(n => n > 1);
      const labels = hint.match(/[A-Z]{2,}[→\-][A-Z]{2,}|EN[→\-]\w+|BLEU|score/gi) || [];
      if (nums.length >= 1) {
        const max = Math.max(...nums) * 1.2;
        for (let i = 0; i < Math.min(nums.length, 4); i++) {
          signs.push({ sign: 'bar', id: `b${i}`, value: nums[i], max, label: labels[i] || `#${i + 1}`, color: ['#4FC3F7', '#FFB74D', '#81C784', '#CE93D8'][i] });
        }
      } else {
        signs.push({ sign: 'box', id: 'data', label: scene.title });
      }
      break;
    }

    case 'text':
    default: {
      // Use the SCENE TITLE as the main visual, not the hint
      // The title IS the content (e.g., "Attention Is All You Need", "Sequential Computation Bottleneck")
      signs.push({ sign: 'circle', id: 'main', label: scene.title.substring(0, 30), r: 90, color: '#4FC3F7' });
      break;
    }
  }

  return signs.length > 0 ? signs : [{ sign: 'circle', id: 'main', label: scene.title.substring(0, 25), r: 80 }];
}

/**
 * Describe what the visual ACTUALLY shows — for the narrator to reference.
 */
function describeVisual(scene, formulas) {
  // Figures
  if (scene.figureIdx !== null && scene.figureIdx !== undefined) {
    return `Original Figure ${scene.figureIdx + 1} from the paper is displayed full-screen.`;
  }

  // Formulas
  if (scene.formulaIds?.length > 0) {
    const descs = scene.formulaIds.map(id => {
      const f = formulas.find(ff => ff.id === id);
      return f ? `Formula card: "${f.name}" showing: ${f.latex}` : '';
    }).filter(Boolean);
    return `The screen shows ${descs.length} formula card(s):\n${descs.join('\n')}`;
  }

  // Schema match
  const schemaFn = findSchema(scene.title, scene.visualHint || '', scene.type);
  if (schemaFn) {
    const spec = schemaFn(scene.title);
    const boxes = spec.signs.filter(s => s.sign === 'box').map(s => `"${s.label}"`);
    const arrows = spec.signs.filter(s => s.sign === 'arrow').length;
    const circles = spec.signs.filter(s => s.sign === 'circle').map(s => `"${s.label}"`);
    const parts = [];
    if (boxes.length) parts.push(`Boxes: ${boxes.join(', ')}`);
    if (circles.length) parts.push(`Circles: ${circles.join(', ')}`);
    if (arrows) parts.push(`${arrows} arrows connecting them`);
    const formSigns = spec.signs.filter(s => s.sign === 'formula');
    if (formSigns.length) parts.push(`Text: ${formSigns.map(s => `"${s.text || s.tex}"`).join(', ')}`);
    return `A diagram showing:\n${parts.join('\n')}`;
  }

  // Generic
  return `A visual with the title "${scene.title}".`;
}

// ═══════════════════════════════════════
// PDF ASSETS
// ═══════════════════════════════════════

async function extractPDFAssets(pdfPath, assetsDir) {
  const { execSync } = await import('child_process');
  if (!existsSync(assetsDir)) await mkdir(assetsDir, { recursive: true });

  let pageCount = 0;
  try {
    const info = execSync(`pdfinfo "${pdfPath}"`, { encoding: 'utf-8', timeout: 15000 });
    pageCount = parseInt(info.match(/Pages:\s+(\d+)/)?.[1] || '0', 10);
  } catch {}

  try { execSync(`pdfimages -png "${pdfPath}" "${join(assetsDir, 'img')}"`, { timeout: 30000 }); } catch {}

  const pagesToRender = Math.max(0, Math.min(pageCount || 12, 24));
  for (let page = 1; page <= pagesToRender; page++) {
    const outFile = join(assetsDir, `page-${String(page).padStart(2, '0')}.png`);
    if (!existsSync(outFile)) {
      try { execSync(`pdftoppm -png -f ${page} -l ${page} -r 200 "${pdfPath}" "${join(assetsDir, 'page')}"`, { timeout: 15000 }); } catch {}
    }
  }

  const figures = new Map();
  const pages = new Map();
  const files = await readdirLocal(assetsDir);
  for (const f of files.sort()) {
    if (!f.endsWith('.png')) continue;
    const data = await readFile(join(assetsDir, f));
    const b64 = `data:image/png;base64,${data.toString('base64')}`;
    if (f.startsWith('img-')) figures.set(parseInt(f.match(/img-(\d+)/)?.[1] || '0'), b64);
    else if (f.startsWith('page-')) pages.set(parseInt(f.match(/page-(\d+)/)?.[1] || '0'), b64);
  }

  console.log(`[Assets] ${figures.size} figures, ${pages.size} pages`);
  return { figures, pages };
}

// ═══════════════════════════════════════
// SAVE PLAYER (reuse from v1)
// ═══════════════════════════════════════

async function saveAsPlayer(scenes, outputPath, title) {
  const audioDivs = scenes.map((s, i) => {
    if (s.audio?.base64) return `<audio id="audio-${i}" preload="none"><source src="data:audio/mpeg;base64,${s.audio.base64}"></audio>`;
    return '';
  }).join('\n');

  // Store visual HTML in hidden <template> tags — NO escaping needed!
  // Templates don't execute their content, so <script> tags inside are safe
  const visualTemplates = scenes.map((s, i) => {
    const vhtml = s.visualHTML || '<html><body style="background:#1a1a2e"></body></html>';
    return `<template id="visual-${i}">${vhtml}</template>`;
  }).join('\n');

  const sceneMeta = scenes.map(s => ({
    index: s.index, narration: s.narration, visualType: s.type,
    audioDuration: s.audio?.duration || 0, hasAudio: !!s.audio?.base64, title: s.title
  }));

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#1a1a2e;color:#e0e0e0;font-family:-apple-system,sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden}
#header{padding:10px 20px;background:#16213e;border-bottom:1px solid #2a3a5a;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
#header h1{font-size:16px;color:#4FC3F7}
.controls{display:flex;gap:8px}
.btn{padding:6px 14px;border:1px solid #2a3a5a;border-radius:8px;background:#1e2a4a;color:#e0e0e0;cursor:pointer;font-size:13px}
.btn:hover{background:#0f3460}
.btn.active{background:#0288D1;border-color:#4FC3F7;color:#fff}
#main{flex:1;display:flex;overflow:hidden;min-height:0}
#visual-panel{flex:1;min-width:0}
#visual-frame{width:100%;height:100%;border:none;background:#1a1a2e}
#narration-panel{width:380px;border-left:1px solid #2a3a5a;display:flex;flex-direction:column;flex-shrink:0}
#narration-text{flex:1;padding:20px;font-size:15px;line-height:1.7;overflow-y:auto}
#scene-info{padding:8px 20px;background:#16213e;border-top:1px solid #2a3a5a;font-size:12px;color:#6a6a7a;flex-shrink:0}
#progress{display:flex;align-items:center;gap:10px;padding:8px 20px;background:#0f3460;flex-shrink:0}
#progress-bar{flex:1;height:4px;background:#1a1a2e;border-radius:2px;cursor:pointer}
#progress-fill{height:100%;background:#4FC3F7;border-radius:2px;transition:width .3s}
#progress-label{font-size:11px;color:#6a6a7a;white-space:nowrap}
.vtype{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}
.vtype-formula{background:rgba(79,195,247,.15);color:#4FC3F7}
.vtype-architecture{background:rgba(255,183,77,.15);color:#FFB74D}
.vtype-comparison{background:rgba(206,147,216,.15);color:#CE93D8}
.vtype-data{background:rgba(129,199,132,.15);color:#81C784}
.vtype-figure{background:rgba(255,183,77,.15);color:#FFB74D}
.vtype-text{background:rgba(255,255,255,.08);color:#a0a0b0}
</style></head><body>
<div id="header"><h1>${title}</h1>
<div class="controls">
<button class="btn" onclick="prevScene()">&larr; Prev</button>
<button class="btn active" id="btn-play" onclick="togglePlay()">&#9654; Play</button>
<button class="btn" onclick="nextScene()">Next &rarr;</button>
<button class="btn" id="btn-speed" onclick="cycleSpeed()">1x</button>
</div></div>
<div id="main">
<div id="visual-panel"><iframe id="visual-frame"></iframe></div>
<div id="narration-panel"><div id="narration-text">Click Play to start.</div><div id="scene-info"></div></div>
</div>
<div id="progress">
<div id="progress-bar" onclick="seekProgress(event)"><div id="progress-fill"></div></div>
<span id="progress-label">0 / ${scenes.length}</span>
</div>
<div style="display:none">${audioDivs}</div>
${visualTemplates}
<script>
const scenes=${JSON.stringify(sceneMeta)};
let cur=-1,playing=false,curAudio=null;
const speeds=[1,1.5,2,0.75];let spdIdx=0;
function goToScene(idx){
if(idx<0||idx>=scenes.length){playing=false;updatePlayBtn();return;}
if(curAudio){curAudio.pause();curAudio=null;}
cur=idx;const s=scenes[idx];
const frame=document.getElementById('visual-frame');
const tpl=document.getElementById('visual-'+idx);
frame.srcdoc=tpl?tpl.innerHTML:'<html><body style="background:#1a1a2e"></body></html>';
document.getElementById('narration-text').innerHTML='<span class="vtype vtype-'+s.visualType+'">'+s.visualType+'</span><br>'+s.narration;
document.getElementById('scene-info').textContent=(idx+1)+' / '+scenes.length+(s.title?' — '+s.title:'');
document.getElementById('progress-fill').style.width=((idx+1)/scenes.length*100)+'%';
document.getElementById('progress-label').textContent=(idx+1)+' / '+scenes.length;
if(playing&&s.hasAudio){const a=document.getElementById('audio-'+idx);if(a){a.playbackRate=speeds[spdIdx];a.currentTime=0;a.onended=()=>{if(playing)nextScene();};a.play().catch(()=>{});curAudio=a;}}
else if(playing){setTimeout(()=>{if(playing)nextScene();},5000/speeds[spdIdx]);}
}
function nextScene(){goToScene(cur+1);}
function prevScene(){goToScene(cur-1);}
function updatePlayBtn(){const b=document.getElementById('btn-play');b.innerHTML=playing?'&#9646;&#9646; Pause':'&#9654; Play';b.className='btn'+(playing?' active':'');}
function togglePlay(){playing=!playing;updatePlayBtn();if(playing){if(cur<0)goToScene(0);else if(scenes[cur]?.hasAudio&&!curAudio){const a=document.getElementById('audio-'+cur);if(a){a.playbackRate=speeds[spdIdx];a.onended=()=>{if(playing)nextScene();};a.play().catch(()=>{});curAudio=a;}}}else{if(curAudio)curAudio.pause();}}
function cycleSpeed(){spdIdx=(spdIdx+1)%speeds.length;document.getElementById('btn-speed').textContent=speeds[spdIdx]+'x';if(curAudio)curAudio.playbackRate=speeds[spdIdx];}
function seekProgress(e){const r=e.currentTarget.getBoundingClientRect();goToScene(Math.floor((e.clientX-r.left)/r.width*scenes.length));}
goToScene(0);
</script></body></html>`;

  const dir = dirname(outputPath);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(outputPath, html);
  console.log(`[Watcher] Saved: ${outputPath} (${(html.length / 1024).toFixed(0)}KB)`);
}

// ═══════════════════════════════════════
// GENERIC INPUT HANDLING
// ═══════════════════════════════════════

function parseCliArgs(argv) {
  const options = {
    input: null,
    output: null,
    pdf: null,
    formulas: null,
    title: null,
    assetsDir: null,
    maxScenes: 24,
    verbatim: false,
    help: false
  };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--input':
      case '-i':
        options.input = argv[++i];
        break;
      case '--output':
      case '-o':
        options.output = argv[++i];
        break;
      case '--pdf':
      case '-p':
        options.pdf = argv[++i];
        break;
      case '--formulas':
      case '-f':
        options.formulas = argv[++i];
        break;
      case '--title':
      case '-t':
        options.title = argv[++i];
        break;
      case '--assets-dir':
        options.assetsDir = argv[++i];
        break;
      case '--max-scenes':
        options.maxScenes = Math.max(1, parseInt(argv[++i] || '24', 10) || 24);
        break;
      case '--verbatim':
        options.verbatim = true;
        break;
      default:
        positional.push(arg);
    }
  }

  if (!options.input && positional[0]) options.input = positional[0];
  if (!options.output && positional[1]) options.output = positional[1];
  if (!options.pdf && positional[2]) options.pdf = positional[2];
  if (!options.formulas && positional[3]) options.formulas = positional[3];
  return options;
}

function printUsage() {
  console.log(`
Usage:
  node agents/article-watcher-v2.mjs --input <paper.txt|paper.pdf> [--output out.html] [--pdf source.pdf] [--formulas formulas.json]

Examples:
  node agents/article-watcher-v2.mjs --input data/attention_paper.txt
  node agents/article-watcher-v2.mjs --input /path/paper.pdf --output /path/paper_watcher.html
  node agents/article-watcher-v2.mjs input.txt output.html optional.pdf optional_formulas.json
`);
}

function deriveOutputPath(inputPath, explicitOutput, titleHint) {
  if (explicitOutput) return explicitOutput;
  const inputDir = dirname(inputPath);
  const base = basename(inputPath, extname(inputPath));
  const stem = slugify(titleHint || base.replace(/_paper$/i, ''));
  return join(inputDir, `${stem}_watcher.html`);
}

function inferFormulaPath(inputPath, outputPath, explicitFormulaPath, titleHint) {
  if (explicitFormulaPath) return explicitFormulaPath;

  const base = basename(inputPath, extname(inputPath));
  const stem = slugify(titleHint || base.replace(/_paper$/i, ''));
  const candidates = [
    join(dirname(inputPath), `${base}_formulas.json`),
    join(dirname(inputPath), `${base.replace(/_paper$/i, '')}_formulas.json`),
    join(dirname(outputPath), `${stem}_formulas.json`)
  ];

  return candidates.find(candidate => existsSync(candidate)) || candidates[candidates.length - 1];
}

async function extractTextFromPdf(pdfPath) {
  const { execSync } = await import('child_process');
  try {
    return execSync(`pdftotext -nopgbrk "${pdfPath}" -`, {
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (err) {
    throw new Error(`Failed to extract text from PDF. Install pdftotext or provide a text file. ${err.message?.substring(0, 120)}`);
  }
}

async function extractFormulaIndex(articleText, documentTitle) {
  // Keep excerpt under ~3500 input tokens so Qwen-14B's 8192 window leaves
  // room for the formula JSON output. Grab the section that most likely
  // contains the method equations: skip the abstract/intro and take the middle.
  const methodStart = Math.min(3000, Math.floor(articleText.length * 0.1));
  const excerpt = articleText.substring(methodStart, methodStart + 12000);
  const raw = await generateText({
    prompt: `Extract the document's important mathematical formulas from this academic article excerpt.

DOCUMENT TITLE: ${documentTitle}

ARTICLE EXCERPT (method section):
"""
${excerpt}
"""

Return JSON in this format:
{
  "title": "${documentTitle} — Formula Index",
  "formulas": [
    {
      "id": "snake_case_id",
      "name": "Short descriptive name",
      "latex": "\\\\text{LaTeX formula here}"
    }
  ]
}

RULES:
- Include only actual equations, complexity expressions, or explicitly defined mathematical identities.
- If the excerpt has no useful formulas, return an empty formulas array.
- latex must be valid LaTeX, not plain English prose.
- Keep ids stable and descriptive.

Return ONLY valid JSON.`,
    maxTokens: 2500
  });

  const parsed = extractJsonObject(raw);
  if (!parsed?.formulas) {
    return { title: `${documentTitle} — Formula Index`, formulas: [] };
  }

  return {
    title: parsed.title || `${documentTitle} — Formula Index`,
    formulas: Array.isArray(parsed.formulas) ? parsed.formulas : []
  };
}

async function loadOrGenerateFormulas(formulaPath, articleText, documentTitle) {
  if (formulaPath && existsSync(formulaPath)) {
    return JSON.parse(await readFile(formulaPath, 'utf-8'));
  }

  const generated = await extractFormulaIndex(articleText, documentTitle);
  if (formulaPath) {
    await writeFile(formulaPath, JSON.stringify(generated, null, 2));
    console.log(`  Formula index generated: ${formulaPath}`);
  }
  return generated;
}

async function buildScenePlayerFallback(scenes, outputPath, title) {
  console.log('[Watcher v2] Falling back to scene-by-scene player...');
  const AUDIO_BATCH = 4;

  for (let i = 0; i < scenes.length; i += AUDIO_BATCH) {
    const batch = scenes.slice(i, i + AUDIO_BATCH);
    const results = await Promise.all(batch.map((scene, idx) =>
      generateAudio(scene.narration, `scene_${i + idx}`)
    ));
    for (let j = 0; j < batch.length; j++) {
      batch[j].audio = results[j];
    }
    process.stdout.write(`  Scene audio ${Math.min(i + AUDIO_BATCH, scenes.length)}/${scenes.length}\r`);
  }

  console.log('');
  await saveAsPlayer(scenes, outputPath, title);
}

// ═══════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════

export async function main(argv = process.argv.slice(2)) {
const cli = parseCliArgs(argv);
if (cli.help) {
  printUsage();
  return;
}

if (!hasOpenAIKey()) {
  throw new Error('OPENAI_API_KEY is not set. Add it to your environment or .env before running the watcher generator.');
}

const sampleInputPath = join(__dirname, '..', 'data', 'attention_paper.txt');
const sourceInputPath = cli.input || sampleInputPath;

let articleText = '';
let pdfPath = cli.pdf || null;
if (extname(sourceInputPath).toLowerCase() === '.pdf') {
  pdfPath = sourceInputPath;
  console.log('[Watcher v2] Extracting text from PDF...');
  articleText = await extractTextFromPdf(sourceInputPath);
  const rawWordCount = articleText.split(/\s+/).filter(Boolean).length;
  articleText = cleanPdfText(articleText);
  const cleanWordCount = articleText.split(/\s+/).filter(Boolean).length;
  console.log(`  PDF text cleaned: ${rawWordCount} → ${cleanWordCount} words (removed ${rawWordCount - cleanWordCount} words of headers/footers/references/artifacts)`);
} else {
  console.log('[Watcher v2] Reading article...');
  articleText = await readFile(sourceInputPath, 'utf-8');
}

const inferredTitle = cli.title || inferDocumentTitle(articleText, basename(sourceInputPath, extname(sourceInputPath)));
const outputPath = deriveOutputPath(sourceInputPath, cli.output, inferredTitle);
const formulaPath = inferFormulaPath(sourceInputPath, outputPath, cli.formulas, inferredTitle);
const assetsDir = cli.assetsDir || join(dirname(outputPath), `${slugify(inferredTitle)}_assets`);

console.log(`  Title: ${inferredTitle}`);
console.log(`  ${articleText.split(/\s+/).filter(Boolean).length} words`);

const formulaData = await loadOrGenerateFormulas(formulaPath, articleText, inferredTitle);
const formulas = Array.isArray(formulaData.formulas) ? formulaData.formulas : [];
const documentTitle = cleanFormulaIndexTitle(formulaData.title) || inferredTitle;
console.log(`  ${formulas.length} formula(s) available`);

let assets = null;
if (pdfPath && existsSync(pdfPath)) {
  console.log('[Watcher v2] Extracting PDF assets...');
  assets = await extractPDFAssets(pdfPath, assetsDir);
}

console.log('[Watcher v2] Pass 1: Planning all scenes...');
let plan = await planScenes(articleText, formulas, assets?.figures?.size || 0, inferredTitle, { maxScenes: cli.maxScenes });
if (plan.length > cli.maxScenes) {
  console.log(`  (truncating ${plan.length} planned scenes to cli.maxScenes=${cli.maxScenes})`);
  plan = plan.slice(0, cli.maxScenes);
}
console.log(`  ${plan.length} scenes planned`);
for (const s of plan) {
  const refs = [];
  if (s.formulaIds?.length) refs.push(`formulas: ${s.formulaIds.join(',')}`);
  if (s.figureIdx !== null && s.figureIdx !== undefined) refs.push(`fig ${s.figureIdx}`);
  console.log(`  ${(plan.indexOf(s) + 1).toString().padStart(2)}. [${(s.type || 'text').padEnd(12)}] ${s.title}${refs.length ? ' (' + refs.join(', ') + ')' : ''}`);
}

console.log('[Watcher v2] Pass 2: Narrating scenes...');
const scenes = [];
const narrations = [];

for (let i = 0; i < plan.length; i++) {
  const scenePlan = { ...plan[i], index: i };

  // STEP 1: Build visual FIRST — so we know exactly what's on screen
  const visualHTML = buildSceneVisual(scenePlan, formulas, assets);

  // STEP 2: Describe what the visual actually shows
  const visualDesc = describeVisual(scenePlan, formulas);

  // STEP 3: Narrate AND get SigmLang IR — they're generated together so they match
  const result = await narrateScene(scenePlan, plan, narrations, articleText, formulas, visualDesc);
  const narration = result.narration;
  narrations.push(narration);

  // STEP 4: Generate STREAMING visual commands synced to narration
  let finalVisualHTML = visualHTML;
  let streamCommands = [];
  try {
    // Collect formula LaTeX and figure base64 for this scene
    // Pass the FIRST formula only — multiple formulas are rendered separately in buildFormulaPage
    const formulaTexts = (scenePlan.formulaIds || []).map(id => {
      const f = formulas.find(ff => ff.id === id);
      return f ? f.latex : '';
    }).filter(Boolean);
    const formulaLatex = formulaTexts[0] || '';

    const formulaContext = (scenePlan.formulaIds || []).map(id => {
      const f = formulas.find(ff => ff.id === id);
      return f ? `Formula "${f.name}": ${f.latex}` : '';
    }).filter(Boolean).join('; ');

    const hasFigure = scenePlan.figureIdx !== null && scenePlan.figureIdx !== undefined;
    const figureBase64 = hasFigure && assets?.figures?.has(scenePlan.figureIdx) ? assets.figures.get(scenePlan.figureIdx) : null;
    const figureLabel = hasFigure ? `Figure ${scenePlan.figureIdx + 1}` : '';

    streamCommands = await generateSemanticCommands(
      narration,
      scenePlan.title + '. ' + formulaContext,
      { formulaLatex: formulaLatex || null, formulaAll: formulaTexts, figureBase64, figureLabel }
    );

    // ── LAYOUT OPTIMIZER (4 penalties) ──
    // 1. Missing important words → add them
    // 2. Distance from center → push everything to center
    // 3. Count > 2 → exponential penalty, remove low-importance items
    // 4. Overlap → minimum displacement to separate
    const beforeScore = scoreLayout(streamCommands, narration);
    streamCommands = optimizeCommands(streamCommands, narration);
    const afterScore = scoreLayout(streamCommands, narration);
    if (beforeScore.total !== afterScore.total) {
      console.log(`    → Optimizer: penalty ${beforeScore.total} → ${afterScore.total}`);
    }

    console.log(`    → ${streamCommands.length} streaming commands${figureBase64 ? ' (with figure)' : ''}${formulaLatex ? ' (with formula)' : ''}`);
    finalVisualHTML = compileStreamingPlayer(streamCommands, scenePlan.title, null, 0);
  } catch (e) {
    console.warn(`    → Streaming failed: ${e.message?.substring(0, 40)}, using fallback`);
    if (result.visualIR?.type) {
      try { finalVisualHTML = sigmlCompile({ root: result.visualIR, title: scenePlan.title }); } catch {}
    }
  }

  scenes.push({
    index: i,
    title: scenePlan.title,
    type: scenePlan.type,
    narration,
    visualHTML: finalVisualHTML,
    streamCommands: streamCommands || [],
    audio: null
  });

  console.log(`  Scene ${i + 1}: ${scenePlan.title} (${narration.split(/\s+/).length} words)`);
}

// ═══════════════════════════════════════
// PASS 3: GRAPH-DRIVEN NARRATION
// Collect the full knowledge graph from all scenes,
// compute optimal traversal, generate NEW narration from graph edges,
// generate TTS, and compile a single unified graph player.
// ═══════════════════════════════════════

console.log('[Watcher v2] Pass 3: Building unified knowledge graph...');

// 3a. Collect ALL streaming commands from all scenes (stored directly, not regex)
const allStreamCommands = [];
for (const s of scenes) {
  if (s.streamCommands) allStreamCommands.push(...s.streamCommands);
}
console.log(`  ${allStreamCommands.length} total commands across ${scenes.length} scenes`);

// 3b. First pass: compile player WITHOUT audio to extract the traversal order
const dryRunPlayer = compileStreamingPlayer(allStreamCommands, '', null, 0);
// Extract graphSubs JSON — find it between markers
let spoTriples = [];
const gsStart = dryRunPlayer.indexOf('var graphSubs = ');
if (gsStart > -1) {
  const jsStart = gsStart + 'var graphSubs = '.length;
  const jsEnd = dryRunPlayer.indexOf(';\nvar duration', jsStart);
  if (jsEnd > jsStart) {
    try { spoTriples = JSON.parse(dryRunPlayer.substring(jsStart, jsEnd)); } catch (e) {
      console.warn('  Failed to parse graphSubs:', e.message?.substring(0, 60));
    }
  }
}
console.log(`  ${spoTriples.length} SPO triples in traversal order`);

// Also extract the ordered edges so we can pass them to the final player
let dryRunEdges = [];
const geStart = dryRunPlayer.indexOf('var graphEdges = ');
if (geStart > -1) {
  const geJsStart = geStart + 'var graphEdges = '.length;
  const geJsEnd = dryRunPlayer.indexOf(';\nvar clusters', geJsStart);
  if (geJsEnd > geJsStart) {
    try { dryRunEdges = JSON.parse(dryRunPlayer.substring(geJsStart, geJsEnd)); } catch {}
  }
}
console.log(`  ${dryRunEdges.length} ordered edges extracted`);

// Also extract graphNodes for hierarchy inference
let dryRunNodes = [];
const gnStart = dryRunPlayer.indexOf('var graphNodes = ');
if (gnStart > -1) {
  const gnJsStart = gnStart + 'var graphNodes = '.length;
  const gnJsEnd = dryRunPlayer.indexOf(';\nvar graphEdges', gnJsStart);
  if (gnJsEnd > gnJsStart) {
    try { dryRunNodes = JSON.parse(dryRunPlayer.substring(gnJsStart, gnJsEnd)); } catch {}
  }
}
console.log(`  ${dryRunNodes.length} graph nodes extracted`);

// 3c. Generate narration: LLM expands EACH triple into exactly one sentence
if (spoTriples.length === 0) {
  await buildScenePlayerFallback(scenes, outputPath, documentTitle);
  console.log('[Watcher v2] Done!');
  return;
}

const alignment = alignTriplesToSourceText(spoTriples, dryRunEdges, articleText, dryRunNodes);
console.log(`[Watcher v2] Source alignment: ${alignment.matchedCount}/${spoTriples.length} direct matches, ${alignment.items?.filter(it => it.bothEndpoints).length || 0} with BOTH endpoints, avg score ${alignment.averageScore.toFixed(2)}`);

let narrationEdges = dryRunEdges;
let narSentences = [];
let sceneEpisodes = [];

if (cli.verbatim) {
  console.log('[Watcher v2] Verbatim mode — reading source sentences directly (no LLM narration)');
  const verbatimUnits = buildSourceUnits(articleText);
  if (verbatimUnits.length === 0) {
    console.warn('[Watcher v2] Verbatim mode: no source sentences found — falling back to graph-driven narration');
    narSentences = await generateGraphOnlyNarrationSentences(spoTriples, documentTitle);
  } else {
    // Use first N source sentences, where N = number of triples. Cycle if the source is shorter than the triple count.
    const needed = spoTriples.length;
    narSentences = Array.from({ length: needed }, (_, i) => verbatimUnits[i % verbatimUnits.length].text);
    console.log(`  ${narSentences.length} verbatim sentences (from ${verbatimUnits.length} source units)`);
  }
  const verbatimItems = narrationEdges.map((edge, index) => ({
    edge,
    matched: true,
    narrationSentence: narSentences[index],
    sourceExcerpt: narSentences[index],
    sourceText: narSentences[index],
    sourceIndex: index,
  }));
  console.log('[Watcher v2] Generating scene episodes from verbatim narration...');
  sceneEpisodes = await generateSceneEpisodesFromSource(verbatimItems, narSentences, documentTitle, { formulas });
} else if (alignment.shouldUseSourceOrder && alignment.orderedItems.length === spoTriples.length) {
  console.log('[Watcher v2] Generating source-grounded narration from original text flow...');
  narrationEdges = alignment.orderedItems.map(item => item.edge);
  narSentences = await generateSourceGroundedNarrationSentences(alignment.orderedItems, documentTitle);
  console.log('[Watcher v2] Generating source-grounded scene episodes...');
  sceneEpisodes = await generateSceneEpisodesFromSource(alignment.orderedItems, narSentences, documentTitle, { formulas });
} else {
  console.log('[Watcher v2] Source alignment too weak, falling back to graph-driven narration...');
  narSentences = await generateGraphOnlyNarrationSentences(spoTriples, documentTitle);
  const fallbackItems = alignment.items || [];
  console.log('[Watcher v2] Generating fallback scene episodes...');
  sceneEpisodes = await generateSceneEpisodesFromSource(narrationEdges.map((edge, index) => ({
    edge,
    matched: fallbackItems[index]?.matched || false,
    narrationSentence: narSentences[index],
    sourceExcerpt: fallbackItems[index]?.sourceExcerpt || fallbackItems[index]?.sourceText || '',
    sourceIndex: fallbackItems[index]?.sourceIndex ?? null
  })), narSentences, documentTitle, { formulas });
}

console.log(`  ${narSentences.length} sentences (1:1 with triples)`);

// 3e. Generate per-sentence TTS audio (true 1:1 sync)
console.log('[Watcher v2] Generating per-edge audio clips...');
const edgeAudios = []; // { base64, duration } per sentence
const AUDIO_BATCH = 5;
for (let i = 0; i < narSentences.length; i += AUDIO_BATCH) {
  const batch = narSentences.slice(i, i + AUDIO_BATCH);
  const results = await Promise.all(batch.map((sent, j) =>
    generateAudio(sent, `edge_${i + j}`)
  ));
  for (const r of results) {
    edgeAudios.push({ base64: r?.base64 || null, duration: r?.duration || 2, mime: r?.mime || 'audio/mpeg' });
  }
  process.stdout.write(`  Audio ${Math.min(i + AUDIO_BATCH, narSentences.length)}/${narSentences.length}\r`);
}
console.log(`\n  ${edgeAudios.length} audio clips generated`);

// 3f. Compute timing from actual clip durations (cumulative)
let cumTime = 0;
const edgeTimings = edgeAudios.map(a => {
  const t = cumTime;
  cumTime += a.duration;
  return t;
});
const totalAudioDur = cumTime;
console.log(`  Total duration: ${totalAudioDur.toFixed(1)}s`);

// 3g. Pass per-edge audio + timing + subtitles to the player
allStreamCommands.push({ cmd: '_edge_timings', timings: edgeTimings });
allStreamCommands.push({ cmd: '_edge_subtitles', subtitles: narSentences });
allStreamCommands.push({ cmd: '_edge_audios', audios: edgeAudios.map(a => a.base64), mime: edgeAudios.find(a => a.mime)?.mime || 'audio/mpeg' });
allStreamCommands.push({ cmd: '_preordered_edges', edges: narrationEdges });
allStreamCommands.push({ cmd: '_scene_episodes', episodes: sceneEpisodes });

// 3g2. Pass formulas and referenced figures for the reference panel
allStreamCommands.push({ cmd: '_formulas', formulas: formulas || [] });
const referencedFigures = {};
if (assets?.figures) {
  for (const ep of sceneEpisodes) {
    const figIdx = ep?.references?.figureIdx;
    if (figIdx !== null && figIdx !== undefined && assets.figures.has(figIdx)) {
      referencedFigures[figIdx] = assets.figures.get(figIdx);
    }
  }
}
allStreamCommands.push({ cmd: '_reference_figures', figures: referencedFigures });

// 3h. Generate concept hierarchy via Louvain community detection (deterministic, no LLM)
console.log('[Watcher v2] Generating concept hierarchy (Louvain)...');
try {
  const hierarchyResult = generateConceptHierarchyLouvain(dryRunNodes, narrationEdges);
  if (hierarchyResult?.tree) {
    allStreamCommands.push({ cmd: '_concept_hierarchy', tree: hierarchyResult.tree });
  }
} catch (e) {
  console.warn('  Hierarchy generation failed:', e.message?.substring(0, 80));
}

// 3i. Compile final player (no single audio — per-edge clips instead)
const finalPlayer = compileStreamingPlayer(allStreamCommands, documentTitle, null, totalAudioDur);

// 3h. Save as single-page player (not multi-scene)
const dir = dirname(outputPath);
if (!existsSync(dir)) await mkdir(dir, { recursive: true });
await writeFile(outputPath, finalPlayer);
console.log(`[Watcher] Saved: ${outputPath} (${(finalPlayer.length / 1024).toFixed(0)}KB)`);
console.log('[Watcher v2] Done!');

// Shut down the Kokoro subprocess so the Node event loop can drain and the
// process can exit. Without this, the long-lived Python worker's pipe handles
// keep Node alive indefinitely after main() completes → the wrapper script
// never advances past Step 1 (article-watcher).
if (USE_KOKORO_TTS) {
  try { await shutdownKokoro(); } catch {}
}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => {
    console.error('[Watcher v2] Failed:', err.message);
    process.exit(1);
  });
}
