import { describe, expect, it } from 'vitest';
import { SpanCache } from '../src/offscreen/cache.js';
import type { SyntaxSpan } from '../src/shared/types.js';

const SPANS: SyntaxSpan[] = [{ type: 'keyword', start: 0, end: 5 }];

function code(index: number, length: number): string {
  const prefix = `c${String(index).padStart(5, '0')}`;
  if (length < prefix.length) throw new Error(`length ${String(length)} is shorter than the prefix`);
  return prefix + 'x'.repeat(length - prefix.length);
}

function fill(cache: SpanCache, count: number, length: number): void {
  for (let i = 0; i < count; i++) cache.set(code(i, length), SPANS);
}

describe('SpanCache', () => {
  it('returns a stored entry and undefined for a miss', () => {
    const cache = new SpanCache({ maxEntries: 10, maxChars: 1000 });
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
    expect(cache.chars).toBe(0);
    cache.set('a', SPANS);
    expect(cache.get('a')).toEqual(SPANS);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.size).toBe(1);
    expect(cache.chars).toBe(1);
  });

  it('evicts oldest-first and settles at exactly maxEntries over 600 inserts of 200 characters', () => {
    const cache = new SpanCache({ maxEntries: 500, maxChars: 5_000_000 });
    fill(cache, 600, 200);
    expect(cache.size).toBe(500);
    expect(cache.chars).toBe(100_000);
    expect(cache.get(code(99, 200))).toBeUndefined();
    expect(cache.get(code(100, 200))).toEqual(SPANS);
    expect(cache.get(code(599, 200))).toEqual(SPANS);
  });

  // 60_003-char keys: the exact totals below hold only at this key length
  it('settles at 83 entries and 4,980,249 chars over 200 inserts of 60,003 characters', () => {
    const cache = new SpanCache({ maxEntries: 500, maxChars: 5_000_000 });
    fill(cache, 200, 60_003);
    expect(cache.size).toBe(83);
    expect(cache.chars).toBe(4_980_249);
    expect(cache.chars).toBeLessThanOrEqual(5_000_000);
    expect(cache.get(code(116, 60_003))).toBeUndefined();
    expect(cache.get(code(117, 60_003))).toEqual(SPANS);
    expect(cache.get(code(199, 60_003))).toEqual(SPANS);
  });

  it('a get refreshes recency and saves the oldest entry from the next eviction', () => {
    const cache = new SpanCache({ maxEntries: 3, maxChars: 10_000 });
    cache.set('a', SPANS);
    cache.set('b', SPANS);
    cache.set('c', SPANS);
    expect(cache.get('a')).toEqual(SPANS);
    cache.set('d', SPANS);
    expect(cache.size).toBe(3);
    expect(cache.get('a')).toEqual(SPANS);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toEqual(SPANS);
    expect(cache.get('d')).toEqual(SPANS);
  });

  it('keeps a single entry larger than maxChars, then evicts it on the next insert', () => {
    const cache = new SpanCache({ maxEntries: 500, maxChars: 100 });
    const big = code(0, 1000);
    cache.set(big, SPANS);
    expect(cache.size).toBe(1);
    expect(cache.chars).toBe(1000);
    expect(cache.get(big)).toEqual(SPANS);
    cache.set('small', SPANS);
    expect(cache.get(big)).toBeUndefined();
    expect(cache.get('small')).toEqual(SPANS);
    expect(cache.size).toBe(1);
    expect(cache.chars).toBe(5);
  });

  it('keeps chars exact across insert, overwrite, hit and eviction', () => {
    const cache = new SpanCache({ maxEntries: 2, maxChars: 1000 });
    expect(cache.chars).toBe(0);
    cache.set('aa', SPANS);
    expect(cache.chars).toBe(2);
    cache.set('bbb', SPANS);
    expect(cache.chars).toBe(5);
    expect(cache.get('aa')).toEqual(SPANS);
    expect(cache.chars).toBe(5);
    cache.set('aa', [{ type: 'comment', start: 1, end: 2 }]);
    expect(cache.chars).toBe(5);
    expect(cache.get('aa')).toEqual([{ type: 'comment', start: 1, end: 2 }]);
    cache.set('cccc', SPANS);
    expect(cache.size).toBe(2);
    expect(cache.chars).toBe(6);
    expect(cache.get('bbb')).toBeUndefined();
  });

  it('does not evict an entry sitting exactly on the char bound', () => {
    const cache = new SpanCache({ maxEntries: 10, maxChars: 5 });
    cache.set('abcde', SPANS);
    expect(cache.size).toBe(1);
    expect(cache.chars).toBe(5);
    expect(cache.get('abcde')).toEqual(SPANS);
  });

  it('terminates with maxEntries: 1', () => {
    const cache = new SpanCache({ maxEntries: 1, maxChars: 1000 });
    for (let i = 0; i < 50; i++) cache.set(code(i, 7), SPANS);
    expect(cache.size).toBe(1);
    expect(cache.chars).toBe(7);
    expect(cache.get(code(48, 7))).toBeUndefined();
    expect(cache.get(code(49, 7))).toEqual(SPANS);
  });

  it('terminates when maxChars is zero', () => {
    const cache = new SpanCache({ maxEntries: 10, maxChars: 0 });
    for (let i = 0; i < 50; i++) cache.set(code(i, 7), SPANS);
    expect(cache.size).toBe(1);
    expect(cache.get(code(49, 7))).toEqual(SPANS);
  });

  it('terminates when every entry overflows both bounds', () => {
    const cache = new SpanCache({ maxEntries: 1, maxChars: 1 });
    for (let i = 0; i < 1000; i++) cache.set(code(i, 50), SPANS);
    expect(cache.size).toBe(1);
    expect(cache.chars).toBe(50);
    expect(cache.get(code(999, 50))).toEqual(SPANS);
  });

  it('handles an empty-string key without spinning', () => {
    const cache = new SpanCache({ maxEntries: 1, maxChars: 0 });
    cache.set('', SPANS);
    expect(cache.size).toBe(1);
    expect(cache.chars).toBe(0);
    expect(cache.get('')).toEqual(SPANS);
    cache.set('a', SPANS);
    expect(cache.size).toBe(1);
    expect(cache.chars).toBe(1);
    expect(cache.get('')).toBeUndefined();
    expect(cache.get('a')).toEqual(SPANS);
  });
});
