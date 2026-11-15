// A mark the model asks for: "what | note", "from -> what | note" (also with "→"), or "clear". The parts as written;
// each tool reads them its way. The note is one line, cut at maxNote.
export function markParts(value: string, maxNote: number): { clear: true } | { targets: string[]; note: string } {
  if (/^\s*clear\s*$/i.test(value)) return { clear: true };
  const bar = value.indexOf("|");
  const targets = (bar === -1 ? value : value.slice(0, bar)).split(/->|→/);
  const note = bar === -1 ? "" : value.slice(bar + 1).replace(/\s+/g, " ").trim().slice(0, maxNote);
  return { targets, note };
}
