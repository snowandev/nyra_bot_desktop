import { describe, expect, it } from "vitest";
import { type Box, DRAWING_PATHS, IDENTITY, imageBox, multiply, pageLayout } from "./pdfLayout";

// A4 in PDF units
const view: Box = [0, 0, 595, 842];
const text = "x".repeat(2000);

describe("pageLayout", () => {
  it("sends a page of text as text only, ignoring logos and rules", () => {
    const logo: Box = [20, 800, 60, 830];
    expect(pageLayout({ view, images: [logo], paths: 12, textChars: text.length })).toEqual({ kind: "text" });
  });

  it("sends a scanned page whole", () => {
    expect(pageLayout({ view, images: [view], paths: 0, textChars: 0 })).toEqual({ kind: "page" });
  });

  it("sends a scan with a hidden text layer whole too", () => {
    expect(pageLayout({ view, images: [[0, 0, 595, 842]], paths: 0, textChars: text.length })).toEqual({ kind: "page" });
  });

  it("cuts out the figure of a page of text", () => {
    const chart: Box = [100, 300, 500, 600];
    expect(pageLayout({ view, images: [chart], paths: 3, textChars: text.length })).toEqual({ kind: "figures", boxes: [chart] });
  });

  it("joins the strips of one image into one figure", () => {
    const top: Box = [100, 400, 400, 500];
    const bottom: Box = [100, 300, 400, 401];
    expect(pageLayout({ view, images: [top, bottom], paths: 0, textChars: text.length })).toEqual({
      kind: "figures",
      boxes: [[100, 300, 400, 500]],
    });
  });

  it("sends a chart drawn with lines whole, since there is no image to cut", () => {
    expect(pageLayout({ view, images: [], paths: DRAWING_PATHS, textChars: text.length })).toEqual({ kind: "page" });
  });

  it("sends whole a page with little text and something drawn", () => {
    expect(pageLayout({ view, images: [[200, 200, 260, 260]], paths: 0, textChars: 40 })).toEqual({ kind: "page" });
  });

  it("leaves an empty page out", () => {
    expect(pageLayout({ view, images: [], paths: 0, textChars: 0 })).toEqual({ kind: "text" });
  });

  it("ignores what is drawn outside the page", () => {
    expect(pageLayout({ view, images: [[700, 0, 900, 842]], paths: 0, textChars: text.length })).toEqual({ kind: "text" });
  });
});

describe("imageBox", () => {
  it("places an image where its matrix draws the unit square", () => {
    const placed = multiply(multiply(IDENTITY, [1, 0, 0, 1, 50, 100]), [200, 0, 0, 150, 0, 0]);
    expect(imageBox(placed)).toEqual([50, 100, 250, 250]);
  });
});
