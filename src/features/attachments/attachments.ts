import { extensionOf } from "@/shared/lib/paths";
import type { Attachment, Message, PdfVisual } from "@/shared/types";
import { documentAttachmentsAt, documentAttachmentsOf } from "@/features/documents/documents";
import { i18n } from "@/shared/i18n/i18n";
import { formatBytes, textBytes } from "@/shared/lib/format";
import { MAX_ATTACHED_PDF_IMAGES, isPasswordError, isPdf, type ReadPdfOptions, readPdf } from "./pdf";
import { latestOfEachLineage, lineageOf } from "./sheetVersions";
import { readSpreadsheet } from "./spreadsheetStorage";
import { domainOf } from "@/shared/lib/links";
import { asAttribute, neutralizeAppTags } from "@/features/chat/reply/appTags";
import { AUDIO_EXTENSIONS, clock } from "@/features/transcription/transcript";
import { audioForModel } from "@/features/transcription/audioFiles";
import { decodedText } from "./textDecoding";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const TEXT_EXTENSIONS = [
  "txt", "md", "markdown", "json", "csv", "tsv", "xml", "yaml", "yml", "toml", "ini", "log",
  "html", "css", "scss", "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "kt", "c",
  "h", "cpp", "hpp", "cs", "php", "sh", "sql", "swift", "vue", "svelte",
];
// Read by Rust into one table per sheet
const SPREADSHEET_TYPES: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xls: "application/vnd.ms-excel",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
};
const PDF_TYPE = "application/pdf";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_FILES = [
  ...IMAGE_TYPES,
  PDF_TYPE,
  ".pdf",
  ...[...TEXT_EXTENSIONS, ...Object.keys(SPREADSHEET_TYPES), ...AUDIO_EXTENSIONS].map((ext) => `.${ext}`),
].join(",");

export function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Models can't read PDFs: they get the text, and vision models also the pages and figures the text can't carry
async function readPdfFile(file: File, options: ReadPdfOptions) {
  let content: Awaited<ReturnType<typeof readPdf>>;
  try {
    content = await readPdf(await file.arrayBuffer(), { ...options, maxImages: MAX_ATTACHED_PDF_IMAGES });
  } catch (e) {
    if (options.signal?.aborted) throw e;
    const named = { name: file.name };
    if (isPasswordError(e)) throw new Error(i18n.t("attachments.errors.passwordProtected", named), { cause: e });
    // pdf.js errors are in English and technical; the likely cause is enough for the user
    throw new Error(i18n.t("attachments.errors.pdfDamaged", named), { cause: e });
  }
  if (new Blob([content.text]).size > MAX_TEXT_BYTES) {
    throw new Error(i18n.t("attachments.errors.pdfTextTooLarge", { name: file.name }));
  }
  return content;
}

// The options only apply to PDFs, the one kind slow enough to need progress and cancelling
export async function readAttachment(file: File, pdfOptions: ReadPdfOptions = {}): Promise<Attachment> {
  const base = { id: crypto.randomUUID(), name: file.name, mimeType: file.type };
  const named = { name: file.name };

  if (IMAGE_TYPES.includes(file.type)) {
    if (file.size > MAX_IMAGE_BYTES) throw new Error(i18n.t("attachments.errors.over10MB", named));
    return { ...base, kind: "image", data: await readAsBase64(file) };
  }

  if (isPdf(file)) {
    if (file.size > MAX_PDF_BYTES) throw new Error(i18n.t("attachments.errors.over10MB", named));
    // The file itself is kept for the viewer, which draws it as it is
    const [{ text, visuals, pageCount, visualsUpToPage }, pdf] = await Promise.all([
      readPdfFile(file, pdfOptions),
      readAsBase64(file),
    ]);
    return {
      ...base,
      mimeType: PDF_TYPE,
      kind: "pdf",
      data: text,
      pdf,
      pageCount,
      ...(visuals.length > 0 && { visuals }),
      ...(visualsUpToPage !== undefined && { visualsUpToPage }),
    };
  }

  const spreadsheetType = SPREADSHEET_TYPES[extensionOf(file.name)];
  if (spreadsheetType) {
    if (file.size > MAX_SPREADSHEET_BYTES) throw new Error(i18n.t("attachments.errors.over10MB", named));
    const [text, workbook] = await Promise.all([
      readSpreadsheet(new Uint8Array(await file.arrayBuffer())).catch((e: unknown) => {
        throw new Error(i18n.t("attachments.errors.spreadsheetUnreadable", named), { cause: e });
      }),
      readAsBase64(file),
    ]);
    return { ...base, mimeType: spreadsheetType, kind: "text", data: text, workbook };
  }

  if (file.type.startsWith("text/") || TEXT_EXTENSIONS.includes(extensionOf(file.name))) {
    if (file.size > MAX_TEXT_BYTES) throw new Error(i18n.t("attachments.errors.over1MB", named));
    const text = decodedText(new Uint8Array(await file.arrayBuffer()));
    if (text === null) throw new Error(i18n.t("attachments.errors.notText", named));
    return { ...base, kind: "text", data: text };
  }

  throw new Error(i18n.t("attachments.errors.unsupported", named));
}

