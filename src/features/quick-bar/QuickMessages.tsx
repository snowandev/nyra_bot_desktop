import { CircleAlert, RotateCcw } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AttachmentChip } from "@/features/attachments/AttachmentChip";
import type { Message } from "@/shared/types";
import { QuickReply } from "./QuickReply";

type Props = {
  messages: Message[];
  isWriting: boolean;
  status?: string;
  error: string | null;
  onRetry: () => void;
  // Taken up again: how long ago it was left
  resumedMinutes: number | null;
  // Undefined while Nyra answers
  onOpenInNyra?: () => void;
};

// Close enough to the end to keep following the reply as it arrives
const FOLLOW_DISTANCE = 40;

// The quick chat's messages. The reply isn't read out word by word: screen readers hear that Nyra is thinking and,
// once it ends, that it answered
export function QuickMessages(props: Props) {
  const { messages, isWriting, status, error, onRetry, resumedMinutes, onOpenInNyra } = props;
  const { t } = useTranslation();
  const list = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const last = messages[messages.length - 1];

  useLayoutEffect(() => {
    const element = list.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  });

  // The same text all along the reply, so it is read once; then the start of what it answered
  const lastContent = last?.role === "assistant" ? last.content : "";
  const firstLine = lastContent.split("\n").find((line) => line.trim()) ?? "";
  const announcement = isWriting ? t("quick.thinking") : firstLine ? t("quick.answered", { text: firstLine }) : "";

  return (
    <>
      <div
        ref={list}
        className="quick-messages"
        role="log"
        aria-label={t("quick.messages")}
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget;
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_DISTANCE;
        }}
      >
        {resumedMinutes !== null && (
          <div className="quick-separator">{t("quick.resumedSeparator", { minutes: resumedMinutes })}</div>
        )}
        {messages.map((message, i) =>
          message.role === "user" ? (
            <div key={i} className="quick-user-message">
              {message.attachments && message.attachments.length > 0 && (
                <div className="attachment-list" aria-label={t("quick.attachments")}>
                  {message.attachments.map((a) => (
                    <AttachmentChip key={a.id} attachment={a} />
                  ))}
                </div>
              )}
              {message.content && <div className="quick-user">{message.content}</div>}
            </div>
          ) : (
            <QuickReply
              key={i}
              message={message}
              isWriting={isWriting && i === messages.length - 1}
              status={isWriting && i === messages.length - 1 ? status : undefined}
              onOpenInNyra={onOpenInNyra}
            />
          ),
        )}
        {error && (
          <div className="quick-error" role="alert">
            <CircleAlert size={16} strokeWidth={2} aria-hidden="true" />
            <div>
              <b>{error}</b>
              <div className="quick-error-actions">
                <button type="button" className="quick-button primary" onClick={onRetry}>
                  <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
                  {t("common.retry")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <span className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
