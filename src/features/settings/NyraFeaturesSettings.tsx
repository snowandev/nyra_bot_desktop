import { ArrowRight, Brain } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SettingsPanel } from "@/shared/ui/SettingsPanel";
import { Switch } from "@/shared/ui/Switch";
import type { FeatureId } from "./nyraFeatures";

type Props = {
  webSearch: boolean;
  onWebSearchChange: (enabled: boolean) => void;
  readLinks: boolean;
  onReadLinksChange: (enabled: boolean) => void;
  compatibleGuides: boolean;
  onCompatibleGuidesChange: (enabled: boolean) => void;
  memory: boolean;
  onMemoryChange: (enabled: boolean) => void;
  onShowMemories: () => void;
  smartTitles: boolean;
  onSmartTitlesChange: (enabled: boolean) => void;
  sensitiveDataWarning: boolean;
  onSensitiveDataWarningChange: (enabled: boolean) => void;
  semanticSearch: boolean;
  onSemanticSearchChange: (enabled: boolean) => void;
  runCommands: boolean;
  onRunCommandsChange: (enabled: boolean) => void;
  runCode: boolean;
  onRunCodeChange: (enabled: boolean) => void;
  browser: boolean;
  onBrowserChange: (enabled: boolean) => void;
  screenLook: boolean;
  onScreenLookChange: (enabled: boolean) => void;
  transcription: boolean;
  onTranscriptionChange: (enabled: boolean) => void;
  // Its model and options are in Proveedores de audio
  onShowAudio: () => void;
};

// Those that call the chosen model to do their job
const MODEL_USERS = new Set<FeatureId>([
  "webSearch",
  "memory",
  "runCommands",
  "runCode",
  "browser",
  "screenLook",
  "smartTitles",
]);
// Of those, the ones with a line on what they ask of the model besides the badge
type WithNote = "memory";
const WITH_NOTE = new Set<FeatureId>(["memory"]);

type Feature = {
  title: string;
  description: string;
  // Features that call the chosen model to do their job, and, when it says more, what they ask of it
  usesModel: boolean;
  modelUse?: string;
  // A line under the description, e.g. the state of the feature and a link to manage it
  extra?: ReactNode;
  checked: boolean;
  onChange: (enabled: boolean) => void;
};

export function NyraFeaturesSettings(props: Props) {
  const { t } = useTranslation();
  // Title, description and, for those that call the model and have one, what they ask of it: all in the catalog
  const feature = (id: FeatureId, checked: boolean, onChange: (enabled: boolean) => void, extra?: ReactNode) => {
    const key = `settings.features.${id}` as const;
    const usesModel = MODEL_USERS.has(id);
    const modelUse = WITH_NOTE.has(id) ? t(`settings.features.${id as WithNote}.modelUse`) : undefined;
    return { title: t(`${key}.title`), description: t(`${key}.description`), usesModel, modelUse, extra, checked, onChange };
  };
  const features: Feature[] = [
    feature("webSearch", props.webSearch, props.onWebSearchChange),
    feature("readLinks", props.readLinks, props.onReadLinksChange),
    feature(
      "memory",
      props.memory,
      props.onMemoryChange,
      <button type="button" className="feature-settings-link" onClick={props.onShowMemories}>
        {t("memory.status.show")}
        <ArrowRight size={13} strokeWidth={2.2} aria-hidden="true" />
      </button>,
    ),
    feature("semanticSearch", props.semanticSearch, props.onSemanticSearchChange),
    feature("compatibleGuides", props.compatibleGuides, props.onCompatibleGuidesChange),
    feature("runCommands", props.runCommands, props.onRunCommandsChange),
    feature("runCode", props.runCode, props.onRunCodeChange),
    feature("browser", props.browser, props.onBrowserChange),
    feature("screenLook", props.screenLook, props.onScreenLookChange),
    feature(
      "transcription",
      props.transcription,
      props.onTranscriptionChange,
      props.transcription && (
        <button type="button" className="feature-settings-link" onClick={props.onShowAudio}>
          {t("transcription.providers.configure")}
          <ArrowRight size={13} strokeWidth={2.2} aria-hidden="true" />
        </button>
      ),
    ),
    feature("smartTitles", props.smartTitles, props.onSmartTitlesChange),
    feature("sensitiveData", props.sensitiveDataWarning, props.onSensitiveDataWarningChange),
  ];

  return (
    <SettingsPanel title={t("settings.features.title")} description={t("settings.features.description")}>
      {features.map((f) => (
        <div key={f.title} className="setting-row">
          <div className="setting-row-text">
            <span className="setting-row-title">
              {f.title}
              {f.usesModel && (
                <span className="uses-model">
                  <Brain size={12} strokeWidth={2.2} aria-hidden="true" />
                  {t("settings.features.usesModel")}
                </span>
              )}
            </span>
            <span className="setting-row-description">{f.description}</span>
            {f.modelUse && <span className="setting-row-model-use">{f.modelUse}</span>}
            {f.extra}
          </div>
          <Switch checked={f.checked} onChange={f.onChange} label={f.title} />
        </div>
      ))}
    </SettingsPanel>
  );
}
