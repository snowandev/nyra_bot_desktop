import { useTranslation } from "react-i18next";
import { ComposerAttachments } from "@/features/attachments/ComposerAttachments";
import type { PdfProgress } from "@/features/attachments/pdf";
import { FileErrorNotice } from "@/features/attachments/FileErrorNotice";
import type { Attachment } from "@/shared/types";

type Props = {
  attachments: Attachment[];
  onRemove: (id: string) => void;
  pendingPdfs: { id: string; name: string; progress: PdfProgress | null }[];
  onCancelPdf: (id: string) => void;
  pendingAudios: { id: string; name: string }[];
  onCancelAudio: (id: string) => void;
  fileError: { message: string; help?: string } | null;
  onDismissError: () => void;
  imagesUnsupported: boolean;
};

const none = () => {};

// What goes with the message in the quick bar, above it: pasted files, and why one can't go
export function QuickAttachments(props: Props) {
  const { attachments, onRemove, pendingPdfs, onCancelPdf, pendingAudios, onCancelAudio } = props;
  const { fileError, onDismissError, imagesUnsupported } = props;
  const { t } = useTranslation();
  if (attachments.length + pendingPdfs.length + pendingAudios.length === 0 && !fileError) return null;

  return (
    <div className="quick-attachments">
      <ComposerAttachments
        invokedSkill={null}
        onRemoveSkill={none}
        attachments={attachments}
        onRemoveAttachment={onRemove}
        references={[]}
        pendingPdfs={pendingPdfs}
        onCancelPdf={onCancelPdf}
        pendingPages={[]}
        onCancelPage={none}
        pendingAudios={pendingAudios}
        onCancelAudio={onCancelAudio}
      />
      {imagesUnsupported && (
        <p role="alert" className="composer-warning">
          {t("attachments.imagesUnsupported")}
        </p>
      )}
      {fileError && <FileErrorNotice error={fileError} onDismiss={onDismissError} />}
    </div>
  );
}
