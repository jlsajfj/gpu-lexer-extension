import { afterEach, describe, expect, it } from 'vitest';
import { isPreHighlighted } from '../src/content/prehighlight.js';

function fixture(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  const el = container.firstElementChild;
  if (el === null) throw new Error(`fixture produced no element: ${html}`);
  return el as HTMLElement;
}

function attached(html: string): HTMLElement {
  const el = fixture(html);
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isPreHighlighted', () => {
  it('returns false for a plain block', () => {
    expect(isPreHighlighted(attached('<pre>const x = 1; const y = 2;</pre>'))).toBe(false);
  });

  it('returns false for a detached element even with a highlighter class', () => {
    expect(isPreHighlighted(fixture('<pre class="hljs">const x = 1;</pre>'))).toBe(false);
  });

  it('detects a highlighter class on the block itself', () => {
    expect(isPreHighlighted(attached('<pre class="hljs">plain text here</pre>'))).toBe(true);
    expect(isPreHighlighted(attached('<pre class="chroma">plain text here</pre>'))).toBe(true);
  });

  it('detects a bare hljs class', () => {
    expect(isPreHighlighted(attached('<pre><code class="hljs">const x = 1;</code></pre>'))).toBe(true);
  });

  it('detects a Prism token class', () => {
    expect(isPreHighlighted(attached('<pre><span class="token keyword">const</span></pre>'))).toBe(true);
  });

  it('detects a cm- span', () => {
    expect(isPreHighlighted(attached('<pre><span class="cm-string">"a"</span></pre>'))).toBe(true);
  });

  it('detects an mtk span', () => {
    expect(isPreHighlighted(attached('<pre><span class="mtk1">const</span></pre>'))).toBe(true);
  });

  it('detects a pl- span', () => {
    expect(isPreHighlighted(attached('<pre><span class="pl-k">const</span></pre>'))).toBe(true);
  });

  it('detects a tok- span', () => {
    expect(isPreHighlighted(attached('<pre><span class="tok-keyword">const</span></pre>'))).toBe(true);
  });

  it('detects a shiki span', () => {
    expect(isPreHighlighted(attached('<pre><span class="shiki">const</span></pre>'))).toBe(true);
  });

  it('returns false for language-hint classes on the block', () => {
    expect(isPreHighlighted(attached('<pre class="language-python"><span class="line">const x = 1;</span></pre>'))).toBe(false);
    expect(isPreHighlighted(attached('<pre class="lang-js"><span class="line">const x = 1;</span></pre>'))).toBe(false);
  });

  it('detects an hljs- span nested three levels down', () => {
    const pre = attached('<pre><div><div><span class="hljs-string">"a"</span></div></div></pre>');
    expect(isPreHighlighted(pre)).toBe(true);
  });

  it('stops scanning after sixty descendants', () => {
    const padding = '<span></span>'.repeat(60);
    const pre = attached(`<pre>${padding}<span class="hljs-keyword"></span></pre>`);
    expect(isPreHighlighted(pre)).toBe(false);
  });

  it('does not spend the scan budget on textless wrappers', () => {
    const wrappers = '<span class="line"></span>'.repeat(60);
    const pre = attached(`<pre>${wrappers}<span style="color: rgb(255, 0, 0)">a</span> b</pre>`);
    expect(isPreHighlighted(pre)).toBe(true);
  });

  it('detects two spans with different inline colors', () => {
    const pre = attached(
      '<pre style="color: rgb(30, 30, 30)"><span style="color: rgb(255, 0, 0)">a</span><span style="color: rgb(0, 128, 0)">b</span></pre>',
    );
    expect(isPreHighlighted(pre)).toBe(true);
  });

  it('detects a second color that differs from the block color alone', () => {
    const pre = attached('<pre><span style="color: rgb(255, 0, 0)">a</span> b</pre>');
    expect(isPreHighlighted(pre)).toBe(true);
  });

  it('returns false when every span shares the block color', () => {
    const pre = attached(
      '<pre style="color: rgb(30, 30, 30)"><span style="color: rgb(30, 30, 30)">a</span><span style="color: rgb(30, 30, 30)">b</span></pre>',
    );
    expect(isPreHighlighted(pre)).toBe(false);
  });

  it('returns false when one wrapper carries the whole block text in another color', () => {
    const pre = attached('<pre><code style="color: rgb(214, 51, 132)">SELECT 1 FROM t</code></pre>');
    expect(isPreHighlighted(pre)).toBe(false);
  });

  it('ignores a wrapper span whose color is not on its own text', () => {
    const pre = attached(
      '<pre style="color: rgb(30, 30, 30)">x<span style="color: rgb(255, 0, 0)"><span style="color: rgb(30, 30, 30)">a</span></span></pre>',
    );
    expect(isPreHighlighted(pre)).toBe(false);
  });

  it('ignores a whitespace-only span', () => {
    const pre = attached('<pre style="color: rgb(30, 30, 30)">const x = 1;<span style="color: rgb(255, 0, 0)">  </span></pre>');
    expect(isPreHighlighted(pre)).toBe(false);
  });

  it('ignores a link with a different color', () => {
    const pre = attached('<pre style="color: rgb(30, 30, 30)">see <a style="color: rgb(0, 0, 255)">link</a></pre>');
    expect(isPreHighlighted(pre)).toBe(false);
  });

  it('returns false for a detached element with unknown colored spans', () => {
    const pre = fixture('<pre><span style="color: rgb(255, 0, 0)">a</span><span style="color: rgb(0, 128, 0)">b</span></pre>');
    expect(isPreHighlighted(pre)).toBe(false);
  });
});