// Spreadsheets and rich text also put an image of the selection on the clipboard; then the user wants the text
export function pastedFiles(clipboard: DataTransfer): File[] {
  if (clipboard.getData("text/plain")) return [];
  // Screenshots pasted from the clipboard can arrive without a name
  return Array.from(clipboard.files).map((file) =>
    file.name
      ? file
      : new File([file], `${i18n.t("attachments.pastedName")}.${file.type.split("/")[1] ?? "png"}`, { type: file.type }),
  );
}

export function imageSrc(attachment: Pick<Attachment, "mimeType" | "data">) {
  return `data:${attachment.mimeType};base64,${attachment.data}`;
}

export function pdfPageSrc(page: string) {
  return `data:image/jpeg;base64,${page}`;
}

// The model sees a PDF's images after its text; this says which page each one is
function visualsNote(visuals: PdfVisual[], upToPage?: number) {
  const described = visuals.map((v) => `page ${v.page} (${v.kind === "page" ? "whole page" : "figure"})`);
  const cut =
    upToPage === undefined
      ? ""
      : ` Images after page ${upToPage} were not sent, only their text: if one is needed, ask the user to attach it.`;
  return `[Images of this PDF sent with the message, in order: ${described.join(", ")}.${cut}]`;
}

// Text files and the text of PDFs travel inside the prompt so they work with any model. Their content and names can
// come from anywhere (a downloaded file, a web page's title), so Nyra's own tags lose their "<" on the way: a file
// can't close itself and pass for the app. What is stored and shown stays as it was.
export function contentWithTextFiles(message: Message) {
  const attached = message.attachments ?? [];
  const files = attached.filter((a) => a.kind !== "image");
  if (files.length === 0) return message.content;
  // A page from a link says where it came from, so the model can name it. An audio says how to have it transcribed,
  // or which file holds its transcript.
  const blocks = files.map((f) =>
    f.kind === "audio"
      ? audioForModel(f, attached.find((a) => a.id === f.transcript))
      : `<file name="${asAttribute(f.name)}"${f.url ? ` url="${asAttribute(f.url)}"` : ""}>\n` +
        `${neutralizeAppTags(f.data)}\n${f.visuals?.length ? `${visualsNote(f.visuals, f.visualsUpToPage)}\n` : ""}</file>`,
  );
  return [...blocks, message.content].filter(Boolean).join("\n\n");
}

// Every image the model sees in a message: attached images and, of attached PDFs, the pages and figures that need
// one (or every page, for PDFs attached with earlier versions)
export function imageInputsOf(message: Message): { data: string; mimeType: string }[] {
  return (message.attachments ?? []).flatMap((a) =>
    a.kind === "image"
      ? [{ data: a.data, mimeType: a.mimeType }]
      : (a.visuals?.map((v) => v.data) ?? a.pages ?? []).map((data) => ({ data, mimeType: "image/jpeg" })),
  );
}

export function imagesOf(message: Message) {
  return imageInputsOf(message).map((image) => image.data);
}

// Models without vision get only the text of PDFs; their images would be rejected or ignored
export function withoutPdfImages(messages: Message[]): Message[] {
  return messages.map((m) =>
    m.attachments
      ? { ...m, attachments: m.attachments.map(({ pages: _pages, visuals: _visuals, ...a }) => a) }
      : m,
  );
}

export function attachmentsOf(messages: Message[]) {
  return messages.flatMap((m) => m.attachments ?? []);
}

// What the user attached plus the documents Nyra wrote; only the first are stored as attachments
export function filesOf(messages: Message[]) {
  return [...attachmentsOf(messages), ...documentAttachmentsOf(messages)];
}

// Where each file came from: the message it was attached to (the first one, for a file referenced again later) or,
// for a document Nyra wrote, its reply
export function fileOriginsOf(messages: Message[]) {
  const origins = new Map<string, number>();
  messages.forEach((m, i) => {
    for (const file of [...(m.attachments ?? []), ...documentAttachmentsAt(m, i)]) {
      if (!origins.has(file.id)) origins.set(file.id, i);
    }
  });
  return origins;
}

function attachmentsById(messages: Message[]) {
  return new Map(filesOf(messages).map((a) => [a.id, a] as const));
}

export function referencedAttachments(message: Message, byId: Map<string, Attachment>) {
  return (message.references ?? []).flatMap((id) => byId.get(id) ?? []);
}

