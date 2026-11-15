import { applyEdits, format, parse, type ParseError, visit } from "jsonc-parser";

// JSON indented or on one line with jsonc-parser: it only changes the spaces between pieces, so numbers of
// any size and escapes ("é") stay as written, which JSON.parse wouldn't keep. JSONC (comments, trailing commas)
// is read too when the block says so.

export type JsonShapes =
  | { ok: true; formatted: string; compact: string | null }
  | { ok: false; line: number; column: number };

// Where a place in the text is, counted from 1 as an editor counts
function lineAndColumn(text: string, at: number) {
  const before = text.slice(0, at).split("\n");
  return { line: before.length, column: before[before.length - 1].length + 1 };
}

// Every piece as written, without the spaces between; null when it has comments, which one line can't keep
function compacted(text: string) {
  let out = "";
  let hasComments = false;
  const piece = (offset: number, length: number) => {
    out += text.slice(offset, offset + length);
  };
  visit(text, {
    onObjectBegin: piece,
    onObjectEnd: piece,
    onArrayBegin: piece,
    onArrayEnd: piece,
    onObjectProperty: (_property, offset, length) => piece(offset, length),
    onLiteralValue: (_value, offset, length) => piece(offset, length),
    onSeparator: (character) => {
      out += character;
    },
    onComment: () => {
      hasComments = true;
    },
  });
  return hasComments ? null : out;
}

// jsonc: comments and trailing commas are fine; plain JSON doesn't take them
export function jsonShapes(text: string, jsonc = false): JsonShapes {
  const errors: ParseError[] = [];
  parse(text, errors, { disallowComments: !jsonc, allowTrailingComma: jsonc, allowEmptyContent: false });
  if (errors.length > 0) return { ok: false, ...lineAndColumn(text, errors[0].offset) };
  const formatted = applyEdits(text, format(text, undefined, { insertSpaces: true, tabSize: 2, eol: "\n" })).trim();
  return { ok: true, formatted, compact: compacted(text) };
}

// A block without a language is offered the JSON views only when it reads as one, and starts as one
export const mayBeJson = (text: string) => /^\s*[[{]/.test(text);
