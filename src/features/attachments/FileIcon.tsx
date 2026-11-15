import { AudioLines, Code, FileText, Globe, ImageIcon } from "lucide-react";
import { fileTypeOf } from "./attachments";
import type { Attachment } from "@/shared/types";

type Props = {
  attachment: Attachment;
  size: "small" | "medium" | "large";
};

const ICON_SIZES = { small: 16, medium: 16, large: 20 };

export function FileIcon({ attachment, size }: Props) {
  const type = fileTypeOf(attachment);
  const Glyph = attachment.url
    ? Globe
    : attachment.kind === "image"
      ? ImageIcon
      : attachment.kind === "pdf"
        ? FileText
        : attachment.kind === "audio"
          ? AudioLines
          : Code;

  return (
    <span className={`file-icon ${size}`} style={{ color: type.color }} aria-hidden="true">
      <Glyph size={ICON_SIZES[size]} strokeWidth={1.9} />
      {size === "large" && type.ext && <span className="file-icon-ext">{type.ext}</span>}
    </span>
  );
}
