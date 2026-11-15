import { type ConversationImages, imageNamed } from "@/features/markdown/conversationImages";
import type { Attachment } from "@/shared/types";
import { saveMarkdown, saveMarkdownZip } from "./documentStorage";
import { imageSources } from "./pdfDefinition";

// The conversation's images a Markdown shows, once each
export function shownImages(markdown: string, images: ConversationImages): Attachment[] {
  const shown = imageSources(markdown).flatMap((src) => imageNamed(images, src) ?? []);
  return [...new Map(shown.map((image) => [image.name, image])).values()];
}

// A Markdown that shows images of the conversation goes in a .zip with them, so they are there when it is opened; one
// without, as the .md alone
export function saveMarkdownFile(filename: string, markdown: string, images: ConversationImages) {
  const shown = shownImages(markdown, images);
  if (shown.length === 0) return saveMarkdown(filename, markdown);
  return saveMarkdownZip(
    filename,
    markdown,
    shown.map((image) => ({ name: image.name, data: image.data ?? "" })),
  );
}
