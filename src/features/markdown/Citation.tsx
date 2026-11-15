import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { CitationsContext } from "./citationsContext";
import { CITATION_LINK_PREFIX } from "./citations";
import { domainOf } from "@/shared/lib/links";
import { DomainInitial } from "@/features/web/DomainInitial";
import { ExternalLink } from "@/shared/ui/ExternalLink";

type Props = {
  // The link the citations plugin wrote: CITATION_LINK_PREFIX and the source's own number
  href: string;
};

export function Citation({ href }: Props) {
  const { t } = useTranslation();
  const context = useContext(CitationsContext);
  const n = Number(href.slice(CITATION_LINK_PREFIX.length));
  const source = context?.citations.sources.get(n);
  const shown = context?.citations.order.get(n);
  if (!context || !source || shown === undefined) return null;
  if (context.isForImage) return <sup className="citation-number">{shown}</sup>;

  const domain = domainOf(source.url);
  return (
    <ExternalLink href={source.url} className="citation" label={t("markdown.source", { number: shown, domain, title: source.title })} title="">
      {shown}
      <span className="citation-tip" aria-hidden="true">
        <DomainInitial domain={domain} large />
        <span className="citation-tip-text">
          <span className="citation-tip-title">{source.title}</span>
          <span className="citation-tip-line">{domain}</span>
          <span className="citation-tip-line">
            <ExternalLinkIcon size={11} strokeWidth={2} />
            {t("markdown.opensInBrowser")}
          </span>
        </span>
      </span>
    </ExternalLink>
  );
}
