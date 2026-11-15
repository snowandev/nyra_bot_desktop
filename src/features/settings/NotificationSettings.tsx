import { useState } from "react";
import { trayLabel, trayMayBeHidden } from "@/shared/lib/platform";
import { useTranslation } from "react-i18next";
import { ensureNotificationPermission } from "@/shared/lib/notifications";
import { SettingsPanel } from "@/shared/ui/SettingsPanel";
import { Switch } from "@/shared/ui/Switch";

type Props = {
  // Closing the window leaves Nyra in the system bar, so a reply goes on and its notice still arrives
  keepInTray: boolean;
  onKeepInTrayChange: (keep: boolean) => void;
  onReply: boolean;
  onReplyChange: (enabled: boolean) => void;
  // When a command waits for the user's approval or answer
  onAttention: boolean;
  onAttentionChange: (enabled: boolean) => void;
};

export function NotificationSettings(props: Props) {
  const { keepInTray, onKeepInTrayChange, onReply, onReplyChange, onAttention, onAttentionChange } = props;
  const { t } = useTranslation();
  const [isRequesting, setIsRequesting] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  // Turning one on asks the system for permission first; turning it off never does
  async function toggle(next: boolean, change: (enabled: boolean) => void) {
    setPermissionDenied(false);
    if (!next) return change(false);

    setIsRequesting(true);
    const granted = await ensureNotificationPermission().catch(() => false);
    setIsRequesting(false);
    if (granted) change(true);
    else setPermissionDenied(true);
  }

  return (
    <SettingsPanel title={t("settings.general.notifications")} description={t("settings.notifications.description")}>
      <div className="setting-row">
        <div className="setting-row-text">
          <span className="setting-row-title">{t("settings.notifications.keepInTray")}</span>
          <span className="setting-row-description">
            {t("settings.notifications.keepInTrayHint", { tray: trayLabel() })}
            {trayMayBeHidden && ` ${t("settings.notifications.trayMayBeHidden")}`}
          </span>
        </div>
        <Switch
          checked={keepInTray}
          onChange={onKeepInTrayChange}
          label={t("settings.notifications.keepInTrayLabel")}
        />
      </div>
      <div className="setting-row">
        <div className="setting-row-text">
          <span className="setting-row-title">{t("settings.notifications.replyDone")}</span>
          <span className="setting-row-description">{t("settings.notifications.replyDoneHint")}</span>
        </div>
        <Switch
          checked={onReply}
          onChange={(next) => void toggle(next, onReplyChange)}
          label={t("settings.notifications.switchLabel")}
          disabled={isRequesting}
        />
      </div>
      <div className="setting-row">
        <div className="setting-row-text">
          <span className="setting-row-title">{t("settings.notifications.needsYou")}</span>
          <span className="setting-row-description">{t("settings.notifications.needsYouHint")}</span>
        </div>
        <Switch
          checked={onAttention}
          onChange={(next) => void toggle(next, onAttentionChange)}
          label={t("settings.notifications.needsYouLabel")}
          disabled={isRequesting}
        />
      </div>
      {permissionDenied && <span className="setting-row-error">{t("settings.notifications.denied")}</span>}
    </SettingsPanel>
  );
}
