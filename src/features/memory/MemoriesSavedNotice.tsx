import { ArrowRight, Bookmark } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMemoriesContext } from "./memoriesContext";
import type { SavedMemory } from "@/shared/types";

type Props = {
  saved: SavedMemory[];
  // Opens Settings → Personalización → Memoria, the only place where memories are changed
  onOpenMemories?: () => void;
};

// Read-only on purpose: the chat says what Nyra saved, as it is now, and nothing more
export function MemoriesSavedNotice({ saved, onOpenMemories }: Props) {
  const { memories } = useMemoriesContext();
  const { t } = useTranslation();
  const shown = saved.map((s) => {
    const current = memories.find((m) => m.id === s.id);
    return { id: s.id, text: current?.text ?? s.text, state: !current ? "deleted" : current.text !== s.text ? "edited" : "kept" };
  });
  const allDeleted = shown.every((m) => m.state === "deleted");
  const link = onOpenMemories && !allDeleted && (
    <button type="button" className="memories-saved-link" onClick={onOpenMemories}>
      {t("memory.saved.open")}
      <ArrowRight size={13} strokeWidth={2.2} />
    </button>
  );
  const text = (m: (typeof shown)[number]) => (
    <>
      {m.state === "deleted" ? <s className="memories-saved-text">{m.text}</s> : <span className="memories-saved-text">{m.text}</span>}
      {m.state !== "kept" && <span className="memories-saved-tag">{m.state === "deleted" ? t("memory.saved.deleted") : t("memory.saved.edited")}</span>}
    </>
  );

  return (
    <div
      className={`memories-saved ${allDeleted ? "all-deleted" : ""}`}
      role="note"
      aria-label={t("memory.saved.label", { count: shown.length })}
    >
      {shown.length === 1 ? (
        <div className="memories-saved-row">
          <Bookmark size={15} strokeWidth={2} aria-hidden="true" />
          <span className="memories-saved-label">{t("memory.saved.remembered")}</span>
          {text(shown[0])}
          {link}
        </div>
      ) : (
        <>
          <div className="memories-saved-row">
            <Bookmark size={15} strokeWidth={2} aria-hidden="true" />
            <span className="memories-saved-label">{t("memory.saved.rememberedThings", { count: shown.length })}</span>
            {link}
          </div>
          <ul>
            {shown.map((m) => (
              <li key={m.id}>{text(m)}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
