import { BookOpen, ChevronDown, Globe } from "lucide-react";
import { type ReactNode, useId } from "react";
import type { Citations } from "@/features/markdown/citations";
import { useTranslation } from "react-i18next";
import type { WebSearchStep } from "@/shared/types";
import { WebSourceList } from "./WebSourceList";

type Props = {
  steps: WebSearchStep[];
  citations: Citations;
  // Without it (in the shared image) the line is plain text
  onToggle?: () => void;
  isExpanded?: boolean;
  // On the same line, to its right; the sources still unfold below
  aside?: ReactNode;
};

// "Buscó en internet · 2 búsquedas · 6 fuentes": what the reply searched, folded into one line above the text
export function WebSearchSummary({ steps, citations, onToggle, isExpanded = false, aside }: Props) {
  const { t } = useTranslation();
  const listId = useId();
  // Wikipedia is only searched when DuckDuckGo didn't answer
  const usedWikipedia = steps.some((step) => step.engine === "wikipedia");
  const pages = steps.reduce((total, step) => total + step.sources.length, 0);
  const Icon = usedWikipedia ? BookOpen : Globe;
  const content = (
    <>
      <Icon size={15} strokeWidth={2} className="reply-summary-icon web-search" />
      <span>{usedWikipedia ? t("web.summary.searchedWikipedia") : t("web.summary.searchedWeb")}</span>
      <span className="reply-summary-detail">
        · {t("web.summary.searches", { count: steps.length })} · {t("web.summary.sources", { count: pages })}
        {usedWikipedia && ` · ${t("web.summary.duckDuckGoDown")}`}
      </span>
    </>
  );

  if (!onToggle) return <span className="reply-summary static">{content}</span>;
  return (
    <>
      <div className="reply-summary-row">
        <button
          type="button"
          className="reply-summary"
          aria-expanded={isExpanded}
          aria-controls={listId}
          onClick={onToggle}
        >
          {content}
          <ChevronDown size={14} strokeWidth={2} className="reply-summary-chevron" />
        </button>
        {aside}
      </div>
      {isExpanded && <WebSourceList id={listId} steps={steps} citations={citations} />}
    </>
  );
}
