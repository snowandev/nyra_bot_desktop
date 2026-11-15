import type { ConversationImages } from "@/features/markdown/conversationImages";
import { withRetries } from "@/shared/lib/loadOnDemand";

// The PDF export, with KaTeX and its fonts, loads the first time a PDF is made, not when Nyra starts
export async function pdfOf(markdown: string, title: string, images?: ConversationImages) {
  const { markdownToPdf } = await withRetries(() => import("./pdfExport"));
  return markdownToPdf(markdown, title, images);
}
