import { X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@/shared/ui/Dialog";
import { describeAttachment, fileTypeOf, imageSrc, pdfPageSrc, textLinesOf } from "./attachments";
import { isGeneratedDocument } from "@/features/documents/documents";
import type { Attachment } from "@/shared/types";
import { CopyButton } from "@/shared/ui/CopyButton";
import { ExternalLink } from "@/shared/ui/ExternalLink";
import { FileIcon } from "./FileIcon";
import { HighlightedCode } from "@/features/markdown/HighlightedCode";
import { CodeViewSwitch } from "@/features/markdown/CodeViewSwitch";
import { useCodeViews } from "@/features/markdown/useCodeViews";
import { PdfDocumentView } from "./PdfDocumentView";
import { SaveDocumentButton } from "@/features/documents/SaveDocumentButton";
import { transcriptNameOf } from "@/features/transcription/transcript";
import { AudioPlayer } from "@/features/transcription/AudioPlayer";

type Props = {
  attachment: Attachment;
  onClose: () => void;
  // Actions of the place it was opened from, before the close button (a project's file: mention it)
  actions?: ReactNode;
};

export function AttachmentViewer({ attachment, onClose, actions }: Props) {
  const { t } = useTranslation();
  const [dimensions, setDimensions] = useState<string | null>(null);
  const isImage = attachment.kind === "image";
  const isPdf = attachment.kind === "pdf";
  const isAudio = attachment.kind === "audio";
  const text = attachment.kind === "text" ? textLinesOf(attachment) : "";
  const fileType = fileTypeOf(attachment).ext;
  // A code file can be read reformatted, a JSON one also on one line; copying copies what is shown
  const views = useCodeViews(text, attachment.kind === "text" ? fileType : null);
  const lineCount = views.shown.split("\n").length;
  // Where its transcript is, once Nyra made it; the file itself isn't shown, only what it says
  const transcriptName = isAudio && attachment.transcript ? transcriptNameOf(attachment.name) : null;
  const audioNote = transcriptName
    ? t("transcription.viewer.done", { name: transcriptName })
    : t("transcription.viewer.pending");
  const pages = attachment.pages ?? [];

  const details = [
    describeAttachment(attachment),
    isImage ? dimensions : isPdf || isAudio ? null : t("attachments.lines", { count: lineCount }),
  ].filter(Boolean);

  return (
    <Dialog
      onClose={onClose}
      label={attachment.name}
      className={`viewer ${attachment.kind}`}
      backdropClassName="viewer-overlay"
    >
      <div className="viewer-header">
        <FileIcon attachment={attachment} size="medium" />
        <div className="viewer-title">
          <span className="viewer-name">{attachment.name}</span>
          <span className="viewer-meta">{details.join(" · ")}</span>
        </div>
        {!isImage && attachment.data && (
          <div className="viewer-copy">
            {views.kind && (
              <CodeViewSwitch
                kind={views.kind}
                json={views.json}
                view={views.view}
                onChange={views.setView}
                formatting={views.formatting}
                error={views.error}
              />
            )}
            <CopyButton
              text={views.isReshaped ? views.shown : attachment.data}
              label={isPdf ? t("attachments.viewer.copyText") : t("attachments.viewer.copy")}
              showLabel
            />
            {attachment.url && (
              <ExternalLink href={attachment.url} className="viewer-open-link">
                {t("attachments.viewer.openInBrowser")}
              </ExternalLink>
            )}
            {isGeneratedDocument(attachment) && (
              <SaveDocumentButton
                filename={attachment.name}
                content={attachment.data}
                title={attachment.name.replace(/\.md$/i, "")}
              />
            )}
          </div>
        )}
        {actions}
        <button
          data-autofocus
          type="button"
          className="icon-button large"
          aria-label={t("attachments.viewer.close")}
          onClick={onClose}
        >
          <X size={20} strokeWidth={2} />
        </button>
      </div>

      {isImage ? (
        <div className="viewer-image">
          <img
            src={imageSrc(attachment)}
            alt={attachment.name}
            onLoad={(e) => setDimensions(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight} px`)}
          />
        </div>
      ) : isPdf && attachment.pdf ? (
        <PdfDocumentView data={attachment.pdf} />
      ) : isPdf ? (
        // Attached with an earlier version: only the pictures of its pages were kept
        <div className="viewer-pages">
          {pages.map((page, i) => (
            <img
              key={i}
              src={pdfPageSrc(page)}
              alt={t("attachments.viewer.page", { page: i + 1, pages: pages.length })}
              loading="lazy"
            />
          ))}
        </div>
      ) : isAudio ? (
        <div className="viewer-audio">
          <AudioPlayer key={attachment.id} audio={attachment} />
          <p>{audioNote}</p>
        </div>
      ) : (
        <div className="viewer-code">
          <HighlightedCode code={views.shown} language={fileType} />
        </div>
      )}
    </Dialog>
  );
}
