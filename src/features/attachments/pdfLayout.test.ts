import { describe, expect, it } from "vitest";
import { type Box, DRAWING_PATHS, IDENTITY, imageBox, multiply, pageLayout } from "./pdfLayout";

// A4 in PDF units
const view: Box = [0, 0, 595, 842];
const text = "x".repeat(2000);

describe("pageLayout", () => {
  const chart: Box = [100, 300, 500, 600];
  it.each<[string, Parameters<typeof pageLayout>[0], ReturnType<typeof pageLayout>]>([
    [
      "sends a page of text as text only, ignoring logos and rules",
      { view, images: [[20, 800, 60, 830]], paths: 12, textChars: text.length },
      { kind: "text" },
    ],
    ["sends a scanned page whole", { view, images: [view], paths: 0, textChars: 0 }, { kind: "page" }],
    [
      "sends a scan with a hidden text layer whole too",
      { view, images: [view], paths: 0, textChars: text.length },
      { kind: "page" },
    ],
    [
      "cuts out the figure of a page of text",
      { view, images: [chart], paths: 3, textChars: text.length },
      { kind: "figures", boxes: [chart] },
    ],
    [
      "joins the strips of one image into one figure",
      {
        view,
        images: [
          [100, 400, 400, 500],
          [100, 300, 400, 401],
        ],
        paths: 0,
        textChars: text.length,
      },
      { kind: "figures", boxes: [[100, 300, 400, 500]] },
    ],
    [
      "sends a chart drawn with lines whole, since there is no image to cut",
      { view, images: [], paths: DRAWING_PATHS, textChars: text.length },
      { kind: "page" },
    ],
    [
      "sends whole a page with little text and something drawn",
      { view, images: [[200, 200, 260, 260]], paths: 0, textChars: 40 },
      { kind: "page" },
    ],
    ["leaves an empty page out", { view, images: [], paths: 0, textChars: 0 }, { kind: "text" }],
    [
      "ignores what is drawn outside the page",
      { view, images: [[700, 0, 900, 842]], paths: 0, textChars: text.length },
      { kind: "text" },
    ],
  ])("%s", (_, page, layout) => {
    expect(pageLayout(page)).toEqual(layout);
  });
});

describe("imageBox", () => {
  it("places an image where its matrix draws the unit square", () => {
    const placed = multiply(multiply(IDENTITY, [1, 0, 0, 1, 50, 100]), [200, 0, 0, 150, 0, 0]);
    expect(imageBox(placed)).toEqual([50, 100, 250, 250]);
  });
});
