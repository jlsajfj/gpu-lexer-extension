#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(ROOT, 'dist');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'page.html');

const OVERALL_TIMEOUT_MS = 150_000;
const DEVTOOLS_TIMEOUT_MS = 30_000;
const LOAD_TIMEOUT_MS = 25_000;
const OFFSCREEN_TIMEOUT_MS = 25_000;
const PAINT_TIMEOUT_MS = 40_000;
const POLL_MS = 250;

const argv = new Set(process.argv.slice(2));

let browser = null;
let server = null;
let profileDir = null;
let overallTimer = null;
let finished = false;
let failures = 0;
const browserLog = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errorText = (error) => (error instanceof Error ? error.message : String(error));

function record(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : ` - ${detail}`}`);
  if (!ok) failures += 1;
  return ok;
}

async function step(name, fn) {
  try {
    const detail = await fn();
    return record(name, true, detail ?? '');
  } catch (error) {
    return record(name, false, errorText(error));
  }
}

async function shutdown(code) {
  if (finished) return;
  finished = true;
  if (overallTimer !== null) clearTimeout(overallTimer);

  if (browser !== null && browser.exitCode === null && browser.signalCode === null) {
    try {
      process.kill(-browser.pid, 'SIGKILL');
    } catch {
      browser.kill('SIGKILL');
    }
  }
  if (server !== null) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  if (profileDir !== null) await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
  process.exit(code);
}

process.on('SIGINT', () => void shutdown(130));
process.on('SIGTERM', () => void shutdown(143));

function runBuild() {
  console.log('building…');
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`build failed (exit ${String(result.status)})`);
}

async function startFixtureServer() {
  const html = await readFile(FIXTURE, 'utf8');
  server = createServer((req, res) => {
    if (req.url === '/' || req.url?.startsWith('/?')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('fixture server has no port');
  return `http://127.0.0.1:${String(address.port)}/`;
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  const port = address !== null && typeof address !== 'string' ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function launchBrowser(debugPort) {
  const binary = process.env['CHROMIUM_BIN'] ?? 'chromium';
  if (process.env['CHROMIUM_BIN'] === undefined && !existsSync(binary)) {
    throw new Error('chromium not found: set CHROMIUM_BIN or put chromium on PATH');
  }
  profileDir = await mkdtemp(path.join(tmpdir(), 'gpu-lexer-smoke-'));
  const flags = [
    '--headless=new',
    '--no-sandbox',
    '--enable-unsafe-webgpu',
    '--enable-unsafe-swiftshader',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    `--remote-debugging-port=${String(debugPort)}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--window-size=1280,900',
    '--hide-scrollbars',
    'about:blank',
  ];
  browser = spawn(binary, flags, { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const capture = (chunk) => {
    browserLog.push(String(chunk));
    if (browserLog.length > 200) browserLog.shift();
  };
  browser.stdout.on('data', capture);
  browser.stderr.on('data', capture);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('chromium did not start within 15s')), 15_000);
    browser.once('spawn', () => {
      clearTimeout(timer);
      resolve();
    });
    browser.once('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`chromium failed to start: ${error.message}`));
    });
  });
}

const targetsUrl = () => `http://127.0.0.1:${String(debugPort)}/json/list`;

async function listTargets() {
  const response = await fetch(targetsUrl());
  if (!response.ok) throw new Error(`/json/list returned ${String(response.status)}`);
  return await response.json();
}

async function waitFor(what, timeoutMs, fn) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      const reason = lastError === null ? `no match within ${String(timeoutMs)}ms` : errorText(lastError);
      throw new Error(`${what}: ${reason}`);
    }
    await sleep(POLL_MS);
  }
}

async function connect(wsUrl) {
  if (typeof wsUrl !== 'string') throw new Error('target has no webSocketDebuggerUrl');
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error(`cannot open ${wsUrl}`)), { once: true });
  });
  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (typeof message.id !== 'number') return;
    const entry = pending.get(message.id);
    if (entry === undefined) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
    else entry.resolve(message.result);
  });
  return {
    send(method, params = {}, sessionId) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
        const message = { id, method, params };
        if (sessionId !== undefined) message.sessionId = sessionId;
        socket.send(JSON.stringify(message));
      });
    },
    close() {
      socket.close();
    },
  };
}

async function evaluate(client, expression, sessionId) {
  const result = await client.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    const description = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
    throw new Error(`evaluate threw: ${String(description)}`);
  }
  return result.result.value;
}

const GPU_PROBE = `(async () => {
  if (!navigator.gpu) return { gpu: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return { gpu: true, adapter: false };
  let vendor = 'unknown';
  let architecture = 'unknown';
  try {
    vendor = adapter.info?.vendor ?? vendor;
    architecture = adapter.info?.architecture ?? architecture;
  } catch {}
  return { gpu: true, adapter: true, vendor, architecture };
})()`;

