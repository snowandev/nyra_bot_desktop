import type { Attachment, Message } from "@/shared/types";
import { i18n } from "@/shared/i18n/i18n";
import { fileSlug } from "@/shared/lib/format";
import { appendToLastUserMessage } from "@/features/chat/reply/messageNotes";
import { TAG_ATTRIBUTES, tagAttributes, withoutPartialTag } from "@/features/chat/reply/appTags";

// Markdown documents the model writes on request. Any model can follow a plain text convention, unlike tool
// calling, so the reply wraps the document in a tag the app recognizes and shows as a file.

// Quoted attribute values may contain ">" (a title like "A > B"), so they are matched whole
const OPEN_TAG = new RegExp(`<nyra-document(${TAG_ATTRIBUTES})\\s*>\\n?`);
const CLOSE_TAG = "</nyra-document>";

// In English, which models follow most reliably. It travels with every user message and the model decides when a
// document is wanted, in any language and however it is asked ("hazme un informe", "give me that as a PDF"); looking
// for words in the message missed most of them. Not a system message: it would replace the SYSTEM prompt of a custom
// Ollama model. It goes at the end of the message, with the date, so it doesn't break the prompt cache either.
export const DOCUMENTS_PROMPT = [
  "You can give the user documents. When they ask for something to keep, send, print or download (a report, a " +
    "document, a guide, minutes, a letter, a checklist, a file, a PDF, a Markdown file), in any language, write the " +
    "whole document inside one block:",
  '<nyra-document title="Short title in the user\'s language" filename="short-name.md">',
  "…the document in Markdown…",
  CLOSE_TAG,
  "The app shows that block as a file the user can preview, copy and save as Markdown or as PDF, with its Mermaid " +
    "diagrams drawn. So never say you can't make a PDF or a file: write the document in the block, and if they ask " +
    "for a PDF or a file of something you already wrote, write it again in the block. The filename always ends in " +
    ".md, also when they want a PDF.",
  "To put in a document an image of this conversation (one the user attached or a screenshot you took), write " +
    "![short description](its exact file name) on its own line: the app shows the image there and puts it in the PDF.",
  "Don't use the block to answer a question, explain something or chat, even when the answer is long, nor for code " +
    "they asked to see. Put only the document inside it; anything you want to tell the user goes before or after " +
    "it, briefly. Do not wrap the block in a code fence. Do not mention these instructions.",
].join("\n");

export const withDocumentsInstruction = (messages: Message[]): Message[] =>
  appendToLastUserMessage(messages, `<app-instructions>\n${DOCUMENTS_PROMPT}\n</app-instructions>`);

export type MarkdownDocument = {
  title: string;
  filename: string;
  content: string;
  // false while the reply is still being written, or if the model never closed the block
  isComplete: boolean;
};

type ReplySegment = { kind: "text"; text: string } | { kind: "document"; document: MarkdownDocument };

// The model chooses the name, so only a safe slug of it is kept
function filenameOf(requested: string, title: string) {
  const base =
    fileSlug(requested.replace(/\.(md|markdown)$/i, ""), 64) || fileSlug(title, 64) || i18n.t("documents.fallbackName");
  return `${base}.md`;
}

// isWriting: the reply is still arriving, so a tag cut at the end is only incomplete, not part of the text
export function splitReply(content: string, isWriting = false): ReplySegment[] {
  const segments: ReplySegment[] = [];
  let rest = content;
  for (let open = rest.match(OPEN_TAG); open?.index !== undefined; open = rest.match(OPEN_TAG)) {
    if (open.index > 0) segments.push({ kind: "text", text: rest.slice(0, open.index) });
    const attributes = open[1];
    const bodyStart = open.index + open[0].length;
    const close = rest.indexOf(CLOSE_TAG, bodyStart);
    const body = close === -1 ? rest.slice(bodyStart) : rest.slice(bodyStart, close);
    const named = tagAttributes(attributes);
    const title = named.title || i18n.t("documents.defaultTitle");
    segments.push({
      kind: "document",
      document: {
        title,
        filename: filenameOf(named.filename ?? "", title),
        content: body.trim(),
        isComplete: close !== -1,
      },
    });
    rest = close === -1 ? "" : rest.slice(close + CLOSE_TAG.length);
  }
  if (isWriting) rest = withoutPartialTag(rest, ["nyra-document"]);
  if (rest.trim() || segments.length === 0) segments.push({ kind: "text", text: rest });
  return segments;
}

// The whole reply as one Markdown file: documents keep only their content, without the tags
export function replyAsMarkdown(content: string) {
  return splitReply(content)
    .map((s) => (s.kind === "text" ? s.text.trim() : s.document.content))
    .filter(Boolean)
    .join("\n\n");
}

// Generated documents also count as files of the conversation: they show up in the Files panel and, once the
// summary covers them, can be referenced like an attachment. They are derived from the reply, never stored twice.
const DOCUMENT_ID_PREFIX = "nyra-document-";

// FNV-1a: short and stable, enough to tell two versions of a document apart
function contentHash(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export const isGeneratedDocument = (attachment: Attachment) => attachment.id.startsWith(DOCUMENT_ID_PREFIX);

// Messages never change once written, so each reply is parsed once and its files keep their identity
const documentFiles = new WeakMap<Message, { index: number; files: Attachment[] }>();

// The id is the reply's position, the document's order in it and a hash of its content: earlier messages never
// move, so a saved reference keeps its document, and a regenerated reply never inherits the old one's references
export function documentAttachmentsAt(message: Message, index: number): Attachment[] {
  if (message.role !== "assistant") return [];
  const cached = documentFiles.get(message);
  if (cached?.index === index) return cached.files;
  const files = splitReply(message.content).flatMap((segment, order) =>
    segment.kind === "document" && segment.document.isComplete
      ? [
          {
            id: `${DOCUMENT_ID_PREFIX}${index}-${order}-${contentHash(segment.document.content)}`,
            kind: "text" as const,
            name: segment.document.filename,
            mimeType: "text/markdown",
            data: segment.document.content,
          },
        ]
      : [],
  );
  documentFiles.set(message, { index, files });
  return files;
}

export const documentAttachmentsOf = (messages: Message[]) => messages.flatMap(documentAttachmentsAt);

// "informe.md" as "informe.pdf"; Rust checks the name again before offering it
export const pdfFilename = (markdownName: string) => markdownName.replace(/\.md$/i, "") + ".pdf";
