import { readWorkspaceFile, type TextReadOutcome } from "./workspaceStorage";
import type { Attachment, WorkspaceSkipReason } from "@/shared/types";
import { scaledForModel } from "@/features/attachments/imageScale";
import { type PdfContent, readPdf } from "@/features/attachments/pdf";
import { base64ToBytes } from "@/shared/lib/base64";
import { linesOf } from "./workspace";
import { fileName } from "@/shared/lib/paths";

// Files of a connected folder as Nyra uses them. A PDF comes from Rust as it is; its text and pictures are read here,
// with the reader of attached PDFs, which works the same in every WebView.

// A reply may read the same PDF several times (parts of it); the latest ones are kept, and Rust is told which version
// is kept so it doesn't send the file again. Their pictures are large, so only a few.
const PDF_CACHE_SIZE = 4;
// By folder and path; size and modified say which version it is (a PDF changed without changing size is another one).
// withVisuals: whether its pictures were looked for, which a model without vision doesn't need.
type CachedPdf = { size: number; modified: number; content: PdfContent; withVisuals: boolean };
const pdfCache = new Map<string, CachedPdf>();

const pdfKey = (root: string, path: string) => `${root}\n${path}`;

function cachedPdf(key: string, withVisuals: boolean) {
  const cached = pdfCache.get(key);
  return cached && (cached.withVisuals || !withVisuals) ? cached : undefined;
}

async function pdfContent(key: string, pdf: { data: string; size: number; modified: number }, withVisuals: boolean) {
  const cached = cachedPdf(key, withVisuals);
  if (cached && cached.size === pdf.size && cached.modified === pdf.modified) return cached.content;
  const content = await readPdf(base64ToBytes(pdf.data), { withVisuals });
  pdfCache.delete(key);
  pdfCache.set(key, { size: pdf.size, modified: pdf.modified, content, withVisuals });
  if (pdfCache.size > PDF_CACHE_SIZE) pdfCache.delete(pdfCache.keys().next().value ?? "");
  return content;
}

const hasNoText = (content: PdfContent) => !content.text.trim();

// "[Page N]" before each page, so the model can ask for a page by its lines and knows which picture is which
function byPage(pageTexts: string[]) {
  const lines: string[] = [];
  const pageStarts: number[] = [];
  for (const [i, text] of pageTexts.entries()) {
    pageStarts.push(lines.length + 1);
    lines.push(`[Page ${i + 1}]`, ...(text.trim() ? text.trim().split("\n") : []));
  }
  return { text: lines.join("\n"), pageStarts };
}

// What the model reads: text files as Rust returns them, a PDF as its text by page (lines included) and, for vision
// models, the pictures of its scanned pages and figures
export async function readWorkspaceText(
  root: string,
  path: string,
  from?: number,
  to?: number,
  withVisuals = false,
): Promise<TextReadOutcome> {
  const key = pdfKey(root, path);
  const cached = cachedPdf(key, withVisuals);
  const known = cached && { size: cached.size, modified: cached.modified };
  const outcome = await readWorkspaceFile(root, path, from, to, known);
  if (outcome.kind === "image") {
    if (!withVisuals) return { kind: "skipped", reason: "imageNoVision" };
    let data: string;
    try {
      data = await scaledForModel(outcome.data, outcome.mimeType);
    } catch {
      return { kind: "skipped", reason: "unreadable" };
    }
    const visuals = [{ page: 1, kind: "page" as const, data }];
    return { kind: "read", content: "", totalLines: 1, from: 1, to: 1, size: outcome.size, pictures: { pageStarts: [1], visuals }, isImage: true };
  }
  if (outcome.kind !== "pdf" && outcome.kind !== "pdfUnchanged") return outcome;
  let content: PdfContent;
  let size: number;
  try {
    if (outcome.kind === "pdfUnchanged") {
      if (!cached) return { kind: "skipped", reason: "unreadable" };
      ({ content, size } = cached);
    } else {
      content = await pdfContent(key, outcome, withVisuals);
      size = outcome.size;
    }
  } catch {
    return { kind: "skipped", reason: "unreadable" };
  }
  const visuals = withVisuals ? content.visuals : [];
  if (hasNoText(content) && visuals.length === 0) {
    return { kind: "skipped", reason: withVisuals ? "noText" : "scannedNoVision" };
  }
  const { text, pageStarts } = byPage(content.pageTexts);
  return { kind: "read", ...linesOf(text, from, to), size, pictures: { pageStarts, visuals } };
}

// For the viewer: a PDF as the file itself, which the viewer draws as it is; any other file as text
export async function workspaceAttachment(
  root: string,
  path: string,
): Promise<Attachment | { kind: "skipped"; reason: WorkspaceSkipReason }> {
  const outcome = await readWorkspaceFile(root, path);
  if (outcome.kind === "skipped") return outcome;
  const base = { id: `workspace:${root}:${path}`, name: fileName(path) };
  if (outcome.kind === "read") return { ...base, kind: "text", mimeType: "text/plain", data: outcome.content };
  if (outcome.kind === "image") return { ...base, kind: "image", mimeType: outcome.mimeType, data: outcome.data };
  // Asked without a known version, so Rust always sends the file, which the viewer draws
  if (outcome.kind !== "pdf") return { kind: "skipped", reason: "unreadable" };
  try {
    // Only the text, for "Copiar texto": nothing is drawn here
    const { text, pageCount } = await pdfContent(pdfKey(root, path), outcome, false);
    return { ...base, kind: "pdf", mimeType: "application/pdf", data: text, pdf: outcome.data, pageCount };
  } catch {
    return { kind: "skipped", reason: "unreadable" };
  }
}

// An instruction file of the folder (NYRA.md, CLAUDE.md…), as text; null if it isn't there. Read by its path, not from
// the index: a project may keep it out of git (and so of the index) and still want it followed.
export async function readGuideFile(root: string, path: string) {
  const outcome = await readWorkspaceText(root, path).catch(() => null);
  return outcome?.kind === "read" ? outcome.content : null;
}
