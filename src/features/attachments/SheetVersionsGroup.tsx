import type { TFunction } from "i18next";
import { ArrowRightToLine, Download, Eye, FileSpreadsheet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { sheetsSummary } from "@/features/workspace/cellGrid";
import type { Attachment, SheetVersion } from "@/shared/types";
import { versionNumberOf } from "./sheetVersions";

type Props = {
  // The attachment and its versions, oldest first
  files: Attachment[];
  versions: SheetVersion[];
  onOpen: (file: Attachment) => void;
  onView: (id: string) => void;
  onSave: (id: string) => void;
  // "Seguir desde esta"; undefined while a reply is being written
  onRestore?: (id: string) => void;
};

// What a version changed, or what it is a copy of
function versionNote(version: SheetVersion | undefined, t: TFunction) {
  if (!version) return t("attachments.versions.group.attachedByYou");
  if (version.restoredFrom !== undefined) {
    return version.restoredFrom <= 1
      ? t("attachments.versions.group.copyOfOriginal")
      : t("attachments.versions.group.copyOfVersion", { number: version.restoredFrom });
  }
  return sheetsSummary(version.cells).join(", ");
}

// An attached spreadsheet with the versions Nyra made of it, newest first, joined by a line of diamonds. The latest is
// the one the next changes start from.
export function SheetVersionsGroup({ files, versions, onOpen, onView, onSave, onRestore }: Props) {
  const { t } = useTranslation();
  const [original] = files;
  const latest = files[files.length - 1];
  const newestFirst = [...files].reverse();

  return (
    <li className="sheet-versions">
      <div className="sheet-versions-head">
        <span className="sheet-versions-icon">
          <FileSpreadsheet size={15} strokeWidth={2} aria-hidden="true" />
        </span>
        <span>
          <strong className="mono">{original.name}</strong>
          <small>
            {t("attachments.versions.group.count", { count: files.length })} ·{" "}
            {t("attachments.versions.group.originalUnchanged")}
          </small>
        </span>
      </div>
      <ol aria-label={t("attachments.versions.group.list", { name: original.name })}>
        {newestFirst.map((file) => {
          const number = versionNumberOf(file);
          const version = versions.find((v) => v.id === file.id);
          const isLatest = file === latest;
          const name =
            number <= 1 ? t("attachments.versions.group.original") : t("attachments.versions.group.version", { number });
          return (
            <li key={file.id} className={isLatest ? "latest" : undefined}>
              <span className="sheet-versions-point" aria-hidden="true" />
              <button type="button" className="sheet-versions-text" onClick={() => onOpen(file)}>
                <strong>{name}</strong>
                {isLatest && <span className="sheet-versions-latest"> · {t("attachments.versions.group.latest")}</span>}
                <small>{versionNote(version, t)}</small>
                {isLatest && number > 1 && <small>{t("attachments.versions.group.nextChanges")}</small>}
              </button>
              <span className="sheet-versions-actions">
                {version && version.cells.length > 0 && (
                  <button
                    type="button"
                    className="icon-button small"
                    aria-label={t("attachments.versions.group.viewChangesOf", { number })}
                    title={t("attachments.versions.group.viewChanges")}
                    onClick={() => onView(file.id)}
                  >
                    <Eye size={15} strokeWidth={1.8} />
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button small"
                  aria-label={
                    number <= 1
                      ? t("attachments.versions.group.saveOriginal")
                      : t("attachments.versions.group.saveVersion", { number })
                  }
                  title={t("attachments.versions.group.saveAs")}
                  onClick={() => onSave(file.id)}
                >
                  <Download size={15} strokeWidth={1.8} />
                </button>
                {!isLatest && onRestore && (
                  <button
                    type="button"
                    className="icon-button small"
                    aria-label={
                      number <= 1
                        ? t("attachments.versions.group.continueFromOriginal")
                        : t("attachments.versions.group.continueFromVersion", { number })
                    }
                    title={t("attachments.versions.group.continueTip")}
                    onClick={() => onRestore(file.id)}
                  >
                    <ArrowRightToLine size={15} strokeWidth={1.8} />
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </li>
  );
}
