import type { Theme } from "@/shared/storage/settings";
import { CHART_COLORS, CHART_LABEL } from "./chartColors";
import type { ChartSeries, ChartSpec } from "./chartSpec";

// A chart drawn as an SVG by Nyra, shown as an image like a Mermaid diagram. The text comes from the model, so every
// piece of it is escaped; colors were already checked to be color codes.

const WIDTH = 640;
const PLOT_HEIGHT = 240;
const PAD = 16;
const FONT = "ui-sans-serif, system-ui, sans-serif";
const TITLE_SIZE = 16;
const TEXT_SIZE = 12;
const SMALL_SIZE = 11;
// Text can't be measured without a page; this average width per letter keeps labels from running into each other
const LETTER_WIDTH = 0.56;
const MAX_LABEL_LETTERS = 18;
// Values are written over the bars only while they fit
const MAX_BARS_WITH_VALUES = 12;

type Ink = { text: string; muted: string; grid: string; axis: string; page: string };

// Around the chart, text and lines follow the theme; the chart's own colors don't
const INK: Record<Theme, Ink> = {
  light: { text: "#1f2328", muted: "#656d76", grid: "#e4e7eb", axis: "#afb8c1", page: "#ffffff" },
  dark: { text: "#f4f1fa", muted: "#a9a3b8", grid: "#363149", axis: "#5c5670", page: "#1d1a27" },
};

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const textWidth = (text: string, size: number) => [...text].length * size * LETTER_WIDTH;

const shortened = (text: string, letters: number) =>
  [...text].length > letters ? `${[...text].slice(0, letters - 1).join("")}…` : text;

const colorOf = (series: ChartSeries, index: number) => series.color ?? CHART_COLORS[index % CHART_COLORS.length];

const round = (n: number) => Math.round(n * 10) / 10;

// Currency signs usually go before the amount; any other unit after it
const UNIT_BEFORE = /^(?:\$|US\$|R\$|£|¥|₹|₩)$/;

// A percentage is written as the language writes it ("45 %" in Spanish, "45%" in English), like a pie's slices
function formatter(locale: string, unit: string | undefined, compact = false) {
  const numbers = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    ...(compact ? { notation: "compact" as const } : {}),
  });
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 });
  return (n: number) => {
    if (unit === "%") return percent.format(n / 100);
    const number = numbers.format(n);
    if (!unit) return number;
    return UNIT_BEFORE.test(unit) ? `${unit}${number}` : `${number} ${unit}`;
  };
}

// Round steps (1, 2, 2.5 or 5 times a power of ten) from zero or below to the largest value or above
export function axisTicks(low: number, high: number) {
  const min = Math.min(0, low);
  // All zeros still get an axis up to 1
  const max = Math.max(0, high) || (min === 0 ? 1 : 0);
  const range = max - min;
  const rough = range / 5;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? power * 10;
  const first = Math.floor(min / step) * step;
  const last = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let tick = first; tick <= last + step / 2; tick += step) ticks.push(Number(tick.toPrecision(12)));
  return ticks;
}

function svg(width: number, height: number, title: string | undefined, body: string[]) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
      `font-family="${FONT}">`,
    title ? `<title>${escape(title)}</title>` : "",
    ...body,
    "</svg>",
  ].join("");
}

function titleOf(spec: ChartSpec, ink: Ink, width: number) {
  if (!spec.title) return { parts: [], height: 0 };
  const title = shortened(spec.title, Math.floor(width / (TITLE_SIZE * LETTER_WIDTH)));
  return {
    parts: [
      `<text x="${width / 2}" y="${PAD + TITLE_SIZE}" text-anchor="middle" font-size="${TITLE_SIZE}" ` +
        `font-weight="600" fill="${ink.text}">${escape(title)}</text>`,
    ],
    height: TITLE_SIZE + 14,
  };
}

// Swatches with names, in as many rows as they need
function legendOf(items: { name: string; color: string }[], top: number, width: number, ink: Ink) {
  const parts: string[] = [];
  let x = PAD;
  let y = top;
  for (const { name, color } of items) {
    const label = shortened(name, 28);
    const itemWidth = 10 + 6 + textWidth(label, TEXT_SIZE) + 18;
    if (x + itemWidth > width - PAD && x > PAD) {
      x = PAD;
      y += 20;
    }
    parts.push(
      `<rect x="${round(x)}" y="${y}" width="10" height="10" rx="2" fill="${color}"/>`,
      `<text x="${round(x + 16)}" y="${y + 9.5}" font-size="${TEXT_SIZE}" fill="${ink.text}">${escape(label)}</text>`,
    );
    x += itemWidth;
  }
  return { parts, height: items.length > 0 ? y - top + 10 + 14 : 0 };
}

