import { parse } from 'gpu-lexer';
import type { SyntaxSpan } from '../shared/types.js';
import { isParseRequest, type ParseRequest, type ParseResult } from '../shared/protocol.js';
import { SpanCache } from './cache.js';

const cache = new SpanCache({ maxEntries: 500, maxChars: 5_000_000 });
const inflight = new Map<string, Promise<SyntaxSpan[]>>();
let latchedGpuFailure: string | null = null;

type GpuNavigator = { requestAdapter(): Promise<unknown> };

function navigatorGpu(): GpuNavigator | undefined {
  const gpu = (navigator as unknown as { gpu?: GpuNavigator | null }).gpu;
  return gpu ?? undefined;
}

function latchGpuFailure(message: string): string {
  latchedGpuFailure ??= message;
  return latchedGpuFailure;
}

function gpuFailureReason(): string | null {
  if (navigatorGpu() === undefined) {
    return latchGpuFailure('WebGPU unavailable: navigator.gpu is undefined');
  }
  return latchedGpuFailure;
}

// Started at load so a null adapter is classified before the first parse
const adapterProbe: Promise<void> = (async () => {
  const gpu = navigatorGpu();
  if (gpu === undefined) {
    latchGpuFailure('WebGPU unavailable: navigator.gpu is undefined');
    return;
  }
  try {
    if ((await gpu.requestAdapter()) === null) latchGpuFailure('WebGPU unavailable: no adapter');
  } catch {
    // a probe rejection is not proof that WebGPU is missing; parse() reports its own failure
  }
})();

function parseOnce(code: string): Promise<SyntaxSpan[]> {
  const existing = inflight.get(code);
  if (existing !== undefined) return existing;
  const pending = parse(code)
    .then((spans) => {
      cache.set(code, spans);
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
    return {
      ok: false,
      reason: 'no-webgpu',
      message: latchGpuFailure(message.length > 0 ? message : 'WebGPU unavailable'),
    };
  }
  return { ok: false, reason: 'parse-failed', message };
}

async function handle(request: ParseRequest): Promise<ParseResult> {
  await adapterProbe;
  const gpuFailure = gpuFailureReason();
  if (gpuFailure !== null) return { ok: false, reason: 'no-webgpu', message: gpuFailure };

  const cached = cache.get(request.code);
  if (cached !== undefined) return { ok: true, spans: cached };

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
