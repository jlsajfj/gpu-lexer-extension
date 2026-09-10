export type SyntaxClassName =
  | 'plain' | 'comment' | 'string' | 'number'
  | 'keyword' | 'type' | 'function' | 'constant' | 'operator';

export interface SyntaxSpan { type: SyntaxClassName; start: number; end: number }

/** The 8 classes that get a color; `plain` is deliberately excluded. */
export const PAINTED_CLASSES = [
  'comment', 'string', 'number', 'keyword',
  'type', 'function', 'constant', 'operator',
] as const satisfies readonly SyntaxClassName[];

export type PaintedClass = (typeof PAINTED_CLASSES)[number];

export const highlightName = (c: PaintedClass): string => `gpu-lexer-${c}`;
