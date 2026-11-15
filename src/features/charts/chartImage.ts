import { currentLocale, i18n } from "@/shared/i18n/i18n";
import type { Theme } from "@/shared/storage/settings";
import { type DiagramImage, svgImage } from "@/features/markdown/svgImage";
import { readChart } from "./chartSpec";
import { chartSvg } from "./chartSvg";

// A ```chart block as an image; rejects with what is wrong with it, in the interface's language
export async function renderChart(code: string, theme: Theme): Promise<DiagramImage> {
  const reading = readChart(code);
  if ("problem" in reading) throw new Error(i18n.t(`markdown.chartErrors.${reading.problem}`));
  return svgImage(chartSvg(reading.spec, theme, currentLocale()));
}
