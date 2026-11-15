import { Check, CircleCheck } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { SearchStepProgress } from "./webSearchAgent";
import { DomainInitial } from "./DomainInitial";

type Props = {
  steps: SearchStepProgress[];
};

// The query goes outside the translated text: it comes from the model and is shown as it is
function stepLine(step: SearchStepProgress, t: TFunction) {
  if (step.phase === "done") {
    return (
      <div className="search-step-line">
        <CircleCheck size={14} strokeWidth={2} />
        <span className="search-step-text">
          {t("web.progress.searched")} <q>{step.query}</q>
          {step.engine === "wikipedia" && ` ${t("web.progress.onWikipedia")}`}
        </span>
        <span className="search-step-count">{t("web.progress.pages", { count: step.pages.length })}</span>
      </div>
    );
  }
  if (step.phase === "searching") {
    return (
      <div className="search-step-line">
        <span className="search-spinner" aria-hidden="true" />
        <span className="search-step-text">
          {t("web.progress.searching")} <q>{step.query}</q>…
        </span>
      </div>
    );
  }
  const read = step.pages.filter((page) => page.state === "done").length;
  return (
    <div className="search-step-line">
      <span className="search-spinner" aria-hidden="true" />
      <span className="search-step-text">{t("web.progress.reading", { count: step.pages.length })}</span>
      <span className="search-step-count">{t("web.progress.readOf", { read, total: step.pages.length })}</span>
    </div>
  );
}

// While a reply searches: one line per search, and the pages being read as they go from pending to read
export function WebSearchProgress({ steps }: Props) {
  const { t } = useTranslation();
  return (
    <div className="search-progress" role="status" aria-live="polite">
      <ol className="search-steps">
        {steps.map((step, i) => (
          <li key={i} className={`search-step ${step.phase === "done" ? "done" : ""}`}>
            {stepLine(step, t)}
            {step.phase === "reading" && (
              <div className="search-domains" aria-hidden="true">
                {step.pages.map((page, j) => (
                  <span key={j} className={`search-domain ${page.state}`}>
                    <DomainInitial domain={page.domain} />
                    <span className="search-domain-name">{page.domain}</span>
                    {page.state === "done" && <Check size={12} strokeWidth={3} />}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
