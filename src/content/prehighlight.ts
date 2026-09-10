const MAX_SCAN = 60;

const CLASS_MARKERS: readonly string[] = ['hljs', 'token', 'chroma'];
const CLASS_PREFIXES: readonly string[] = ['hljs-', 'cm-', 'mtk', 'pl-', 'tok-', 'shiki'];

export function isPreHighlighted(el: Element): boolean {
  if (!el.isConnected) return false;
  const descendants = el.querySelectorAll('*');
  if (hasMarkerClass(el, descendants)) return true;
  return hasMultipleColors(el, descendants);
}

function hasMarkerClass(el: Element, descendants: NodeListOf<Element>): boolean {
  if (hasMarker(el)) return true;
  let seen = 0;
  for (const node of descendants) {
    if (seen === MAX_SCAN) return false;
    seen += 1;
    if (hasMarker(node)) return true;
  }
  return false;
}

function hasMarker(el: Element): boolean {
  for (const token of el.classList) {
    if (CLASS_MARKERS.includes(token)) return true;
    if (CLASS_PREFIXES.some((prefix) => token.startsWith(prefix))) return true;
  }
  return false;
}

function hasMultipleColors(el: Element, descendants: NodeListOf<Element>): boolean {
  const view = el.ownerDocument.defaultView;
  if (view === null || typeof view.getComputedStyle !== 'function') return false;
  const colors = new Set<string>();
  addColor(colors, view.getComputedStyle(el).color);
  const text = el.textContent;
  let seen = 0;
  for (const node of descendants) {
    if (node.localName === 'a' || !hasOwnText(node) || node.textContent === text) continue;
    if (seen === MAX_SCAN) break;
    seen += 1;
    addColor(colors, view.getComputedStyle(node).color);
  }
  return colors.size >= 2;
}

function addColor(colors: Set<string>, color: string): void {
  if (color !== '') colors.add(color);
}

function hasOwnText(el: Element): boolean {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && /\S/.test(node.nodeValue ?? '')) return true;
  }
  return false;
}
