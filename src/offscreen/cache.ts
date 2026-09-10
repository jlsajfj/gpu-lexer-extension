import type { SyntaxSpan } from '../shared/types.js';

export interface SpanCacheOptions { maxEntries: number; maxChars: number }

export class SpanCache {
  readonly #entries = new Map<string, SyntaxSpan[]>();
  readonly #maxEntries: number;
  readonly #maxChars: number;
  #chars = 0;

  constructor(options: SpanCacheOptions) {
    this.#maxEntries = options.maxEntries;
    this.#maxChars = options.maxChars;
  }

  get(code: string): SyntaxSpan[] | undefined {
    const spans = this.#entries.get(code);
    if (spans === undefined) return undefined;
    this.#entries.delete(code);
    this.#entries.set(code, spans);
    return spans;
  }

  set(code: string, spans: SyntaxSpan[]): void {
    if (this.#entries.has(code)) {
      this.#entries.delete(code);
      this.#chars -= code.length;
    }
    this.#entries.set(code, spans);
    this.#chars += code.length;
    // The size > 1 guard keeps a single oversized entry instead of evicting what was just cached
    while ((this.#entries.size > this.#maxEntries || this.#chars > this.#maxChars) && this.#entries.size > 1) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
      this.#chars -= oldest.length;
    }
  }

  get size(): number { return this.#entries.size; }

  get chars(): number { return this.#chars; }
}
