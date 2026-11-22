import { Pencil, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePreferencesContext } from "@/features/settings/preferencesContext";
import { useSensitiveData } from "@/features/sensitive-data/useSensitiveData";
import { referencedAttachments } from "@/features/attachments/attachments";
import { findSensitiveData, labelsOf } from "@/features/sensitive-data/sensitiveData";
import type { Attachment, Message } from "@/shared/types";
import { AttachmentChip } from "@/features/attachments/AttachmentChip";
import { isTranscript } from "@/features/transcription/audioFiles";
import { SensitiveDataIndicator } from "@/features/sensitive-data/SensitiveDataIndicator";
import { SensitiveSentMark } from "@/features/sensitive-data/SensitiveSentMark";

type Props = {
  // Position in the conversation, so search can find this message on screen
  index: number;
  message: Message;
  // Every attachment of the conversation, to resolve this message's references
  attachmentsById: Map<string, Attachment>;
  isSummarized: boolean;
  onOpenAttachment: (attachment: Attachment) => void;
  // removedFiles: attachments or references taken out while editing
  onEdit?: (text: string, removedFiles: string[]) => void;
  // Undefined while a reply is being written
  onDelete?: () => void;
  // The conversation has nothing else: deleting the message deletes the conversation, so it asks first
  isOnlyExchange: boolean;
  onDeleteConversation?: () => void;
  hasLaterMessages: boolean;
  // The cloud provider a later reply came from: the whole history went there, this message included
  sentTo?: string;
};

