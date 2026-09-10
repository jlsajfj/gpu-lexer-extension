import { SYNTAX_CLASSES, type SyntaxSpan } from './types.js';

export const OFFSCREEN_TARGET = 'gpu-lexer-offscreen';

/** content script -> service worker */
export interface HighlightRequest { kind: 'highlight'; code: string }

/** service worker -> offscreen document */
export interface ParseRequest { target: typeof OFFSCREEN_TARGET; kind: 'parse'; code: string }

export const PARSE_FAILURES = ['no-webgpu', 'parse-failed', 'unavailable'] as const;

export type ParseFailure = (typeof PARSE_FAILURES)[number];

export type ParseResult =
  | { ok: true; spans: SyntaxSpan[] }
  | { ok: false; reason: ParseFailure; message: string };

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isCharIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

export function isSyntaxSpan(v: unknown): v is SyntaxSpan {
  if (!isRecord(v)) return false;
  return (
    SYNTAX_CLASSES.some((name) => name === v['type']) &&
    isCharIndex(v['start']) &&
    isCharIndex(v['end'])
  );
}

export function isParseResult(v: unknown): v is ParseResult {
  if (!isRecord(v)) return false;
  if (v['ok'] === true) {
    const spans = v['spans'];
    return Array.isArray(spans) && spans.every(isSyntaxSpan);
  }
  if (v['ok'] !== false) return false;
  if (!PARSE_FAILURES.some((reason) => reason === v['reason'])) return false;
  return typeof v['message'] === 'string';
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
