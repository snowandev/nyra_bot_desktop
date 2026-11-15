// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { QUALITY_SCALE, scaleFor, whenDiagramsDrawn } from "./share";

describe("scaleFor", () => {
  it("uses four times the resolution for a normal reply", () => {
    expect(scaleFor(720, 900)).toBe(4);
  });

  it("lowers it so a very long reply still fits in a canvas", () => {
    const scale = scaleFor(720, 12_000);
    expect(scale).toBeLessThan(4);
    expect(720 * scale * 12_000 * scale).toBeLessThanOrEqual(60_000_000);
    expect(12_000 * scale).toBeLessThanOrEqual(16_384);
  });

  it("follows the quality chosen in Settings", () => {
    expect(scaleFor(720, 900, QUALITY_SCALE.normal)).toBe(3);
    expect(scaleFor(720, 900, QUALITY_SCALE.low)).toBe(2);
  });

  it("never goes below the screen's own size", () => {
    expect(scaleFor(720, 100_000)).toBe(1);
  });
});

describe("whenDiagramsDrawn", () => {
  it("waits until no diagram is still being drawn", async () => {
    const card = document.createElement("div");
    card.innerHTML = '<div class="diagram-loading">…</div>';
    setTimeout(() => (card.innerHTML = '<div class="diagram-picture"><img alt=""></div>'), 150);
    await whenDiagramsDrawn(card);
    expect(card.querySelector(".diagram-loading")).toBeNull();
  });
});
