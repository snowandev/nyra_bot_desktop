import type { Element } from "hast";
import { WrapText } from "lucide-react";
import { type ComponentPropsWithoutRef, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type DiagramImage, diagramPng } from "./svgImage";
import { copyImage } from "@/features/share/shareStorage";
import { CopyButton } from "@/shared/ui/CopyButton";
import { type DiagramKind, DrawnDiagram } from "./DrawnDiagram";
import { textOf } from "./hastText";
import { highlightCode } from "./codeHighlight";
import { CodeViewSwitch } from "./CodeViewSwitch";
import { useCodeViews } from "./useCodeViews";

type Props = ComponentPropsWithoutRef<"pre"> & {
  node?: Element;
};

function languageOf(code: Element | undefined) {
  const classes = code?.properties.className;
  if (!Array.isArray(classes)) return null;
  const match = classes.map(String).find((c) => c.startsWith("language-"));
  return match ? match.slice("language-".length) : null;
}

// A long block shows its start, so it doesn't push the rest of the reply away, until the user unfolds it
const FOLD_AFTER_LINES = 30;
// Lines this long would scroll sideways in the chat's column: the block offers to wrap them
const LONG_LINE = 80;

export function CodeBlock({ node, children, ...props }: Props) {
  const { t } = useTranslation();
  const code = node?.children.find(
    (child): child is Element => child.type === "element" && child.tagName === "code",
  );
  const text = code ? textOf(code).replace(/\n$/, "") : "";
  const language = languageOf(code);
  // Mermaid code and chart data are drawn by default, with the code a click away
  const kind: DiagramKind | null = language === "mermaid" || language === "chart" ? language : null;
  const isDiagram = kind !== null;
  const [view, setView] = useState<"diagram" | "code">("diagram");
  // Reformatted by its language's formatter; JSON also on one line
  const views = useCodeViews(text, isDiagram ? null : language);
  const [diagram, setDiagram] = useState<DiagramImage | null>(null);
  const [isUnfolded, setIsUnfolded] = useState(false);
  const [wraps, setWraps] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  // What's on screen is what gets copied: the diagram as an image, or else the code
  const copiesImage = isDiagram && view === "diagram" && diagram !== null;
  const showsCode = !isDiagram || view === "code";
  const lines = views.shown.split("\n");
  const canFold = showsCode && lines.length > FOLD_AFTER_LINES;
  const canWrap = showsCode && lines.some((line) => line.length > LONG_LINE);
  const classes = ["code-block", canFold && !isUnfolded && "folded", canWrap && wraps && "wrapped"];

  async function copyDiagram() {
    if (!diagram || !blockRef.current) return;
    await copyImage(await diagramPng(diagram, getComputedStyle(blockRef.current).backgroundColor));
  }
  // Reformatted, or JSON recognized without a language: colored here, since the reply's coloring was of the code as it
  // came, or didn't know its language
  const shownLanguage = views.language;
  const codeView =
    shownLanguage && (views.isReshaped || (views.kind === "json" && !language)) ? (
    <pre {...props}>
      <code className={`hljs language-${shownLanguage}`}>{highlightCode(views.shown, shownLanguage)}</code>
    </pre>
  ) : (
    <pre {...props}>{children}</pre>
  );

  return (
    <div className={classes.filter(Boolean).join(" ")} ref={blockRef}>
      <div className="code-block-copy">
        {canWrap && (
          <button
            type="button"
            className="code-block-wrap"
            aria-pressed={wraps}
            aria-label={t("markdown.wrapLines")}
            title={t("markdown.wrapLines")}
            onClick={() => setWraps((on) => !on)}
          >
            <WrapText size={15} strokeWidth={2} />
          </button>
        )}
        {copiesImage ? (
          <CopyButton copy={copyDiagram} label={t("markdown.copyImage")} showLabel />
        ) : (
          <CopyButton text={views.shown} label={t("markdown.copy")} showLabel />
        )}
      </div>
      <div className="code-block-header">
        <span className="code-block-language">{shownLanguage ?? t("markdown.code")}</span>
        {views.kind && (
          <CodeViewSwitch
            kind={views.kind}
            json={views.json}
            view={views.view}
            onChange={views.setView}
            formatting={views.formatting}
            error={views.error}
          />
        )}
        {isDiagram && (
          <div
            className="code-block-tabs"
            role="tablist"
            aria-label={t(kind === "chart" ? "markdown.chartViewTabs" : "markdown.viewTabs")}
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === "diagram"}
              aria-controls={panelId}
              onClick={() => setView("diagram")}
            >
              {t(kind === "chart" ? "markdown.chart" : "markdown.diagram")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "code"}
              aria-controls={panelId}
              onClick={() => setView("code")}
            >
              {t(kind === "chart" ? "markdown.chartData" : "markdown.codeTab")}
            </button>
          </div>
        )}
      </div>
      {kind ? (
        <div id={panelId} role="tabpanel">
          {view === "diagram" ? (
            <DrawnDiagram kind={kind} code={text} fallback={codeView} onDrawn={setDiagram} />
          ) : (
            codeView
          )}
        </div>
      ) : (
        codeView
      )}
      {canFold && (
        <button
          type="button"
          className="code-block-fold"
          aria-expanded={isUnfolded}
          onClick={() => setIsUnfolded((open) => !open)}
        >
          {isUnfolded ? t("markdown.foldCode") : t("markdown.unfoldCode", { count: lines.length })}
        </button>
      )}
    </div>
  );
}
