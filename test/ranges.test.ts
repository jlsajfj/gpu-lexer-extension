import { describe, expect, it } from 'vitest';
import { spansToRanges } from '../src/content/ranges.js';
import type { PaintedClass, SyntaxClassName, SyntaxSpan } from '../src/shared/types.js';

function el(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  const first = host.firstElementChild;
  if (first === null) throw new Error(`fixture produced no element: ${html}`);
  return first as HTMLElement;
}

function span(type: SyntaxClassName, start: number, end: number): SyntaxSpan {
  return { type, start, end };
}

function texts(map: Map<PaintedClass, Range[]>, cls: PaintedClass): string[] {
  return (map.get(cls) ?? []).map((r) => r.toString());
}

function allText(map: Map<PaintedClass, Range[]>): string[] {
  return [...map.values()].flat().map((r) => r.toString());
}

describe('spansToRanges', () => {
  it('maps a mid-string span onto the exact substring', () => {
    const pre = el('<pre>const x = 42;</pre>');
    const map = spansToRanges(pre, [span('keyword', 6, 7), span('number', 10, 12)]);
    expect(texts(map, 'keyword')).toEqual(['x']);
    expect(texts(map, 'number')).toEqual(['42']);
  });

  it('resolves a span that crosses text-node boundaries', () => {
    const pre = el('<pre>const <span>x</span> = "hi";</pre>');
    expect(pre.textContent).toBe('const x = "hi";');
    const map = spansToRanges(pre, [span('keyword', 4, 14)]);
    expect(texts(map, 'keyword')).toEqual(['t x = "hi"']);
  });

  it('handles a span at offset 0 and a span ending on the last character', () => {
    const pre = el('<pre>abc def</pre>');
    const map = spansToRanges(pre, [span('keyword', 0, 3), span('constant', 4, 7)]);
    expect(texts(map, 'keyword')).toEqual(['abc']);
    expect(texts(map, 'constant')).toEqual(['def']);
  });

  it('keeps adjacent spans that share a boundary from overlapping or dropping text', () => {
    const pre = el('<pre>aabb</pre>');
    const map = spansToRanges(pre, [span('comment', 0, 2), span('keyword', 2, 4)]);
    expect(texts(map, 'comment')).toEqual(['aa']);
    expect(texts(map, 'keyword')).toEqual(['bb']);
    expect(allText(map).join('')).toBe('aabb');
  });

  it('excludes plain spans from the result', () => {
    const pre = el('<pre>plain words</pre>');
    const map = spansToRanges(pre, [span('plain', 0, 5), span('keyword', 6, 11)]);
    expect(map.size).toBe(1);
    expect(texts(map, 'keyword')).toEqual(['words']);
    expect(map.has('plain' as unknown as PaintedClass)).toBe(false);
  });

  it('groups spans of the same class into one array and omits untouched classes', () => {
    const pre = el('<pre>aa bb cc</pre>');
    const map = spansToRanges(pre, [span('keyword', 0, 2), span('comment', 3, 5), span('keyword', 6, 8)]);
    expect(map.size).toBe(2);
    expect(texts(map, 'keyword')).toEqual(['aa', 'cc']);
    expect(texts(map, 'comment')).toEqual(['bb']);
    for (const absent of ['string', 'number', 'type', 'function', 'constant', 'operator'] as const) {
      expect(map.has(absent)).toBe(false);
    }
  });

  it('resolves offsets through deeply nested markup', () => {
    const pre = el('<pre><span><span>a</span>b</span>c</pre>');
    expect(pre.textContent).toBe('abc');
    const map = spansToRanges(pre, [span('keyword', 0, 2), span('comment', 1, 3)]);
    expect(texts(map, 'keyword')).toEqual(['ab']);
    expect(texts(map, 'comment')).toEqual(['bc']);
  });

  it('clamps an end past the end of the text down to the text length', () => {
    const pre = el('<pre>hello world</pre>');
    const map = spansToRanges(pre, [span('keyword', 2, 9999)]);
    expect(texts(map, 'keyword')).toEqual(['llo world']);
    expect(map.get('keyword')?.length).toBe(1);
  });

  it('drops a span whose start is negative instead of clamping it to 0', () => {
    const pre = el('<pre>hello world</pre>');
    const map = spansToRanges(pre, [span('keyword', -5, 3)]);
    expect(texts(map, 'keyword')).toEqual([]);
    expect(map.has('keyword')).toBe(false);
  });

  it('drops a span that starts exactly at, or past, the end of the text', () => {
    const pre = el('<pre>hello world</pre>');
    const map = spansToRanges(pre, [span('keyword', 11, 12), span('comment', 20, 25)]);
    expect(texts(map, 'keyword')).toEqual([]);
    expect(texts(map, 'comment')).toEqual([]);
    expect(map.size).toBe(0);
  });

  it('distinguishes a dropped span from a clamped one in the same call', () => {
    const pre = el('<pre>hello world</pre>');
    const map = spansToRanges(pre, [span('keyword', -5, 3), span('comment', 6, 9999)]);
    expect(texts(map, 'keyword')).toEqual([]);
    expect(texts(map, 'comment')).toEqual(['world']);
    expect(map.size).toBe(1);
  });

  it('drops spans whose end is not after their start', () => {
    const pre = el('<pre>hello world</pre>');
    const map = spansToRanges(pre, [
      span('keyword', 5, 5),
      span('comment', 8, 3),
      span('string', -3, -1),
      span('number', 0, -1),
    ]);
    expect(texts(map, 'keyword')).toEqual([]);
    expect(texts(map, 'comment')).toEqual([]);
    expect(texts(map, 'string')).toEqual([]);
    expect(texts(map, 'number')).toEqual([]);
    expect(map.size).toBe(0);
  });

  it('returns an empty map for an empty element', () => {
    const pre = el('<pre></pre>');
    expect(spansToRanges(pre, []).size).toBe(0);
    expect(spansToRanges(pre, [span('keyword', 0, 1)]).size).toBe(0);
  });

  it('maps a span over a whitespace-only text node', () => {
    const pre = el('<pre>   </pre>');
    expect(texts(spansToRanges(pre, [span('keyword', 0, 3)]), 'keyword')).toEqual(['   ']);
  });

  it('does not throw on spans covering a single space', () => {
    const pre = el('<pre>a b</pre>');
    const map = spansToRanges(pre, [span('keyword', 1, 2)]);
    expect(texts(map, 'keyword')).toEqual([' ']);
  });

  it('leaves the DOM untouched', () => {
    const pre = el('<pre>const <span>x</span> = 42;</pre>');
    const before = pre.innerHTML;
    spansToRanges(pre, [span('keyword', 0, 5), span('number', 16, 18)]);
    expect(pre.innerHTML).toBe(before);
    expect(pre.textContent).toBe('const x = 42;');
  });

  it('returns ranges that live inside the element', () => {
    const pre = el('<pre>const x = 42;</pre>');
    const ranges = spansToRanges(pre, [span('keyword', 0, 5)]).get('keyword');
    expect(ranges?.map((r) => r.toString())).toEqual(['const']);
    for (const range of ranges ?? []) {
      expect(pre.contains(range.startContainer)).toBe(true);
      expect(pre.contains(range.endContainer)).toBe(true);
    }
  });
});
