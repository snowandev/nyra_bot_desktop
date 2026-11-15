import { Check, Copy, Download, FileText, FileType, LoaderCircle, Share } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePopover } from "@/shared/hooks/usePopover";
import { useTransientState } from "@/shared/hooks/useTransientState";
import type { ShareAction } from "./share";

type Props = {
  onShare: (action: ShareAction) => Promise<boolean>;
};

type ShareState = "idle" | "working" | ShareAction;

const isDone = (state: ShareState): state is ShareAction => state !== "idle" && state !== "working";

export function ShareMenu({ onShare }: Props) {
  const { t } = useTranslation();
  const { isOpen, rootRef, close, toggle } = usePopover();
  const [state, setState, flash] = useTransientState<ShareState>("idle");
  const label = isDone(state) ? t(`share.done.${state}`) : t("share.share");
  const Icon = state === "working" ? LoaderCircle : state === "idle" ? Share : Check;

  async function run(action: ShareAction) {
    close();
    setState("working");
    if (await onShare(action)) flash(action);
    else setState("idle");
  }

  return (
    <div className="share-menu" ref={rootRef}>
      <button
        type="button"
        className={`icon-button small ${isDone(state) ? "share-done" : ""}`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        disabled={state === "working"}
        onClick={toggle}
      >
        <Icon size={16} strokeWidth={1.8} className={state === "working" ? "spin" : undefined} />
      </button>
      <span className="visually-hidden" role="status">
        {isDone(state) ? label : ""}
      </span>

      {isOpen && (
        <div role="menu" aria-label={t("share.share")} className="composer-menu-list up">
          <button type="button" role="menuitem" className="menu-option" onClick={() => run("copy")}>
            <Copy size={16} strokeWidth={1.8} />
            <span className="menu-option-text">
              {t("share.copyImage")}
              <span className="menu-option-hint">{t("share.copyImageHint")}</span>
            </span>
          </button>
          <button type="button" role="menuitem" className="menu-option" onClick={() => run("save")}>
            <Download size={16} strokeWidth={1.8} />
            <span className="menu-option-text">
              {t("share.saveImage")}
              <span className="menu-option-hint">{t("share.saveImageHint")}</span>
            </span>
          </button>
          <button type="button" role="menuitem" className="menu-option" onClick={() => run("markdown")}>
            <FileText size={16} strokeWidth={1.8} />
            <span className="menu-option-text">
              {t("share.saveMarkdown")}
              <span className="menu-option-hint">{t("share.saveMarkdownHint")}</span>
            </span>
          </button>
          <button type="button" role="menuitem" className="menu-option" onClick={() => run("pdf")}>
            <FileType size={16} strokeWidth={1.8} />
            <span className="menu-option-text">
              {t("share.savePdf")}
              <span className="menu-option-hint">{t("share.savePdfHint")}</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
