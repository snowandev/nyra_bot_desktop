import { ChevronLeft, Download, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cellChanges, fileExtension, orderedBySheet } from "@/features/workspace/cellGrid";
import { CellsReview } from "@/features/workspace/CellsReview";
import { cellKey } from "@/features/workspace/workspaceChanges";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { versionNumberOf } from "./sheetVersions";
import type { OpenSheetVersion } from "./useSheetVersions";

type Props = OpenSheetVersion & {
  onSave: () => void;
  onClose: () => void;
};

// A version of an attached spreadsheet next to the one it came from. Nothing is written to disk, so instead of
// "Aplicar" it offers to save it.
export function SheetVersionPanel({ version, file, base, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const [readError, setReadError] = useState<string | null>(null);
  useEscapeKey(onClose);

  const changes = useMemo(() => {
    const before = new Map(version.cellsBefore.map((c) => [cellKey(c.sheet, c.cell), c]));
    return orderedBySheet(cellChanges(version.cells, (sheet, cell) => before.get(cellKey(sheet, cell))));
  }, [version]);
  const sheetCount = new Set(changes.map((c) => c.sheet)).size;
  const baseNumber = base ? versionNumberOf(base) : version.number - 1;

  return (
    <aside
      className="change-review cells-review"
      aria-label={t("attachments.versions.panel.label", { file: version.file, number: version.number })}
    >
      <div className="change-review-header">
        <button type="button" className="ghost-button change-review-back" onClick={onClose}>
          <ChevronLeft size={15} strokeWidth={2} />
          {t("attachments.versions.panel.back")}
        </button>
        <span className="change-review-title">
          <span className="change-review-path">
            {t("attachments.versions.cards.fileVersion", { file: version.file, number: version.number })}
          </span>
          <span className="change-review-meta">
            <span className="change-tag">
              {t("attachments.versions.panel.spreadsheet", { ext: fileExtension(version.file) })}
            </span>
            <span>
              {t("attachments.versions.panel.cellsInSheets", {
                cells: t("attachments.versions.panel.cells", { count: changes.length }),
                sheets: t("attachments.versions.panel.sheets", { count: sheetCount }),
              })}
            </span>
            <span>
              {baseNumber <= 1
                ? t("attachments.versions.panel.comparedOriginal")
                : t("attachments.versions.panel.comparedVersion", { number: baseNumber })}
            </span>
          </span>
        </span>
        <button
          type="button"
          className="icon-button small"
          aria-label={t("attachments.versions.panel.close")}
          onClick={onClose}
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      {readError && (
        <p className="change-review-error" role="alert">
          {readError}
        </p>
      )}

      {file?.workbook ? (
        <CellsReview
          key={version.id}
          changes={changes}
          source={{ kind: "attachment", id: file.id, workbook: file.workbook }}
          label={t("attachments.versions.panel.reviewLabel", { file: version.file, number: version.number })}
          onError={setReadError}
        />
      ) : (
        <p className="change-review-loading">{t("attachments.versions.panel.gone")}</p>
      )}

      <div className="change-review-footer">
        <span>{t("attachments.versions.panel.footer", { number: version.number })}</span>
        <button type="button" className="outline-button small" disabled={!file?.workbook} onClick={onSave}>
          <Download size={14} strokeWidth={2} />
          {t("attachments.versions.group.saveAs")}
        </button>
      </div>
    </aside>
  );
}
