import { Download, Eye, Layers, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { sheetsSummary } from "@/features/workspace/cellGrid";
import type { SheetVersion } from "@/shared/types";

type Props = {
  versions: SheetVersion[];
  onView: (id: string) => void;
  onSave: (id: string) => void;
  // Open in the review panel right now
  openId?: string;
};

// The versions a reply made of attached spreadsheets. Nothing was written to disk, so there is nothing to approve: the
// border is solid from the start, and the user's attachment stays as it was.
export function SheetVersionCards({ versions, onView, onSave, openId }: Props) {
  const { t } = useTranslation();
  return (
    <section className="change-proposals" aria-label={t("attachments.versions.cards.label")}>
      <ul className="change-proposals-list">
        {versions.map((v) => {
          const summary = sheetsSummary(v.cells).join(", ");
          if (v.error) {
            return (
              <li key={v.id}>
                <div
                  className="change-card problem"
                  role="group"
                  aria-label={t("attachments.versions.cards.failedLabel", { file: v.file })}
                >
                  <span className="change-card-icon">
                    <TriangleAlert size={17} strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="change-card-text">
                    <span className="change-card-path">{v.file}</span>
                    <span className="change-card-meta">
                      <span className="change-tag warning">{t("attachments.versions.cards.noNewVersion")}</span>
                      <span className="change-card-sheets">{summary}</span>
                    </span>
                  </span>
                </div>
                <p className="change-card-reason">
                  {v.error} {t("attachments.versions.cards.unchanged")}
                </p>
              </li>
            );
          }
          const restored = v.restoredFrom !== undefined;
          const from =
            v.restoredFrom !== undefined && v.restoredFrom <= 1
              ? t("attachments.versions.cards.theOriginal")
              : t("attachments.versions.cards.theVersion", { number: v.restoredFrom });
          return (
            <li key={v.id}>
              <div
                className={`change-card sheet-version ${openId === v.id ? "open" : ""}`}
                role="group"
                aria-label={t("attachments.versions.cards.cardLabel", {
                  file: v.file,
                  number: v.number,
                  summary: restored ? t("attachments.versions.cards.copyOf", { from }) : summary,
                })}
              >
                <span className="change-card-icon">
                  <Layers size={17} strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="change-card-text">
                  <span className="change-card-path">
                    {t("attachments.versions.cards.fileVersion", { file: v.file, number: v.number })}
                  </span>
                  <span className="change-card-meta">
                    <span className="change-tag copy">{t("attachments.versions.cards.newCopy")}</span>
                    <span className="change-card-sheets">
                      {restored ? t("attachments.versions.cards.sameAs", { from }) : summary}
                    </span>
                    <span>{t("attachments.versions.cards.notChanging")}</span>
                  </span>
                </span>
                <span className="change-card-actions">
                  {!restored && (
                    <button type="button" className="outline-button small" data-review-id={v.id} onClick={() => onView(v.id)}>
                      <Eye size={14} strokeWidth={2} />
                      {t("attachments.versions.group.viewChanges")}
                    </button>
                  )}
                  <button type="button" className="outline-button small" onClick={() => onSave(v.id)}>
                    <Download size={14} strokeWidth={2} />
                    {t("attachments.versions.group.saveAs")}
                  </button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
