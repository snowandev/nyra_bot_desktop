import { FolderOpen, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isGeneratedDocument } from "@/features/documents/documents";
import type { FileState } from "@/features/chat/reply/summary";
import type { Attachment, SheetVersion } from "@/shared/types";
import { FileRow } from "./FileRow";
import { FilesGroup } from "./FilesGroup";
import { lineageOf } from "./sheetVersions";
import { SheetVersionsGroup } from "./SheetVersionsGroup";

type Props = {
  attachments: Attachment[];
  // Only known once the conversation has been summarized; before that every file is complete
  states: Map<string, FileState> | null;
  pendingReferenceIds: string[];
  onReference: (attachment: Attachment) => void;
  openId: string | null;
  onOpen: (attachment: Attachment) => void;
  // The message each file came with, by file id (fileOriginsOf), and how to go to it
  origins: Map<string, number>;
  onShowMessage: (index: number) => void;
  // Versions Nyra made of attached spreadsheets, shown together with the attachment
  sheetVersions: SheetVersion[];
  onViewSheetVersion: (id: string) => void;
  onSaveSheetVersion: (id: string) => void;
  // Undefined while a reply is being written
  onRestoreSheetVersion?: (fileId: string) => void;
  onClose: () => void;
};

type Filter = "all" | "uploaded" | "generated";

// Their names are in the catalog, under attachments.panel.filters
const FILTERS: Filter[] = ["all", "uploaded", "generated"];

export function AttachmentsPanel(props: Props) {
  const { attachments, states, pendingReferenceIds, onReference, openId, onOpen, origins, onShowMessage, onClose } = props;
  const { sheetVersions, onViewSheetVersion, onSaveSheetVersion, onRestoreSheetVersion } = props;
  const { t } = useTranslation();
  // A spreadsheet with versions is one entry, under its first file
  const lineages = new Map<string, Attachment[]>();
  for (const a of attachments) {
    if (a.workbook) lineages.set(lineageOf(a), [...(lineages.get(lineageOf(a)) ?? []), a]);
  }
  const versionsOf = (a: Attachment) => (a.workbook ? (lineages.get(lineageOf(a)) ?? []) : []);
  const [filter, setFilter] = useState<Filter>("all");
  const generated = attachments.filter(isGeneratedDocument);
  const uploaded = attachments.filter((a) => !isGeneratedDocument(a));
  // With only one kind of file the tabs would just repeat the same list
  const hasTabs = generated.length > 0 && uploaded.length > 0;
  const byFilter = { all: attachments, uploaded, generated };
  const visible = hasTabs ? byFilter[filter] : attachments;
  const row = (a: Attachment) => {
    const files = versionsOf(a);
    if (files.length > 1) {
      return files[0] === a ? (
        <SheetVersionsGroup
          key={a.id}
          files={files}
          versions={sheetVersions}
          onOpen={onOpen}
          onView={onViewSheetVersion}
          onSave={onSaveSheetVersion}
          onRestore={onRestoreSheetVersion}
        />
      ) : null;
    }
    return fileRow(a);
  };
  const fileRow = (a: Attachment) => (
    <FileRow
      key={a.id}
      attachment={a}
      state={states?.get(a.id)}
      isPending={pendingReferenceIds.includes(a.id)}
      onReference={() => onReference(a)}
      isOpen={a.id === openId}
      onOpen={() => onOpen(a)}
      onShowMessage={origins.has(a.id) ? () => onShowMessage(origins.get(a.id) ?? 0) : undefined}
    />
  );
  const inContext = visible.filter((a) => states?.get(a.id) !== "summarized");
  const summarized = visible.filter((a) => states?.get(a.id) === "summarized");

  return (
    <aside aria-label={t("attachments.panel.label")} className="files-panel">
      <div className="files-panel-header">
        <div className="files-panel-title">
          <h2>{t("attachments.panel.title")}</h2>
          <span className="pill">{attachments.length}</span>
        </div>
        <button type="button" className="icon-button small" aria-label={t("attachments.panel.close")} onClick={onClose}>
          <X size={18} strokeWidth={2} />
        </button>
      </div>

      {hasTabs && (
        <div className="files-tabs" role="tablist" aria-label={t("attachments.panel.show")}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              className="files-tab"
              onClick={() => setFilter(f)}
            >
              {t(`attachments.panel.filters.${f}`)}
              <span className="files-tab-count">{byFilter[f].length}</span>
            </button>
          ))}
        </div>
      )}

      {attachments.length === 0 ? (
        <div className="files-empty">
          <div className="files-empty-icon">
            <span />
            <FolderOpen size={24} strokeWidth={1.8} />
          </div>
          <span className="files-empty-title">{t("attachments.panel.emptyTitle")}</span>
          <span className="files-empty-text">{t("attachments.panel.emptyText")}</span>
        </div>
      ) : states ? (
        <div className="files-list grouped">
          <FilesGroup title={t("attachments.panel.inContext")} count={inContext.length}>
            {inContext.map(row)}
          </FilesGroup>
          <FilesGroup
            title={t("attachments.panel.inSummary")}
            count={summarized.length}
            note={t("attachments.panel.summaryNote")}
          >
            {summarized.map(row)}
          </FilesGroup>
        </div>
      ) : (
        <ul className="files-list">{visible.map(row)}</ul>
      )}
    </aside>
  );
}
