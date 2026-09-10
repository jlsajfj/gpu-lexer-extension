import { describe, expect, it } from 'vitest';
import { extractCode, findBlocks, isEligible } from '../src/content/detect.js';

const BASE = { minLength: 24, maxLength: 100_000, inlineCode: false };

function root(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

function tags(els: Element[]): string[] {
  return els.map((e) => e.localName);
}

function textOf(els: Element[]): string[] {
  return els.map((e) => e.textContent ?? '');
}

function textNodeChars(el: Element): number {
  const walker = document.createTreeWalker(el, window.NodeFilter.SHOW_TEXT);
  let total = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    total += (node as Text).data.length;
  }
  return total;
}

describe('findBlocks', () => {
  it('returns the <pre> and not the inner <code>', () => {
    const blocks = findBlocks(root('<pre><code>const x = 1;</code></pre>'));
    expect(tags(blocks)).toEqual(['pre']);
    expect(textOf(blocks)).toEqual(['const x = 1;']);
  });

  it('returns the <pre> when the <code> is deeper than one level', () => {
    const blocks = findBlocks(root('<pre><span><code>const x = 1;</code></span></pre>'));
    expect(tags(blocks)).toEqual(['pre']);
  });

  it('returns both of two sibling blocks in document order', () => {
    const blocks = findBlocks(root('<pre>aaa</pre><p>in between</p><pre>bbb</pre>'));
    expect(tags(blocks)).toEqual(['pre', 'pre']);
    expect(textOf(blocks)).toEqual(['aaa', 'bbb']);
  });

  it('returns a bare <code>', () => {
    const blocks = findBlocks(root('<code>const x = 1;</code>'));
    expect(tags(blocks)).toEqual(['code']);
  });

  it('returns nested blocks and a sibling bare <code> together, without the inner <code>', () => {
    const blocks = findBlocks(root('<pre><code>aaa</code></pre><code>bbb</code>'));
    expect(tags(blocks)).toEqual(['pre', 'code']);
    expect(textOf(blocks)).toEqual(['aaa', 'bbb']);
  });

  it('returns an empty array when the root has no blocks', () => {
    expect(findBlocks(root('<p>hello</p><div><span>nested</span></div>'))).toEqual([]);
  });
});

describe('isEligible', () => {
  it('rejects text shorter than minLength', () => {
    const pre = root('<pre>tiny</pre>').firstElementChild as Element;
    expect(isEligible(pre, BASE)).toBe(false);
  });

  it('rejects text longer than maxLength', () => {
    const pre = root('<pre>this is longer than ten</pre>').firstElementChild as Element;
    expect(isEligible(pre, { minLength: 0, maxLength: 10, inlineCode: true })).toBe(false);
  });

  it('accepts text exactly on both length bounds', () => {
    const pre = root('<pre>0123456789</pre>').firstElementChild as Element;
    expect(isEligible(pre, { minLength: 10, maxLength: 10, inlineCode: false })).toBe(true);
  });

  it('rejects whitespace-only blocks', () => {
    const pre = root('<pre>      </pre>').firstElementChild as Element;
    expect(isEligible(pre, { minLength: 0, maxLength: 100, inlineCode: true })).toBe(false);
  });

  it('accepts a multi-line <code> inside a <pre>', () => {
    const code = root('<pre><code>line one is here\nline two is here</code></pre>').querySelector('code');
    expect(code).not.toBeNull();
    expect(isEligible(code as Element, BASE)).toBe(true);
  });

  it('rejects a single-line bare <code> when inlineCode is false', () => {
    const code = root('<code>const value = compute(x, y)</code>').firstElementChild as Element;
    expect(isEligible(code, { ...BASE, inlineCode: false })).toBe(false);
  });

  it('accepts a single-line bare <code> when inlineCode is true', () => {
    const code = root('<code>const value = compute(x, y)</code>').firstElementChild as Element;
    expect(isEligible(code, { ...BASE, inlineCode: true })).toBe(true);
  });

  it('still accepts a multi-line bare <code> when inlineCode is false', () => {
    const code = root('<code>first line here\nsecond line here</code>').firstElementChild as Element;
    expect(isEligible(code, { ...BASE, inlineCode: false })).toBe(true);
  });

  it('rejects an element inside a contenteditable ancestor', () => {
    const pre = root('<div contenteditable="true"><pre>const x = 1; const y = 2;</pre></div>')
      .querySelector('pre') as Element;
    expect(isEligible(pre, BASE)).toBe(false);
  });

  it('rejects an element that is itself contenteditable', () => {
    const pre = root('<pre contenteditable="true">const x = 1; const y = 2;</pre>')
      .firstElementChild as Element;
    expect(isEligible(pre, BASE)).toBe(false);
  });

  it('accepts an element inside a contenteditable="false" ancestor', () => {
    const pre = root('<div contenteditable="false"><pre>const x = 1; const y = 2;</pre></div>')
      .querySelector('pre') as Element;
    expect(isEligible(pre, BASE)).toBe(true);
  });
});

describe('extractCode', () => {
  it('returns text verbatim, including leading, trailing and CRLF whitespace', () => {
    const pre = document.createElement('pre');
    pre.appendChild(document.createTextNode('\n  const x = 1;\r\n  const y = 2;\n'));
    expect(extractCode(pre)).toBe('\n  const x = 1;\r\n  const y = 2;\n');
  });

  it('returns whitespace inside nested markup without collapsing it', () => {
    const pre = root('<pre><span>  a  b  </span>tail</pre>').firstElementChild as Element;
    expect(extractCode(pre)).toBe('  a  b  tail');
  });

  it('returns an empty string for an empty element', () => {
    expect(extractCode(root('<pre></pre>').firstElementChild as Element)).toBe('');
  });

  it('returns text from the whole subtree, not just direct children', () => {
    const pre = root('<pre>outer<span>inner<em>deep</em></span></pre>').firstElementChild as Element;
    expect(extractCode(pre)).toBe('outerinnerdeep');
  });

  it('length equals the sum of descendant text-node lengths', () => {
    const fixture =
      '<pre>const <span>x</span> = <em>"hi"</em>;\n' +
      '<span><span>nested</span></span></pre>';
    const pre = root(fixture).firstElementChild as Element;
    expect(extractCode(pre).length).toBe(textNodeChars(pre));
    expect(extractCode(pre)).toBe(pre.textContent);
  });
});
