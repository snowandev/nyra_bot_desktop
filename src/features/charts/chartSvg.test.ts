import { describe, expect, it } from "vitest";
import type { ChartSpec } from "./chartSpec";
import { axisTicks, chartSvg } from "./chartSvg";

const bars: ChartSpec = {
  type: "bar",
  title: "Ventas <2025>",
  labels: ["Ene", "Feb", "Mar"],
  series: [
    { name: "Tienda", values: [12, 18, 15] },
    { name: "Web", values: [4, 9, 11], color: "#123456" },
  ],
  unit: "€",
};

const count = (svg: string, tag: string) => svg.split(`<${tag} `).length - 1;

describe("axisTicks", () => {
  it("goes in round steps from zero to past the largest value", () => {
    expect(axisTicks(0, 18)).toEqual([0, 5, 10, 15, 20]);
    expect(axisTicks(0, 1234)).toEqual([0, 250, 500, 750, 1000, 1250]);
    expect(axisTicks(-7, 12)).toEqual([-10, -5, 0, 5, 10, 15]);
    expect(axisTicks(0, 0)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
});

describe("chartSvg", () => {
  it("draws one bar per value, with the series' own color when it has one", () => {
    const svg = chartSvg(bars, "light", "es");
    expect(count(svg, "rect")).toBe(6 + 2);
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain("18 €");
  });

  it("escapes the text the model wrote", () => {
    const svg = chartSvg({ ...bars, labels: ['<script>"x"</script>', "b", "c"] }, "dark", "en");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;&quot;x&quot;");
    expect(svg).toContain("<title>Ventas &lt;2025&gt;</title>");
  });

  it("breaks a line where a value is missing", () => {
    const svg = chartSvg({ type: "line", labels: ["a", "b", "c", "d"], series: [{ name: "", values: [1, 2, null, 4] }] }, "light", "es");
    expect(svg).toMatch(/d="M[\d. ]+ L[\d. ]+ M[\d. ]+"/);
    expect(count(svg, "circle")).toBe(3);
  });

  it("draws a pie's slices with their share and a legend with each value", () => {
    const svg = chartSvg(
      { type: "pie", labels: ["Cuadernos", "Agendas"], series: [{ name: "", values: [3, 1] }], unit: "%" },
      "light",
      "es",
    );
    expect(count(svg, "path")).toBe(2);
    expect(svg).toContain("75");
    // Spanish keeps the % on the same line as its number
    expect(svg).toContain("Cuadernos · 3\u00a0%");
  });
});
