import { type ReactNode, useMemo } from "react";
import { type CommandTokenKind, commandTokens } from "./commandSyntax";

type Props = {
  command: string;
  // The part that raised a warning, underlined over its colors
  mark?: string;
};

// The colors of the code in replies (syntax.css), given to the parts of a command
const CLASS_OF: Record<CommandTokenKind, string | undefined> = {
  program: "hljs-title function_",
  option: "hljs-keyword",
  string: "hljs-string",
  variable: "hljs-variable",
  operator: "hljs-meta",
  comment: "hljs-comment",
  text: undefined,
};

type Piece = { text: string; kind: CommandTokenKind; inMark: boolean };

// The tokens cut where the mark starts and ends, so it can be underlined without losing their colors
function piecesOf(command: string, mark: string | undefined): Piece[] {
  const from = mark ? command.indexOf(mark) : -1;
  const to = from === -1 || !mark ? -1 : from + mark.length;
  return commandTokens(command).flatMap(({ kind, text, start }) => {
    const end = start + text.length;
    const cuts = [start, Math.min(Math.max(from, start), end), Math.min(Math.max(to, start), end), end];
    return [0, 1, 2].flatMap((i) => {
      const piece = command.slice(cuts[i], cuts[i + 1]);
      return piece ? [{ text: piece, kind, inMark: from !== -1 && cuts[i] >= from && cuts[i + 1] <= to }] : [];
    });
  });
}

// A command colored by its parts, like the code in replies
export function CommandText({ command, mark }: Props) {
  const pieces = useMemo(() => piecesOf(command, mark), [command, mark]);
  const out: ReactNode[] = [];
  let marked: ReactNode[] = [];
  const span = (piece: Piece, key: number) => (
    <span key={key} className={CLASS_OF[piece.kind]}>
      {piece.text}
    </span>
  );
  pieces.forEach((piece, i) => {
    if (piece.inMark) {
      marked.push(span(piece, i));
      return;
    }
    if (marked.length > 0) out.push(<mark key={`mark-${i}`}>{marked}</mark>);
    marked = [];
    out.push(span(piece, i));
  });
  if (marked.length > 0) out.push(<mark key="mark-end">{marked}</mark>);
  return <code className="hljs">{out}</code>;
}
