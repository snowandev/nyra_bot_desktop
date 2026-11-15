import { getVersion } from "@tauri-apps/api/app";
import {
  AudioLines,
  Blocks,
  ChevronLeft,
  Command,
  Import,
  type LucideIcon,
  Plug,
  SlidersHorizontal,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CommandsSettings } from "./CommandsSettings";
import { type GeneralOption, GeneralSettings } from "./GeneralSettings";
import { ImportSettings } from "@/features/conversations/ImportSettings";
import { type PersonalizationOption, PersonalizationSettings } from "./PersonalizationSettings";
import { ProvidersSettings } from "./ProvidersSettings";
import { SkillsSettings } from "@/features/skills/SkillsSettings";
import { AudioProvidersSettings } from "@/features/transcription/AudioProvidersSettings";
import { McpSettings } from "@/features/mcp/McpSettings";

export type SettingsSection =
  | "general"
  | "personalization"
  | "providers"
  | "audio"
  | "mcp"
  | "skills"
  | "commands"
  | "import";

// Their names and descriptions are in the catalog, under settings.sections.<id>
const SECTIONS: { id: SettingsSection; icon: LucideIcon }[] = [
  { id: "general", icon: SlidersHorizontal },
  { id: "personalization", icon: UserRound },
  { id: "providers", icon: Plug },
  { id: "audio", icon: AudioLines },
  { id: "mcp", icon: Blocks },
  { id: "skills", icon: Sparkles },
  { id: "commands", icon: Command },
  { id: "import", icon: Import },
];

// Preferences and provider settings come from context; these are the actions that belong to the chat
type Props = {
  initialSection: SettingsSection;
  // A panel inside General to open directly, e.g. "features" from the sensitive data notice
  initialGeneralOption?: GeneralOption;
  // A panel inside Personalización to open directly, e.g. "memory" from a memory saved in the chat
  initialPersonalizationOption?: PersonalizationOption;
  // A skill to show first in Skills
  initialSkill?: string;
  onBack: () => void;
  onConversationsImported: (conversationIds: string[]) => void;
  conversationCount: number;
  onDeleteAllConversations: () => Promise<void>;
  conversationTitle: (id: string) => string | undefined;
  onOpenConversation: (id: string) => void;
  onShowWelcome: () => void;
};

export function SettingsView(props: Props) {
  const { initialSection, initialGeneralOption, initialPersonalizationOption, initialSkill, onBack } = props;
  const { onConversationsImported, conversationCount, onDeleteAllConversations } = props;
  const { conversationTitle, onOpenConversation, onShowWelcome } = props;
  const { t } = useTranslation();
  const [section, setSection] = useState(initialSection);
  const [generalOption, setGeneralOption] = useState(initialGeneralOption);
  const [personalizationOption, setPersonalizationOption] = useState(initialPersonalizationOption);
  const [version, setVersion] = useState("");
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  return (
    <div className="app">
      <aside className="sidebar settings-sidebar">
        <button type="button" className="ghost-button" onClick={onBack}>
          <ChevronLeft size={18} strokeWidth={2} />
          {t("settings.back")}
        </button>

        <div className="settings-title">
          <h1>{t("settings.title")}</h1>
          <div className="ornament">
            <span className="line" />
            <span className="diamond" />
            <span className="line" />
          </div>
        </div>

        <nav aria-label={t("settings.sectionsLabel")} className="conversation-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`conversation-item ${s.id === section ? "active" : ""}`}
              aria-current={s.id === section ? "page" : undefined}
              onClick={() => {
                setSection(s.id);
                setGeneralOption(undefined);
                setPersonalizationOption(undefined);
              }}
            >
              <span className="conversation-marker" />
              <s.icon size={18} strokeWidth={1.8} />
              {t(`settings.sections.${s.id}.label`)}
            </button>
          ))}
        </nav>

        <p className="settings-version">Nyra Bot{version && ` · v${version}`}</p>
      </aside>

      <main className="main settings-main">
        <header className="settings-header">
          <h2>{t(`settings.sections.${current.id}.label`)}</h2>
          <p>{t(`settings.sections.${current.id}.description`)}</p>
        </header>

        {section === "general" && (
          <GeneralSettings
            initialOption={generalOption}
            conversationCount={conversationCount}
            onDeleteAllConversations={onDeleteAllConversations}
            onShowMemories={() => {
              setPersonalizationOption("memory");
              setSection("personalization");
            }}
            onShowAudio={() => setSection("audio")}
            onShowWelcome={onShowWelcome}
          />
        )}
        {section === "personalization" && (
          <PersonalizationSettings
            initialOption={personalizationOption}
            conversationTitle={conversationTitle}
            onOpenConversation={onOpenConversation}
            onShowFeatures={() => {
              setGeneralOption("features");
              setSection("general");
            }}
          />
        )}
        {section === "providers" && <ProvidersSettings />}
        {section === "audio" && <AudioProvidersSettings />}
        {section === "mcp" && <McpSettings />}
        {section === "skills" && <SkillsSettings initialSkill={initialSkill} />}
        {section === "commands" && <CommandsSettings />}
        {section === "import" && <ImportSettings onImported={onConversationsImported} />}
      </main>
    </div>
  );
}
