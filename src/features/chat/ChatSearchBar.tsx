import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  query: string;
  onQueryChange: (query: string) => void;
  matchCount: number;
  currentNumber: number;
  onOlder: () => void;
  onNewer: () => void;
  onClose: () => void;
};

export function ChatSearchBar(props: Props) {
  const { query, onQueryChange, matchCount, currentNumber, onOlder, onNewer, onClose } = props;
  const { t } = useTranslation();
  const hasQuery = query.trim().length > 0;

  return (
    <div role="search" className="chat-search">
      <Search size={16} strokeWidth={2} className="chat-search-icon" />
      <input
        type="search"
        autoFocus
        aria-label={t("chat.search.label")}
        placeholder={t("chat.search.label")}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onNewer();
            else onOlder();
          }
        }}
      />
      {hasQuery && (
        <span className="chat-search-count" role="status">
          {matchCount === 0
            ? t("chat.search.none")
            : t("chat.search.position", { current: currentNumber, total: matchCount })}
        </span>
      )}
      <button
        type="button"
        className="icon-button small"
        aria-label={t("chat.search.previous")}
        title={t("chat.search.previousTitle")}
        disabled={matchCount < 2}
        onClick={onOlder}
      >
        <ChevronUp size={16} strokeWidth={2} />
      </button>
      <button
        type="button"
        className="icon-button small"
        aria-label={t("chat.search.next")}
        title={t("chat.search.nextTitle")}
        disabled={matchCount < 2}
        onClick={onNewer}
      >
        <ChevronDown size={16} strokeWidth={2} />
      </button>
      <button
        type="button"
        className="icon-button small"
        aria-label={t("chat.search.close")}
        title={t("chat.search.closeTitle")}
        onClick={onClose}
      >
        <X size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