const HIGHLIGHT_KEYS = `(() => {
  if (typeof CSS === 'undefined' || !CSS.highlights) return null;
  return {
    size: CSS.highlights.size,
    keys: [...CSS.highlights.keys()].filter((k) => String(k).startsWith('gpu-lexer-')),
  };
})()`;

const MUTATION_TIMEOUT_MS = 20_000;

const MUTATION_TEXT_A = `const doubled = values.map(function (value) { return value * 2; });
console.log(doubled.length);
`;

const MUTATION_TEXT_B = `let running = 0;
for (const value of values) { running = running + value * 3; }
console.log(running);
`;

const SIGNATURE_FN = `window.__smokeSignature = (id) => {
  const el = document.getElementById(id);
  if (el === null) return null;
  const out = [];
  for (const [name, highlight] of CSS.highlights) {
    if (!String(name).startsWith('gpu-lexer-')) continue;
    for (const range of highlight) {
      if (el.contains(range.startContainer) && el.contains(range.endContainer)) {
        out.push(String(name) + ':' + range.toString());
      }
    }
  }
  return out.sort();
};`;

const MUTATION_INJECT = `(() => {
  ${SIGNATURE_FN}
  const add = (id, text) => {
    const pre = document.createElement('pre');
    pre.id = id;
    pre.textContent = text;
    document.body.insertBefore(pre, document.body.firstChild);
  };
  add('smoke-subject', ${JSON.stringify(MUTATION_TEXT_A)});
  add('smoke-control', ${JSON.stringify(MUTATION_TEXT_B)});
  return true;
})()`;

const MUTATION_EDIT = `(() => {
  const el = document.getElementById('smoke-subject');
  if (el === null) return false;
  el.textContent = ${JSON.stringify(MUTATION_TEXT_B)};
  return true;
})()`;