export function UserMessage(props: Props) {
  const { index, message, attachmentsById, isSummarized, onOpenAttachment, onEdit, hasLaterMessages, sentTo } = props;
  const { onDelete, isOnlyExchange, onDeleteConversation } = props;
  const { t } = useTranslation();
  const references = useMemo(() => referencedAttachments(message, attachmentsById), [message, attachmentsById]);
  const [draft, setDraft] = useState<string | null>(null);
  const [removedFiles, setRemovedFiles] = useState<string[]>([]);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const isEditing = draft !== null;
  // Transcripts are shown in the replies that made them and in the files panel, not piled up next to their audio
  const attached = useMemo(
    () => message.attachments?.filter((a) => !isTranscript(a, message.attachments ?? [])) ?? [],
    [message.attachments],
  );
  const hasFiles = attached.length > 0 || references.length > 0;
  const keptFiles =
    attached.filter((a) => !removedFiles.includes(a.id)).length +
    references.filter((a) => !removedFiles.includes(a.id)).length;
  const canSave = isEditing && (draft.trim().length > 0 || keptFiles > 0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { preferences } = usePreferencesContext();
  // The edited text goes again with the message's files, so they are checked too
  const files = useMemo(() => [...(message.attachments ?? []), ...references], [message, references]);
  const editing = useSensitiveData(draft ?? "", isEditing ? files : []);
  const sentLabels = useMemo(
    () => (sentTo && preferences.sensitiveDataWarning ? labelsOf(findSensitiveData(message.content, files)) : []),
    [sentTo, preferences.sensitiveDataWarning, message, files],
  );

  function startEditing() {
    setRemovedFiles([]);
    setDraft(message.content);
  }

  // Cancelling forgets the files taken out: nothing changed
  function stopEditing() {
    setDraft(null);
    setRemovedFiles([]);
  }

  function save() {
    if (!canSave || !onEdit) return;
    // An audio taken out takes its hidden transcripts with it
    const removedAudio = attached.filter((a) => a.kind === "audio" && removedFiles.includes(a.id));
    const theirTranscripts = (message.attachments ?? []).filter(
      (a) => isTranscript(a, removedAudio) && (!a.transcriptOf || removedAudio.some((audio) => audio.id === a.transcriptOf)),
    );
    onEdit(draft.trim(), [...removedFiles, ...theirTranscripts.map((a) => a.id)]);
    stopEditing();
  }

  function remove() {
    if (isOnlyExchange) setIsConfirmingDelete(true);
    else onDelete?.();
  }

  // While editing, each file has a ✕ so a file too large for the model can go without losing the text
  const removeFile = isEditing ? (id: string) => setRemovedFiles((ids) => [...ids, id]) : undefined;

  function selectText(secret: string) {
    const at = draft?.indexOf(secret) ?? -1;
    if (at === -1) return;
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(at, at + secret.length);
  }

  return (
    <div className="user-message" data-message-index={index}>
      {hasFiles && (
        <div className="attachment-list">
          {attached
            .filter((a) => !removedFiles.includes(a.id))
            .map((a) => (
              <AttachmentChip
                key={a.id}
                attachment={a}
                isSummarized={isSummarized}
                onOpen={removeFile ? undefined : () => onOpenAttachment(a)}
                onRemove={removeFile && (() => removeFile(a.id))}
              />
            ))}
          {references
            .filter((a) => !removedFiles.includes(a.id))
            .map((a) => (
              <AttachmentChip
                key={`reference-${a.id}`}
                attachment={a}
                isReference
                onOpen={removeFile ? undefined : () => onOpenAttachment(a)}
                onRemove={removeFile && (() => removeFile(a.id))}
              />
            ))}
        </div>
      )}

      {isEditing ? (
        <div className="user-edit">
          <textarea
            ref={textareaRef}
            aria-label={t("chat.user.edit")}
            autoFocus
            rows={Math.min(10, Math.max(2, draft.split("\n").length))}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.setSelectionRange(draft.length, draft.length)}
            onKeyDown={(e) => {
              if (e.key === "Escape") stopEditing();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                save();
              }
            }}
          />
          <div className="user-edit-bar">
            {(hasLaterMessages || removedFiles.length > 0) && (
              <span className="user-edit-hint">
                {removedFiles.length > 0 && `${t("chat.user.withoutFiles")} `}
                {hasLaterMessages && t("chat.user.laterReplaced")}
              </span>
            )}
            <button type="button" className="ghost-button" onClick={stopEditing}>
              {t("common.cancel")}
            </button>
            {editing.matches.length > 0 && (
              <SensitiveDataIndicator
                matches={editing.matches}
                placement="up"
                onSelectText={selectText}
              />
            )}
            <button type="button" className="primary-button user-edit-send" disabled={!canSave} onClick={save}>
              {t("chat.user.send")}
            </button>
          </div>
        </div>
      ) : (
        <>
          {message.content && <div className="user-bubble">{message.content}</div>}
          {message.skill && (
            <span className="skill-mark mono" aria-label={t("chat.user.manualSkill", { name: message.skill })}>
              <Sparkles size={11} strokeWidth={2} aria-hidden="true" />
              {message.skill}
            </span>
          )}
          {sentLabels.length > 0 && sentTo && <SensitiveSentMark labels={sentLabels} destination={sentTo} />}
          {/* Disabled instead of removed: hiding every bar while a reply streams shifts the history and breaks auto-scroll */}
          <div className="message-actions user-actions">
            <button
              type="button"
              className="icon-button small"
              aria-label={t("chat.user.edit")}
              disabled={!onEdit}
              title={hasFiles ? t("chat.user.editTitleFiles") : t("chat.user.edit")}
              onClick={startEditing}
            >
              <Pencil size={16} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="icon-button small"
              aria-label={isOnlyExchange ? t("chat.user.deleteWithConversation") : t("chat.user.delete")}
              title={t("chat.user.delete")}
              disabled={!onDelete}
              onClick={remove}
            >
              <Trash2 size={16} strokeWidth={1.8} />
            </button>
          </div>
          {isConfirmingDelete && (
            <div role="alertdialog" aria-labelledby={`delete-only-${index}`} className="danger-confirm user-delete-confirm">
              <span id={`delete-only-${index}`} className="danger-confirm-text">
                {t("chat.user.onlyMessage")}
              </span>
              <div className="danger-confirm-actions">
                <button type="button" className="ghost-button" autoFocus onClick={() => setIsConfirmingDelete(false)}>
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="primary-button danger padded"
                  onClick={() => {
                    setIsConfirmingDelete(false);
                    onDeleteConversation?.();
                  }}
                >
                  {t("chat.user.deleteConversation")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
