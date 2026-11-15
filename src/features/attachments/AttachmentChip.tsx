import { useTranslation } from "react-i18next";
import { describeAttachment } from "./attachments";
import { useImageSrc } from "./useImageSrc";
import type { Attachment } from "@/shared/types";
import { AttachmentVisual } from "./AttachmentVisual";
import { FileStatePill } from "./FileStatePill";
import { ReferenceLabel } from "./ReferenceLabel";
import { RemoveButton } from "@/shared/ui/RemoveButton";

type Props = {
  attachment: Attachment;
  onRemove?: () => void;
  onOpen?: () => void;
  // A file from earlier in the conversation sent again, not a new upload
  isReference?: boolean;
  // The message holding it was summarized, so the model no longer sees the file in full
  isSummarized?: boolean;
};

export function AttachmentChip({ attachment, onRemove, onOpen, isReference = false, isSummarized = false }: Props) {
  const { t } = useTranslation();
  const src = useImageSrc(attachment);
  const referenceClass = isReference ? "reference" : "";

  if (onOpen) {
    // References always use the compact card, so they read as a pointer to a file and not a new image
    if (attachment.kind === "image" && !isReference) {
      return (
        <button
          type="button"
          className="attachment-card"
          aria-label={t("attachments.chip.view", { name: attachment.name })}
          onClick={onOpen}
        >
          <img src={src} alt="" />
          <span className="attachment-card-name">
            <span className="attachment-card-title">{attachment.name}</span>
            {isSummarized && <FileStatePill state="summarized" mini />}
          </span>
        </button>
      );
    }
    return (
      <button
        type="button"
        className={`attachment-doc ${referenceClass}`}
        aria-label={t(isReference ? "attachments.chip.viewReference" : "attachments.chip.view", { name: attachment.name })}
        onClick={onOpen}
      >
        <AttachmentVisual attachment={attachment} isReference={isReference} />
        <span className="attachment-doc-text">
          <span className="attachment-doc-name">{attachment.name}</span>
          <span className="attachment-doc-meta attachment-meta-row">
            {isReference && <ReferenceLabel />}
            {describeAttachment(attachment)}
            {isSummarized && <FileStatePill state="summarized" mini />}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className={`attachment-chip ${referenceClass}`} title={attachment.name}>
      <AttachmentVisual attachment={attachment} isReference={isReference} />
      <span className="attachment-chip-text">
        <span className="attachment-chip-name">{attachment.name}</span>
        <span className="attachment-chip-meta attachment-meta-row">
          {isReference && <ReferenceLabel />}
          {describeAttachment(attachment)}
        </span>
      </span>
      {onRemove && (
        <RemoveButton
          label={t(isReference ? "attachments.chip.removeReference" : "attachments.chip.remove", { name: attachment.name })}
          onClick={onRemove}
        />
      )}
    </div>
  );
}
