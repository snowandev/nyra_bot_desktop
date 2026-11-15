// Decides, page by page, what a vision model needs to see of a PDF besides its text: nothing (a page of text), the
// whole page (a scan, a slide, a chart drawn with lines) or only the figures on a page of text. Pure, so it is
// tested without pdf.js; pdf.ts feeds it what each page draws.

// [x0, y0, x1, y1] in PDF units
export type Box = [number, number, number, number];
// A PDF transformation matrix [a, b, c, d, e, f]
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

// Images covering this share of the page or more make it a picture of a page (a scan, a slide)
const PICTURE_PAGE_COVERAGE = 0.5;
// Smaller images are logos, icons and rules, not content worth the tokens
const MIN_FIGURE_SHARE = 0.04;
// A page with less text than this and something drawn on it is read from its picture (title pages, scans with a
// stray line of text)
const SPARSE_TEXT_CHARS = 200;
// Charts and diagrams are often drawn with lines instead of images; this many shapes means the page has one
export const DRAWING_PATHS = 400;
// On a page with little text, fewer shapes than this are rules and borders, not a drawing
const SPARSE_PAGE_PATHS = 20;
// More figures than this on one page cost more than the page itself
const MAX_FIGURES_PER_PAGE = 3;

type PageLayout = { kind: "text" } | { kind: "page" } | { kind: "figures"; boxes: Box[] };

// The same composition the PDF renderer uses: m2 applied inside m1
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

// An image is drawn in the unit square under the current matrix
export function imageBox(m: Matrix): Box {
  const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
  const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const areaOf = ([x0, y0, x1, y1]: Box) => Math.max(0, x1 - x0) * Math.max(0, y1 - y0);

function clip([x0, y0, x1, y1]: Box, [px0, py0, px1, py1]: Box): Box {
  return [Math.max(x0, px0), Math.max(y0, py0), Math.min(x1, px1), Math.min(y1, py1)];
}

const overlap = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

// Overlapping figures (an image split in strips, a photo with its frame) are cut out as one
function merged(boxes: Box[]): Box[] {
  const out: Box[] = [];
  for (const box of boxes) {
    let current = box;
    for (let i = out.length - 1; i >= 0; i--) {
      if (!overlap(out[i], current)) continue;
      const other = out.splice(i, 1)[0];
      current = [
        Math.min(other[0], current[0]),
        Math.min(other[1], current[1]),
        Math.max(other[2], current[2]),
        Math.max(other[3], current[3]),
      ];
    }
    out.push(current);
  }
  return out;
}

export function pageLayout({ view, images, paths, textChars }: { view: Box; images: Box[]; paths: number; textChars: number }): PageLayout {
  const pageArea = areaOf(view);
  if (pageArea <= 0) return { kind: "text" };
  const visible = images.map((box) => clip(box, view)).filter((box) => areaOf(box) > 0);
  const coverage = Math.min(1, visible.reduce((sum, box) => sum + areaOf(box), 0) / pageArea);
  const figures = merged(visible.filter((box) => areaOf(box) / pageArea >= MIN_FIGURE_SHARE));

  if (coverage >= PICTURE_PAGE_COVERAGE || paths >= DRAWING_PATHS || figures.length > MAX_FIGURES_PER_PAGE) {
    return { kind: "page" };
  }
  if (textChars < SPARSE_TEXT_CHARS && (visible.length > 0 || paths >= SPARSE_PAGE_PATHS)) return { kind: "page" };
  return figures.length > 0 ? { kind: "figures", boxes: figures } : { kind: "text" };
}
