import { Bell, CircleArrowUp, Database, ImageDown, MessageSquareText, Palette, Sparkle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePreferencesContext } from "./preferencesContext";
import { AppearanceSettings } from "./AppearanceSettings";
import { DataSettings } from "./DataSettings";
import { NotificationSettings } from "./NotificationSettings";
import { SettingsOption } from "@/shared/ui/SettingsOption";
import { BrandIcon } from "@/shared/ui/BrandIcon";
import { UpdateSettings } from "@/features/updates/UpdateSettings";
import { NyraFeaturesSettings } from "./NyraFeaturesSettings";
import { FEATURE_PREFERENCES } from "./nyraFeatures";
import { ShareImageSettings } from "./ShareImageSettings";
import { QuickChatSettings } from "./QuickChatSettings";
import { acceleratorLabel } from "@/features/quick-bar/quickShortcut";
import { platformName } from "@/shared/lib/platform";

export type GeneralOption =
  | "appearance"
  | "notifications"
  | "quickChat"
  | "features"
  | "shareImages"
  | "updates"
  | "data";

type Props = {
  initialOption?: GeneralOption;
  conversationCount: number;
  onDeleteAllConversations: () => Promise<void>;
  // Opens Personalización → Memoria
  onShowMemories: () => void;
  // Settings → Proveedores de audio, from «Transcribir audio»
  onShowAudio: () => void;
  // The first-day steps again; nothing set up is lost
  onShowWelcome: () => void;
};

