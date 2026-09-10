import { extractCode, findBlocks, isEligible } from './detect.js';
import { isHighlightApiSupported, isPaintLive, paint, unpaint, unpaintAll } from './painter.js';
import { spansToRanges } from './ranges.js';
import { isParseResult } from '../shared/protocol.js';
import type { HighlightRequest, ParseResult } from '../shared/protocol.js';
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
const MAX_IN_FLIGHT = 8;
const CHARS_PER_INTERVAL_UNIT = 5000;
const MUTATION_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
};

type Phase = 'idle' | 'running' | 'dead';

interface Session {
  settings: Settings | null;
  io: IntersectionObserver | null;
  mo: MutationObserver | null;
  scanTimer: number | null;
  scanDueAt: number;
  processed: WeakMap<Element, string>;
  tracked: Set<Element>;
  queue: Set<Element>;
  inFlight: Set<Element>;
  lastParseAt: WeakMap<Element, number>;
  visible: WeakSet<Element>;
  shadowRoots: WeakSet<ShadowRoot>;
  pending: Set<ParentNode> | null;
  fullScan: boolean;
  warned: Set<string>;
}

function newSession(settings: Settings | null): Session {
  return {
    settings,
    io: null,
    mo: null,
    scanTimer: null,
    scanDueAt: 0,
    processed: new WeakMap(),
    tracked: new Set(),
    queue: new Set(),
    inFlight: new Set(),
    lastParseAt: new WeakMap(),
    visible: new WeakSet(),
    shadowRoots: new WeakSet(),
    pending: null,
    fullScan: false,
    warned: new Set(),
  };
}

let state: Phase = 'idle';
let session = newSession(null);
let resizeArmed = false;

function active(): boolean {
  const s = session.settings;
  return s !== null && s.enabled && !isHostDisabled(s, location.hostname);
}

function warnOnce(reason: string, message: string): void {
  if (session.warned.has(reason)) return;
  session.warned.add(reason);
  console.debug('[gpu-lexer]', message);
}

function syncTheme(): void {
  const root = document.documentElement;
  const s = session.settings;
  if (!root || !s) return;
  if (active() && s.theme !== 'auto') root.dataset.gpuLexerTheme = s.theme;
  else delete root.dataset.gpuLexerTheme;
}

function hasFrameArea(): boolean {
  return window.innerWidth > 0 && window.innerHeight > 0;
}

function armResize(): void {
  if (resizeArmed) return;
  resizeArmed = true;
  window.addEventListener('resize', onResize);
}

function disarmResize(): void {
  if (!resizeArmed) return;
  resizeArmed = false;
  window.removeEventListener('resize', onResize);
}

function onResize(): void {
  if (!hasFrameArea()) return;
  disarmResize();
  begin();
}

function begin(): void {
  if (state !== 'idle' || !active()) return;
  if (!hasFrameArea()) {
    armResize();
    return;
  }
  start();
}

function start(): void {
  if (state !== 'idle' || !session.settings || !document.documentElement) return;
  disarmResize();
  state = 'running';
  session.io = new IntersectionObserver(onIntersect, { rootMargin: ROOT_MARGIN });
  session.mo = new MutationObserver((records) => {
    scheduleScan(records);
  });
  // No `attributes`, so our own data-gpu-lexer-theme write cannot re-enter the scan.
  session.mo.observe(document.documentElement, MUTATION_OPTIONS);
  session.fullScan = true;
  scan();
}

function stop(): void {
  const settings = session.settings;
  session.io?.disconnect();
  session.mo?.disconnect();
  if (session.scanTimer !== null) clearTimeout(session.scanTimer);
  unpaintAll();
  session = newSession(settings);
  state = 'idle';
}

function shutdown(): void {
  if (state === 'dead') return;
  stop();
  state = 'dead';
  disarmResize();
  try {
    chrome.storage.onChanged.removeListener(onSettingsChanged);
  } catch {
    // the extension context is already gone
  }
}

function registerShadowRoot(shadow: ShadowRoot): void {
  if (session.shadowRoots.has(shadow)) return;
  session.shadowRoots.add(shadow);
  session.mo?.observe(shadow, MUTATION_OPTIONS);
}

function accumulate(records: readonly MutationRecord[]): void {
  const pending = (session.pending ??= new Set<ParentNode>());
  for (const record of records) {
    if (record.type === 'characterData') {
      const parent = record.target.parentElement;
      if (parent) pending.add(parent);
      continue;
    }
    if (record.target instanceof Element || record.target instanceof ShadowRoot) {
      pending.add(record.target);
    }
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      pending.add(node);
      for (const host of [node, ...node.querySelectorAll('*')]) {
        const shadow = host.shadowRoot;
        if (!shadow) continue;
        pending.add(shadow);
        registerShadowRoot(shadow);
      }
    }
  }
}

function scheduleScan(records?: readonly MutationRecord[], delayMs = SCAN_DEBOUNCE_MS): void {
  if (state !== 'running') return;
  if (records) accumulate(records);
  const due = performance.now() + delayMs;
  if (session.scanTimer !== null) {
    if (session.scanDueAt <= due) return;
    clearTimeout(session.scanTimer);
  }
  session.scanDueAt = due;
  session.scanTimer = window.setTimeout(() => {
    session.scanTimer = null;
    scan();
  }, delayMs);
}

function sweep(): void {
  for (const el of session.tracked) {
    if (!el.isConnected) drop(el);
  }
}

