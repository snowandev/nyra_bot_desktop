import { describe, expect, it } from "vitest";
import { imagesByName } from "@/features/markdown/conversationImages";
import type { Attachment } from "@/shared/types";
import { shownImages } from "./markdownFiles";

const image = (name: string): Attachment => ({ id: name, kind: "image", name, mimeType: "image/png", data: "AAAA" });

describe("shownImages", () => {
  it("takes once each image of the conversation the Markdown shows, and nothing from the web", () => {
    const images = imagesByName([image("panel.png"), image("Ventas mayo.png"), image("no-usada.png")]);
    const markdown = [
      "![Panel](panel.png)",
      "Otra vez: ![Panel](./panel.png)",
      "![Mayo](Ventas%20mayo.png)",
      "![Logo](https://ejemplo.com/logo.png)",
    ].join("\n\n");
    expect(shownImages(markdown, images).map((i) => i.name)).toEqual(["panel.png", "Ventas mayo.png"]);
    expect(shownImages("# Sin imágenes", images)).toEqual([]);
  });
});
