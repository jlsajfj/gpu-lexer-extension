import type { PaintedClass, SyntaxClassName, SyntaxSpan } from '../shared/types.js';
import { PAINTED_CLASSES } from '../shared/types.js';

/** NodeFilter.SHOW_TEXT as a literal: the NodeFilter global is absent outside a browser. */
const SHOW_TEXT = 4;

const PAINTED: ReadonlySet<string> = new Set<string>(PAINTED_CLASSES);

function isPainted(type: SyntaxClassName): type is PaintedClass {
  return PAINTED.has(type);
}

interface TextSlice { node: Text; start: number; end: number }

function collectTextSlices(el: Element): TextSlice[] {
  const walker = el.ownerDocument.createTreeWalker(el, SHOW_TEXT);
  const slices: TextSlice[] = [];
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const length = text.data.length;
    if (length === 0) continue;
    slices.push({ node: text, start: offset, end: offset + length });
    offset += length;
  }
  return slices;
}

function sliceAt(slices: TextSlice[], offset: number): number {
  let lo = 0;
  let hi = slices.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (slices[mid]!.end <= offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function spansToRanges(
  el: Element,
  spans: readonly SyntaxSpan[],
): Map<PaintedClass, Range[]> {
  const byClass = new Map<PaintedClass, Range[]>();
  if (spans.length === 0) return byClass;

  const slices = collectTextSlices(el);
  if (slices.length === 0) return byClass;
  const total = slices[slices.length - 1]!.end;
  const doc = el.ownerDocument;

  for (const span of spans) {
    if (!isPainted(span.type)) continue;
    const { start } = span;
    if (!Number.isFinite(start) || !Number.isFinite(span.end)) continue;
    // Clamp an out-of-range `end` to the text length; drop when `start` is out of range or the clamp leaves it empty.
    if (start < 0 || start >= total || span.end <= start) continue;
    const end = Math.min(span.end, total);
    if (end <= start) continue;

    const head = slices[sliceAt(slices, start)]!;
    const tail = slices[sliceAt(slices, end)]!;
    try {
      const range = doc.createRange();
      range.setStart(head.node, start - head.start);
      range.setEnd(tail.node, end - tail.start);
      const existing = byClass.get(span.type);
      if (existing) existing.push(range);
      else byClass.set(span.type, [range]);
    } catch {
      // IndexSizeError when the element's text shrank between the walk and here
    }
  }
  return byClass;
}
