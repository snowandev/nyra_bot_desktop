import { AtSign, ChevronRight, FolderOpen, Paperclip, Plus, Search, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePopover } from "@/shared/hooks/usePopover";
import { SHORTCUTS, shortcutLabelOf } from "@/shared/lib/shortcuts";
import type { WorkspaceFolder } from "@/shared/types";
import { joinedList } from "./listFormat";

type Props = {
  onAttachFile: () => void;
  // Missing where skills aren't used (an isolated conversation)
  onUseSkill?: () => void;
  // Only inside a conversation; the welcome screen has nothing to search yet
  onSearch?: () => void;
  placement: "up" | "down";
  // Marked in this conversation; the menu says how many and which, since the bar no longer shows them
  activeSkillNames: string[];
  workspace?: {
    folder: WorkspaceFolder | null;
    // Once its index is read
    fileCount?: number;
    // Missing for a project's folder, which can't be changed nor disconnected
    onPick?: () => void;
    onDisconnect?: () => void;
  };
  // With a folder whose files are read: writes "@" to pick one of them
  onMentionFile?: () => void;
};

export function ComposerMenu(props: Props) {
  const { onAttachFile, onUseSkill, onSearch, placement, activeSkillNames, workspace } = props;
  const { onMentionFile } = props;
  const { isOpen, rootRef, close, toggle } = usePopover();
  const { t } = useTranslation();
  const count = activeSkillNames.length;

  return (
    <div className="composer-menu" ref={rootRef}>
      <button
        type="button"
        className={`icon-button soft composer-menu-trigger ${isOpen ? "open" : ""}`}
        aria-label={t("chat.menu.more")}
        title={t("chat.menu.more")}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={toggle}
      >
        <Plus size={20} strokeWidth={2} />
      </button>

      {isOpen && (
        <div role="menu" aria-label={t("chat.menu.label")} className={`composer-menu-list ${placement}`}>
          <button
            type="button"
            role="menuitem"
            className="menu-option"
            onClick={() => {
              close();
              onAttachFile();
            }}
          >
            <Paperclip size={16} strokeWidth={1.8} />
            <span className="menu-option-text">
              {t("chat.menu.attach")}
              <span className="menu-option-hint">{t("chat.menu.attachHint")}</span>
            </span>
          </button>
          {/* A project's folder can't be changed and is in its sidebar already, so it isn't repeated here */}
          {workspace?.onPick &&
            (workspace.folder ? (
              <>
                <div className="menu-workspace" role="group" aria-label={t("chat.menu.folder", { name: workspace.folder.name })}>
                  <FolderOpen size={16} strokeWidth={1.8} aria-hidden="true" />
                  <span className="menu-option-text">
                    {workspace.folder.name}
                    <span className="menu-workspace-path" title={workspace.folder.path}>
                      {workspace.folder.path}
                    </span>
                    <span className="menu-option-hint">
                      {workspace.fileCount === undefined
                        ? t("chat.menu.readOnly")
                        : t("chat.menu.files", { count: workspace.fileCount })}
                    </span>
                  </span>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-option sub"
                  onClick={() => {
                    close();
                    workspace.onPick?.();
                  }}
                >
                  <span className="menu-option-text">{t("chat.menu.changeFolder")}</span>
                  <kbd className="menu-option-shortcut">{shortcutLabelOf(SHORTCUTS.workspace)}</kbd>
                </button>
                {workspace.onDisconnect && (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-option sub danger"
                    onClick={() => {
                      close();
                      workspace.onDisconnect?.();
                    }}
                  >
                    <span className="menu-option-text">{t("chat.menu.disconnect")}</span>
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                role="menuitem"
                className="menu-option workspace"
                onClick={() => {
                  close();
                  workspace.onPick?.();
                }}
              >
                <FolderOpen size={16} strokeWidth={1.8} />
                <span className="menu-option-text">
                  {t("chat.menu.workWithFolder")}
                  <span className="menu-option-hint">{t("chat.menu.workWithFolderHint")}</span>
                </span>
                <kbd className="menu-option-shortcut">{shortcutLabelOf(SHORTCUTS.workspace)}</kbd>
              </button>
            ))}
          {onMentionFile && (
            <button
              type="button"
              role="menuitem"
              className="menu-option"
              onClick={() => {
                close();
                onMentionFile();
              }}
            >
              <AtSign size={16} strokeWidth={1.8} />
              <span className="menu-option-text">
                {t("chat.menu.mention")}
                <span className="menu-option-hint">{t("chat.menu.mentionHint")}</span>
              </span>
              <kbd className="menu-option-shortcut">@</kbd>
            </button>
          )}
          {onUseSkill && (
            <button
              type="button"
              role="menuitem"
              className="menu-option use-skill"
              aria-haspopup="dialog"
              aria-label={
                count > 0
                  ? t("chat.menu.useSkillLabel", {
                      active: t("chat.menu.activeSkills", { count }),
                      names: joinedList(activeSkillNames),
                    })
                  : undefined
              }
              onClick={() => {
                close();
                onUseSkill();
              }}
            >
              <Sparkles size={16} strokeWidth={1.8} />
              <span className="menu-option-text">
                <span>
                  {t("chat.menu.useSkill")}
                  {count > 0 && <span className="menu-option-count"> · {t("chat.menu.activeCount", { count })}</span>}
                </span>
                <span className="menu-option-hint">{t("chat.menu.useSkillHint")}</span>
              </span>
              <ChevronRight size={15} strokeWidth={1.8} className="menu-option-trailing" />
              {/* To the side, so it doesn't cover the other options; its text is already in the label */}
              {count > 0 && (
                <span className="active-skills-tip" aria-hidden="true">
                  {t("chat.menu.activeTip")}
                  <span className="active-skills-names">
                    {activeSkillNames.map((name) => (
                      <span key={name} className="mono">
                        <Sparkles size={12} strokeWidth={2} />
                        {name}
                      </span>
                    ))}
                  </span>
                  <small>{t("chat.menu.activeTipNote")}</small>
                </span>
              )}
            </button>
          )}
          {onSearch && (
            <button
              type="button"
              role="menuitem"
              className="menu-option"
              onClick={() => {
                close();
                onSearch();
              }}
            >
              <Search size={16} strokeWidth={1.8} />
              <span className="menu-option-text">
                {t("chat.search.label")}
                <span className="menu-option-hint">{t("chat.search.hint")}</span>
              </span>
              <kbd className="menu-option-shortcut">{shortcutLabelOf(SHORTCUTS.searchConversation)}</kbd>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
