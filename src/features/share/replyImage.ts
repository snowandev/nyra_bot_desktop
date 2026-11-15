import { captureImage, sharpenDiagrams, whenDiagramsDrawn } from "./share";
import { loadKatex } from "@/features/markdown/katexPlugin";
import { sharpenFormulas } from "./formulaPictures";

// Frames to wait for the formulas to be drawn once KaTeX is there
const FORMULA_FRAMES = 10;

// A formula still waiting for KaTeX is shown as written ($$…$$): it is drawn before the capture
async function whenFormulasDrawn(node: HTMLElement) {
  if (!node.textContent?.includes("$$")) return;
  await loadKatex();
  for (let frame = 0; frame < FORMULA_FRAMES && node.textContent?.includes("$$"); frame++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

// A reply's card as the PNG Nyra shares: diagrams and formulas become sharp pictures first, and go back once captured
export async function replyImage(node: HTMLElement, scale: number): Promise<Uint8Array> {
  await whenDiagramsDrawn(node);
  await whenFormulasDrawn(node);
  let releaseDiagrams = () => {};
  let releaseFormulas = () => {};
  try {
    releaseDiagrams = await sharpenDiagrams(node, scale);
    releaseFormulas = await sharpenFormulas(node, scale);
    return await captureImage(node, scale);
  } finally {
    releaseDiagrams();
    releaseFormulas();
  }
}
