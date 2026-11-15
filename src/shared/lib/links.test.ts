import { describe, expect, it } from "vitest";
import { isInlineImage, openableUrl } from "./links";

describe("openableUrl", () => {
  it("allows web and mail links", () => {
    expect(openableUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(openableUrl("http://example.com")).toBe("http://example.com/");
    expect(openableUrl("mailto:hola@example.com")).toBe("mailto:hola@example.com");
  });

  it("refuses anything that could run code or reach local files", () => {
    for (const href of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "file:///etc/passwd", "data:text/html,x", "/relativo", "", undefined]) {
      expect(openableUrl(href)).toBeNull();
    }
  });
});

describe("isInlineImage", () => {
  it("accepts only embedded raster images, which need no network", () => {
    expect(isInlineImage("data:image/png;base64,AAAA")).toBe(true);
    expect(isInlineImage("data:image/svg+xml;base64,AAAA")).toBe(false);
    expect(isInlineImage("https://example.com/a.png")).toBe(false);
  });
});
