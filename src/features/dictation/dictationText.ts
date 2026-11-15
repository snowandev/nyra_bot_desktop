// Scripts written without spaces between words: next to them, a space would be a mistake
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

// Two pieces of text read apart only with a space between them
const needsSpace = (left: string, right: string) =>
  !!left && !!right && !/\s/u.test(left) && !/\s/u.test(right) && !UNSPACED.test(left) && !UNSPACED.test(right);

// What was said goes where the cursor is, replacing what is selected, with a space on each side only where words would
// otherwise run together. The caret ends after it.
export function insertDictation(text: string, spoken: string, start: number, end: number) {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const said = spoken.trim();
  const spaceBefore = needsSpace(before.slice(-1), said.slice(0, 1)) ? " " : "";
  const spaceAfter = needsSpace(said.slice(-1), after.slice(0, 1)) ? " " : "";
  return {
    text: `${before}${spaceBefore}${said}${spaceAfter}${after}`,
    caret: before.length + spaceBefore.length + said.length,
  };
}
