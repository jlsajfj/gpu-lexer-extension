#!/usr/bin/env node
// Deliberately NOT part of `npm run build`: icon generation is a manual step that costs money.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jimp, ResizeStrategy } from 'jimp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const shown = (p) => (p.startsWith(ROOT) ? path.relative(ROOT, p) : p);
const MODEL = 'gpt-image-2';
const MASTER_SIZE = 1024;
const DERIVED_SIZES = [128, 48, 32, 16];
const RESIZE_MODE = ResizeStrategy.BICUBIC;

// Mirrors public/highlight.css (dark theme, since the tile background is dark).
const PALETTE = {
  comment: '#7f848e',
  string: '#98c379',
  number: '#d19a66',
  keyword: '#c678dd',
  type: '#e5c07b',
  function: '#61afef',
  constant: '#56b6c2',
  operator: '#9aa4b2',
};

const STYLE_RULES = [
  'Flat vector illustration only: not photorealistic, not 3D, no drop shadows, no bevels, no glossy highlights.',
  'Hard crisp edges only: no glow, no bloom, no halo, no aura, no outer shadow, no blurred or feathered edge around the shape, no light rays, no lens flare.',
  'Every pixel is either a fully opaque solid fill or fully transparent; the background around the subject must be completely clear and empty.',
  'Absolutely no lettering, no words, no letters, no numbers, no punctuation characters, no signature, no watermark.',
  'One single centered subject occupying roughly the middle 70 percent of the frame, with generous empty margins on all four sides.',
  'High contrast, bold geometric shapes, each shape a single flat solid color with no shading.',
  'Simple enough to read as one silhouette at a glance, and it must stay legible when scaled down to 16 by 16 pixels.',
  'No backdrop, no border, no frame, no outline stroke around the subject.',
].join(' ');

const p = (name) => `${PALETTE[name]} (${name})`;

// Keyed by CLI argument; add a concept here and it is selectable by name.
const CONCEPTS = {
  lines: [
    'An app icon: a dark charcoal (#1f2429) rounded square tile, centered, occupying about 80 percent of the frame with even margins on all sides.',
    'Inside the tile sit four thick horizontal rounded bars stacked evenly like lines of source code, all left-aligned, each bar a completely different solid color:',
    `top bar ${p('string')}, second bar ${p('keyword')}, third bar ${p('number')}, bottom bar ${p('function')}.`,
    'The bottom bar is noticeably shorter than the other three. The bars are chunky and widely spaced, not thin hairlines.',
    STYLE_RULES,
  ].join(' '),

  bracket: [
    'An app icon: one enormous bold chevron pointing left, drawn as two thick straight bars meeting at a sharp point, like the opening half of an angle bracket.',
    `The upper stroke is a solid single color, ${p('function')}. The lower stroke is a solid single color, ${p('keyword')}.`,
    `Where the two strokes meet at the point there is a small solid block of ${p('string')}.`,
    'The chevron is the only object, centered, with wide empty margins, its strokes very thick and its shape reduced to its simplest possible geometry.',
    STYLE_RULES,
  ].join(' '),

  prism: [
    'An app icon: a single bold equilateral triangle pointing straight up, centered, occupying most of the frame.',
    'The triangle is split cleanly down its vertical center line.',
    `Its left half is one flat neutral color, ${p('comment')}.`,
    `Its right half is sliced into four clean parallel bands running from the apex to the base, each band a different solid color, in order: ${p('string')}, ${p('number')}, ${p('keyword')}, ${p('constant')}.`,
    'The effect reads as a beam entering the plain left half and leaving the right half split into separate colors, suggesting acceleration and light.',
    'The outer silhouette is a plain triangle with nothing outside it.',
    STYLE_RULES,
  ].join(' '),
};

const DEFAULT_CONCEPT = 'lines';

function parseArgs(argv) {
  const args = { concept: null, generate: true, out: path.join(ROOT, 'public', 'icons'), basename: 'icon' };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-generate') args.generate = false;
    else if (a === '--out') args.out = path.resolve(argv[++i] ?? '');
    else if (a === '--basename') args.basename = argv[++i];
    else if (a === '--list') args.list = true;
    else if (a.startsWith('-')) throw new Error(`unknown flag: ${a}`);
    else positional.push(a);
  }
  if (positional.length > 1) throw new Error(`expected at most one concept, got ${positional.length}`);
  args.concept = positional[0] ?? DEFAULT_CONCEPT;
  return args;
}

function usage() {
  console.log('usage: node scripts/gen-icons.mjs [concept] [--no-generate] [--out DIR] [--basename NAME]');
  console.log(`concepts: ${Object.keys(CONCEPTS).join(', ')} (default: ${DEFAULT_CONCEPT})`);
}

