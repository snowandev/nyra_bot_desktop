import { Paperclip } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/shared/lib/format";
import { splitByMatches } from "@/shared/lib/search";
import { MATCH_END, MATCH_START, type SearchHit } from "./conversationStorage";

type Props = {
  title: string;
  // Highlighted in the title
  query: string;
  // A match inside the conversation; without it, only the title matched
  hit?: SearchHit;
  isActive: boolean;
  onOpen: () => void;
};

// The snippet comes with markers around the matched words; they become <mark> elements, never HTML
function highlightedSnippet(snippet: string) {
  return snippet.split(MATCH_START).flatMap((part, i) => {
    if (i === 0) return [part];
    const [match, rest = ""] = part.split(MATCH_END);
    return [<mark key={i}>{match}</mark>, rest];
  });
}

const highlightedTitle = (title: string, query: string) =>
  splitByMatches(title, query).map((part, i) => (part.isMatch ? <mark key={i}>{part.text}</mark> : part.text));

export function SearchHitRow({ title, query, hit, isActive, onOpen }: Props) {
  const { t } = useTranslation();
  return (
    <li>
      <button type="button" className={`search-hit ${isActive ? "active" : ""}`} onClick={onOpen}>
        <span className="search-hit-header">
          <span className="search-hit-title">{highlightedTitle(title, query)}</span>
          {hit && <span className="search-hit-date">{formatDate(hit.updatedAt)}</span>}
        </span>
        {hit?.attachmentName && (
          <span className="search-hit-file">
            <Paperclip size={12} strokeWidth={2} />
            {hit.attachmentName}
          </span>
        )}
        {hit && <span className="search-hit-snippet">{highlightedSnippet(hit.snippet)}</span>}
        {hit && hit.matchCount > 1 && (
          <span className="search-hit-count">{t("conversations.hit.matches", { count: hit.matchCount })}</span>
        )}
      </button>
    </li>
  );
}
