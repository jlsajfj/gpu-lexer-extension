import type { PaintedClass } from '../shared/types.js';
import { PAINTED_CLASSES, highlightName } from '../shared/types.js';

// lib.dom types Highlight/HighlightRegistry without their Set-like members.
interface HighlightLike {
  add(range: AbstractRange): void;
  delete(range: AbstractRange): void;
  clear(): void;
}

interface RegistryLike {
  get(name: string): HighlightLike | undefined;
  set(name: string, highlight: HighlightLike): void;
  delete(name: string): void;
}

const painted = new WeakMap<Element, Map<PaintedClass, Range[]>>();

export function isHighlightApiSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
}

function highlights(): RegistryLike | null {
  return isHighlightApiSupported() ? (CSS.highlights as unknown as RegistryLike) : null;
}

function highlightFor(cls: PaintedClass): HighlightLike | null {
  const all = highlights();
  if (!all) return null;
  const name = highlightName(cls);
  const existing = all.get(name);
  if (existing) return existing;
  const created = new Highlight();
  all.set(name, created);
  return created;
}

/** Replaces any ranges previously painted for `el`. */
export function paint(el: Element, ranges: Map<PaintedClass, Range[]>): void {
  if (!isHighlightApiSupported()) return;
  unpaint(el);
  const stored = new Map<PaintedClass, Range[]>();
  for (const cls of PAINTED_CLASSES) {
    const list = ranges.get(cls);
    if (!list || list.length === 0) continue;
    const highlight = highlightFor(cls);
    if (!highlight) continue;
    for (const range of list) highlight.add(range);
    stored.set(cls, list);
  }
  if (stored.size > 0) painted.set(el, stored);
}

/** True when nothing is stored, or every stored range still lies inside `el`. */
export function isPaintLive(el: Element): boolean {
  const stored = painted.get(el);
  if (!stored) return true;
  for (const list of stored.values()) {
    for (const range of list) {
      if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return false;
    }
  }
  return true;
}

export function unpaint(el: Element): void {
  const stored = painted.get(el);
  if (!stored) return;
  const all = highlights();
  if (all) {
    for (const [cls, list] of stored) {
      const highlight = all.get(highlightName(cls));
      if (!highlight) continue;
      for (const range of list) highlight.delete(range);
    }
  }
  painted.delete(el);
}

export function unpaintAll(): void {
  const all = highlights();
  if (!all) return;
  for (const cls of PAINTED_CLASSES) {
    const name = highlightName(cls);
    const highlight = all.get(name);
    if (highlight) highlight.clear();
    all.delete(name);
  }
}