async function generate(prompt, useTransparent) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set in the environment; refusing to run.');

  const body = {
    model: MODEL,
    prompt,
    n: 1,
    size: `${MASTER_SIZE}x${MASTER_SIZE}`,
    quality: 'high',
    output_format: 'png',
  };
  if (useTransparent) body.background = 'transparent';

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    const detail = describeApiError(text);
    throw new Error(`images API returned ${res.status}: ${detail}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`images API returned non-JSON body (${text.length} bytes)`);
  }

  const item = json?.data?.[0];
  if (!item) throw new Error(`images API response had no data[0]; keys: ${Object.keys(json ?? {}).join(', ')}`);

  const observed = Object.keys(item).join(', ');
  if (typeof item.b64_json === 'string') return { buffer: Buffer.from(item.b64_json, 'base64'), shape: `b64_json (data[0].keys=[${observed}])` };
  if (typeof item.url === 'string') {
    const img = await fetch(item.url);
    if (!img.ok) throw new Error(`downloading data[0].url failed with ${img.status}`);
    return { buffer: Buffer.from(await img.arrayBuffer()), shape: `url (data[0].keys=[${observed}])` };
  }
  throw new Error(`data[0] had neither b64_json nor url; keys: ${observed}`);
}

function describeApiError(text) {
  try {
    const json = JSON.parse(text);
    const msg = json?.error?.message ?? json?.message;
    if (msg) return `${msg}${json?.error?.code ? ` (code=${json.error.code})` : ''}`;
  } catch {
    /* not JSON; fall through to the raw body, which never contains request headers */
  }
  return text.slice(0, 500);
}

function isTransparentRejection(err) {
  return /background|transparen|output_format/i.test(err.message);
}

async function decodeMaster(buffer) {
  let image;
  try {
    image = await Jimp.read(buffer);
  } catch (err) {
    throw new Error(`failed to decode the returned image: ${err.message}`);
  }
  if (image.bitmap.width !== MASTER_SIZE || image.bitmap.height !== MASTER_SIZE) {
    console.warn(`  ! expected ${MASTER_SIZE}x${MASTER_SIZE}, decoded ${image.bitmap.width}x${image.bitmap.height}`);
  }
  return image;
}

// Successive halving keeps detail far better than one 1024 -> 16 jump.
function downscale(master, target) {
  let img = master.clone();
  let width = img.bitmap.width;
  while (width > target) {
    width = Math.max(target, Math.round(width / 2));
    img.resize({ w: width, h: width, mode: RESIZE_MODE });
  }
  return img;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    usage();
    process.exit(0);
  }

  const prompt = CONCEPTS[args.concept];
  if (!prompt) throw new Error(`unknown concept "${args.concept}"; known: ${Object.keys(CONCEPTS).join(', ')}`);
  if (args.generate && !process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set in the environment; refusing to run.');
  }

  const masterPath = path.join(args.out, `${args.basename}-${MASTER_SIZE}.png`);
  await mkdir(args.out, { recursive: true });

  let masterBuffer;
  if (args.generate) {
    console.log(`generating "${args.concept}" with ${MODEL} at ${MASTER_SIZE}x${MASTER_SIZE}...`);
    console.log(`  prompt: ${prompt}`);
    try {
      const out = await generate(prompt, true);
      masterBuffer = out.buffer;
      console.log(`  response: ${out.shape}`);
    } catch (err) {
      if (!isTransparentRejection(err)) throw err;
      console.warn(`  ! transparent background rejected (${err.message}); retrying with an opaque background`);
      const out = await generate(prompt, false);
      masterBuffer = out.buffer;
      console.log(`  response: ${out.shape}`);
    }
    await writeFile(masterPath, masterBuffer);
  } else {
    console.log(`--no-generate: reusing ${masterPath}`);
    masterBuffer = await readFile(masterPath);
  }

  const master = await decodeMaster(masterBuffer);
  const masterBytes = masterBuffer.length;
  console.log(`  ${shown(masterPath)} ${master.bitmap.width}x${master.bitmap.height} ${(masterBytes / 1024).toFixed(1)} KB`);

  for (const size of DERIVED_SIZES) {
    const out = path.join(args.out, `${args.basename}-${size}.png`);
    await downscale(master, size).write(out);
    const { size: bytes } = await stat(out);
    console.log(`  ${shown(out).padEnd(34)} ${size}x${size} ${(bytes / 1024).toFixed(1)} KB`);
  }
}

main().catch((err) => {
  console.error(`gen-icons failed: ${err.message}`);
  process.exit(1);
});
