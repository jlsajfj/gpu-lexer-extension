import { parse } from 'gpu-lexer';
import type { SyntaxSpan } from '../shared/types.js';
import { isParseRequest, type ParseRequest, type ParseResult } from '../shared/protocol.js';

const MAX_ENTRIES = 500;
const MAX_CHARS = 5_000_000;

const cache = new Map<string, SyntaxSpan[]>();
const inflight = new Map<string, Promise<SyntaxSpan[]>>();
let cachedChars = 0;
let latchedGpuFailure: string | null = null;

function remember(code: string, spans: SyntaxSpan[]): void {
  const previous = cache.get(code);
  if (previous !== undefined) {
    cache.delete(code);
    cachedChars -= code.length;
  }
  cache.set(code, spans);
  cachedChars += code.length;
  // The size > 1 guard keeps a single oversized entry instead of evicting what was just cached
  while ((cache.size > MAX_ENTRIES || cachedChars > MAX_CHARS) && cache.size > 1) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
    cachedChars -= oldest.length;
  }
}

function gpuFailureReason(): string | null {
  if (latchedGpuFailure !== null) return latchedGpuFailure;
  const gpu = (navigator as unknown as { gpu?: unknown }).gpu;
  if (gpu === undefined || gpu === null) {
    latchedGpuFailure = 'WebGPU unavailable: navigator.gpu is undefined';
  }
  return latchedGpuFailure;
}

function parseOnce(code: string): Promise<SyntaxSpan[]> {
  const existing = inflight.get(code);
  if (existing !== undefined) return existing;
  const pending = parse(code)
    .then((spans) => {
      remember(code, spans);
      return spans;
    })
    .finally(() => {
      inflight.delete(code);
    });
  inflight.set(code, pending);
  return pending;
}

function toFailure(error: unknown): ParseResult {
  const message = error instanceof Error ? error.message : String(error);
  if (latchedGpuFailure !== null || /webgpu unavailable/i.test(message)) {
    latchedGpuFailure = message.length > 0 ? message : 'WebGPU unavailable';
    return { ok: false, reason: 'no-webgpu', message: latchedGpuFailure };
  }
  return { ok: false, reason: 'parse-failed', message };
}

async function handle(request: ParseRequest): Promise<ParseResult> {
  const gpuFailure = gpuFailureReason();
  if (gpuFailure !== null) return { ok: false, reason: 'no-webgpu', message: gpuFailure };

  const cached = cache.get(request.code);
  if (cached !== undefined) {
    remember(request.code, cached);
    return { ok: true, spans: cached };
  }

  try {
    return { ok: true, spans: await parseOnce(request.code) };
  } catch (error) {
    return toFailure(error);
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isParseRequest(message)) return false;
  handle(message).then(sendResponse, (error: unknown) => {
    sendResponse(toFailure(error));
  });
  return true;
});
