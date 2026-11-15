import { CodeXml, MessagesSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SHORTCUTS, shortcutLabelOf } from "@/shared/lib/shortcuts";
import type { Space } from "@/shared/storage/settings";

type Props = {
  space: Space;
  onChange: (space: Space) => void;
  // The spaces with unsent text somewhere; only the other space is marked
  withDrafts: Record<Space, boolean>;
  // Icons only, one above the other, for the folded sidebar
  vertical?: boolean;
};

// Their names are in the catalog, under projects.space.<space>
const SPACES = [
  { space: "chat", icon: MessagesSquare, shortcut: SHORTCUTS.chatSpace },
  { space: "code", icon: CodeXml, shortcut: SHORTCUTS.codeSpace },
] as const;

// Chat and Código are two places of the same app: each keeps its sidebar, its open conversation and its drafts
export function SpaceSwitch({ space, onChange, withDrafts, vertical = false }: Props) {
  const { t } = useTranslation();
  return (
    <div className={`space-switch ${vertical ? "vertical" : ""}`} role="group" aria-label={t("projects.space.label")}>
      {SPACES.map(({ space: value, icon: Icon, shortcut }) => {
        const hasDraft = value !== space && withDrafts[value];
        const label = t(`projects.space.${value}`);
        const named = { space: label, shortcut: shortcutLabelOf(shortcut) };
        return (
          <button
            key={value}
            type="button"
            aria-pressed={space === value}
            aria-label={vertical ? (hasDraft ? t("projects.space.labelWithDraft", named) : label) : undefined}
            title={t(hasDraft ? "projects.space.titleWithDraft" : "projects.space.title", named)}
            onClick={() => onChange(value)}
          >
            <Icon size={vertical ? 16 : 15} strokeWidth={2} aria-hidden="true" />
            {!vertical && label}
            {hasDraft && <span className="space-switch-draft" aria-hidden="true" />}
            {/* With its words shown, the button is named by them; the folded one by its aria-label */}
            {hasDraft && !vertical && <span className="visually-hidden">{t("projects.space.draft")}</span>}
          </button>
        );
      })}
    </div>
  );
}
