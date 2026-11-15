import { describe, expect, it } from "vitest";
import type { Attachment } from "@/shared/types";
import { imageNamed, imagesByName } from "./conversationImages";

const capture: Attachment = { id: "1", kind: "image", name: "Panel de ventas.png", mimeType: "image/png", data: "AAAA" };

describe("imageNamed", () => {
  it("finds an image of the conversation however the model wrote its name", () => {
    const images = imagesByName([capture]);
    expect(imageNamed(images, "Panel de ventas.png")).toBe(capture);
    expect(imageNamed(images, "./Panel de ventas.png")).toBe(capture);
    expect(imageNamed(images, "Panel%20de%20ventas.png")).toBe(capture);
    expect(imageNamed(images, "https://ejemplo.com/Panel de ventas.png")).toBeUndefined();
    expect(imageNamed(images, "%E0%A4%A")).toBeUndefined();
  });
});
