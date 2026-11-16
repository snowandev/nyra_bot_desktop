import { describe, expect, it } from "vitest";
import { boxFormatFor, boxOf, fitFor, groundingPrompt, locate, withinZoom } from "./screenGrounding";
import type { ScreenArea } from "./screenStorage";

function expectArea(actual: ScreenArea | null, expected: ScreenArea) {
  expect(actual).not.toBeNull();
  for (const key of ["x", "y", "width", "height"] as const) expect(actual?.[key]).toBeCloseTo(expected[key]);
}

const whole = { image: "whole", width: 1600, height: 900 };

describe("boxOf", () => {
  it("reads the box however the model wraps it, in fractions of the image", () => {
    expectArea(boxOf("[100, 200, 300, 400]"), { x: 0.1, y: 0.2, width: 0.2, height: 0.2 });
    expectArea(boxOf("The box is (300,400),(100,200)."), { x: 0.1, y: 0.2, width: 0.2, height: 0.2 });
  });

  it("keeps it on the image and refuses what isn't a box", () => {
    expect(boxOf("[-20, 0, 1200, 500]")).toEqual({ x: 0, y: 0, width: 1, height: 0.5 });
    expect(boxOf("I can't see it")).toBeNull();
    expect(boxOf("[10, 10, 10, 50]")).toBeNull();
  });

  it("reads each family's own way: Gemini's rows first, Claude's pixels", () => {
    // The same place, a box at x 0.1–0.3 and y 0.2–0.4 of a 1600×900 image
    expectArea(boxOf("[200, 100, 400, 300]", "thousandthsYX"), { x: 0.1, y: 0.2, width: 0.2, height: 0.2 });
    expectArea(boxOf("[160, 180, 480, 360]", "pixels", whole), { x: 0.1, y: 0.2, width: 0.2, height: 0.2 });
    // Past the edge, it stays on the image
    expectArea(boxOf("[1500, 800, 1700, 1000]", "pixels", whole), { x: 0.9375, y: 800 / 900, width: 0.0625, height: 100 / 900 });
  });
});

describe("boxFormatFor", () => {
  it("tells the family by the model, and asks each in its way", () => {
    expect(boxFormatFor({ id: "claude-sonnet-5-5", providerId: "anthropic" })).toBe("pixels");
    expect(boxFormatFor({ id: "gemini-3-flash", providerId: "gemini" })).toBe("thousandthsYX");
    expect(boxFormatFor({ id: "qwen3.8:27b", providerId: "ollama" })).toBe("thousandths");
    expect(fitFor("pixels")).toEqual({ width: 1568, pixels: 1_150_000 });
    expect(fitFor("thousandths")).toBeUndefined();
    expect(groundingPrompt("the 'Save' button", "pixels", whole)).toContain("1600×900 pixels");
    expect(groundingPrompt("x", "thousandthsYX", whole)).toContain("[ymin, xmin, ymax, xmax]");
  });
});

describe("locate", () => {
  it("corrects the first answer with a second look at a zoom around it", async () => {
    const asked: string[] = [];
    const area = await locate("the 'Save' button", {
      view: whole,
      format: "thousandths",
      see: async (image) => {
        asked.push(image);
        return image === "whole" ? "[400, 400, 600, 600]" : "[250, 250, 750, 750]";
      },
      zoom: async (x, y) => {
        expect([x, y]).toEqual([0.5, 0.5]);
        return { image: "zoomed", width: 800, height: 450, area: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 } };
      },
    });
    expect(asked).toEqual(["whole", "zoomed"]);
    expect(area?.x).toBeCloseTo(0.45);
    expect(area?.width).toBeCloseTo(0.1);
  });

  it("reads a zoom's pixels against the zoom's own size", async () => {
    const area = await locate("x", {
      view: whole,
      format: "pixels",
      see: async (image) => (image === "whole" ? "[640, 360, 960, 540]" : "[200, 112, 600, 338]"),
      zoom: async () => ({ image: "zoomed", width: 800, height: 450, area: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 } }),
    });
    expectArea(area, { x: 0.45, y: 0.45, width: 0.1, height: 0.1 });
  });

  it("looks first at the detailed screen when there is one, and at the view when there isn't", async () => {
    const asked: string[] = [];
    const see = async (image: string) => {
      asked.push(image);
      return "[400, 400, 600, 600]";
    };
    const zoom = async () => ({ image: "zoomed", width: 800, height: 450, area: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 } });
    const detailed = { image: "detailed", width: 2400, height: 1350 };
    await locate("x", { view: whole, overview: async () => detailed, format: "thousandths", see, zoom });
    expect(asked).toEqual(["detailed", "zoomed"]);
    asked.length = 0;
    await locate("x", { view: whole, overview: async () => null, format: "thousandths", see, zoom });
    expect(asked).toEqual(["whole", "zoomed"]);
  });

  it("keeps the first answer when the zoom gives none, and gives none without a first", async () => {
    const zoom = async () => ({ image: "zoomed", width: 800, height: 450, area: { x: 0, y: 0, width: 0.5, height: 0.5 } });
    const format = "thousandths" as const;
    const first = await locate("x", { view: whole, format, see: async (i) => (i === "whole" ? "[0,0,100,100]" : "no"), zoom });
    expect(first).toEqual({ x: 0, y: 0, width: 0.1, height: 0.1 });
    expect(await locate("x", { view: whole, format, see: async () => "nothing", zoom })).toBeNull();
  });

  it("maps a box on a zoom back to the screen", () => {
    const zoom = { x: 0.5, y: 0.5, width: 0.25, height: 0.25 };
    expectArea(withinZoom(zoom, { x: 0.5, y: 0, width: 0.5, height: 1 }), { x: 0.625, y: 0.5, width: 0.125, height: 0.25 });
  });
});