function barsAndLines(spec: ChartSpec, ink: Ink, locale: string) {
  const values = spec.series.flatMap((s) => s.values).filter((n): n is number => n !== null);
  const ticks = axisTicks(Math.min(...values, 0), Math.max(...values, 0));
  const bottomValue = ticks[0];
  const topValue = ticks[ticks.length - 1];
  const isLarge = Math.max(Math.abs(bottomValue), Math.abs(topValue)) >= 10_000;
  const axisText = formatter(locale, spec.unit, isLarge);
  const valueText = formatter(locale, spec.unit);

  const title = titleOf(spec, ink, WIDTH);
  const named = spec.series.filter((s) => s.name);
  const legend = legendOf(
    spec.series.length > 1 || named.length > 0 ? spec.series.map((s, i) => ({ name: s.name, color: colorOf(s, i) })) : [],
    PAD + title.height,
    WIDTH,
    ink,
  );
  const plotTop = PAD + title.height + legend.height + 8;
  const left = PAD + Math.max(...ticks.map((t) => textWidth(axisText(t), SMALL_SIZE))) + 10;
  const right = WIDTH - PAD;
  const plotWidth = right - left;
  const slot = plotWidth / spec.labels.length;

  // Labels lie flat while they fit their slot; otherwise they lean, and when there are many only some are written
  const labels = spec.labels.map((l) => shortened(l, MAX_LABEL_LETTERS));
  const widest = Math.max(...labels.map((l) => textWidth(l, SMALL_SIZE)));
  const isFlat = widest <= slot - 6;
  const every = isFlat ? 1 : Math.max(1, Math.ceil(16 / slot));
  const labelsHeight = isFlat ? 22 : Math.min(widest * 0.7, 90) + 16;
  const height = Math.round(plotTop + PLOT_HEIGHT + labelsHeight + PAD / 2);

  const y = (value: number) => plotTop + PLOT_HEIGHT - ((value - bottomValue) / (topValue - bottomValue)) * PLOT_HEIGHT;
  const parts: string[] = [...title.parts, ...legend.parts];

  for (const tick of ticks) {
    const at = round(y(tick));
    parts.push(
      `<line x1="${round(left)}" y1="${at}" x2="${right}" y2="${at}" stroke="${tick === 0 ? ink.axis : ink.grid}" ` +
        `stroke-width="1"/>`,
      `<text x="${round(left - 8)}" y="${at + 4}" text-anchor="end" font-size="${SMALL_SIZE}" fill="${ink.muted}">` +
        `${escape(axisText(tick))}</text>`,
    );
  }

  labels.forEach((label, i) => {
    if (i % every !== 0) return;
    const x = round(left + slot * (i + 0.5));
    const top = plotTop + PLOT_HEIGHT + 16;
    parts.push(
      isFlat
        ? `<text x="${x}" y="${top}" text-anchor="middle" font-size="${SMALL_SIZE}" fill="${ink.muted}">${escape(label)}</text>`
        : `<text x="${x}" y="${top - 6}" text-anchor="end" font-size="${SMALL_SIZE}" fill="${ink.muted}" ` +
            `transform="rotate(-40 ${x} ${top - 6})">${escape(label)}</text>`,
    );
  });

  const zero = y(Math.max(bottomValue, Math.min(0, topValue)));
  if (spec.type === "bar") {
    const group = slot * 0.72;
    const bar = group / spec.series.length;
    const withValues = spec.labels.length * spec.series.length <= MAX_BARS_WITH_VALUES;
    spec.series.forEach((series, s) => {
      series.values.forEach((value, i) => {
        if (value === null) return;
        const x = left + slot * i + (slot - group) / 2 + bar * s;
        const top = Math.min(y(value), zero);
        const barHeight = Math.max(Math.abs(zero - y(value)), 1);
        parts.push(
          `<rect x="${round(x + 1)}" y="${round(top)}" width="${round(Math.max(bar - 2, 1))}" ` +
            `height="${round(barHeight)}" rx="2" fill="${colorOf(series, s)}"/>`,
        );
        if (withValues) {
          const at = value < 0 ? top + barHeight + 13 : top - 5;
          parts.push(
            `<text x="${round(x + bar / 2)}" y="${round(at)}" text-anchor="middle" font-size="${SMALL_SIZE}" ` +
              `fill="${ink.text}">${escape(valueText(value))}</text>`,
          );
        }
      });
    });
  } else {
    spec.series.forEach((series, s) => {
      const color = colorOf(series, s);
      // A missing value breaks the line instead of joining its neighbours
      let path = "";
      let isDrawing = false;
      const points: string[] = [];
      series.values.forEach((value, i) => {
        if (value === null) {
          isDrawing = false;
          return;
        }
        const x = round(left + slot * (i + 0.5));
        const at = round(y(value));
        path += `${isDrawing ? "L" : "M"}${x} ${at} `;
        isDrawing = true;
        points.push(`<circle cx="${x}" cy="${at}" r="3.5" fill="${color}" stroke="${ink.page}" stroke-width="1.5"/>`);
      });
      parts.push(
        `<path d="${path.trim()}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" ` +
          `stroke-linecap="round"/>`,
        ...points,
      );
    });
  }
  return svg(WIDTH, height, spec.title, parts);
}

