import { ArrowRight, Bookmark, LockKeyhole, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useMemoriesContext } from "./memoriesContext";
import { usePreferencesContext } from "@/features/settings/preferencesContext";
import { errorMessage } from "@/shared/lib/errors";
import { formatNumber } from "@/shared/lib/format";
import { MEMORY_TOKENS_LIMIT, memoryTokens } from "./memories";
import type { Memory } from "./memoryStorage";
import { MemoryEditor } from "./MemoryEditor";
import { MemoryRow } from "./MemoryRow";
import { SettingsPanel } from "@/shared/ui/SettingsPanel";

const LOCAL_CONTEXT = 32_768;
// Shown when there are none yet; their texts are in the catalog, under memory.settings.examples
const EXAMPLES = ["city", "short", "dog", "language"] as const;

type Props = {
  conversationTitle: (id: string) => string | undefined;
  onOpenConversation: (id: string) => void;
  // Memory is turned on and off with the other features, in General → Funciones de Nyra
  onShowFeatures: () => void;
};

export function MemorySettings({ conversationTitle, onOpenConversation, onShowFeatures }: Props) {
  const { preferences } = usePreferencesContext();
  const { t } = useTranslation();
  const { memories, loadError, add, update, remove, restore, removeAll } = useMemoriesContext();
  const [isAdding, setIsAdding] = useState(false);
  const [deleted, setDeleted] = useState<Memory | null>(null);
  const [isConfirmingAll, setIsConfirmingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const cancelAllRef = useRef<HTMLButtonElement>(null);
  const isOn = preferences.memory;
  const tokens = isOn ? memoryTokens(memories.map((m) => m.text)) : 0;
  const isHeavy = tokens > MEMORY_TOKENS_LIMIT;

  useEffect(() => {
    if (isConfirmingAll) cancelAllRef.current?.focus();
  }, [isConfirmingAll]);

  // Each action says what failed in the panel; the list only changes once the database did
  async function run(action: () => Promise<void>, failure: string) {
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(`${failure}: ${errorMessage(e)}`);
      return false;
    }
  }

  // No confirmation for one: the bar to undo it is enough, and the keyboard lands on it
  async function deleteOne(memory: Memory) {
    if (await run(() => remove(memory.id), t("memory.settings.deleteFailed"))) {
      setDeleted(memory);
      requestAnimationFrame(() => undoRef.current?.focus());
    }
  }

  async function undoDelete() {
    if (deleted && (await run(() => restore(deleted), t("memory.settings.restoreFailed")))) setDeleted(null);
  }

  async function deleteAll() {
    setIsConfirmingAll(false);
    if (await run(removeAll, t("memory.settings.deleteAllFailed"))) setDeleted(null);
  }

  return (
    <SettingsPanel title={t("settings.personalization.memory")} description={t("memory.settings.description")}>
      <button type="button" className="setting-row memory-feature-shortcut" onClick={onShowFeatures}>
        <span className="setting-row-text">
          <span className="setting-row-title">
            <span className={`status-dot ${isOn ? "loaded" : "idle"}`} />
            {isOn ? t("memory.settings.on") : t("memory.settings.off")}
          </span>
          <span className="setting-row-description">
            {isOn ? t("memory.settings.onHint") : t("memory.settings.offHint")}
          </span>
        </span>
        <span className="memory-feature-shortcut-link">
          {t("memory.settings.goToFeatures")}
          <ArrowRight size={14} strokeWidth={2.2} />
        </span>
      </button>

      <div className={`memory-usage ${isOn ? "" : "off"}`}>
        <div className="memory-usage-line">
          <span>
            <strong>{t("memory.settings.tokens", { tokens: formatNumber(tokens) })}</strong> ·{" "}
            {!isOn
              ? t("memory.settings.notSent")
              : tokens > 0
                ? t("memory.settings.sentEach")
                : t("memory.settings.noneToSend")}
          </span>
          <small>{t("memory.settings.limit", { limit: formatNumber(MEMORY_TOKENS_LIMIT) })}</small>
        </div>
        <div
          className={`memory-meter ${isHeavy ? "heavy" : ""}`}
          role="img"
          aria-label={t("memory.settings.meter", { percent: Math.round((tokens / MEMORY_TOKENS_LIMIT) * 100) })}
        >
          <span style={{ width: `${Math.min(100, (tokens / MEMORY_TOKENS_LIMIT) * 100)}%` }} />
        </div>
      </div>
      {isHeavy && (
        <div className="memory-notice heavy" role="status">
          <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />
          <span>
            <Trans
              i18nKey="memory.settings.heavy"
              values={{ tokens: formatNumber(tokens), percent: Math.round((tokens / LOCAL_CONTEXT) * 100) }}
              components={{ strong: <strong /> }}
            />
          </span>
        </div>
      )}

      <div className="memory-list-header">
        <h4>
          {t("memory.settings.list")} <span className="memory-count">{memories.length}</span>
        </h4>
        <button type="button" className="outline-button small" disabled={isAdding} onClick={() => setIsAdding(true)}>
          <Plus size={15} strokeWidth={2} />
          {t("memory.settings.add")}
        </button>
        <button
          type="button"
          className="outline-button small danger"
          disabled={memories.length === 0 || isConfirmingAll}
          onClick={() => setIsConfirmingAll(true)}
        >
          {t("memory.settings.deleteAll")}
        </button>
      </div>

      {isConfirmingAll && (
        <div
          role="alertdialog"
          aria-labelledby="delete-memories-title"
          aria-describedby="delete-memories-text"
          className="danger-confirm"
          onKeyDown={(e) => e.key === "Escape" && setIsConfirmingAll(false)}
        >
          <div className="danger-confirm-header">
            <Trash2 size={18} strokeWidth={2} />
            <span id="delete-memories-title" className="danger-confirm-title">
              {t("memory.settings.confirm", { count: memories.length })}
            </span>
          </div>
          <p id="delete-memories-text" className="danger-confirm-text">
            {t("memory.settings.confirmText")}
          </p>
          <div className="danger-confirm-actions">
            <button ref={cancelAllRef} type="button" className="ghost-button" onClick={() => setIsConfirmingAll(false)}>
              {t("common.cancel")}
            </button>
            <button type="button" className="primary-button danger padded" onClick={deleteAll}>
              {t("memory.settings.confirmButton", { count: memories.length })}
            </button>
          </div>
        </div>
      )}

      {deleted && (
        <div className="memory-undo" role="status">
          <span>{t("memory.settings.deletedOne", { text: t("ui.quotedName", { name: deleted.text }) })}</span>
          <button ref={undoRef} type="button" className="ghost-button" onClick={undoDelete}>
            {t("memory.settings.undo")}
          </button>
        </div>
      )}
      {(error ?? loadError) && (
        <span className="setting-row-error" role="alert">
          {error ?? t("memory.settings.loadError", { error: loadError })}
        </span>
      )}

      {memories.length === 0 && !isAdding ? (
        <div className="memory-empty">
          <span className="memory-empty-icon">
            <Bookmark size={22} strokeWidth={2} aria-hidden="true" />
          </span>
          <strong>{t("memory.settings.empty")}</strong>
          <p>{t("memory.settings.emptyText")}</p>
          <ul className="memory-examples" aria-label={t("memory.settings.examplesLabel")}>
            {EXAMPLES.map((example) => (
              <li key={example}>
                <Bookmark size={12} strokeWidth={2} aria-hidden="true" />
                {t(`memory.settings.examples.${example}`)}
              </li>
            ))}
          </ul>
          <small>{t("memory.settings.avoid")}</small>
        </div>
      ) : (
        <ul className={`memory-list ${isOn ? "" : "off"}`} aria-label={t("memory.settings.list")}>
          {isAdding && (
            <li className="memory-row editing">
              <Bookmark size={15} strokeWidth={2} aria-hidden="true" />
              <MemoryEditor
                initialText=""
                label={t("memory.settings.newMemory")}
                onSave={async (text) => {
                  await add(text);
                  setIsAdding(false);
                }}
                onCancel={() => setIsAdding(false)}
              />
            </li>
          )}
          {memories.map((memory) => (
            <MemoryRow
              key={memory.id}
              memory={memory}
              conversationTitle={memory.conversationId ? conversationTitle(memory.conversationId) : undefined}
              onOpenConversation={onOpenConversation}
              onUpdate={(text) => update(memory.id, text)}
              onDelete={() => deleteOne(memory)}
            />
          ))}
        </ul>
      )}

      <div className="memory-notice">
        <LockKeyhole size={16} strokeWidth={2} aria-hidden="true" />
        <span>
          <Trans i18nKey="memory.settings.privacy" components={{ strong: <strong /> }} />
        </span>
      </div>
    </SettingsPanel>
  );
}