export function GeneralSettings(props: Props) {
  const { initialOption = "appearance", conversationCount, onDeleteAllConversations, onShowMemories } = props;
  const { onShowAudio, onShowWelcome } = props;
  const { preferences, updatePreferences: onChange } = usePreferencesContext();
  const { t } = useTranslation();
  const [selected, setSelected] = useState<GeneralOption>(initialOption);
  const notificationsOn = preferences.notifyOnReply || preferences.notifyOnAttention;
  const features = Object.values(FEATURE_PREFERENCES).map((key) => preferences[key]);
  const featuresOn = features.filter(Boolean).length;

  return (
    <div className="settings-content">
      <section aria-label={t("settings.general.label")} className="settings-list">
        <div className="section-label">{t("common.options")}</div>
        <SettingsOption
          icon={<Palette size={18} strokeWidth={1.8} />}
          name={t("settings.general.appearance")}
          status={<span className="settings-option-status">{t(`settings.appearance.themes.${preferences.theme}`)}</span>}
          selected={selected === "appearance"}
          onSelect={() => setSelected("appearance")}
        />
        <SettingsOption
          icon={<Bell size={18} strokeWidth={1.8} />}
          name={t("settings.general.notifications")}
          status={
            <span className="settings-option-status">
              <span className={`status-dot ${notificationsOn ? "loaded" : "idle"}`} />
              {notificationsOn ? t("common.on") : t("common.off")}
            </span>
          }
          selected={selected === "notifications"}
          onSelect={() => setSelected("notifications")}
        />
        <SettingsOption
          icon={<MessageSquareText size={18} strokeWidth={1.8} />}
          name={t("settings.general.quickChat")}
          status={
            <span className="settings-option-status">
              {preferences.quickShortcutEnabled
                ? acceleratorLabel(preferences.quickShortcut, platformName)
                : t("settings.general.noShortcut")}
            </span>
          }
          selected={selected === "quickChat"}
          onSelect={() => setSelected("quickChat")}
        />
        <SettingsOption
          icon={<BrandIcon size={18} />}
          name={t("settings.general.features")}
          status={
            <span className="settings-option-status">
              <span className={`status-dot ${featuresOn > 0 ? "loaded" : "idle"}`} />
              {featuresOn === 0 ? t("common.off") : t("settings.general.featuresOn", { on: featuresOn, total: features.length })}
            </span>
          }
          selected={selected === "features"}
          onSelect={() => setSelected("features")}
        />
        <SettingsOption
          icon={<ImageDown size={18} strokeWidth={1.8} />}
          name={t("settings.shareImages.title")}
          status={
            <span className="settings-option-status">
              {t(`settings.shareImages.qualities.${preferences.shareImageQuality}`)}
            </span>
          }
          selected={selected === "shareImages"}
          onSelect={() => setSelected("shareImages")}
        />
        <SettingsOption
          icon={<Database size={18} strokeWidth={1.8} />}
          name={t("settings.general.data")}
          status={
            <span className="settings-option-status">{t("common.conversations", { count: conversationCount })}</span>
          }
          selected={selected === "data"}
          onSelect={() => setSelected("data")}
        />
        <SettingsOption
          icon={<Sparkle size={18} strokeWidth={1.8} />}
          name={t("welcome.settings.title")}
          status={<span className="settings-option-status">{t("welcome.settings.again")}</span>}
          selected={false}
          onSelect={onShowWelcome}
        />
        <SettingsOption
          icon={<CircleArrowUp size={18} strokeWidth={1.8} />}
          name={t("updates.settings.title")}
          status={
            <span className="settings-option-status">
              {preferences.checkUpdates ? t("updates.settings.statusOn") : t("updates.settings.statusOff")}
            </span>
          }
          selected={selected === "updates"}
          onSelect={() => setSelected("updates")}
        />
      </section>

      {selected === "appearance" && (
        <AppearanceSettings
          theme={preferences.theme}
          onThemeChange={(theme) => onChange({ theme })}
          accent={preferences.accentColor}
          onAccentChange={(accentColor) => onChange({ accentColor })}
          fontScale={preferences.fontScale}
          onFontScaleChange={(fontScale) => onChange({ fontScale })}
          language={preferences.language}
          onLanguageChange={(language) => onChange({ language })}
        />
      )}
      {selected === "notifications" && (
        <NotificationSettings
          keepInTray={preferences.keepInTray}
          onKeepInTrayChange={(keepInTray) => onChange({ keepInTray })}
          onReply={preferences.notifyOnReply}
          onReplyChange={(notifyOnReply) => onChange({ notifyOnReply })}
          onAttention={preferences.notifyOnAttention}
          onAttentionChange={(notifyOnAttention) => onChange({ notifyOnAttention })}
        />
      )}
      {selected === "quickChat" && (
        <QuickChatSettings
          quickEnabled={preferences.quickShortcutEnabled}
          onQuickEnabledChange={(quickShortcutEnabled) => onChange({ quickShortcutEnabled })}
          quickShortcut={preferences.quickShortcut}
          quickSize={preferences.quickSize}
          onQuickSizeChange={(quickSize) => onChange({ quickSize })}
          onQuickShortcutChange={(quickShortcut) => onChange({ quickShortcut })}
        />
      )}
      {selected === "features" && (
        <NyraFeaturesSettings
          webSearch={preferences.webSearch}
          onWebSearchChange={(webSearch) => onChange({ webSearch })}
          readLinks={preferences.readLinks}
          onReadLinksChange={(readLinks) => onChange({ readLinks })}
          compatibleGuides={preferences.compatibleGuides}
          onCompatibleGuidesChange={(compatibleGuides) => onChange({ compatibleGuides })}
          memory={preferences.memory}
          onMemoryChange={(memory) => onChange({ memory })}
          onShowMemories={onShowMemories}
          smartTitles={preferences.smartTitles}
          onSmartTitlesChange={(smartTitles) => onChange({ smartTitles })}
          sensitiveDataWarning={preferences.sensitiveDataWarning}
          onSensitiveDataWarningChange={(sensitiveDataWarning) => onChange({ sensitiveDataWarning })}
          semanticSearch={preferences.semanticSearch}
          onSemanticSearchChange={(semanticSearch) => onChange({ semanticSearch })}
          runCommands={preferences.runCommands}
          onRunCommandsChange={(runCommands) => onChange({ runCommands })}
          runCode={preferences.runCode}
          onRunCodeChange={(runCode) => onChange({ runCode })}
          browser={preferences.browser}
          onBrowserChange={(browser) => onChange({ browser })}
          screenLook={preferences.screenLook}
          onScreenLookChange={(screenLook) => onChange({ screenLook })}
          transcription={preferences.transcription}
          onTranscriptionChange={(transcription) => onChange({ transcription })}
          onShowAudio={onShowAudio}
        />
      )}
      {selected === "shareImages" && (
        <ShareImageSettings
          quality={preferences.shareImageQuality}
          onChange={(shareImageQuality) => onChange({ shareImageQuality })}
        />
      )}
      {selected === "updates" && (
        <UpdateSettings
          checkOnOpen={preferences.checkUpdates}
          onCheckOnOpenChange={(checkUpdates) => onChange({ checkUpdates })}
        />
      )}
      {selected === "data" && (
        <DataSettings conversationCount={conversationCount} onDeleteAll={onDeleteAllConversations} />
      )}
    </div>
  );
}
