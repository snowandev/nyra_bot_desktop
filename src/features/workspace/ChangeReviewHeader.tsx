import { ChevronLeft, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ProposedChange } from "@/shared/types";
import { PathLabel } from "./PathLabel";

type Props = {
  change: ProposedChange;
  onClose: () => void;
  // What each review says of the change under its path: its tag, what it touches
  meta: ReactNode;
};

// The top of a change's review, the same for text and for cells: back, the file, and close
export function ChangeReviewHeader({ change, onClose, meta }: Props) {
  const { t } = useTranslation();
  return (
    <div className="change-review-header">
      <button type="button" className="ghost-button change-review-back" onClick={onClose}>
        <ChevronLeft size={15} strokeWidth={2} />
        {t("changes.review.back")}
      </button>
      <span className="change-review-title">
        <span className="change-review-path" title={`${change.root}/${change.path}`}>
          <PathLabel path={change.path} dirClassName="change-card-dir" />
        </span>
        <span className="change-review-meta">{meta}</span>
      </span>
      <button type="button" className="icon-button small" aria-label={t("changes.review.close")} onClick={onClose}>
        <X size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
