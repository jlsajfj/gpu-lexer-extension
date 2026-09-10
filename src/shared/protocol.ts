import type { SyntaxSpan } from './types.js';

export const OFFSCREEN_TARGET = 'gpu-lexer-offscreen';

/** content script -> service worker */
export interface HighlightRequest { kind: 'highlight'; code: string }

/** service worker -> offscreen document */
export interface ParseRequest { target: typeof OFFSCREEN_TARGET; kind: 'parse'; code: string }

export type ParseFailure = 'no-webgpu' | 'parse-failed' | 'unavailable';

export type ParseResult =
  | { ok: true; spans: SyntaxSpan[] }
  | { ok: false; reason: ParseFailure; message: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isHighlightRequest(m: unknown): m is HighlightRequest {
  if (!isRecord(m)) return false;
  if (m['kind'] !== 'highlight') return false;
  return typeof m['code'] === 'string';
}

export function isParseRequest(m: unknown): m is ParseRequest {
  if (!isRecord(m)) return false;
  if (m['kind'] !== 'parse') return false;
  if (m['target'] !== OFFSCREEN_TARGET) return false;
  return typeof m['code'] === 'string';
}