function pie(spec: ChartSpec, ink: Ink, locale: string) {
  const values = spec.series[0].values.map((n) => n ?? 0);
  const total = values.reduce((sum, n) => sum + n, 0);
  const valueText = formatter(locale, spec.unit);
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const colors = values.map((_, i) => spec.colors?.[i] ?? CHART_COLORS[i % CHART_COLORS.length]);

  const title = titleOf(spec, ink, WIDTH);
  const top = PAD + title.height;
  const radius = 115;
  const legendRows = values.length;
  const height = Math.round(top + Math.max(radius * 2 + PAD, legendRows * 24) + PAD);
  const cx = PAD + radius + 20;
  const cy = top + Math.max(radius, (legendRows * 24) / 2);
  const parts: string[] = [...title.parts];

  const point = (angle: number, r: number) => [round(cx + r * Math.cos(angle)), round(cy + r * Math.sin(angle))];
  let angle = -Math.PI / 2;
  values.forEach((value, i) => {
    if (value <= 0) return;
    const share = value / total;
    const sweep = share * Math.PI * 2;
    if (share >= 0.9999) {
      parts.push(`<circle cx="${cx}" cy="${round(cy)}" r="${radius}" fill="${colors[i]}"/>`);
    } else {
      const [x1, y1] = point(angle, radius);
      const [x2, y2] = point(angle + sweep, radius);
      parts.push(
        `<path d="M${cx} ${round(cy)} L${x1} ${y1} A${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z" ` +
          `fill="${colors[i]}" stroke="${ink.page}" stroke-width="2" stroke-linejoin="round"/>`,
      );
    }
    // A slice too thin for its percentage leaves it to the legend
    if (share >= 0.07) {
      const [x, y] = point(angle + sweep / 2, radius * 0.64);
      parts.push(
        `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="${TEXT_SIZE}" font-weight="600" ` +
          `fill="${CHART_LABEL}">${escape(percent.format(share))}</text>`,
      );
    }
    angle += sweep;
  });

  const legendLeft = cx + radius + 36;
  const legendTop = cy - (legendRows * 24) / 2 + 6;
  const letters = Math.floor((WIDTH - PAD - legendLeft - 16) / (TEXT_SIZE * LETTER_WIDTH));
  spec.labels.forEach((label, i) => {
    const y = round(legendTop + i * 24);
    const line = shortened(`${label} · ${valueText(values[i])}`, letters);
    parts.push(
      `<rect x="${round(legendLeft)}" y="${y}" width="11" height="11" rx="2" fill="${colors[i]}"/>`,
      `<text x="${round(legendLeft + 18)}" y="${y + 10}" font-size="${TEXT_SIZE}" fill="${ink.text}">` +
        `${escape(line)}</text>`,
    );
  });
  return svg(WIDTH, height, spec.title, parts);
}

export function chartSvg(spec: ChartSpec, theme: Theme, locale: string) {
  return spec.type === "pie" ? pie(spec, INK[theme], locale) : barsAndLines(spec, INK[theme], locale);
}
