import { Fragment, type ReactNode, useMemo } from "react";
import { CitationsContext } from "@/features/markdown/citationsContext";
import type { Citations } from "@/features/markdown/citations";
import { splitReply } from "@/features/documents/documents";
import { DocumentCard } from "@/features/documents/DocumentCard";
import { Markdown } from "@/features/markdown/Markdown";
import { CommandGroup } from "@/features/terminal/CommandGroup";
import type { CommandRun } from "@/shared/types";

type Props = {
  content: string;
  isWriting?: boolean;
  isForImage?: boolean;
  // Only replies that searched the web
  citations?: Citations | null;
  // Commands the reply asked to run, each where it asked for it
  commands?: CommandRun[];
  // Other cards of the reply, each where it was asked for: what it did in the browser, transcripts
  cards?: ReplyCard[];
};

export type ReplyCard = { at: number; key: string; card: ReactNode };

type Piece =
  | { kind: "text"; text: string; isLast: boolean }
  | { kind: "commands"; runs: CommandRun[] }
  | { kind: "card"; key: string };

// The text cut where each request for commands went, and where each other card goes, so the cards sit between what
// was written before and after
function piecesOf(content: string, commands: CommandRun[], cards: { at: number; key: string }[]): Piece[] {
  const groups = new Map<number, CommandRun[]>();
  for (const run of commands) groups.set(run.at, [...(groups.get(run.at) ?? []), run]);
  const places = new Set([...groups.keys(), ...cards.map((c) => c.at)]);
  const pieces: Piece[] = [];
  let from = 0;
  for (const at of [...places].sort((a, b) => a - b)) {
    const to = Math.min(Math.max(at, from), content.length);
    pieces.push({ kind: "text", text: content.slice(from, to), isLast: false });
    for (const card of cards.filter((c) => c.at === at)) pieces.push({ kind: "card", key: card.key });
    const runs = groups.get(at);
    if (runs) pieces.push({ kind: "commands", runs: runs.sort((a, b) => a.n - b.n) });
    from = to;
  }
  pieces.push({ kind: "text", text: content.slice(from), isLast: true });
  return pieces;
}

// A reply is Markdown, except the documents the model wrote on request, which are shown as files, and the commands
// it asked to run, shown as cards
export function ReplyContent(props: Props) {
  const { content, isWriting = false, isForImage = false, citations = null, commands, cards } = props;
  // Cheap to cut again on every frame; what costs is drawing the Markdown, which keeps its own pieces
  const pieces = piecesOf(content, commands ?? [], cards ?? []);
  const citationsValue = useMemo(() => citations && { citations, isForImage }, [citations, isForImage]);
  const rendered = pieces.map((piece, p) =>
    // Pieces only grow at the end while streaming, so their position identifies them
    piece.kind === "commands" ? (
      <CommandGroup key={`commands-${p}`} runs={piece.runs} />
    ) : piece.kind === "card" ? (
      <Fragment key={piece.key}>{cards?.find((c) => c.key === piece.key)?.card}</Fragment>
    ) : (
      <Fragment key={`text-${p}`}>
        {splitReply(piece.text, isWriting && piece.isLast).map((segment, index) => (
          <Fragment key={index}>
            {segment.kind === "text" ? (
              segment.text.trim() && <Markdown>{segment.text}</Markdown>
            ) : (
              <DocumentCard document={segment.document} isWriting={isWriting} isForImage={isForImage} />
            )}
          </Fragment>
        ))}
      </Fragment>
    ),
  );
  return <CitationsContext value={citationsValue}>{rendered}</CitationsContext>;
}
