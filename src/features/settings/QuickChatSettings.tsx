import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { platformName, trayLabel } from "@/shared/lib/platform";
import { acceleratorLabel } from "@/features/quick-bar/quickShortcut";
import { onQuickShortcutStatus, quickShortcutStatus, type ShortcutStatus } from "@/features/quick-bar/quickWindow";
import { CopyButton } from "@/shared/ui/CopyButton";
import { SettingsPanel } from "@/shared/ui/SettingsPanel";
import { ShortcutRecorder } from "@/features/quick-bar/ShortcutRecorder";
import { Switch } from "@/shared/ui/Switch";
import { QUICK_SIZES, type QuickSize } from "@/shared/storage/settings";

type Props = {
  quickEnabled: boolean;
  onQuickEnabledChange: (enabled: boolean) => void;
  quickShortcut: string;
  onQuickShortcutChange: (shortcut: string) => void;
  quickSize: QuickSize;
  onQuickSizeChange: (size: QuickSize) => void;
};

// The quick chat bar: opening it with a shortcut, which one, and how big it grows
export function QuickChatSettings(props: Props) {
  const { quickEnabled, onQuickEnabledChange, quickShortcut } = props;
  const { onQuickShortcutChange, quickSize, onQuickSizeChange } = props;
  const sizeTitleId = useId();
  const { t } = useTranslation();
  // Whether the shortcut works, as Rust registered it; it changes after every choice
  const [status, setStatus] = useState<ShortcutStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Without Rust (tests) there is no status to show, and the row works without it
    quickShortcutStatus()
      .then((current) => !cancelled && setStatus(current))
      .catch(() => {});
    const stop = onQuickShortcutStatus(setStatus);
    return () => {
      cancelled = true;
      // If listening never started, there is nothing to stop
      void stop.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  const label = acceleratorLabel(quickShortcut, platformName);

  return (
    <SettingsPanel title={t("settings.general.quickChat")} description={t("settings.quickChat.description")}>
      <div className="setting-row">
        <div className="setting-row-text">
          <span className="setting-row-title">{t("settings.quickChat.quickBar")}</span>
          <span className="setting-row-description">{t("settings.quickChat.quickBarHint")}</span>
        </div>
        <Switch checked={quickEnabled} onChange={onQuickEnabledChange} label={t("settings.quickChat.quickBarLabel")} />
      </div>

      {quickEnabled && (
        <div className="setting-row">
          <div className="setting-row-text">
            <span className="setting-row-title">{t("settings.quickChat.shortcut")}</span>
            {status?.wayland ? (
              <span className="setting-row-description">
                {t("settings.quickChat.wayland", { shortcut: label })}
                <span className="shortcut-command">
                  <code>{status.command}</code>
                  <CopyButton text={status.command} label={t("settings.quickChat.copyCommand")} />
                </span>
              </span>
            ) : (
              <span className="setting-row-description">{t("settings.quickChat.worksHidden", { tray: trayLabel() })}</span>
            )}
            {status?.error && <span className="setting-row-error">{status.error}</span>}
          </div>
          {!status?.wayland && <ShortcutRecorder shortcut={quickShortcut} onChange={onQuickShortcutChange} />}
        </div>
      )}

      {/* Also with the shortcut off: the bar still opens from the icon's menu */}
      <div className="setting-row">
        <div className="setting-row-text">
          <span className="setting-row-title" id={sizeTitleId}>
            {t("settings.quickChat.quickSize")}
          </span>
          <span className="setting-row-description">{t("settings.quickChat.quickSizeHint")}</span>
        </div>
        <div className="segmented" role="group" aria-labelledby={sizeTitleId}>
          {QUICK_SIZES.map((size) => (
            <button key={size} type="button" aria-pressed={quickSize === size} onClick={() => onQuickSizeChange(size)}>
              {t(`settings.quickChat.quickSizes.${size}`)}
            </button>
          ))}
        </div>
      </div>
    </SettingsPanel>
  );
}
