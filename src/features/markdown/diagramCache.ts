import type { DiagramImage } from "./svgImage";

// Diagrams already drawn, by kind, theme and code: opening a conversation again shows them at once instead of drawing
// each one anew. The oldest go past this many; each image is a data URL that can weigh a few hundred kilobytes.
const MAX_DRAWN = 40;

export type Drawn = { image: DiagramImage } | { error: string };

const drawn = new Map<string, Drawn>();

export const drawnDiagram = (key: string): Drawn | undefined => drawn.get(key);

// Also when one is shown again: the latest used goes last, so it is the last to go
export function keepDrawn(key: string, result: Drawn) {
  drawn.delete(key);
  drawn.set(key, result);
  if (drawn.size > MAX_DRAWN) drawn.delete(drawn.keys().next().value as string);
}
