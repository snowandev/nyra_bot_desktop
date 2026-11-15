import { canvasPng, drawCanvas, scaleFor } from "./share";

// KaTeX places the pieces of a formula with positioned boxes, which WebKit paints unscaled in a capture (tiny and out
// of place). Before the capture each formula becomes a picture drawn at the final size: copies of all of them go on one
// sheet, drawn once (each drawing waits about a second for its fonts) and cut into pieces. The PDF uses them too.

// A formula as a PNG, with the size in pixels it has on the page
type FormulaPicture = { png: Blob; width: number; height: number };

const SHEET_GAP_PX = 8;

// How far the formula reaches below the line its text sits on, so its picture sits on that line too
function depthBelowBaseline(formula: HTMLElement) {
  const marker = document.createElement("span");
  marker.style.display = "inline-block";
  formula.before(marker);
  const baseline = marker.getBoundingClientRect().bottom;
  marker.remove();
  return Math.max(0, formula.getBoundingClientRect().bottom - baseline);
}

// One under another: zoomed, WebKit didn't wrap them into rows the same way, and those past the edge came out blank.
// Copies keep the size and color of their formula, wherever it was (a heading, a link).
function sheetOf(formulas: HTMLElement[]) {
  const sheet = document.createElement("div");
  Object.assign(sheet.style, {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: `${SHEET_GAP_PX}px`,
    width: "max-content",
  });
  for (const formula of formulas) {
    const copy = formula.cloneNode(true) as HTMLElement;
    const { fontSize, color } = getComputedStyle(formula);
    // A block formula's centering would push the zoomed drawing off the sheet
    Object.assign(copy.style, { display: "inline-block", margin: "0", textAlign: "left", fontSize, color });
    sheet.append(copy);
  }
  return sheet;
}

function cut(canvas: HTMLCanvasElement, x: number, y: number, width: number, height: number) {
  const piece = document.createElement("canvas");
  piece.width = Math.ceil(width);
  piece.height = Math.ceil(height);
  piece.getContext("2d")?.drawImage(canvas, x, y, width, height, 0, 0, piece.width, piece.height);
  return canvasPng(piece);
}

// The sheet goes inside host while it is drawn, so the copies have the page's styles and fonts
export async function drawFormulas(
  host: HTMLElement,
  formulas: HTMLElement[],
  preferred: number,
): Promise<FormulaPicture[]> {
  const sheet = sheetOf(formulas);
  host.append(sheet);
  try {
    const origin = sheet.getBoundingClientRect();
    const boxes = [...sheet.children].map((copy) => copy.getBoundingClientRect());
    const scale = scaleFor(origin.width, origin.height, preferred);
    // Zoomed instead of scaled, which WebKit would do unscaled again
    const canvas = await drawCanvas(sheet, {
      width: Math.ceil(origin.width * scale),
      height: Math.ceil(origin.height * scale),
      scale: 1,
      style: { zoom: String(scale) },
    });
    return await Promise.all(
      boxes.map(async (box) => ({
        png: await cut(
          canvas,
          (box.left - origin.left) * scale,
          (box.top - origin.top) * scale,
          box.width * scale,
          box.height * scale,
        ),
        width: box.width,
        height: box.height,
      })),
    );
  } finally {
    sheet.remove();
  }
}

// Gives back what frees the pictures once the capture is done
export async function sharpenFormulas(node: HTMLElement, preferred: number): Promise<() => void> {
  const formulas = [...node.querySelectorAll<HTMLElement>(".katex")]
    .map((formula) => ({ formula, box: formula.getBoundingClientRect(), below: depthBelowBaseline(formula) }))
    .filter(({ box }) => box.width > 0 && box.height > 0);
  if (formulas.length === 0) return () => {};
  const drawn = await drawFormulas(
    node,
    formulas.map(({ formula }) => formula),
    preferred,
  );
  const urls = drawn.map((d) => URL.createObjectURL(d.png));
  const release = () => urls.forEach((url) => URL.revokeObjectURL(url));
  const pictures = await Promise.all(
    formulas.map(async ({ box, below }, i) => {
      const picture = new Image(box.width, box.height);
      picture.src = urls[i];
      picture.alt = "";
      picture.style.verticalAlign = `${-below}px`;
      await picture.decode();
      return picture;
    }),
  ).catch((e: unknown) => {
    // One that can't be shown: none is put in, and all of them go
    release();
    throw e;
  });
  formulas.forEach(({ formula }, i) => {
    for (const part of formula.children) (part as HTMLElement).style.display = "none";
    // KaTeX positions the formula's own box too, and WebKit would paint the picture inside it unscaled as well
    formula.style.position = "static";
    formula.append(pictures[i]);
  });
  return release;
}
