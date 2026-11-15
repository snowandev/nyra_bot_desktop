import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { replyAsMarkdown } from "@/features/documents/documents";
import { savePdf } from "@/features/documents/documentStorage";
import { saveMarkdownFile } from "@/features/documents/markdownFiles";
import { i18n } from "@/shared/i18n/i18n";
import { errorMessage } from "@/shared/lib/errors";
import { pdfOf } from "@/features/documents/pdfOf";
import { usePreferencesContext } from "@/features/settings/preferencesContext";
import { QUALITY_SCALE, type ShareAction } from "./share";
import { copyImage, saveImage } from "./shareStorage";
import { replyImage } from "./replyImage";
import type { Message } from "@/shared/types";
import type { ConversationImages } from "@/features/markdown/conversationImages";
import { useStableCallback } from "@/shared/hooks/useStableCallback";

// The user message the reply answers: the closest one before it
function questionFor(messages: Message[], index: number) {
  for (let i = index - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return undefined;
}

// Exports a reply: as an image (the card is rendered off screen only while it is being captured) or as Markdown.
// images: the conversation's, which its documents may name; in the PDF they are drawn.
export function useMessageShare(messages: Message[], images: ConversationImages) {
  const [index, setIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const isBusy = useRef(false);
  const { preferences } = usePreferencesContext();
  const scale = QUALITY_SCALE[preferences.shareImageQuality];

  // Resolves to true when it was copied or saved; false if cancelled or failed
  const share = useStableCallback(async (messageIndex: number, action: ShareAction) => {
    if (isBusy.current) return false;
    isBusy.current = true;
    setError(null);
    try {
      if (action === "markdown" || action === "pdf") {
        // The whole reply, so it isn't named after one of its documents
        const markdown = replyAsMarkdown(messages[messageIndex].content);
        // The name the save dialog offers and the PDF's title follow the interface's language
        const name = i18n.t("share.fileName");
        if (action === "markdown") return await saveMarkdownFile(`${name}.md`, markdown, images);
        return await savePdf(`${name}.pdf`, await pdfOf(markdown, i18n.t("share.pdfTitle"), images));
      }
      // Synchronous, so the card is in the page before the capture reads it
      flushSync(() => setIndex(messageIndex));
      const node = cardRef.current;
      if (!node) return false;
      let png: Uint8Array;
      try {
        png = await replyImage(node, scale);
      } catch (e) {
        // The capture library's errors are technical and in English
        throw new Error(i18n.t("share.imageFailed"), { cause: e });
      }
      if (action === "save") return await saveImage(png);
      await copyImage(png);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      isBusy.current = false;
      setIndex(null);
    }
  });

  const answer = index === null ? undefined : messages[index];
  const card = answer && index !== null ? { answer, question: questionFor(messages, index) } : null;

  return { share, shareCard: card, shareCardRef: cardRef, shareError: error, dismissShareError: () => setError(null) };
}
