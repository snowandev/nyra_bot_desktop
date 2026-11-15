import { useTranslation } from "react-i18next";
import { domainOf } from "@/shared/lib/links";
import type { PdfProgress } from "./pdf";
import type { Attachment } from "@/shared/types";
import { AttachmentChip } from "./AttachmentChip";
import { InvokedSkillPill } from "@/features/skills/InvokedSkillPill";
import { LoadingChip } from "./LoadingChip";

type Props = {
  // The skill chosen for this message goes first: it goes with the message, like a file
  invokedSkill: string | null;
  onRemoveSkill: () => void;
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  // Files from earlier in the conversation sent again with this message
  references: Attachment[];
  onRemoveReference?: (id: string) => void;
  pendingPdfs: { id: string; name: string; progress: PdfProgress | null }[];
  onCancelPdf: (id: string) => void;
  pendingPages: { id: string; url: string }[];
  onCancelPage: (id: string) => void;
  // Audio being kept as a file
  pendingAudios: { id: string; name: string }[];
  onCancelAudio: (id: string) => void;
};

// What goes with the message being written, above the text: the chosen skill, files, and files still being read
export function ComposerAttachments(props: Props) {
  const { invokedSkill, onRemoveSkill, attachments, onRemoveAttachment, references, onRemoveReference } = props;
  const { pendingPdfs, onCancelPdf, pendingPages, onCancelPage, pendingAudios, onCancelAudio } = props;
  const { t } = useTranslation();
  const isEmpty =
    !invokedSkill &&
    attachments.length + references.length + pendingPdfs.length + pendingPages.length + pendingAudios.length === 0;
  if (isEmpty) return null;

  return (
    <div className="attachment-list" aria-label={t("attachments.composer.list")}>
      {invokedSkill && <InvokedSkillPill name={invokedSkill} onRemove={onRemoveSkill} />}
      {attachments.map((a) => (
        <AttachmentChip key={a.id} attachment={a} onRemove={() => onRemoveAttachment(a.id)} />
      ))}
      {references.map((a) => (
        <AttachmentChip
          key={`reference-${a.id}`}
          attachment={a}
          isReference
          onRemove={onRemoveReference && (() => onRemoveReference(a.id))}
        />
      ))}
      {pendingPdfs.map((p) => (
        <LoadingChip
          key={p.id}
          name={p.name}
          label={t("attachments.composer.readingPdf")}
          detail={
            p.progress
              ? t("attachments.composer.pdfProgress", { page: p.progress.page, pages: p.progress.pages })
              : undefined
          }
          percent={p.progress ? Math.round((p.progress.page / p.progress.pages) * 100) : 0}
          onCancel={() => onCancelPdf(p.id)}
        />
      ))}
      {pendingAudios.map((p) => (
        <LoadingChip
          key={p.id}
          name={p.name}
          label={t("transcription.storing")}
          onCancel={() => onCancelAudio(p.id)}
        />
      ))}
      {pendingPages.map((p) => (
        <LoadingChip
          key={p.id}
          name={domainOf(p.url)}
          label={t("attachments.composer.readingPage")}
          onCancel={() => onCancelPage(p.id)}
        />
      ))}
    </div>
  );
}
