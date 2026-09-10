import {
  OFFSCREEN_TARGET,
  isHighlightRequest,
  isParseResult,
  type ParseRequest,
  type ParseResult,
} from '../shared/protocol.js';

const NO_WEBGPU_KEY = 'noWebgpuAt';
const NO_WEBGPU_COOLDOWN_MS = 10 * 60_000;

let creating: Promise<void> | null = null;
let documentExists: boolean | null = null;
let noWebgpuUntil: number | null = null;

function targetsOffscreen(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) return false;
  return (message as Record<string, unknown>)['target'] === OFFSCREEN_TARGET;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function alreadyExists(error: unknown): boolean {
  return /single offscreen document|already exists/i.test(errorMessage(error));
}

async function documentIsOpen(): Promise<boolean> {
  if (documentExists === null) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    documentExists = contexts.length > 0;
  }
  return documentExists;
}

async function createOffscreenDocument(): Promise<void> {
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification:
        'Runs the WebGPU syntax highlighting model past the 30 second service worker lifetime.',
    });
  } catch (error) {
    if (alreadyExists(error)) return;
    throw error;
  }
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await documentIsOpen()) return;
  // Shared across concurrent callers; cleared so a later request re-derives it after a SW restart
  if (creating === null) {
    creating = createOffscreenDocument()
      .then(() => {
        documentExists = true;
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}

async function webgpuBlocked(): Promise<boolean> {
  if (noWebgpuUntil === null) {
    try {
      const stored = await chrome.storage.session.get(NO_WEBGPU_KEY);
      const at = stored[NO_WEBGPU_KEY];
      noWebgpuUntil = typeof at === 'number' ? at + NO_WEBGPU_COOLDOWN_MS : 0;
    } catch {
      noWebgpuUntil = 0;
    }
  }
  return noWebgpuUntil > Date.now();
}

async function recycleOffscreenDocument(): Promise<void> {
  documentExists = null;
  noWebgpuUntil = Date.now() + NO_WEBGPU_COOLDOWN_MS;
  try {
    await chrome.offscreen.closeDocument();
  } catch {}
  try {
    await chrome.storage.session.set({ [NO_WEBGPU_KEY]: Date.now() });
  } catch {}
}

async function highlight(code: string): Promise<ParseResult> {
  try {
    if (await webgpuBlocked()) {
      return {
        ok: false,
        reason: 'no-webgpu',
        message: 'WebGPU is unavailable, so highlighting is paused.',
      };
    }
    await ensureOffscreenDocument();
    const request: ParseRequest = { target: OFFSCREEN_TARGET, kind: 'parse', code };
    const response: unknown = await chrome.runtime.sendMessage(request);
    if (!isParseResult(response)) {
      return {
        ok: false,
        reason: 'unavailable',
        message: 'offscreen document returned an unexpected response',
      };
    }
    // The offscreen document latches the failure and gpu-lexer memoizes its device promise
    if (!response.ok && response.reason === 'no-webgpu') await recycleOffscreenDocument();
    return response;
  } catch (error) {
    // A failed send can mean the offscreen document is gone: re-derive it next time
    documentExists = null;
    return { ok: false, reason: 'unavailable', message: errorMessage(error) };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  // Our own broadcast sendMessage is delivered back to this listener; never answer it here
  if (targetsOffscreen(message)) return false;
  if (!isHighlightRequest(message)) return false;
  highlight(message.code).then(sendResponse, (error: unknown) => {
    sendResponse({
      ok: false,
      reason: 'unavailable',
      message: errorMessage(error),
    } satisfies ParseResult);
  });
  return true;
});
