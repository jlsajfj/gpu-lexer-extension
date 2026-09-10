import { describe, expect, it } from 'vitest';
import {
  OFFSCREEN_TARGET,
  isHighlightRequest,
  isParseRequest,
  type HighlightRequest,
  type ParseRequest,
} from '../src/shared/protocol.js';

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
