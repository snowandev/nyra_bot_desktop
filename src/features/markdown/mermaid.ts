import type { Mermaid } from "mermaid";
import type { Theme } from "@/shared/storage/settings";
import { CHART_COLORS, CHART_LABEL } from "@/features/charts/chartColors";
import { type DiagramImage, svgImage } from "./svgImage";
import { loadOnce } from "@/shared/lib/loadOnDemand";

// Mermaid diagrams written by the model, drawn as images. An SVG shown through <img> can't run scripts nor load
// anything, so the model's diagram never becomes part of the page (no dangerouslySetInnerHTML).


let configuredTheme: Theme | null = null;
// Mermaid can't draw two diagrams at once; renders wait for each other
let queue: Promise<unknown> = Promise.resolve();
let renderCount = 0;

// Large, so it loads with the first diagram rather than with the app
const load = loadOnce<Mermaid>(() => import("mermaid").then((module) => module.default));


const chartVariables = (theme: Theme) => ({
  ...Object.fromEntries(CHART_COLORS.map((color, i) => [`pie${i + 1}`, color])),
  pieOpacity: "1",
  pieSectionTextColor: CHART_LABEL,
  // The slices are parted by a line of the page's color
  pieStrokeColor: theme === "dark" ? "#1d1a27" : "#ffffff",
  pieStrokeWidth: "2px",
  pieOuterStrokeWidth: "0px",
  // Over the diagram's own background, which the app paints, instead of a gray of its own
  xyChart: { plotColorPalette: CHART_COLORS.join(", "), backgroundColor: "transparent" },
});

function configure(mermaid: Mermaid, theme: Theme) {
  if (configuredTheme === theme) return;
  mermaid.initialize({
    startOnLoad: false,
    // No HTML, links nor click handlers inside the diagram
    securityLevel: "strict",
    // Plain SVG text, which an <img> can show (HTML labels would need the page)
    htmlLabels: false,
    theme: theme === "dark" ? "dark" : "default",
    themeVariables: chartVariables(theme),
    // A diagram may pick its colors, which then look the same in the chat and the PDF, but not its theme: one forced
    // dark on a light page lost its arrows and labels. The rest are the keys Mermaid already protects.
    secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "theme"],
    // Generic families exist on every system, and the image is drawn with the same font that measured the text
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
  });
  configuredTheme = theme;
}

// Rejects with Mermaid's own message when the code isn't a valid diagram
export function renderMermaid(code: string, theme: Theme): Promise<DiagramImage> {
  const render = async () => {
    const mermaid = await load();
    configure(mermaid, theme);
    // Checked first: a failed render can leave an error drawing behind in the page
    await mermaid.parse(code);
    const { svg } = await mermaid.render(`nyra-mermaid-${++renderCount}`, code);
    return svgImage(svg);
  };
  const result = queue.then(render, render);
  queue = result.catch(() => undefined);
  return result;
}
