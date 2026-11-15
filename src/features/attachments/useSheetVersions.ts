import { useMemo, useState } from "react";
import { i18n } from "@/shared/i18n/i18n";
import { errorMessage } from "@/shared/lib/errors";
import type { Attachment, Message, SheetVersion } from "@/shared/types";
import { versionFileName, versionNumberOf } from "./sheetVersions";
import { saveSpreadsheet } from "./spreadsheetStorage";

// The versions of attached spreadsheets in a conversation: which one is open in the review, and saving any of them
export function useSheetVersions(messages: Message[]) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const files = useMemo(
    () => new Map(messages.flatMap((m) => m.attachments ?? []).map((a) => [a.id, a])),
    [messages],
  );
  const versions = useMemo(() => messages.flatMap((m) => m.sheetVersions ?? []), [messages]);
  const open = versions.find((v) => v.id === openId && !v.error);

  async function save(file: Attachment) {
    if (!file.workbook) return;
    setError(null);
    try {
      await saveSpreadsheet(versionFileName(file.name, versionNumberOf(file)), file.workbook);
    } catch (e) {
      setError(i18n.t("attachments.errors.saveFailed", { name: file.name, error: errorMessage(e) }));
    }
  }

  return {
    versions,
    open: open && { version: open, file: files.get(open.id), base: files.get(open.baseId) },
    view: (id: string) => setOpenId(id),
    close: () => setOpenId(null),
    save: (id: string) => {
      const file = files.get(id);
      if (file) void save(file);
    },
    error,
    clearError: () => setError(null),
  };
}

export type OpenSheetVersion = { version: SheetVersion; file?: Attachment; base?: Attachment };
