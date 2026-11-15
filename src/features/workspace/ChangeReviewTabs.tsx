import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ProposedChange } from "@/shared/types";
import { fileName } from "@/shared/lib/paths";

type Props = {
  changes: ProposedChange[];
  openId: string;
  onSelect: (id: string) => void;
};


// One tab per file of the reply, with whether it was reviewed or applied
export function ChangeReviewTabs({ changes, openId, onSelect }: Props) {
  const { t } = useTranslation();
  if (changes.length < 2) return null;
  return (
    <div className="change-review-tabs" role="tablist" aria-label={t("changes.review.tabsLabel")}>
      {changes.map((c) => {
        const state =
          c.status === "applied"
            ? t("changes.state.applied")
            : c.reviewed
              ? t("changes.state.reviewed")
              : t("changes.state.pending");
        return (
          <button
            key={c.id}
            type="button"
            role="tab"
            className="change-review-tab"
            aria-selected={c.id === openId}
            aria-label={`${c.path}, ${state}`}
            onClick={() => onSelect(c.id)}
          >
            {c.status === "applied" ? (
              <Check size={13} strokeWidth={2.6} className="change-review-tab-done" />
            ) : (
              <span className={`change-review-tab-dot ${c.reviewed ? "seen" : ""}`} aria-hidden="true" />
            )}
            {fileName(c.path)}
          </button>
        );
      })}
    </div>
  );
}
