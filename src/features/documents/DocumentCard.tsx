import { FileText, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MarkdownDocument } from "./documents";
import { formatBytes, textBytes } from "@/shared/lib/format";
import { CopyButton } from "@/shared/ui/CopyButton";
import { Markdown } from "@/features/markdown/Markdown";
import { SaveDocumentButton } from "./SaveDocumentButton";

type Props = {
  document: MarkdownDocument;
  // The reply is still arriving, so an unclosed document is being written rather than cut off
  isWriting: boolean;
  // Inside a shared image: fully expanded and without buttons
  isForImage?: boolean;
};

// Long documents start collapsed so they don't push the conversation away
const COLLAPSE_AFTER_LINES = 14;

export function DocumentCard({ document, isWriting, isForImage = false }: Props) {
  const { title, filename, content, isComplete } = document;
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const isBeingWritten = !isComplete && isWriting;
  // Not while it is being written: the user follows it as it grows
  const canCollapse = !isForImage && !isBeingWritten && content.split("\n").length > COLLAPSE_AFTER_LINES;
  const isCollapsed = canCollapse && !isExpanded;

  return (
    <section className="document-card" aria-label={t("documents.label", { title })}>
      <div className="document-card-header">
        <span className="document-card-icon">
          <FileText size={18} strokeWidth={1.8} />
        </span>
        <span className="document-card-heading">
          <span className="document-card-title">{title}</span>
          <span className="document-card-meta">
            <span className="mono">{filename}</span> · {formatBytes(textBytes(content))}
          </span>
        </span>
        {isBeingWritten ? (
          <span className="document-card-writing" role="status">
            <LoaderCircle size={14} strokeWidth={2.2} className="spin" />
            {t("documents.writing")}
          </span>
        ) : (
          !isForImage && (
            <span className="document-card-actions">
              <CopyButton text={content} label={t("documents.copy")} showLabel />
              <SaveDocumentButton filename={filename} content={content} title={title} />
            </span>
          )
        )}
      </div>
      <div className={`document-card-preview ${isCollapsed ? "collapsed" : ""}`}>
        <Markdown>{content}</Markdown>
      </div>
      {canCollapse && (
        <button
          type="button"
          className="link-button document-card-toggle"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((open) => !open)}
        >
          {isExpanded ? t("documents.less") : t("documents.more")}
        </button>
      )}
    </section>
  );
}
