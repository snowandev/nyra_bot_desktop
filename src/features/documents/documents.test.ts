import { describe, expect, it } from "vitest";
import type { Message } from "@/shared/types";
import { withReferencedFiles } from "@/features/attachments/attachments";
import {
  documentAttachmentsOf,
  isGeneratedDocument,
  replyAsMarkdown,
  splitReply,
  withDocumentsInstruction,
} from "./documents";
import { fileStatesOf } from "@/features/chat/reply/summary";

const reply = [
  "Aquí lo tienes:",
  '<nyra-document title="Instalar Python en macOS" filename="Instalar Python.md">',
  "# Instalar Python",
  "",
  "```bash",
  "brew install python",
  "```",
  "</nyra-document>",
  "¿Algo más?",
].join("\n");

describe("splitReply", () => {
  it("keeps a normal reply as text", () => {
    expect(splitReply("Hola")).toEqual([{ kind: "text", text: "Hola" }]);
  });

  it("separates the document from the text around it, with code blocks inside", () => {
    const segments = splitReply(reply);
    expect(segments.map((s) => s.kind)).toEqual(["text", "document", "text"]);
    const document = segments[1].kind === "document" ? segments[1].document : null;
    expect(document).toEqual({
      title: "Instalar Python en macOS",
      filename: "instalar-python.md",
      content: "# Instalar Python\n\n```bash\nbrew install python\n```",
      isComplete: true,
    });
  });

  it("shows a document that is still being written", () => {
    const [, segment] = splitReply('Va:\n<nyra-document title="Notas">\n# Not');
    expect(segment).toEqual({
      kind: "document",
      document: { title: "Notas", filename: "notas.md", content: "# Not", isComplete: false },
    });
  });

  it("hides an opening tag that hasn't fully arrived", () => {
    expect(splitReply("Va:\n<nyra-doc", true)).toEqual([{ kind: "text", text: "Va:\n" }]);
    expect(splitReply('Va:\n<nyra-document title="No', true)).toEqual([{ kind: "text", text: "Va:\n" }]);
    expect(splitReply("a < b", true)).toEqual([{ kind: "text", text: "a < b" }]);
  });

  it("keeps the end of a finished reply as it is", () => {
    expect(splitReply("usa a <")).toEqual([{ kind: "text", text: "usa a <" }]);
  });

  it("reads a title that contains >", () => {
    const [segment] = splitReply('<nyra-document title="A > B" filename="ab.md">\n# AB\n</nyra-document>');
    expect(segment.kind === "document" && segment.document).toMatchObject({ title: "A > B", content: "# AB" });
  });

  it("never lets the model pick an unsafe file name", () => {
    const [segment] = splitReply('<nyra-document filename="../../etc/passwd">x</nyra-document>');
    expect(segment.kind === "document" && segment.document.filename).toBe("etc-passwd.md");
  });
});

describe("replyAsMarkdown", () => {
  it("drops the tags and keeps everything else", () => {
    expect(replyAsMarkdown(reply)).toBe(
      "Aquí lo tienes:\n\n# Instalar Python\n\n```bash\nbrew install python\n```\n\n¿Algo más?",
    );
  });
});

describe("generated documents as conversation files", () => {
  const answer: Message = { role: "assistant", content: reply };
  const [document] = documentAttachmentsOf([{ role: "user", content: "Hazme un markdown" }, answer]);
  const messages: Message[] = [
    { role: "user", content: "Hazme un markdown" },
    answer,
    { role: "user", content: "Gracias", references: [document.id] },
  ];

  it("lists each finished document with a stable id", () => {
    const [file] = documentAttachmentsOf(messages);
    expect(file).toMatchObject({ id: document.id, kind: "text", name: "instalar-python.md" });
    expect(isGeneratedDocument(file)).toBe(true);
    expect(documentAttachmentsOf(messages)[0]).toBe(file);
  });

  it("skips a document that is still being written", () => {
    const writing: Message = { role: "assistant", content: '<nyra-document title="A">\n# A' };
    expect(documentAttachmentsOf([writing])).toEqual([]);
  });

  it("sends a referenced document back to the model and tracks it in the summary", () => {
    const resolved = withReferencedFiles(messages);
    expect(resolved[2].attachments?.[0].name).toBe("instalar-python.md");
    expect(fileStatesOf(messages, { text: "…", fromIndex: 2 }).get(document.id)).toBe("referenced");
  });

  it("gives a regenerated document a new id, so old references don't point at it", () => {
    const regenerated: Message = { role: "assistant", content: reply.replace("brew", "port") };
    const [other] = documentAttachmentsOf([messages[0], regenerated]);
    expect(other.id).not.toBe(document.id);
  });
});

describe("withDocumentsInstruction", () => {
  it("goes with every user message, so the model knows in any language and however it is asked", () => {
    for (const content of ["Hazme un informe corto", "Give me that as a PDF", "¿Qué hora es en Tokio?"]) {
      const [sent] = withDocumentsInstruction([{ role: "user", content }]);
      expect(sent.content.startsWith(content)).toBe(true);
      expect(sent.content).toContain("<nyra-document");
    }
    // Only the latest user message, never a reply
    const reply: Message[] = [{ role: "assistant", content: "Hola" }];
    expect(withDocumentsInstruction(reply)).toBe(reply);
  });
});
