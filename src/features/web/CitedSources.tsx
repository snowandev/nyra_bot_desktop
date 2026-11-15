import { useTranslation } from "react-i18next";
import { type Citations, citedSources } from "@/features/markdown/citations";
import { domainOf } from "@/shared/lib/links";
import { ExternalLink } from "@/shared/ui/ExternalLink";

type Props = {
  citations: Citations;
};

// The sources the text cites, after it: a shortcut for whoever finished reading and wants to go to the source
export function CitedSources({ citations }: Props) {
  const { t } = useTranslation();
  const cited = citedSources(citations).map((c) => ({ ...c, domain: domainOf(c.source.url) }));
  if (cited.length === 0) return null;
  // Two articles from the same site would look identical by domain, so those show their title
  const repeated = (domain: string) => cited.filter((c) => c.domain === domain).length > 1;

  return (
    <div className="cited-sources" role="list" aria-label={t("web.cited.list")}>
      <span className="cited-sources-label">{t("web.cited.label")}</span>
      {cited.map(({ shown, source, domain }) => (
        <span key={shown} role="listitem">
          <ExternalLink
            href={source.url}
            className="cited-source"
            label={t("web.cited.sourceLabel", { number: shown, domain, title: source.title })}
            title={source.title}
          >
            <span className="cited-source-number">{shown}</span>
            <span className="cited-source-name">{repeated(domain) ? source.title.split(" - ")[0] : domain}</span>
          </ExternalLink>
        </span>
      ))}
    </div>
  );
}
