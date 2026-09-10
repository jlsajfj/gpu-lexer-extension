import { extractCode, findBlocks, isEligible } from './detect.js';
import { isHighlightApiSupported, paint, unpaint, unpaintAll } from './painter.js';
import { spansToRanges } from './ranges.js';
import type { HighlightRequest, ParseFailure, ParseResult } from '../shared/protocol.js';
import type { SyntaxSpan } from '../shared/types.js';
import {
  isHostDisabled,
  loadSettings,
  normalizeSettings,
  SETTINGS_KEY,
  type Settings,
} from '../shared/settings.js';

const ROOT_MARGIN = '400px';
const SCAN_DEBOUNCE_MS = 200;
const RETRY_MS = 250;
const MUTATION_OPTIONS: MutationObserverInit = { childList: true, subtree: true, characterData: true };
const FAILURE_REASONS: ReadonlySet<string> = new Set<string>(['no-webgpu', 'parse-failed', 'unavailable']);

let settings: Settings | null = null;
let running = false;
let dead = false;
let warned = false;
let scanTimer: number | null = null;
let io: IntersectionObserver | null = null;
let mo: MutationObserver | null = null;
let processed = new WeakMap<Element, string>();
let shadowRoots = new WeakSet<ShadowRoot>();
const inFlight = new WeakSet<Element>();

function active(): boolean {
  return settings !== null && settings.enabled && !isHostDisabled(settings, location.hostname);
}

function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  console.debug('[gpu-lexer]', message);
}

function syncTheme(): void {
  const root = document.documentElement;
  if (!root || !settings) return;
  if (active() && settings.theme !== 'auto') root.dataset.gpuLexerTheme = settings.theme;
  else delete root.dataset.gpuLexerTheme;
}

function forEachBlock(visit: (el: HTMLElement) => void): void {
  const roots: ParentNode[] = [document];
  const observer = mo;
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i]!;
    for (const el of findBlocks(root)) visit(el);
    for (const host of root.querySelectorAll('*')) {
      const shadow = host.shadowRoot;
      if (!shadow) continue;
      roots.push(shadow);
      if (shadowRoots.has(shadow)) continue;
      shadowRoots.add(shadow);
      observer?.observe(shadow, MUTATION_OPTIONS);
    }
  }
}

function scan(): void {
  const current = settings;
  if (dead || !running || !current) return;
  forEachBlock((el) => {
    const paintedText = processed.get(el);
    if (paintedText === undefined) {
      if (isEligible(el, current)) io?.observe(el);
      return;
    }
    if (paintedText !== extractCode(el)) void processBlock(el);
  });
}

function scheduleScan(): void {
  if (dead || !running || scanTimer !== null) return;
  scanTimer = window.setTimeout(() => {
    scanTimer = null;
    scan();
  }, SCAN_DEBOUNCE_MS);
}

function start(): void {
  if (dead || running || !settings || !document.documentElement) return;
  running = true;
  io = new IntersectionObserver(onIntersect, { rootMargin: ROOT_MARGIN });
  mo = new MutationObserver(scheduleScan);
  // No `attributes`, so our own data-gpu-lexer-theme write cannot re-enter the scan.
  mo.observe(document.documentElement, MUTATION_OPTIONS);
  scan();
}

function stop(): void {
  running = false;
  io?.disconnect();
  mo?.disconnect();
  io = null;
  mo = null;
  if (scanTimer !== null) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }
  unpaintAll();
  processed = new WeakMap<Element, string>();
  shadowRoots = new WeakSet<ShadowRoot>();
}

function shutdown(): void {
  if (dead) return;
  dead = true;
  stop();
  try {
    chrome.storage.onChanged.removeListener(onSettingsChanged);
  } catch {
    // the extension context is already gone
  }
}

function onIntersect(entries: IntersectionObserverEntry[]): void {
  const visible: Element[] = [];
  for (const entry of entries) {
    if (entry.isIntersecting) visible.push(entry.target);
  }
  if (visible.length === 0) return;
  void Promise.all(visible.map((el) => processBlock(el)));
}

async function processBlock(el: Element): Promise<void> {
  const current = settings;
  if (dead || !running || !current || !active() || inFlight.has(el)) return;
  if (!isEligible(el, current)) {
    if (processed.has(el)) {
      unpaint(el);
      processed.delete(el);
    }
    return;
  }
  const code = extractCode(el);
  if (code.length === 0 || processed.get(el) === code) return;

  inFlight.add(el);
  try {
    const result = await requestSpans(code);
    if (!result) return;
    if (!result.ok) {
      if (result.reason === 'no-webgpu') {
        warnOnce('WebGPU is unavailable, highlighting is off for this page');
        shutdown();
      } else {
        warnOnce(result.message);
      }
      return;
    }
    if (dead || !running) return;
    // The block changed while the parse was in flight: the ranges would land on stale offsets.
    if (extractCode(el) !== code) {
      scheduleScan();
      return;
    }
    paint(el, spansToRanges(el, result.spans));
    processed.set(el, code);
  } finally {
    inFlight.delete(el);
  }
}

async function requestSpans(code: string): Promise<ParseResult | null> {
  const message: HighlightRequest = { kind: 'highlight', code };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response: unknown = await chrome.runtime.sendMessage<HighlightRequest, unknown>(message);
      if (response === undefined) throw new Error('no response from the service worker');
      return asParseResult(response);
    } catch (error) {
      if (isContextInvalidated(error)) {
        shutdown();
        return null;
      }
      if (attempt === 1) return null;
      await delay(RETRY_MS);
    }
  }
  return null;
}

function isContextInvalidated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Extension context invalidated');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSyntaxSpan(value: unknown): value is SyntaxSpan {
  if (!isRecord(value)) return false;
  return (
    typeof value['type'] === 'string' &&
    typeof value['start'] === 'number' &&
    typeof value['end'] === 'number'
  );
}

function asParseResult(value: unknown): ParseResult | null {
  if (!isRecord(value)) return null;
  if (value['ok'] === true) {
    const spans = value['spans'];
    return Array.isArray(spans) ? { ok: true, spans: spans.filter(isSyntaxSpan) } : null;
  }
  if (value['ok'] !== false) return null;
  const reason = value['reason'];
  const message = value['message'];
  if (typeof reason !== 'string' || !FAILURE_REASONS.has(reason)) return null;
  if (typeof message !== 'string') return null;
  return { ok: false, reason: reason as ParseFailure, message };
}

function needsRepaint(before: Settings, after: Settings): boolean {
  return (
    before.enabled !== after.enabled ||
    before.inlineCode !== after.inlineCode ||
    before.minLength !== after.minLength ||
    before.maxLength !== after.maxLength ||
    before.disabledHosts.join('\n') !== after.disabledHosts.join('\n')
  );
}

function onSettingsChanged(changes: Record<string, chrome.storage.StorageChange>): void {
  const change = changes[SETTINGS_KEY];
  const before = settings;
  if (!change || !before || dead) return;
  settings = normalizeSettings(change.newValue);
  syncTheme();
  if (!needsRepaint(before, settings)) return;
  stop();
  if (active()) start();
}

async function main(): Promise<void> {
  if (!isHighlightApiSupported()) return;
  if (typeof chrome === 'undefined' || !chrome.runtime) return;
  settings = await loadSettings();
  chrome.storage.onChanged.addListener(onSettingsChanged);
  syncTheme();
  if (active()) start();
}

void main().catch(() => {
  // a failed bootstrap stays silent: this runs on every page the user visits
});
