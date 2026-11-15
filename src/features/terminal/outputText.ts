// What a command printed, kept as plain text: how new output joins it, how much is kept and the parts the model reads

import { i18n } from "@/shared/i18n/i18n";
import { formatNumber, shortened } from "@/shared/lib/format";

// How it ended, by the shells' own exit codes: 127 and 126 mean it never ran. Any other code but 0 is often a
// result rather than a breakdown: tests that fail, a linter's warnings, a scanner's findings, grep finding nothing.
export function endingOf(exitCode: number | undefined): "ok" | "notFound" | "notRunnable" | "nonZero" | "noStart" {
  if (exitCode === undefined) return "noStart";
  if (exitCode === 0) return "ok";
  if (exitCode === 127) return "notFound";
  if (exitCode === 126) return "notRunnable";
  return "nonZero";
}

// Kept in the conversation; past this the start and the end stay and the middle gives way
export const MAX_KEPT_LINES = 50_000;
const KEPT_HEAD_LINES = 1_000;
// While it runs, trimmed again only once this many more lines arrived, so it isn't split on every chunk
export const LIVE_SLACK_LINES = 10_000;
// What the model gets of a finished command without asking: its end, where the summary and the errors usually are
const TAIL_LINES = 120;
const TAIL_CHARS = 8_000;
// A range the model reads at once, and how many matches a search returns
export const MAX_READ_LINES = 300;
const MAX_SEARCH_MATCHES = 60;
// A line longer than this (minified code, a progress dump) is cut when it goes to the model
const MAX_LINE_CHARS = 400;

// A line redrawn with "\r" (a progress bar) keeps only its last drawing; "\r\n" is just the end of a line
function redrawn(line: string) {
  const at = line.lastIndexOf("\r", line.length - 2);
  return at === -1 ? line : line.slice(at + 1);
}

// Adds what just arrived. Only the last line can still change, so the rest isn't looked at again.
export function appendOutput(output: string, chunk: string) {
  const lineStart = output.lastIndexOf("\n") + 1;
  const pending = (output.slice(lineStart) + chunk).replace(/\r\n/g, "\n");
  const lines = pending.split("\n");
  // A "\r" at the very end may be the start of a "\r\n" that comes in the next chunk
  return output.slice(0, lineStart) + lines.map(redrawn).join("\n");
}

export function lineCount(output: string) {
  if (!output) return 0;
  const lines = output.split("\n").length;
  return output.endsWith("\n") ? lines - 1 : lines;
}

export const newlinesIn = (chunk: string) => chunk.split("\n").length - 1;

// The output within the limit, with a line saying how much of the middle went; dropped counts every line that went,
// also in earlier trims while it ran, whose line this one replaces. That line is written in the interface's
// language; the model reads it as part of the output, in any language.
export function keepWithin(output: string, dropped = 0) {
  const lines = output.split("\n");
  if (lines.length <= MAX_KEPT_LINES) return { output, dropped };
  const middle = KEPT_HEAD_LINES + (dropped > 0 ? 1 : 0);
  const tail = MAX_KEPT_LINES - KEPT_HEAD_LINES - 1;
  const total = dropped + lines.length - middle - tail;
  const note = i18n.t("terminal.keptOmitted", { lines: formatNumber(total) });
  return { output: [...lines.slice(0, KEPT_HEAD_LINES), note, ...lines.slice(-tail)].join("\n"), dropped: total };
}

// Every line it printed, also those that went
export const totalLines = (output: string, dropped: number) => lineCount(output) + (dropped > 0 ? dropped - 1 : 0);

const cutLine = (line: string) => shortened(line, MAX_LINE_CHARS);

// Numbered as in the viewer ("12 | text"), so the model can cite them and ask for a range
function numbered(lines: string[], first: number) {
  const width = String(first + lines.length - 1).length;
  return lines.map((line, i) => `${String(first + i).padStart(width)} | ${cutLine(line)}`).join("\n");
}

const linesOf = (output: string) => {
  const lines = output.split("\n");
  return output.endsWith("\n") ? lines.slice(0, -1) : lines;
};

// The last lines that fit, for the result the model gets when the command ends; fewer for a shorter note
export function outputTail(output: string, maxLines = TAIL_LINES) {
  const lines = linesOf(output);
  const picked: string[] = [];
  let chars = 0;
  for (let i = lines.length - 1; i >= 0 && picked.length < maxLines; i--) {
    chars += Math.min(lines[i].length, MAX_LINE_CHARS) + 1;
    if (chars > TAIL_CHARS && picked.length > 0) break;
    picked.unshift(lines[i]);
  }
  const from = lines.length - picked.length + 1;
  return { text: numbered(picked, from), from, total: lines.length };
}

// Lines from–to (1-based, inclusive), as many as one read takes
export function outputRange(output: string, from: number, to: number) {
  const lines = linesOf(output);
  const start = Math.max(1, Math.min(from, lines.length));
  const end = Math.min(lines.length, to, start + MAX_READ_LINES - 1);
  return { text: numbered(lines.slice(start - 1, end), start), from: start, to: end, total: lines.length };
}

// Lines holding a text, in any case, with their numbers
export function searchOutput(output: string, query: string) {
  const needle = query.toLowerCase();
  const matches: string[] = [];
  let total = 0;
  for (const [i, line] of linesOf(output).entries()) {
    if (!line.toLowerCase().includes(needle)) continue;
    total++;
    if (matches.length < MAX_SEARCH_MATCHES) matches.push(`${i + 1}: ${cutLine(line)}`);
  }
  return { text: matches.join("\n"), total, shown: matches.length };
}
