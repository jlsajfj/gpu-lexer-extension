import { describe, expect, it } from 'vitest';
import {
  OFFSCREEN_TARGET,
  PARSE_FAILURES,
  isHighlightRequest,
  isParseRequest,
  isParseResult,
  isSyntaxSpan,
  type HighlightRequest,
  type ParseRequest,
} from '../src/shared/protocol.js';
import { SYNTAX_CLASSES } from '../src/shared/types.js';

const highlight: HighlightRequest = { kind: 'highlight', code: 'const x = 1;' };
const parse: ParseRequest = { target: OFFSCREEN_TARGET, kind: 'parse', code: 'const x = 1;' };

const notObjects: unknown[] = [null, undefined, 'highlight', 42, true, [], () => undefined];

describe('isHighlightRequest', () => {
  it('accepts the valid highlight shape', () => {
    expect(isHighlightRequest(highlight)).toBe(true);
  });

  it('rejects non-objects', () => {
    for (const value of notObjects) expect(isHighlightRequest(value)).toBe(false);
  });

  it('rejects objects that are not shaped like a request', () => {
    expect(isHighlightRequest({})).toBe(false);
    expect(isHighlightRequest({ kind: 'highlight' })).toBe(false);
    expect(isHighlightRequest({ kind: 'highlight', code: 123 })).toBe(false);
    expect(isHighlightRequest({ kind: 'parse', code: 'x' })).toBe(false);
    expect(isHighlightRequest({ kind: 'other', code: 'x' })).toBe(false);
  });

  it('rejects a ParseRequest, so the worker never answers on the offscreen document behalf', () => {
    expect(isHighlightRequest(parse)).toBe(false);
  });
});

describe('isParseRequest', () => {
  it('accepts the valid parse shape', () => {
    expect(isParseRequest(parse)).toBe(true);
  });

  it('rejects non-objects', () => {
    for (const value of notObjects) expect(isParseRequest(value)).toBe(false);
  });

  it('rejects a parse request missing the target discriminator', () => {
    expect(isParseRequest({ kind: 'parse', code: 'x' })).toBe(false);
    expect(isParseRequest({ kind: 'parse', target: 'something-else', code: 'x' })).toBe(false);
  });

  it('rejects objects that are not shaped like a parse request', () => {
    expect(isParseRequest({})).toBe(false);
    expect(isParseRequest({ target: OFFSCREEN_TARGET, kind: 'parse' })).toBe(false);
    expect(isParseRequest({ target: OFFSCREEN_TARGET, kind: 'parse', code: 123 })).toBe(false);
  });

  it('rejects a HighlightRequest, so the offscreen document never handles a page request', () => {
    expect(isParseRequest(highlight)).toBe(false);
  });
});

describe('isSyntaxSpan', () => {
  it('accepts every known syntax class', () => {
    expect(SYNTAX_CLASSES.length).toBeGreaterThan(0);
    for (const type of SYNTAX_CLASSES) {
      expect(isSyntaxSpan({ type, start: 0, end: 1 })).toBe(true);
    }
  });

  it('accepts a zero-width span, since it only checks the type and the offsets', () => {
    expect(isSyntaxSpan({ type: 'keyword', start: 4, end: 4 })).toBe(true);
  });

  it('rejects non-objects', () => {
    for (const value of notObjects) expect(isSyntaxSpan(value)).toBe(false);
  });

  it('rejects types outside the syntax class list', () => {
    expect(isSyntaxSpan({ type: 'nope', start: 0, end: 1 })).toBe(false);
    expect(isSyntaxSpan({ type: 'Keyword', start: 0, end: 1 })).toBe(false);
    expect(isSyntaxSpan({ type: '', start: 0, end: 1 })).toBe(false);
    expect(isSyntaxSpan({ type: 7, start: 0, end: 1 })).toBe(false);
    expect(isSyntaxSpan({ start: 0, end: 1 })).toBe(false);
  });

  it('rejects missing, negative, fractional, NaN and non-numeric offsets', () => {
    const bad: unknown[] = [
      { type: 'keyword', end: 1 },
      { type: 'keyword', start: 0 },
      { type: 'keyword', start: -1, end: 1 },
      { type: 'keyword', start: 0, end: -1 },
      { type: 'keyword', start: 0.5, end: 1 },
      { type: 'keyword', start: 0, end: 1.5 },
      { type: 'keyword', start: Number.NaN, end: 1 },
      { type: 'keyword', start: 0, end: Number.NaN },
      { type: 'keyword', start: Number.POSITIVE_INFINITY, end: 1 },
      { type: 'keyword', start: 0, end: Number.NEGATIVE_INFINITY },
      { type: 'keyword', start: '0', end: 1 },
      { type: 'keyword', start: 0, end: null },
      { type: 'keyword', start: 0, end: true },
    ];
    for (const value of bad) expect(isSyntaxSpan(value)).toBe(false);
  });

  it('accepts a reversed span: it validates offsets, and ranges.ts drops the span', () => {
    expect(isSyntaxSpan({ type: 'keyword', start: 5, end: 2 })).toBe(true);
  });
});

describe('isParseResult', () => {
  it('accepts a successful result, with or without spans', () => {
    expect(isParseResult({ ok: true, spans: [] })).toBe(true);
    expect(isParseResult({ ok: true, spans: [{ type: 'keyword', start: 0, end: 5 }] })).toBe(true);
  });

  it('accepts every failure reason in PARSE_FAILURES when a message is present', () => {
    expect(PARSE_FAILURES.length).toBeGreaterThan(0);
    for (const reason of PARSE_FAILURES) {
      expect(isParseResult({ ok: false, reason, message: 'x' })).toBe(true);
    }
  });

  it('rejects non-objects', () => {
    for (const value of notObjects) expect(isParseResult(value)).toBe(false);
  });

  it('rejects the hostile shapes the stateless worker used to accept', () => {
    const hostile: unknown[] = [
      null,
      'ok',
      {},
      { ok: true },
      { ok: true, spans: [1, 2, 3] },
      { ok: true, spans: [{ type: 'nope', start: 0, end: 1 }] },
      { ok: false, reason: 'banana', message: 'x' },
      { ok: false, reason: 'no-webgpu' },
      { ok: false, reason: 'no-webgpu', message: 7 },
      { ok: true, spans: 'keyword' },
      { ok: 'true', spans: [] },
      { ok: false, spans: [] },
    ];
    for (const value of hostile) expect(isParseResult(value)).toBe(false);
  });

  it('rejects a result carrying a span with a bad offset', () => {
    const badSpans: unknown[] = [
      { type: 'keyword', start: -1, end: 1 },
      { type: 'keyword', start: 0.5, end: 1 },
      { type: 'keyword', start: Number.NaN, end: 3 },
      { type: 'keyword', start: 0, end: Number.POSITIVE_INFINITY },
      { type: 'keyword', start: '0', end: 3 },
      { type: 'keyword', start: 0 },
    ];
    for (const spans of badSpans) expect(isParseResult({ ok: true, spans: [spans] })).toBe(false);
  });

  it('accepts a reversed span for the same reason isSyntaxSpan does; ranges.ts drops it', () => {
    expect(isParseResult({ ok: true, spans: [{ type: 'keyword', start: 5, end: 2 }] })).toBe(true);
  });

  it('rejects one bad span among good ones', () => {
    const spans = [
      { type: 'keyword', start: 0, end: 3 },
      { type: 'nope', start: 0, end: 1 },
    ];
    expect(isParseResult({ ok: true, spans })).toBe(false);
  });
});
