import { useMemo } from "react";
import type { Attachment } from "@/shared/types";
import { imageSrc } from "./attachments";

// An image's data URL is megabytes of text: built once per image, not on every render (in the composer, on every key)
export function useImageSrc(attachment: Attachment) {
  const { kind, mimeType, data } = attachment;
  return useMemo(() => (kind === "image" ? imageSrc({ mimeType, data }) : ""), [kind, mimeType, data]);
}
