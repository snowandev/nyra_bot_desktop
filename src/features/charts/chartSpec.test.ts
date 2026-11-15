import { describe, expect, it } from "vitest";
import { readChart } from "./chartSpec";

const chart = (data: unknown) => readChart(JSON.stringify(data));

describe("readChart", () => {
  it("reads a chart with its labels, series and unit", () => {
    expect(
      chart({ type: "bar", title: "Ventas", labels: ["Ene", "Feb"], series: [{ name: "2025", values: [12, 18] }], unit: "€" }),
    ).toEqual({
      spec: { type: "bar", title: "Ventas", labels: ["Ene", "Feb"], series: [{ name: "2025", values: [12, 18] }], unit: "€" },
    });
  });

  it("keeps a gap only where the value is null", () => {
    const reading = chart({ type: "line", labels: ["a", "b", "c"], series: [{ values: [1, null, 3] }] });
    expect("spec" in reading && reading.spec.series[0].values).toEqual([1, null, 3]);
    expect(chart({ type: "line", labels: ["a", "b"], series: [{ values: [1, "dos"] }] })).toEqual({ problem: "values" });
  });

  it("says what is wrong instead of drawing a misleading chart", () => {
    expect(readChart("{ type: bar")).toEqual({ problem: "notJson" });
    expect(chart({ type: "radar", labels: ["a"], series: [{ values: [1] }] })).toEqual({ problem: "type" });
    expect(chart({ type: "bar", labels: [], series: [{ values: [] }] })).toEqual({ problem: "labels" });
    expect(chart({ type: "bar", labels: ["a"], series: [] })).toEqual({ problem: "series" });
    expect(chart({ type: "bar", labels: ["a", "b"], series: [{ values: [1] }] })).toEqual({ problem: "values" });
    expect(chart({ type: "pie", labels: ["a", "b"], series: [{ values: [-1, 2] }] })).toEqual({ problem: "pieValues" });
    expect(chart({ type: "pie", labels: ["a"], series: [{ values: [0] }] })).toEqual({ problem: "pieValues" });
  });

  it("takes only color codes, and one series for a pie", () => {
    const reading = chart({
      type: "pie",
      labels: ["a", "b"],
      series: [{ values: [1, 2], color: "red" }, { values: [3, 4] }],
      colors: ["#e74c3c", "url(javascript:1)"],
    });
    expect(reading).toEqual({
      spec: { type: "pie", labels: ["a", "b"], series: [{ name: "", values: [1, 2] }], colors: ["#e74c3c", undefined] },
    });
  });
});
