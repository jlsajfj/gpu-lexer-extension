# Tint: Automatic Code Highlighting

A Chrome extension that syntax-highlights `<pre>` and `<code>` blocks on any web
page, automatically. Blocks the page already highlighted itself are left alone: a
block counts as pre-highlighted when it carries a known highlighter class
(`hljs`, `token`, `chroma`, `hljs-`, `cm-`, `mtk`, `pl-`, `tok-`, `shiki`) or shows
more than one text color. It uses [gpu-lexer](https://gpu-lexer.vercel.app), a
41k-parameter neural highlighter by Shu Ding at Vercel Labs that runs on WebGPU
and guesses the language itself, so there is no grammar list and no per-language
parser to configure. The model weights are inlined in the library, which is 27KB
brotli on the wire and 58KB unminified inside the bundle.

## Requirements

gpu-lexer needs WebGPU with no fallback. The GPU work runs in the extension's
offscreen document, which is a `chrome-extension://` page and therefore always a
secure context, so `http://` pages are highlighted too. On a browser or machine
without WebGPU the extension does nothing and pages stay exactly as they are: there
is no error banner and no fallback highlighter.

## Build and load

```
npm install
npm run build
```

Then open `chrome://extensions`, turn on Developer mode, click "Load unpacked", and
pick the `dist/` directory. `npm run watch` rebuilds on change; reload the extension
from `chrome://extensions` after a rebuild.

## Icon

`public/icons/` holds the toolbar and extension icon at 16, 32, 48 and 128 px,
all downscaled from the 1024 px master in `assets/`. The master stays out of
`public/` on purpose, so 700 KB of source art is not shipped inside the packaged
extension. `npm run gen-icons` redraws the master with
the OpenAI images API (`gpt-image-2` model) and regenerates every size; it needs
`OPENAI_API_KEY` set, and it is deliberately manual and not part of
`npm run build`, because each run costs money and is not reproducible. To rebuild
the four sizes from the existing master without calling the API, use the
resize-only flag: `npm run gen-icons -- --no-generate`; add `--list` to print the
available concepts.

## How it works

- **Content script** (`content.js`) scans the DOM for eligible `<pre>`/`<code>`
  blocks, extracts their text, and asks the service worker to highlight it. Blocks
  the page has already highlighted itself are skipped unless `skipPreHighlighted`
  is turned off.
- **Service worker** (`sw.js`) is a stateless router. It makes sure the offscreen
  document exists, forwards the request, and returns the response. It holds no
  state because Chrome kills it after 30 seconds idle.
- **Offscreen document** (`offscreen.js`) owns the `GPUDevice` and the compiled
  pipelines for the whole browsing session, and calls gpu-lexer's `parse()` with an
  LRU cache keyed on the code string, so identical blocks are free.
- **CSS Custom Highlight API** paints the result. The content script turns the
  returned character offsets into live `Range`s and registers one named `Highlight`
  per token class; `highlight.css` supplies the `::highlight()` colors.

## Colors only, no bold or italic

The CSS Custom Highlight API can only style `color`, `background-color`,
`text-decoration`, `text-shadow` and `-webkit-text-*`. `font-weight` and
`font-style` are not stylable, so this extension cannot bold keywords or italicize
comments. It is colors-only by design, not by choice.

Ranges are live and are invalidated when their text nodes change, so a block is
re-processed when its text changes.

## Settings

Stored in `chrome.storage.sync` under the key `settings`.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Master switch for highlighting |
| `disabledHosts` | string[] | `[]` | Hostnames to skip. A `.example.com` entry also matches subdomains |
| `inlineCode` | boolean | `false` | Also highlight single-line `<code>` outside a `<pre>` |
| `skipPreHighlighted` | boolean | `true` | Skip blocks the page has already highlighted with its own syntax highlighter |
| `minLength` | number | `24` | Skip blocks shorter than this many characters |
| `maxLength` | number | `100000` | Skip blocks longer than this many characters |
| `theme` | `auto` \| `light` \| `dark` | `auto` | Which palette `highlight.css` paints with |

## Credit

Syntax highlighting by [gpu-lexer](https://gpu-lexer.vercel.app), a neural
highlighter by Shu Ding at Vercel Labs, MIT licensed. Try the upstream demo at
https://gpu-lexer.vercel.app.

The extension is named Tint. The repository and package stay
`gpu-lexer-extension`, and the internal `gpu-lexer-*` CSS custom properties and
`CSS.highlights` registry keys keep that prefix: those name gpu-lexer's own token
spans, which is accurate, and the registry is shared with the page.

## License

MIT
