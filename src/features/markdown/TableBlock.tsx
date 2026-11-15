import type { Element } from "hast";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  Children,
  cloneElement,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { currentLocale } from "@/shared/i18n/i18n";
import { CopyButton } from "@/shared/ui/CopyButton";
import { SaveTableButton } from "./SaveTableButton";
import { sortedOrder, tableData, type TableSort } from "./tableData";
import { copyTable } from "./tableStorage";

type Props = ComponentPropsWithoutRef<"table"> & {
  node?: Element;
};

type WithChildren = ReactElement<{ children?: ReactNode; style?: CSSProperties }>;

const elementsOf = (children: ReactNode) => Children.toArray(children).filter(isValidElement) as WithChildren[];

// A click sorts up, the next down, the next back to the order the reply wrote
function nextSort(sort: TableSort | null, column: number): TableSort | null {
  if (sort?.column !== column) return { column, direction: "ascending" };
  return sort.direction === "ascending" ? { column, direction: "descending" } : null;
}

// A table of a reply: sorted by a click on a column's header, and copied or saved as a workbook as it is shown. The
// rows are the ones the Markdown rendered (with their links, code and formulas), only put in another order.
export function TableBlock({ node, children, ...props }: Props) {
  const { t } = useTranslation();
  const data = useMemo(() => (node ? tableData(node) : null), [node]);
  const [sort, setSort] = useState<TableSort | null>(null);
  const order = useMemo(
    () => (data && sort ? sortedOrder(data.rows, sort, currentLocale()) : null),
    [data, sort],
  );
  const shown = () =>
    data && order ? { header: data.header, rows: order.map((i) => data.rows[i]) } : (data ?? { header: [], rows: [] });

  function header(cell: WithChildren, column: number) {
    const direction = sort?.column === column ? sort.direction : null;
    const Icon = direction === "ascending" ? ArrowUp : direction === "descending" ? ArrowDown : ArrowUpDown;
    // In a column aligned right the arrow goes before the name, so the name lines up with the numbers under it
    const isRight = cell.props.style?.textAlign === "right";
    return cloneElement(cell as ReactElement<{ children?: ReactNode; "aria-sort"?: string }>, {
      "aria-sort": direction ?? "none",
      children: (
        <button
          type="button"
          className={`table-sort ${direction ? "sorted" : ""} ${isRight ? "arrow-before" : ""}`}
          title={t("markdown.sortBy", { column: data?.header[column] ?? "" })}
          onClick={() => setSort(nextSort(sort, column))}
        >
          {cell.props.children}
          <Icon size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      ),
    });
  }

  const sections = elementsOf(children).map((section) => {
    if (!data) return section;
    if (section.type === "thead") {
      return cloneElement(section, {
        children: elementsOf(section.props.children).map((row) =>
          cloneElement(row, { children: elementsOf(row.props.children).map(header) }),
        ),
      });
    }
    if (section.type === "tbody" && order) {
      const rows = elementsOf(section.props.children);
      return cloneElement(section, { children: order.map((i) => rows[i]) });
    }
    return section;
  });

  return (
    <div className="table-block">
      <div className="table-wrapper">
        <table {...props}>{sections}</table>
      </div>
      {data && (
        <div className="table-actions">
          <CopyButton copy={() => copyTable(shown())} label={t("markdown.copyTable")} showLabel />
          <SaveTableButton data={shown} />
        </div>
      )}
    </div>
  );
}
