export const SYNTAX_CLASSES = [
  'plain', 'comment', 'string', 'number',
  'keyword', 'type', 'function', 'constant', 'operator',
] as const;

export type SyntaxClassName = (typeof SYNTAX_CLASSES)[number];

export interface SyntaxSpan { type: SyntaxClassName; start: number; end: number }

export const PAINTED_CLASSES = [
  'comment', 'string', 'number', 'keyword',
  'type', 'function', 'constant', 'operator',
] as const satisfies readonly SyntaxClassName[];

export type PaintedClass = (typeof PAINTED_CLASSES)[number];

export const highlightName = (c: PaintedClass): string => `gpu-lexer-${c}`;
