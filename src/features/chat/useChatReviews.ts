import { useEffect, useMemo } from "react";
import { useSheetVersions } from "@/features/attachments/useSheetVersions";
import { type ChangeAction, useWorkspaceChanges } from "@/features/workspace/useWorkspaceChanges";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import type { Conversation, Message } from "@/shared/types";

type ChangesOptions = Parameters<typeof useWorkspaceChanges>[0];

type Options = {
  conversation: Conversation;
  // The messages no longer being written, where the versions of attached spreadsheets are
  settledMessages: Message[];
  onUpdateChange: ChangesOptions["onUpdate"];
  onFixChange: ChangesOptions["onFix"];
  onAsk: ChangesOptions["onAsk"];
  // A review takes the place of the Files panel next to the chat
  closeFilesPanel: () => void;
  onReviewChange?: (isReviewing: boolean) => void;
};

// Back on the «Revisar» that opened what was reviewed, once the panel is gone
const focusReviewButton = (id: string) =>
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-review-id="${id}"]`)?.focus());

// What a conversation has to review in place of the chat: the changes its replies proposed and the versions of its
// attached spreadsheets, one open at a time
export function useChatReviews(options: Options) {
  const { conversation, settledMessages, onUpdateChange, onFixChange, onAsk } = options;
  const { closeFilesPanel, onReviewChange } = options;
  const changes = useWorkspaceChanges({
    conversationId: conversation.id,
    messages: conversation.messages,
    onUpdate: onUpdateChange,
    onFix: onFixChange,
    onAsk,
  });
  const sheetVersions = useSheetVersions(settledMessages);
  const changeAction = useStableCallback((index: number, id: string, action: ChangeAction) => {
    // The review takes the place of the Files panel next to the chat
    if (action === "review") {
      closeFilesPanel();
      sheetVersions.close();
    }
    void changes.act(index, id, action);
  });
  // A version of an attached spreadsheet opens in the same place as a proposed change
  const viewSheetVersion = useStableCallback((id: string) => {
    changes.close();
    closeFilesPanel();
    sheetVersions.view(id);
  });
  const saveSheetVersion = useStableCallback(sheetVersions.save);
  const openVersionId = sheetVersions.open?.version.id;
  const applyAllChanges = useStableCallback((index: number) => void changes.applyAll(index));
  const discardAllChanges = useStableCallback(changes.discardAll);
  const { busy: changesBusy, fixing: changesFixing, errors: changeErrors, open: openChangeAt } = changes;
  const changeStatus = useMemo(
    () => ({ busy: changesBusy, fixing: changesFixing, errors: changeErrors, openId: openChangeAt?.id }),
    [changesBusy, changesFixing, changeErrors, openChangeAt],
  );

  const isReviewing = !!changes.open || !!sheetVersions.open;
  useEffect(() => {
    onReviewChange?.(isReviewing);
    // Leaving the conversation leaves no review open
    return () => onReviewChange?.(false);
  }, [isReviewing, onReviewChange]);

  function closeVersion() {
    sheetVersions.close();
    if (openVersionId) focusReviewButton(openVersionId);
  }

  function closeReview() {
    const id = changes.open?.id;
    changes.close();
    if (id) focusReviewButton(id);
  }

  return {
    changes,
    sheetVersions,
    changeAction,
    viewSheetVersion,
    saveSheetVersion,
    openVersionId,
    applyAllChanges,
    discardAllChanges,
    changeStatus,
    closeVersion,
    closeReview,
  };
}
