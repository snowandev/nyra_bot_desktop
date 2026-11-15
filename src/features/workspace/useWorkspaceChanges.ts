import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { i18n } from "@/shared/i18n/i18n";
import { errorMessage } from "@/shared/lib/errors";
import { type ChangedRange, changeAsText } from "./fileChanges";
import {
  applyChange,
  type CellsReview,
  cellsRetryText,
  copyAsXlsx,
  reviewCells,
  reviewChange,
  undoChange,
} from "./workspaceChanges";
import type { Message, ProposedChange } from "@/shared/types";
import type { TextEncoding } from "./workspaceStorage";
import { useWorkspacesContext } from "./workspacesContext";
import { fileName } from "@/shared/lib/paths";

export type ChangeAction = "review" | "apply" | "discard" | "restore" | "undo" | "reveal" | "copy" | "retry" | "convert";

// What the review panel shows for the change it has open
export type TextReview = {
  kind: "text";
  original: string;
  ranges: ChangedRange[];
  crlf: boolean;
  encoding: TextEncoding;
};
export type SheetReview = { kind: "cells" } & CellsReview;
type ChangeReview = TextReview | SheetReview;

type Options = {
  conversationId: string;
  messages: Message[];
  onUpdate: (conversationId: string, index: number, change: ProposedChange) => void;
  // "Pedir que lo corrija" on the card itself: the model redoes the change against the file as it is now
  onFix: (change: ProposedChange, signal: AbortSignal) => Promise<ProposedChange>;
  // A new message to Nyra, for what can't be fixed on the card (a new file whose name is taken)
  onAsk: (text: string) => void;
};


// Sent as the user's message, in the interface's language like anything the user types
const takenNameText = (change: ProposedChange) => i18n.t("changes.ask.takenName", { path: change.path });

