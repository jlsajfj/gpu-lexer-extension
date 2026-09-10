import {
  OFFSCREEN_TARGET,
  isHighlightRequest,
  type ParseRequest,
  type ParseResult,
} from '../shared/protocol.js';

let creating: Promise<void> | null = null;

function targetsOffscreen(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) return false;
  return (message as Record<string, unknown>)['target'] === OFFSCREEN_TARGET;
}

function isParseResult(value: unknown): value is ParseResult {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['ok'] === true) return Array.isArray(record['spans']);
  return record['ok'] === false && typeof record['reason'] === 'string';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function alreadyExists(error: unknown): boolean {
  return /single offscreen document|already exists/i.test(errorMessage(error));
}

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  return contexts.length > 0;
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
  if (await hasOffscreenDocument()) return;
  // Shared across concurrent callers; cleared so a later request re-derives it after a SW restart
  if (creating === null) {
    creating = createOffscreenDocument().finally(() => {
      creating = null;
    });
  }
  await creating;
}

async function highlight(code: string): Promise<ParseResult> {
  try {
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
    return response;
  } catch (error) {
    return { ok: false, reason: 'unavailable', message: errorMessage(error) };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
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
