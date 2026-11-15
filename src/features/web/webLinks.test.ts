import { describe, expect, it } from "vitest";
import { linksIn, MAX_LINKS, pageAttachment } from "./webLinks";

describe("linksIn", () => {
  it("finds http and https links, without the punctuation that ends the sentence", () => {
    expect(linksIn("Resume https://tauri.app/blog/tauri-20/. Y esto: (http://example.com/a)")).toEqual([
      "https://tauri.app/blog/tauri-20/",
      "http://example.com/a",
    ]);
  });

  it("keeps a closing parenthesis that belongs to the link", () => {
    expect(linksIn("Mira https://es.wikipedia.org/wiki/Rust_(lenguaje_de_programación)")).toEqual([
      "https://es.wikipedia.org/wiki/Rust_(lenguaje_de_programación)",
    ]);
  });

  it("counts each link once, ignores other schemes and stops at the limit", () => {
    expect(linksIn("https://a.com https://a.com ftp://b.com mailto:x@y.com http://localhost:3000")).toEqual([
      "https://a.com",
    ]);
    const many = Array.from({ length: 5 }, (_, i) => `https://site${i}.com`).join(" ");
    expect(linksIn(many)).toHaveLength(MAX_LINKS);
  });

  it("finds nothing in plain text", () => {
    expect(linksIn("Esto no tiene enlaces, solo www.texto")).toEqual([]);
  });
});

describe("pageAttachment", () => {
  it("keeps the page as a text file named after its title, with its address", () => {
    const page = { url: "https://tauri.app/blog/", title: "Tauri 2.0", text: "Texto", truncated: false };
    expect(pageAttachment(page)).toMatchObject({ kind: "text", name: "Tauri 2.0", data: "Texto", url: page.url });
  });

  it("uses the domain without a title", () => {
    const page = { url: "https://www.example.com/x", title: " ", text: "Texto", truncated: false };
    expect(pageAttachment(page).name).toBe("example.com");
  });
});
