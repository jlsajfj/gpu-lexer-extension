#!/usr/bin/env node
import { context } from 'esbuild';
import { watch as watchFs } from 'node:fs';
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(ROOT, 'dist');
const PUBLIC = path.join(ROOT, 'public');

const argv = new Set(process.argv.slice(2));
const WATCH = argv.has('--watch');
const PRODUCTION = argv.has('--minify') || process.env.NODE_ENV === 'production';

// content.js is a static MV3 content script: not a module, so it must be IIFE.
const ENTRIES = [
  { entry: 'src/background/sw.ts', out: 'sw.js', format: 'esm' },
  { entry: 'src/content/content.ts', out: 'content.js', format: 'iife' },
  { entry: 'src/offscreen/offscreen.ts', out: 'offscreen.js', format: 'esm' },
  { entry: 'src/popup/popup.ts', out: 'popup.js', format: 'esm' },
];

const bytes = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const line = (name, size) => console.log(`  ${name.padEnd(18)} ${bytes(size).padStart(9)}`);

function options({ entry, out, format }) {
  return {
    entryPoints: [path.join(ROOT, entry)],
    outfile: path.join(DIST, out),
    bundle: true,
    format,
    platform: 'browser',
    target: 'chrome116',
    sourcemap: PRODUCTION ? false : 'linked',
    minify: PRODUCTION,
    legalComments: 'none',
    logLevel: 'warning',
  };
}

async function copyPublic() {
  if (!existsSync(PUBLIC)) return;
  await cp(PUBLIC, DIST, { recursive: true });
  for (const rel of await readdir(PUBLIC, { recursive: true })) {
    if (!(await stat(path.join(PUBLIC, rel))).isFile()) continue;
    line(rel, (await stat(path.join(DIST, rel))).size);
  }
}

async function buildOnce(spec) {
  const ctx = await context(options(spec));
  try {
    const result = await ctx.rebuild();
    if (result.errors.length > 0) {
      throw new Error(`${spec.out}: ${result.errors.length} build error(s)`);
    }
    line(spec.out, (await stat(path.join(DIST, spec.out))).size);
  } finally {
    await ctx.dispose();
  }
}

async function watchAll() {
  const ctxs = [];
  for (const spec of ENTRIES) {
    const ctx = await context({
      ...options(spec),
      plugins: [
        {
          name: 'report',
          setup(build) {
            build.onEnd(async (result) => {
              if (result.errors.length > 0) {
                console.error(`  ${spec.out} FAILED`);
                return;
              }
              line(spec.out, (await stat(path.join(DIST, spec.out))).size);
            });
          },
        },
      ],
    });
    await ctx.watch();
    ctxs.push(ctx);
  }

  if (existsSync(PUBLIC)) {
    let pending = null;
    watchFs(PUBLIC, { recursive: true }, () => {
      clearTimeout(pending);
      pending = setTimeout(() => {
        copyPublic().catch((err) => console.error(`  public copy failed: ${err.message}`));
      }, 50);
    });
  }
}

try {
  if (!WATCH) await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  console.log(`${PRODUCTION ? 'building (production)' : 'building'} -> dist/`);

  await copyPublic();

  if (WATCH) {
    await watchAll();
    console.log('watching for changes (ctrl-c to stop)');
  } else {
    for (const spec of ENTRIES) await buildOnce(spec);
    console.log('done');
  }
} catch (err) {
  console.error(`build failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
