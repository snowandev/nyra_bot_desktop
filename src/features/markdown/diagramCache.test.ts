import { expect, it } from "vitest";
import { drawnDiagram, keepDrawn } from "./diagramCache";

const image = (n: number) => ({ image: { src: `data:image/svg+xml,${n}`, width: 10, height: 10, svg: "<svg/>" } });

it("keeps the latest drawn diagrams and lets the least used go first", () => {
  keepDrawn("primero", image(0));
  for (let i = 1; i < 40; i++) keepDrawn(`otro-${i}`, image(i));
  // Shown again, so it moves to the end
  keepDrawn("primero", drawnDiagram("primero")!);
  keepDrawn("nuevo", image(99));
  expect(drawnDiagram("primero")).toEqual(image(0));
  expect(drawnDiagram("otro-1")).toBeUndefined();
  expect(drawnDiagram("nuevo")).toEqual(image(99));
});
