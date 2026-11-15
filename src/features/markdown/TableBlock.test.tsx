// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TABLE = ["| Producto | Ventas |", "|---|--:|", "| [Agendas](https://ejemplo.com) | 1.420 € |", "| Cuadernos | 168 € |", "| Láminas | 90 € |"].join("\n");

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Markdown>{TABLE}</Markdown>));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const firstColumn = () => [...container.querySelectorAll("tbody tr td:first-child")].map((td) => td.textContent);
const sortBy = (column: number) =>
  act(() => (container.querySelectorAll<HTMLButtonElement>("th .table-sort")[column]).click());

describe("a table in a reply", () => {
  it("sorts by a column, the other way on the next click and back to the reply's order on the third", () => {
    expect(firstColumn()).toEqual(["Agendas", "Cuadernos", "Láminas"]);
    sortBy(1);
    expect(firstColumn()).toEqual(["Láminas", "Cuadernos", "Agendas"]);
    expect(container.querySelectorAll("th")[1].getAttribute("aria-sort")).toBe("ascending");
    sortBy(1);
    expect(firstColumn()).toEqual(["Agendas", "Cuadernos", "Láminas"]);
    expect(container.querySelectorAll("th")[1].getAttribute("aria-sort")).toBe("descending");
    sortBy(1);
    expect(container.querySelectorAll("th")[1].getAttribute("aria-sort")).toBe("none");
  });

  it("keeps what the cells hold, like links, when it moves the rows", () => {
    sortBy(0);
    sortBy(0);
    expect(firstColumn()).toEqual(["Láminas", "Cuadernos", "Agendas"]);
    expect(container.querySelector("tbody tr:last-child a")?.getAttribute("href")).toBe("https://ejemplo.com/");
  });

  it("offers to copy the table and to save it as a workbook", () => {
    const actions = [...container.querySelectorAll(".table-actions button")].map((b) => b.getAttribute("aria-label"));
    expect(actions).toEqual(["Copiar tabla", "Guardar como Excel"]);
  });
});
