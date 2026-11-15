import { Check, CircleAlert, Download, FileText, FileType } from "lucide-react";
import { useContext, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePopover } from "@/shared/hooks/usePopover";
import { useTransientState } from "@/shared/hooks/useTransientState";
import { pdfFilename } from "./documents";
import { savePdf } from "./documentStorage";
import { saveMarkdownFile, shownImages } from "./markdownFiles";
import { errorMessage } from "@/shared/lib/errors";
import { ConversationImagesContext } from "@/features/markdown/conversationImages";
import { pdfOf } from "./pdfOf";

type Props = {
  filename: string;
  content: string;
  // The PDF's title, as readers show it
  title: string;
};

type SaveState = "idle" | "saving" | "saved" | "error";

// Same look as the copy buttons next to it; it asks for the format, and the native save dialog opens on the Rust side
export function SaveDocumentButton({ filename, content, title }: Props) {
  const { t } = useTranslation();
  const { isOpen, rootRef, close, toggle } = usePopover();
  const images = useContext(ConversationImagesContext);
  // Saved as a .zip with them, and the menu says so
  const withImages = useMemo(() => shownImages(content, images).length > 0, [content, images]);
  const [state, setState, flash] = useTransientState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const Icon = state === "saved" ? Check : state === "error" ? CircleAlert : Download;

  async function save(format: "md" | "pdf") {
    close();
    setState("saving");
    setError(null);
    try {
      const saved =
        format === "md"
          ? await saveMarkdownFile(filename, content, images)
          : await savePdf(pdfFilename(filename), await pdfOf(content, title, images));
      if (saved) flash("saved");
      else setState("idle");
    } catch (e) {
      setError(errorMessage(e));
      flash("error");
    }
  }

  return (
    <div className="save-document" ref={rootRef}>
      <button
        type="button"
        className={`copy-button with-label ${state === "saved" ? "copied" : state}`}
        // Only while the error is on screen; afterwards the button is back to normal
        title={state === "error" ? (error ?? undefined) : undefined}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        disabled={state === "saving"}
        onClick={toggle}
      >
        <Icon size={14} strokeWidth={1.8} />
        {t(`documents.save.${state}`)}
      </button>
      <span className="visually-hidden" role="status">
        {state === "saved" || state === "error" ? (error ?? t(`documents.save.${state}`)) : ""}
      </span>
      {isOpen && (
        <div role="menu" aria-label={t("documents.saveMenu")} className="composer-menu-list down save-document-menu">
          <button type="button" role="menuitem" className="menu-option" onClick={() => save("md")}>
            <FileText size={16} strokeWidth={1.8} />
            <span className="menu-option-text">
              {withImages ? t("documents.markdownZip") : "Markdown (.md)"}
              <span className="menu-option-hint">
                {t(withImages ? "documents.markdownZipHint" : "documents.markdownHint")}
              </span>
            </span>
          </button>
          <button type="button" role="menuitem" className="menu-option" onClick={() => save("pdf")}>
            <FileType size={16} strokeWidth={1.8} />
            <span className="menu-option-text">
              PDF (.pdf)
              <span className="menu-option-hint">{t("documents.pdfHint")}</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
