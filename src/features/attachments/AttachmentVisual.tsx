import { Link2 } from "lucide-react";
import { useImageSrc } from "./useImageSrc";
import type { Attachment } from "@/shared/types";
import { FileIcon } from "./FileIcon";

type Props = {
  attachment: Attachment;
  isReference: boolean;
};

export function AttachmentVisual({ attachment, isReference }: Props) {
  const src = useImageSrc(attachment);
  return (
    <span className="attachment-visual">
      {attachment.kind === "image" ? (
        <img className="attachment-chip-thumb" src={src} alt="" />
      ) : (
        <FileIcon attachment={attachment} size="medium" />
      )}
      {isReference && (
        <span className="reference-badge" aria-hidden="true">
          <Link2 size={10} strokeWidth={2.6} />
        </span>
      )}
    </span>
  );
}
