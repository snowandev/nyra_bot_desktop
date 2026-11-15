import { useCallback, useState } from "react";
import { errorMessage } from "@/shared/lib/errors";
import { SKIP_REASON_LABEL } from "./workspace";
import { workspaceAttachment } from "./workspaceFiles";
import type { Attachment } from "@/shared/types";
import { useWorkspacesContext } from "./workspacesContext";
import { i18n } from "@/shared/i18n/i18n";

// A file of a connected folder shown in the viewer or in the system's file manager, from the list of what a reply
// consulted. It is read again when opened: the conversation only keeps the list, never the content.
export function useWorkspaceFiles() {
  const { stateOf, refresh, reveal } = useWorkspacesContext();
  const [file, setFile] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(
    async (root: string, path: string) => {
      setError(null);
      try {
        // Rust only reads files of the folder's latest index, which a restart forgets
        if (stateOf(root)?.kind !== "ready") await refresh(root);
        const opened = await workspaceAttachment(root, path);
        if (opened.kind === "skipped") setError(i18n.t("workspace.viewer.cannotOpen", { path, reason: SKIP_REASON_LABEL[opened.reason] }));
        else setFile(opened);
      } catch (e) {
        setError(i18n.t("workspace.viewer.openFailed", { path, error: errorMessage(e) }));
      }
    },
    [stateOf, refresh],
  );

  const show = useCallback(
    (root: string, path: string) => {
      setError(null);
      reveal(root, path).catch((e) => setError(i18n.t("workspace.viewer.revealFailed", { path, error: errorMessage(e) })));
    },
    [reveal],
  );

  return {
    file,
    open,
    show,
    close: useCallback(() => setFile(null), []),
    error,
    dismissError: useCallback(() => setError(null), []),
  };
}
