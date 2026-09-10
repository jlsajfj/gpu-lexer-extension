import type { Settings } from '../shared/settings.js';

const EDITOR_SELECTOR = '[contenteditable=""], [contenteditable="true"]';

/** Candidate blocks under `root`, outermost only (a <code> inside a <pre> yields just the <pre>). */
export function findBlocks(root: ParentNode): HTMLElement[] {
  const candidates = root.querySelectorAll('pre, code');
  const set = new Set<Element>(candidates);
  const blocks: HTMLElement[] = [];
  for (const el of set) {
    if (hasAncestorIn(el, set)) continue;
    blocks.push(el as HTMLElement);
  }
  return blocks;
}

function hasAncestorIn(el: Element, set: ReadonlySet<Element>): boolean {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    if (set.has(parent)) return true;
  }
  return false;
}

export function isEligible(
  el: Element,
  s: Pick<Settings, 'minLength' | 'maxLength' | 'inlineCode'>,
): boolean {
  const text = el.textContent ?? '';
  if (text.trim().length === 0) return false;
  if (text.length < s.minLength || text.length > s.maxLength) return false;
  if (el.closest(EDITOR_SELECTOR)) return false;
  if (el.localName === 'code' && !el.closest('pre') && !text.includes('\n')) return s.inlineCode;
  return true;
}

/** Exact text of the block. Never normalized: offsets must line up with the text-node walk in ranges.ts. */
export function extractCode(el: Element): string {
  return el.textContent ?? '';
}
