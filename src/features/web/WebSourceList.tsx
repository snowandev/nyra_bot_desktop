import { ExternalLink as ExternalLinkIcon, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Citations } from "@/features/markdown/citations";
import { domainOf } from "@/shared/lib/links";
import type { WebSearchStep } from "@/shared/types";
import { DomainInitial } from "./DomainInitial";
import { ExternalLink } from "@/shared/ui/ExternalLink";

type Props = {
  id: string;
  steps: WebSearchStep[];
  citations: Citations;
};

// Every page the reply read, grouped by search; the cited ones carry the number they have in the text
export function WebSourceList({ id, steps, citations }: Props) {
  const { t } = useTranslation();
  return (
    <div className="web-sources" id={id}>
      {steps.map((step, i) => (
        <div key={i} className="web-sources-group">
          <div className="web-sources-query">
            <Globe size={12} strokeWidth={2} />
            <span className="web-sources-query-text">
              {t("web.sources.search", { number: i + 1 })} <q>{step.query}</q>
            </span>
            <span className="web-sources-engine">{step.engine === "wikipedia" ? "Wikipedia" : "DuckDuckGo"}</span>
          </div>
          {step.sources.map((source) => {
            const shown = citations.order.get(source.n);
            const domain = domainOf(source.url);
            return (
              <ExternalLink
                key={source.n}
                href={source.url}
                className={`web-source ${shown === undefined ? "uncited" : ""}`}
                label={t("web.sources.label", {
                  state: shown === undefined ? t("web.sources.uncited") : t("web.sources.source", { number: shown }),
                  title: source.title,
                  domain,
                })}
                title={source.title}
              >
                <span className="web-source-number">{shown ?? "–"}</span>
                <DomainInitial domain={domain} />
                <span className="web-source-text">
                  <span className="web-source-title">{source.title}</span>
                  <span className="web-source-domain">{domain}</span>
                </span>
                <span className="web-source-state">
                  {shown === undefined ? t("web.sources.uncited") : t("web.sources.cited")}
                </span>
                <ExternalLinkIcon size={13} strokeWidth={2} className="muted" />
              </ExternalLink>
            );
          })}
        </div>
      ))}
    </div>
  );
}
