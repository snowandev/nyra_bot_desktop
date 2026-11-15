import { GitCommitHorizontal, MessageSquare, SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Conversation } from "@/shared/types";
import { commitTitle } from "./commits";
import { groupByConversation } from "./pending";
import type { PendingItem } from "./projectStorage";

type Props = {
  items: PendingItem[];
  conversations: Conversation[];
  // The conversation open now, shown first as "Esta conversación"
  openConversationId: string | null;
  onOpen: (item: PendingItem) => void;
};

const titleOfItem = (item: PendingItem) =>
  item.kind === "command" ? `$ ${item.label}` : item.kind === "commit" ? commitTitle(item.label) : item.label;

// What waits for the user in the project, by conversation: changes to review and commands waiting for permission
export function PendingList({ items, conversations, openConversationId, onOpen }: Props) {
  const { t } = useTranslation();
  const titleOf = (id: string) => conversations.find((c) => c.id === id)?.title ?? t("panel.pending.conversation");
  return (
    <div className="pending-list">
      {groupByConversation(items, conversations, openConversationId).map((group) => {
        const title =
          group.conversationId === openConversationId
            ? t("panel.pending.thisConversation")
            : titleOf(group.conversationId);
        return (
          <div key={group.conversationId} className="pending-group" role="group" aria-label={title}>
            <div className="pending-group-title">
              <MessageSquare size={13} strokeWidth={2} aria-hidden="true" />
              <span>{title}</span>
            </div>
            {group.items.map((item) => (
              <div key={item.id} className={`pending-item ${item.kind}`}>
                <span className="pending-icon" aria-hidden="true">
                  {item.kind === "command" ? (
                    <SquareTerminal size={14} strokeWidth={2} />
                  ) : item.kind === "commit" ? (
                    <GitCommitHorizontal size={14} strokeWidth={2} />
                  ) : (
                    <i className="mark-proposed" />
                  )}
                </span>
                <span className="pending-text">
                  <strong className="mono">{titleOfItem(item)}</strong>
                  <small>{t(`panel.pending.${item.kind === "change" && item.isNew ? "newFile" : item.kind}`)}</small>
                </span>
                <button
                  type="button"
                  className="outline-button small"
                  aria-label={t(item.kind === "command" ? "panel.pending.viewItem" : "panel.pending.reviewItem", {
                    name: titleOfItem(item),
                  })}
                  onClick={() => onOpen(item)}
                >
                  {item.kind === "command" ? t("panel.pending.view") : t("panel.pending.review")}
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
