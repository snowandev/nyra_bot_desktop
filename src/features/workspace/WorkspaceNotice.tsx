import { Cloud, FolderX, Lock, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { WorkspaceState } from "./useWorkspaces";
import type { WorkspaceIndexText } from "./workspace";
import type { WorkspaceFolder } from "@/shared/types";

type Props = {
  folder: WorkspaceFolder;
  state: WorkspaceState | null;
  index: WorkspaceIndexText | null | undefined;
  modelName?: string;
  cloudProvider?: string;
  // The informative notice is shown once; the problems stay until they are solved
  dismissed: { cloud: boolean };
  onDismiss: (notice: "cloud") => void;
  // Missing for a project's folder, which can't be changed nor disconnected
  onChange?: () => void;
  onDisconnect?: () => void;
};

type Notice = { tone: "info" | "warning"; icon: ReactNode; title: ReactNode; text: ReactNode; actions?: ReactNode };

// What the composer says about the connected folder, above it. Problems are yellow, never red: Nyra keeps
// answering without the folder until they are solved.
export function WorkspaceNotice(props: Props) {
  const { folder, state, index, modelName, cloudProvider, dismissed, onDismiss, onChange, onDisconnect } = props;
  const { t } = useTranslation();
  const name = folder.name;
  const model = modelName ?? t("workspace.thisModel");
  // The folder's path, in its own style, inside a translated sentence
  const withPath = (key: "workspace.notice.missingText" | "workspace.notice.noAccessText") => (
    <Trans
      i18nKey={key}
      values={{ path: folder.path }}
      components={{ path: <span className="mono workspace-notice-path" /> }}
    />
  );
  const fix = (label: string) =>
    onChange &&
    onDisconnect && (
      <>
        <button type="button" className="outline-button small" onClick={onChange}>
          {label}
        </button>
        <button type="button" className="ghost-button" onClick={onDisconnect}>
          {t("workspace.disconnect")}
        </button>
      </>
    );
  const dismiss = (notice: "cloud") => (
    <button type="button" className="outline-button small" onClick={() => onDismiss(notice)}>
      {t("workspace.notice.gotIt")}
    </button>
  );
  const warning = <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />;

  let notice: Notice | null = null;
  if (state?.kind === "missing") {
    notice = {
      tone: "warning",
      icon: <FolderX size={16} strokeWidth={2} aria-hidden="true" />,
      title: t("workspace.notice.missingTitle", { name }),
      text: withPath("workspace.notice.missingText"),
      actions: fix(t("workspace.notice.findIt")),
    };
  } else if (state?.kind === "noAccess") {
    notice = {
      tone: "warning",
      icon: <Lock size={16} strokeWidth={2} aria-hidden="true" />,
      title: t("workspace.notice.noAccessTitle", { name }),
      text: withPath("workspace.notice.noAccessText"),
      actions: fix(t("workspace.notice.giveAccess")),
    };
  } else if (state?.kind === "error") {
    notice = {
      tone: "warning",
      icon: warning,
      title: t("workspace.notice.errorTitle", { name }),
      text: t("workspace.notice.errorText", { message: state.message }),
      actions: fix(t("workspace.notice.chooseAnother")),
    };
  } else if (state?.kind === "empty") {
    notice = {
      tone: "warning",
      icon: <FolderX size={16} strokeWidth={2} aria-hidden="true" />,
      title: t("workspace.notice.emptyTitle", { name }),
      text: t("workspace.notice.emptyText"),
      actions: fix(t("workspace.notice.chooseAnother")),
    };
  } else if (state?.kind === "ready" && index === null) {
    notice = {
      tone: "warning",
      icon: warning,
      title: t("workspace.notice.tooBigTitle", { name, model }),
      text: t("workspace.notice.tooBigText"),
      actions: fix(t("workspace.notice.connectSubfolder")),
    };
  } else if (state?.kind === "indexing") {
    notice = {
      tone: "info",
      icon: <span className="workspace-spinner" aria-hidden="true" />,
      title: t("workspace.notice.readingTitle"),
      text: t("workspace.notice.readingText"),
    };
  } else if (state?.kind === "ready" && cloudProvider && !dismissed.cloud) {
    notice = {
      tone: "info",
      icon: <Cloud size={16} strokeWidth={2} aria-hidden="true" />,
      title: t("workspace.notice.cloudTitle", { model, provider: cloudProvider }),
      text: t("workspace.notice.cloudText"),
      actions: dismiss("cloud"),
    };
  }
  if (!notice) return null;

  return (
    <div className={`workspace-notice ${notice.tone}`} role="status">
      {notice.icon}
      <div className="workspace-notice-body">
        <p>
          <strong>{notice.title}</strong> {notice.text}
        </p>
        {notice.actions && <div className="workspace-notice-actions">{notice.actions}</div>}
      </div>
    </div>
  );
}
