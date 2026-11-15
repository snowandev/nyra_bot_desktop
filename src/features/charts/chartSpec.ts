// A chart the model writes as a ```chart block of JSON: what kind, the labels along it and one or more series of
// numbers, one per label. Read strictly, so a mistake shows as an error instead of a misleading chart.

const CHART_TYPES = ["bar", "line", "pie"] as const;
type ChartType = (typeof CHART_TYPES)[number];

// A value missing for a label (null) leaves a gap in its bar or line
export type ChartSeries = { name: string; values: (number | null)[]; color?: string };

export type ChartSpec = {
  type: ChartType;
  title?: string;
  labels: string[];
  series: ChartSeries[];
  // Written after each value: "€", "%", "km"
  unit?: string;
  // One per label, for a pie's slices; a missing one takes Nyra's color
  colors?: (string | undefined)[];
};

// Each one has its own message in the catalog (markdown.chartErrors)
type ChartProblem = "notJson" | "type" | "labels" | "series" | "values" | "pieValues";

type ChartReading = { spec: ChartSpec } | { problem: ChartProblem };

const MAX_LABELS = 60;
const MAX_SERIES = 12;
// Only a color code, which goes into the drawing as it is
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const colorOf = (value: unknown) => (typeof value === "string" && COLOR.test(value) ? value : undefined);

const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value).trim() : "");

function seriesOf(value: unknown, labels: number): ChartSeries | null {
  if (!isRecord(value) || !Array.isArray(value.values) || value.values.length !== labels) return null;
  const written: unknown[] = value.values;
  const values = written.map((n) => (typeof n === "number" && Number.isFinite(n) ? n : null));
  // A value that isn't a number is a mistake, not a gap; only null is
  if (values.some((n, i) => n === null && written[i] !== null)) return null;
  const color = colorOf(value.color);
  return { name: text(value.name), values, ...(color ? { color } : {}) };
}

export function readChart(code: string): ChartReading {
  let data: unknown;
  try {
    data = JSON.parse(code);
  } catch {
    return { problem: "notJson" };
  }
  if (!isRecord(data)) return { problem: "notJson" };
  const type = CHART_TYPES.find((t) => t === data.type);
  if (!type) return { problem: "type" };
  if (!Array.isArray(data.labels) || data.labels.length === 0 || data.labels.length > MAX_LABELS) {
    return { problem: "labels" };
  }
  const labels = data.labels.map(text);
  if (!Array.isArray(data.series) || data.series.length === 0 || data.series.length > MAX_SERIES) {
    return { problem: "series" };
  }
  const series = data.series.map((s) => seriesOf(s, labels.length));
  if (series.some((s) => s === null)) return { problem: "values" };
  const valid = series as ChartSeries[];
  const slices = valid[0].values;
  if (type === "pie" && (slices.some((n) => n === null || n < 0) || slices.every((n) => n === 0))) {
    return { problem: "pieValues" };
  }
  const title = text(data.title);
  const unit = text(data.unit);
  const colors = Array.isArray(data.colors) ? labels.map((_, i) => colorOf((data.colors as unknown[])[i])) : [];
  return {
    spec: {
      type,
      labels,
      // A pie shows one series: the first
      series: type === "pie" ? valid.slice(0, 1) : valid,
      ...(title ? { title } : {}),
      ...(unit ? { unit } : {}),
      ...(colors.some(Boolean) ? { colors } : {}),
    },
  };
}