// The proposed changes of the open conversation: the review panel, and applying, undoing and discarding them. What
// the user decides is kept with the reply, so it is still there when the conversation opens again.
export function useWorkspaceChanges({ conversationId, messages, onUpdate, onFix, onAsk }: Options) {
  const { reveal } = useWorkspacesContext();
  const [open, setOpen] = useState<{ index: number; id: string } | null>(null);
  // For a fix that ends after the panel was opened or closed
  const openRef = useRef(open);
  useLayoutEffect(() => {
    openRef.current = open;
  });
  const [reviews, setReviews] = useState<Map<string, ChangeReview>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  // Read out by screen readers when something is applied, undone or discarded
  const [announcement, setAnnouncement] = useState("");
  // Being redone by the model ("Corrigiendo…"); never stored, so a closed app doesn't leave a card stuck in it
  const [fixing, setFixing] = useState<Set<string>>(new Set());
  const fixes = useRef(new Map<string, AbortController>());

  // Another conversation opened (or the chat closed): its fixes stop, and their cards stay as they were
  useEffect(() => {
    const running = fixes.current;
    return () => {
      for (const controller of running.values()) controller.abort();
      running.clear();
    };
  }, [conversationId]);

  const changeAt = useCallback(
    (index: number, id: string) => messages[index]?.workspaceChanges?.find((c) => c.id === id),
    [messages],
  );

  function setError(id: string, message: string | null) {
    setErrors((current) => {
      const next = new Map(current);
      if (message) next.set(id, message);
      else next.delete(id);
      return next;
    });
  }

  async function run(index: number, change: ProposedChange, work: () => Promise<ProposedChange>, done: string) {
    setBusy((current) => new Set(current).add(change.id));
    setError(change.id, null);
    try {
      const updated = await work();
      onUpdate(conversationId, index, updated);
      setAnnouncement(updated.status === "applied" || updated.status === "undone" ? done : "");
      return updated;
    } catch (e) {
      setError(change.id, errorMessage(e));
      return change;
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(change.id);
        return next;
      });
    }
  }

  async function fix(index: number, change: ProposedChange) {
    const controller = new AbortController();
    fixes.current.set(change.id, controller);
    setFixing((current) => new Set(current).add(change.id));
    setError(change.id, null);
    try {
      const fixed = await onFix(change, controller.signal);
      if (controller.signal.aborted) return;
      // Its blocks are new: the diff seen before no longer shows them, so it has to be seen again before applying
      setReviews((current) => {
        const next = new Map(current);
        next.delete(change.id);
        return next;
      });
      onUpdate(conversationId, index, { ...fixed, reviewed: false });
      setAnnouncement(i18n.t("changes.announce.fixed", { name: fileName(change.path) }));
      // Open in the panel: it shows the new change against the file right away
      if (openRef.current?.id === change.id) await review(index, fixed);
    } catch (e) {
      if (!controller.signal.aborted) setError(change.id, errorMessage(e));
    } finally {
      fixes.current.delete(change.id);
      setFixing((current) => {
        const next = new Set(current);
        next.delete(change.id);
        return next;
      });
    }
  }

  async function review(index: number, change: ProposedChange) {
    setOpen({ index, id: change.id });
    try {
      const { change: checked, ...data }: { change: ProposedChange } & ChangeReview =
        change.kind === "cells"
          ? { kind: "cells", ...(await reviewCells(change)) }
          : { kind: "text", ...(await reviewChange(change)) };
      setReviews((current) => new Map(current).set(change.id, data));
      // Opening it is what allows applying it: the user has seen the original and the changes
      onUpdate(conversationId, index, { ...checked, reviewed: true });
    } catch (e) {
      setError(change.id, errorMessage(e));
    }
  }

  async function act(index: number, id: string, action: ChangeAction) {
    const change = changeAt(index, id);
    if (!change) return;
    const name = fileName(change.path);
    switch (action) {
      case "review":
        return review(index, change);
      case "apply":
        // Never one the user hasn't seen, whatever asked for it (a shortcut, a stale button)
        if (!change.reviewed && change.status !== "undone") return;
        return run(index, change, () => applyChange(change), i18n.t("changes.announce.applied", { name }));
      case "undo":
        return run(index, change, () => undoChange(change), i18n.t("changes.announce.undone", { name }));
      case "discard":
        onUpdate(conversationId, index, { ...change, status: "discarded" });
        return setAnnouncement(i18n.t("changes.announce.discarded", { name }));
      case "restore":
        return onUpdate(conversationId, index, { ...change, status: "pending", reviewed: false });
      case "reveal":
        return reveal(change.root, change.copiedTo ?? change.path).catch((e) => setError(id, errorMessage(e)));
      case "convert":
        return run(index, change, () => copyAsXlsx(change), i18n.t("changes.announce.copied", { name }));
      case "copy":
        return writeText(changeAsText(change)).catch((e) => setError(id, errorMessage(e)));
      case "retry":
        if (fixing.has(id)) return;
        if (change.kind === "cells") return onAsk(cellsRetryText(change));
        return change.kind === "create" ? onAsk(takenNameText(change)) : fix(index, change);
    }
  }

  // "Aplicar los N": every reviewed pending change of the reply, one after another
  async function applyAll(index: number) {
    for (const change of messages[index]?.workspaceChanges ?? []) {
      if (change.status === "pending" && change.reviewed) await act(index, change.id, "apply");
    }
  }

  function discardAll(index: number) {
    for (const change of messages[index]?.workspaceChanges ?? []) {
      if (change.status === "pending") onUpdate(conversationId, index, { ...change, status: "discarded" });
    }
  }

  return {
    open,
    // The panel shows the change it was opened with, as it is now in the conversation
    openChange: open ? changeAt(open.index, open.id) : undefined,
    openReview: open ? reviews.get(open.id) : undefined,
    close: () => setOpen(null),
    act,
    applyAll,
    discardAll,
    busy,
    fixing,
    errors,
    announcement,
  };
}