function drop(el: Element): void {
  const tracked = session.tracked.delete(el);
  if (session.processed.has(el)) unpaint(el);
  session.processed.delete(el);
  session.queue.delete(el);
  if (tracked) session.io?.unobserve(el);
}

function enclosingBlock(el: Element): Element | null {
  let found: Element | null = null;
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.localName === 'pre' || node.localName === 'code') found = node;
  }
  return found;
}

function fullPass(current: Settings): void {
  // No light-DOM candidates: skip the shadow-host sweep, later inserts arrive as mutations.
  if (!document.querySelector('pre, code')) return;
  const roots: ParentNode[] = [document];
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i]!;
    for (const el of findBlocks(root)) consider(el, current);
    for (const host of root.querySelectorAll('*')) {
      const shadow = host.shadowRoot;
      if (!shadow) continue;
      registerShadowRoot(shadow);
      roots.push(shadow);
    }
  }
}

function incrementalPass(pending: Iterable<ParentNode>, current: Settings): void {
  const seen = new Set<Element>();
  const visit = (el: Element): void => {
    if (seen.has(el)) return;
    seen.add(el);
    consider(el, current);
  };
  for (const root of pending) {
    if (root instanceof Element) {
      const block = enclosingBlock(root);
      if (block) visit(block);
    }
    for (const el of findBlocks(root)) visit(el);
  }
}

function scan(): void {
  const current = session.settings;
  if (state !== 'running' || !current) return;
  sweep();
  const pending = session.pending;
  const full = session.fullScan;
  session.pending = null;
  session.fullScan = false;
  if (pending) incrementalPass(pending, current);
  else if (full) fullPass(current);
  drainQueue(current);
}

function remainingWait(el: Element, chars: number): number {
  const at = session.lastParseAt.get(el);
  if (at === undefined) return 0;
  const interval = Math.max(SCAN_DEBOUNCE_MS, (chars / CHARS_PER_INTERVAL_UNIT) * 1000);
  return at + interval - performance.now();
}

function consider(el: Element, current: Settings): void {
  if (state !== 'running') return;
  if (!el.isConnected) {
    drop(el);
    return;
  }
  const code = extractCode(el);
  if (!isEligible(el, code, current)) {
    drop(el);
    return;
  }
  session.io?.observe(el);
  session.tracked.add(el);
  if (!session.visible.has(el)) return;

  if (session.processed.get(el) === code && isPaintLive(el)) return;

  const wait = remainingWait(el, code.length);
  if (wait > 0) {
    session.queue.add(el);
    scheduleScan(undefined, wait);
    return;
  }
  if (session.inFlight.size >= MAX_IN_FLIGHT || session.inFlight.has(el)) {
    session.queue.add(el);
    return;
  }
  startParse(el, code);
}

function drainQueue(current: Settings): void {
  if (session.queue.size === 0) return;
  const batch = [...session.queue];
  session.queue.clear();
  for (const el of batch) {
    if (session.inFlight.size >= MAX_IN_FLIGHT) {
      session.queue.add(el);
      continue;
    }
    consider(el, current);
  }
}

function startParse(el: Element, code: string): void {
  const s = session;
  s.inFlight.add(el);
  s.lastParseAt.set(el, performance.now());
  void processBlock(el, code).finally(() => {
    s.inFlight.delete(el);
    if (s === session && state === 'running' && session.settings) drainQueue(session.settings);
  });
}

function onIntersect(entries: IntersectionObserverEntry[]): void {
  const current = session.settings;
  if (state !== 'running' || !current) return;
  for (const entry of entries) {
    if (entry.isIntersecting) session.visible.add(entry.target);
    else session.visible.delete(entry.target);
  }
  for (const entry of entries) {
    if (entry.isIntersecting) consider(entry.target, current);
  }
  drainQueue(current);
}

async function processBlock(el: Element, code: string): Promise<void> {
  const result = await requestSpans(code);
  if (!result || state !== 'running') return;
  if (!result.ok) {
    if (result.reason === 'no-webgpu') {
      warnOnce('no-webgpu', 'WebGPU is unavailable, highlighting is off for this page');
      shutdown();
    } else {
      warnOnce(result.reason, result.message);
    }
    return;
  }
  // The block changed while the parse was in flight: the ranges would land on stale offsets.
  if (extractCode(el) !== code) {
    session.queue.add(el);
    scheduleScan();
    return;
  }
  paint(el, spansToRanges(el, result.spans));
  session.processed.set(el, code);
  session.tracked.add(el);
}

async function requestSpans(code: string): Promise<ParseResult | null> {
  const message: HighlightRequest = { kind: 'highlight', code };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response: unknown = await chrome.runtime.sendMessage<HighlightRequest, unknown>(message);
      if (response === undefined) throw new Error('no response from the service worker');
      return isParseResult(response) ? response : null;
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
  const before = session.settings;
  if (!change || !before || state === 'dead') return;
  const after = normalizeSettings(change.newValue);
  session.settings = after;
  syncTheme();
  if (!needsRepaint(before, after)) return;
  if (state === 'running') stop();
  begin();
}

async function main(): Promise<void> {
  if (!isHighlightApiSupported()) return;
  if (typeof chrome === 'undefined' || !chrome.runtime) return;
  session.settings = await loadSettings();
  chrome.storage.onChanged.addListener(onSettingsChanged);
  syncTheme();
  begin();
}

void main().catch(() => {
  // a failed bootstrap stays silent: this runs on every page the user visits
});
