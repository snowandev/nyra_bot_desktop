import { ExternalLink, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { splitReply } from "@/features/documents/documents";
import type { Message } from "@/shared/types";
import { Markdown } from "@/features/markdown/Markdown";
import { ReasoningSummary } from "@/features/chat/ReasoningSummary";
import { ScreenCard } from "@/features/screen-look/ScreenCard";
import { ToolCallCard } from "@/features/mcp/ToolCallCard";

type Props = {
  message: Message;
  // The reply being written right now
  isWriting: boolean;
  // What it is doing before answering, as the main window's card says it ("Buscando «…»")
  status?: string;
  // A document is seen whole in the main window; undefined while the reply is still being written
  onOpenInNyra?: () => void;
};

// One of Nyra's replies in the quick chat: the reasoning folded, the text, and documents as a compact card, since
// the bar is too small to show them whole
export function QuickReply({ message, isWriting, status, onOpenInNyra }: Props) {
  const { t } = useTranslation();
  const segments = splitReply(message.content, isWriting);
  const hasText = message.content.trim() !== "";
  const isThinking = isWriting && !hasText;
  // As in the main window: the dots while it waits, and "Pensando…" only once the model really reasons
  const reasoning = message.reasoning?.text.trim() ? message.reasoning : undefined;

  return (
    <div className="quick-reply">
      <div className="quick-reply-body">
        {reasoning && <ReasoningSummary reasoning={reasoning} isThinking={isThinking} />}
        {/* What it looked at and marked on the screen; the marks themselves stay there when the bar goes away */}
        {!!message.screen?.steps.length && <ScreenCard record={message.screen} />}
        {/* A tool of the user's MCP servers waits here for their yes: only this window can give it */}
        {message.toolCalls?.map((call) => <ToolCallCard key={call.id} call={call} />)}
        {isThinking && !reasoning && (
          <span className="quick-waiting">
            {status}
            <span className="quick-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </span>
        )}
        {segments.map((segment, i) =>
          segment.kind === "text" ? (
            segment.text.trim() && <Markdown key={i}>{segment.text}</Markdown>
          ) : (
            <div key={i} className="quick-document">
              <span className="quick-document-icon" aria-hidden="true">
                <FileText size={18} strokeWidth={2} />
              </span>
              <span className="quick-document-text">
                <b>{segment.document.title}</b>
                <small>
                  {segment.document.isComplete
                    ? t("quick.documentLines", { count: segment.document.content.split("\n").length })
                    : t("quick.writing")}
                </small>
              </span>
              {onOpenInNyra && segment.document.isComplete && (
                <button
                  type="button"
                  className="quick-button"
                  aria-label={t("quick.openDocument", { title: segment.document.title })}
                  onClick={onOpenInNyra}
                >
                  <ExternalLink size={14} strokeWidth={2} aria-hidden="true" />
                  {t("quick.openInNyra")}
                </button>
              )}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