// Turns references into real attachments, so the model receives the file as if it had been attached again
export function withReferencedFiles(messages: Message[]): Message[] {
  if (!messages.some((m) => m.references?.length)) return withLatestSheetVersions(messages);
  const byId = attachmentsById(messages);
  return withLatestSheetVersions(
    messages.map((m) => {
      const referenced = referencedAttachments(m, byId);
      return referenced.length > 0 ? { ...m, attachments: [...(m.attachments ?? []), ...referenced] } : m;
    }),
  );
}

// Of an attached spreadsheet, only its latest version goes to the model, which makes the next changes on it; the
// earlier ones would only fill the context
function withLatestSheetVersions(messages: Message[]): Message[] {
  if (!messages.some((m) => m.attachments?.some((a) => a.version))) return messages;
  const latest = latestOfEachLineage(messages);
  const superseded = (a: Attachment) => !!a.workbook && latest.get(lineageOf(a)) !== a;
  return messages.map((m) =>
    m.attachments?.some(superseded)
      ? {
          ...m,
          attachments: m.attachments.map((a) =>
            superseded(a)
              ? { ...a, workbook: undefined, data: `[An earlier version of ${a.name}; a later message has the current one]` }
              : a,
          ),
        }
      : m,
  );
}

// Names of formats stay as they are; the two generic ones (ods, txt) are in the catalog
const FILE_TYPES: Record<string, { label: string; color: string }> = {
  py: { label: "Python", color: "var(--orange)" },
  js: { label: "JavaScript", color: "var(--highlight)" },
  jsx: { label: "JavaScript", color: "var(--highlight)" },
  ts: { label: "TypeScript", color: "var(--info)" },
  tsx: { label: "TypeScript", color: "var(--info)" },
  json: { label: "JSON", color: "var(--highlight)" },
  md: { label: "Markdown", color: "var(--accent)" },
  pdf: { label: "PDF", color: "var(--danger)" },
  rs: { label: "Rust", color: "var(--orange)" },
  html: { label: "HTML", color: "var(--accent-secondary)" },
  css: { label: "CSS", color: "var(--info)" },
  csv: { label: "CSV", color: "var(--success)" },
  xlsx: { label: "Excel", color: "var(--success)" },
  xlsm: { label: "Excel", color: "var(--success)" },
  xls: { label: "Excel", color: "var(--success)" },
  ods: { label: "", color: "var(--success)" },
  txt: { label: "", color: "var(--text-soft)" },
};
const GENERIC_LABELS: Record<string, () => string> = {
  ods: () => i18n.t("attachments.types.spreadsheet"),
  txt: () => i18n.t("attachments.types.text"),
};

export function fileTypeOf(attachment: Attachment) {
  if (attachment.url) return { label: i18n.t("attachments.types.webPage"), color: "var(--info)", ext: "" };
  const ext = extensionOf(attachment.name);
  if (attachment.kind === "image") {
    const format = attachment.mimeType.split("/")[1]?.toUpperCase() ?? "";
    const label = format ? i18n.t("attachments.types.imageFormat", { format }) : i18n.t("attachments.types.image");
    return { label, color: "var(--accent-secondary)", ext };
  }
  if (attachment.kind === "pdf") return { ...FILE_TYPES.pdf, ext: "pdf" };
  if (attachment.kind === "audio") return { label: i18n.t("transcription.type"), color: "var(--workspace)", ext };
  const known = FILE_TYPES[ext];
  if (known) return { ...known, label: GENERIC_LABELS[ext]?.() ?? known.label, ext };
  return { label: ext.toUpperCase() || i18n.t("attachments.types.text"), color: "var(--accent)", ext };
}

// Base64 encodes 3 bytes in 4 characters, and pads the last group with "="
const base64Bytes = (base64: string) => (base64.length * 3) / 4 - (base64.match(/=*$/)?.[0].length ?? 0);

// A spreadsheet weighs what its file does, not its text
function sizeOf(attachment: Attachment) {
  if (attachment.workbook) return base64Bytes(attachment.workbook);
  return attachment.kind === "image" ? base64Bytes(attachment.data) : textBytes(attachment.data);
}

// Files usually end with a newline that shouldn't count as an extra line
export function textLinesOf(attachment: Attachment) {
  return attachment.data.replace(/\r?\n$/, "");
}

export function describeAttachment(attachment: Attachment) {
  if (attachment.url) return i18n.t("attachments.webPageFrom", { domain: domainOf(attachment.url) });
  if (attachment.kind === "audio") return `${fileTypeOf(attachment).label} · ${clock(attachment.duration ?? 0)}`;
  const pageCount = attachment.pageCount ?? attachment.pages?.length ?? 0;
  const detail =
    attachment.kind === "pdf" ? i18n.t("attachments.pages", { count: pageCount }) : formatBytes(sizeOf(attachment));
  return `${fileTypeOf(attachment).label} · ${detail}`;
}
