import { Check, Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { describeAttachment } from "./attachments";
import { useImageSrc } from "./useImageSrc";
import { isGeneratedDocument } from "@/features/documents/documents";
import type { FileState } from "@/features/chat/reply/summary";
import type { Attachment } from "@/shared/types";
import { FileIcon } from "./FileIcon";
import { FileMenu } from "./FileMenu";
import { FileStatePill } from "./FileStatePill";

type Props = {
  attachment: Attachment;
  state: FileState | undefined;
  isPending: boolean;
  onReference: () => void;
  isOpen: boolean;
  onOpen: () => void;
  // Takes the chat to the message the file came with; missing when it isn't known
  onShowMessage?: () => void;
};

export function FileRow({ attachment, state, isPending, onReference, isOpen, onOpen, onShowMessage }: Props) {
  const { t } = useTranslation();
  const src = useImageSrc(attachment);
  const canReference = state === "summarized";
  const actions = Number(canReference) + Number(!!onShowMessage);
  const hintId = `file-state-${attachment.id}`;

  return (
    <li className="file-item">
      <button
        type="button"
        className={`file-row ${isOpen ? "selected" : ""} ${actions > 0 ? `with-actions-${actions}` : ""}`}
        aria-label={t("attachments.row.open", { name: attachment.name })}
        aria-describedby={state ? hintId : undefined}
        onClick={onOpen}
      >
        {attachment.kind === "image" ? (
          <img className="file-row-thumb" src={src} alt="" />
        ) : (
          <FileIcon attachment={attachment} size="large" />
        )}
        <span className="file-row-text">
          <span className="file-row-name">{attachment.name}</span>
          <span className="file-row-line">
            <span className="file-row-meta">
              {describeAttachment(attachment)}
              {isGeneratedDocument(attachment) && ` · ${t("attachments.row.byNyra")}`}
            </span>
            {state && <FileStatePill state={state} />}
          </span>
        </span>
        {state && (
          <span id={hintId} hidden>
            {t(`attachments.state.${state}.label`)}. {t(`attachments.state.${state}.hint`)}
          </span>
        )}
      </button>
      {actions > 0 && (
        <div className="file-actions">
          {canReference && (
            <button
              type="button"
              className="reference-button has-tip"
              aria-label={t(isPending ? "attachments.row.pendingLabel" : "attachments.row.reference", {
                name: attachment.name,
              })}
              aria-disabled={isPending}
              onClick={() => !isPending && onReference()}
            >
              {isPending ? <Check size={16} strokeWidth={2.2} /> : <Link2 size={16} strokeWidth={2} />}
              <span className="hover-tip left" aria-hidden="true">
                {isPending ? t("attachments.row.pendingTip") : t("attachments.row.referenceTip")}
              </span>
            </button>
          )}
          {onShowMessage && <FileMenu fileName={attachment.name} onShowMessage={onShowMessage} />}
        </div>
      )}
    </li>
  );
}
