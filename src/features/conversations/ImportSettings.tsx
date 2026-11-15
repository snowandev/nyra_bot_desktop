import { SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ClaudeCodeImport } from "./ClaudeCodeImport";
import { SettingsOption } from "@/shared/ui/SettingsOption";

type Props = {
  onImported: (conversationIds: string[]) => void;
};

export function ImportSettings({ onImported }: Props) {
  const { t } = useTranslation();
  return (
    <div className="settings-content">
      <section aria-label={t("conversations.import.sources")} className="settings-list">
        <div className="section-label">{t("conversations.import.from")}</div>
        <SettingsOption
          icon={<SquareTerminal size={18} strokeWidth={1.8} />}
          name="Claude Code"
          status={<span className="settings-option-status">{t("conversations.import.thisComputerSessions")}</span>}
          selected
          onSelect={() => {}}
        />
      </section>

      <ClaudeCodeImport onImported={onImported} />
    </div>
  );
}