async function main() {
  if (!argv.has('--no-build')) runBuild();
  if (!existsSync(path.join(DIST, 'manifest.json'))) {
    throw new Error(`no extension build at ${DIST}: run \`npm run build\` first`);
  }

  const pageUrl = await startFixtureServer();
  debugPort = await freePort();
  await launchBrowser(debugPort);

  await step('devtools endpoint reachable', async () => {
    const version = await waitFor('devtools endpoint', DEVTOOLS_TIMEOUT_MS, async () => {
      const response = await fetch(`http://127.0.0.1:${String(debugPort)}/json/version`);
      return response.ok ? await response.json() : null;
    });
    browserWsUrl = version.webSocketDebuggerUrl;
    return `127.0.0.1:${String(debugPort)}`;
  });

  const swOk = await step('extension service worker target present', async () => {
    const target = await waitFor('service worker target', DEVTOOLS_TIMEOUT_MS, async () => {
      const targets = await listTargets();
      return targets.find((t) => t.type === 'service_worker' && String(t.url).endsWith('/sw.js'));
    });
    return String(target.url);
  });
  if (!swOk) record('navigating the fixture page', false, 'skipped: no service worker');

  const pageTarget = await waitFor('page target', DEVTOOLS_TIMEOUT_MS, async () => {
    const targets = await listTargets();
    return targets.find((t) => t.type === 'page');
  });
  const page = await connect(pageTarget.webSocketDebuggerUrl);

  await step('fixture page loaded', async () => {
    await page.send('Page.enable');
    await page.send('Page.navigate', { url: pageUrl });
    await waitFor('page load', LOAD_TIMEOUT_MS, async () => (await evaluate(page, 'document.readyState')) === 'complete');
    return pageUrl;
  });

  const offscreenTarget = await step('offscreen document target present', async () => {
    offscreen = await waitFor('offscreen document target', OFFSCREEN_TIMEOUT_MS, async () => {
      const targets = await listTargets();
      return targets.find((t) => String(t.url).endsWith('/offscreen.html'));
    });
    return String(offscreen.url);
  });

  if (offscreenTarget) {
    await step('offscreen document has a WebGPU adapter', async () => {
      const browser = await connect(browserWsUrl);
      try {
        const { sessionId } = await browser.send('Target.attachToTarget', {
          targetId: offscreen.id,
          flatten: true,
        });
        const info = await evaluate(browser, GPU_PROBE, sessionId);
        if (info.gpu !== true) throw new Error('navigator.gpu is undefined in the offscreen document');
        if (info.adapter !== true) throw new Error('requestAdapter() resolved to null');
        return `vendor=${String(info.vendor)} architecture=${String(info.architecture)}`;
      } finally {
        browser.close();
      }
    });
  } else {
    record('offscreen document has a WebGPU adapter', false, 'skipped: no offscreen target');
  }

  const painted = await step('page paints at least one gpu-lexer-* highlight', async () => {
    const registry = await waitFor('gpu-lexer highlights in the page', PAINT_TIMEOUT_MS, async () => {
      const value = await evaluate(page, HIGHLIGHT_KEYS);
      return value !== null && value.keys.length > 0 ? value : null;
    });
    return `${String(registry.size)} registered (${registry.keys.join(', ')})`;
  });

  if (painted) {
    await step('a keyword highlight holds a range', async () => {
      const keywordSize = await waitFor('gpu-lexer-keyword range', PAINT_TIMEOUT_MS, async () => {
        const size = await evaluate(page, `(() => { const h = CSS.highlights.get('gpu-lexer-keyword'); return h ? h.size : 0; })()`);
        return size > 0 ? size : null;
      });
      return `gpu-lexer-keyword has ${String(keywordSize)} range(s)`;
    });
  } else {
    record('a keyword highlight holds a range', false, 'skipped: nothing was painted');
  }

  if (painted) {
    await evaluate(page, `${SIGNATURE_FN} true`);

    await step('the pre-highlighted fixture block stays unpainted', async () => {
      const signature = await evaluate(page, `window.__smokeSignature('prehighlighted')`);
      if (!Array.isArray(signature)) throw new Error('the pre-highlighted fixture block is missing from the page');
      if (signature.length !== 0) throw new Error(`the detector painted over it: ${signature.join(', ')}`);
      return '0 ranges';
    });

    await step('a block wrapped in plain spans is still painted', async () => {
      const count = await waitFor('ranges inside the wrapper-span block', PAINT_TIMEOUT_MS, async () => {
        const signature = await evaluate(page, `window.__smokeSignature('wrapped')`);
        return Array.isArray(signature) && signature.length > 0 ? signature.length : null;
      });
      return `${String(count)} range(s)`;
    });

    await step('a block edited after painting is re-highlighted to match an unedited control', async () => {
      if ((await evaluate(page, MUTATION_INJECT)) !== true) throw new Error('could not inject the mutation fixture');

      const before = await waitFor('the injected blocks to be painted', MUTATION_TIMEOUT_MS, async () => {
        const both = await evaluate(
          page,
          `[window.__smokeSignature('smoke-subject'), window.__smokeSignature('smoke-control')]`,
        );
        if (!Array.isArray(both)) return null;
        const [subject, control] = both;
        return Array.isArray(subject) && subject.length > 0 && Array.isArray(control) && control.length > 0 ? both : null;
      });
      const [subjectBefore, control] = before;
      if (subjectBefore.join('|') === control.join('|')) {
        throw new Error('the two fixture texts highlight identically, so editing one would prove nothing');
      }

      if ((await evaluate(page, MUTATION_EDIT)) !== true) throw new Error('could not edit the block');

      const after = await waitFor('the edited block to be re-highlighted', MUTATION_TIMEOUT_MS, async () => {
        const signature = await evaluate(page, `window.__smokeSignature('smoke-subject')`);
        return Array.isArray(signature) && signature.join('|') === control.join('|') ? signature : null;
      });
      return `${String(after.length)} range(s) match the unedited control`;
    });
  } else {
    record('the pre-highlighted fixture block stays unpainted', false, 'skipped: nothing was painted');
    record('a block wrapped in plain spans is still painted', false, 'skipped: nothing was painted');
    record('a block edited after painting is re-highlighted to match an unedited control', false, 'skipped: nothing was painted');
  }

  page.close();
}

let debugPort = 0;
let browserWsUrl = null;
let offscreen = null;
let browserLogShown = false;

const NOISE = /dbus|DBus|UPower|gcm\/engine|DEPRECATED_ENDPOINT/;

function reportBrowserLog() {
  if (browserLogShown) return;
  browserLogShown = true;
  const lines = browserLog
    .join('')
    .split('\n')
    .filter((line) => line.trim() !== '' && !NOISE.test(line));
  if (lines.length === 0) return;
  console.error(`--- chromium output ---\n${lines.join('\n')}`);
}

overallTimer = setTimeout(() => {
  console.error(`FAIL  overall timeout after ${String(OVERALL_TIMEOUT_MS)}ms`);
  reportBrowserLog();
  void shutdown(1);
}, OVERALL_TIMEOUT_MS);

try {
  await main();
  if (failures > 0) {
    console.error(`\n${String(failures)} check(s) failed`);
    reportBrowserLog();
    await shutdown(1);
  }
  console.log('\nall smoke checks passed');
  await shutdown(0);
} catch (error) {
  console.error(`FAIL  ${errorText(error)}`);
  reportBrowserLog();
  await shutdown(1);
}
