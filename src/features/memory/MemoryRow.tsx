import { Bookmark, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { formatDate } from "@/shared/lib/format";
import type { Memory } from "./memoryStorage";
import { MemoryEditor } from "./MemoryEditor";

type Props = {
  memory: Memory;
  // The title of the conversation it was saved in, while that conversation exists
  conversationTitle?: string;
  onOpenConversation: (id: string) => void;
  onUpdate: (text: string) => Promise<void>;
  onDelete: () => void;
};

function origin({ memory, conversationTitle, onOpenConversation }: Props, t: TFunction) {
  if (memory.source === "user") return t("memory.row.manual");
  const { conversationId } = memory;
  if (!conversationId || !conversationTitle) return t("memory.row.goneConversation");
  return (
    <>
      {t("memory.row.savedIn")}{" "}
      <button type="button" className="memory-origin-link" onClick={() => onOpenConversation(conversationId)}>
        {t("ui.quotedName", { name: conversationTitle })}
      </button>
    </>
  );
}

export function MemoryRow(props: Props) {
  const { memory, onUpdate, onDelete } = props;
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // Back on "Editar" once it is drawn again, so the keyboard doesn't lose its place
  useEffect(() => {
    if (isEditing || !returnFocus.current) return;
    returnFocus.current = false;
    editRef.current?.focus();
  }, [isEditing]);

  function stopEditing() {
    returnFocus.current = true;
    setIsEditing(false);
  }

  if (isEditing) {
    return (
      <li className="memory-row editing">
        <Bookmark size={15} strokeWidth={2} aria-hidden="true" />
        <MemoryEditor
          initialText={memory.text}
          label={t("memory.row.editLabel")}
          onSave={async (text) => {
            await onUpdate(text);
            stopEditing();
          }}
          onCancel={stopEditing}
        />
      </li>
    );
  }

  return (
    <li className="memory-row">
      <Bookmark size={15} strokeWidth={2} aria-hidden="true" />
      <div className="memory-row-body">
        <span className="memory-row-text">{memory.text}</span>
        <span className="memory-row-meta">
          {formatDate(memory.createdAt)} · {origin(props, t)}
        </span>
      </div>
      <span className="memory-row-actions">
        <button
          ref={editRef}
          type="button"
          className="icon-button small"
          aria-label={t("memory.row.editOf", { text: memory.text })}
          title={t("memory.row.edit")}
          onClick={() => setIsEditing(true)}
        >
          <Pencil size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="icon-button small danger"
          aria-label={t("memory.row.deleteOf", { text: memory.text })}
          title={t("memory.row.delete")}
          onClick={onDelete}
        >
          <Trash2 size={15} strokeWidth={1.8} />
        </button>
      </span>
    </li>
  );
}
