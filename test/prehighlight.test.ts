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

  it('returns false for a block with no descendant elements', () => {
    expect(isPreHighlighted(attached('<pre style="color: rgb(30, 30, 30)">const x = 1;</pre>'))).toBe(false);
  });

  it('detects an hljs span', () => {
    expect(isPreHighlighted(fixture('<pre><span class="hljs-keyword">const</span></pre>'))).toBe(true);
  });

  it('detects a bare hljs class', () => {
    expect(isPreHighlighted(fixture('<pre><code class="hljs">const x = 1;</code></pre>'))).toBe(true);
  });

  it('detects a chroma class', () => {
    expect(isPreHighlighted(fixture('<pre><span class="chroma">const</span></pre>'))).toBe(true);
  });

  it('detects a Prism token class', () => {
    expect(isPreHighlighted(fixture('<pre><span class="token keyword">const</span></pre>'))).toBe(true);
  });

  it('detects a cm- span', () => {
    expect(isPreHighlighted(fixture('<pre><span class="cm-string">"a"</span></pre>'))).toBe(true);
  });

  it('detects an mtk span', () => {
    expect(isPreHighlighted(fixture('<pre><span class="mtk1">const</span></pre>'))).toBe(true);
  });

  it('detects a pl- span', () => {
    expect(isPreHighlighted(fixture('<pre><span class="pl-k">const</span></pre>'))).toBe(true);
  });

  it('detects a tok- span', () => {
    expect(isPreHighlighted(fixture('<pre><span class="tok-keyword">const</span></pre>'))).toBe(true);
  });

  it('detects a shiki span', () => {
    expect(isPreHighlighted(fixture('<pre><span class="shiki">const</span></pre>'))).toBe(true);
  });

  it('returns false for a language-python hint on the block', () => {
    expect(isPreHighlighted(fixture('<pre class="language-python">const x = 1;</pre>'))).toBe(false);
  });

  it('returns false for a lang-js hint on the block', () => {
    expect(isPreHighlighted(fixture('<pre class="lang-js"><span class="line">const x = 1;</span></pre>'))).toBe(false);
  });

  it('detects an hljs- span nested three levels down', () => {
    const pre = fixture('<pre><div><div><span class="hljs-string">"a"</span></div></div></pre>');
    expect(isPreHighlighted(pre)).toBe(true);
  });

  it('stops scanning after sixty descendants', () => {
    const padding = '<span></span>'.repeat(60);
    expect(isPreHighlighted(fixture(`<pre>${padding}<span class="hljs-keyword"></span></pre>`))).toBe(false);
  });

  it('detects two spans with different inline colors', () => {
    const pre = attached(
      '<pre style="color: rgb(30, 30, 30)"><span style="color: rgb(255, 0, 0)">a</span><span style="color: rgb(0, 128, 0)">b</span></pre>',
    );
    expect(isPreHighlighted(pre)).toBe(true);
  });

  it('detects a second color that differs from the block color alone', () => {
    const pre = attached('<pre><span style="color: rgb(255, 0, 0)">a</span></pre>');
    expect(isPreHighlighted(pre)).toBe(true);
  });

  it('returns false when every span shares the block color', () => {
    const pre = attached(
      '<pre style="color: rgb(30, 30, 30)"><span style="color: rgb(30, 30, 30)">a</span><span style="color: rgb(30, 30, 30)">b</span></pre>',
    );
    expect(isPreHighlighted(pre)).toBe(false);
  });

  it('ignores a wrapper span whose color is not on its own text', () => {
    const pre = attached(
      '<pre style="color: rgb(30, 30, 30)"><span style="color: rgb(255, 0, 0)"><span style="color: rgb(30, 30, 30)">a</span></span></pre>',
    );
    expect(isPreHighlighted(pre)).toBe(false);
  });

  it('ignores a whitespace-only span', () => {
    const pre = attached('<pre style="color: rgb(30, 30, 30)"><span style="color: rgb(255, 0, 0)">  </span></pre>');
    expect(isPreHighlighted(pre)).toBe(false);
  });

  it('returns false for a lone link with a different color', () => {
    const pre = attached('<pre style="color: rgb(30, 30, 30)"><a style="color: rgb(0, 0, 255)">link</a></pre>');
    expect(isPreHighlighted(pre)).toBe(false);
  });

  it('returns false for a detached element with unknown colored spans', () => {
    const pre = fixture('<pre><span style="color: rgb(255, 0, 0)">a</span><span style="color: rgb(0, 128, 0)">b</span></pre>');
    expect(() => isPreHighlighted(pre)).not.toThrow();
    expect(isPreHighlighted(pre)).toBe(false);
  });
});
