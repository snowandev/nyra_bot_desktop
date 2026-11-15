import { AlignLeft, CircleHelp, ListChecks, Lock, type LucideIcon, PenLine, ShieldCheck } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDraft } from "@/shared/hooks/useDraft";
import type { SendOptions } from "@/features/chat/reply/useChat";
import { initRequestOf, messageForNew } from "@/features/chat/reply/commands";
import { SHORTCUTS, shortcutLabelOf } from "@/shared/lib/shortcuts";
import type { Attachment, Model, WorkspaceFolder } from "@/shared/types";
import { BrandIcon } from "@/shared/ui/BrandIcon";
import { Composer } from "./Composer";
import { useNewConversationSkills } from "./useNewConversationSkills";
import { Disclaimer } from "@/shared/ui/Disclaimer";

type Suggestion = {
  icon: LucideIcon;
  color: string;
  // The skill that comes with Nyra for this task; the card only activates it. Its title and description are in the
  // catalog, under chat.welcome.suggestions.<skill>
  skill: "writing" | "summarize" | "explain" | "plan";
};

// The next conversation: normal; private (not saved, nothing about the user); or isolated (private, and only the model
// and the files)
export type NewPrivacy = "normal" | "private" | "isolated";

const SUGGESTIONS: Suggestion[] = [
  { icon: PenLine, color: "var(--accent)", skill: "writing" },
  { icon: AlignLeft, color: "var(--accent-secondary)", skill: "summarize" },
  { icon: CircleHelp, color: "var(--info)", skill: "explain" },
  { icon: ListChecks, color: "var(--highlight)", skill: "plan" },
];

type Props = {
  models: Model[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  onSend: (text: string, attachments: Attachment[], references: string[], options: SendOptions) => void;
  onOpenSettings: () => void;
  onManageSkills: () => void;
  onOpenFeatureSettings: () => void;
  // Controlled, because a keyboard shortcut can start a private conversation from anywhere
  privacy: NewPrivacy;
  onPrivacyChange: (privacy: NewPrivacy) => void;
  // Off while Settings cover the screen
  shortcutsEnabled: boolean;
  // Nyra is answering or summarizing elsewhere: a new message waits until it ends
  isBusy: boolean;
  // A notice above the composer, like the one when there are no models yet
  aboveComposer?: ReactNode;
};

export function WelcomeView(props: Props) {
  const { models, selectedModelId, onSelectModel, onSend, onOpenSettings, onManageSkills } = props;
  const { onOpenFeatureSettings } = props;
  const { privacy, onPrivacyChange, shortcutsEnabled, isBusy, aboveComposer } = props;
  const isPrivate = privacy !== "normal";
  const isIsolated = privacy === "isolated";
  const { t } = useTranslation();
  // Chosen before the first message, for the new conversation
  const [workspace, setWorkspace] = useState<WorkspaceFolder | null>(null);
  const [draft, setDraft] = useDraft("welcome");
  const { skills, skillNames, setChosenSkills, isSkillPickerOpen, setIsSkillPickerOpen, invokedSkill } =
    useNewConversationSkills();
  const mainRef = useRef<HTMLElement>(null);

  // A card whose skill the user deleted would do nothing, so it isn't shown; an isolated conversation uses none
  const suggestions = isIsolated ? [] : SUGGESTIONS.filter((s) => skills.some((skill) => skill.name === s.skill));
  const heading = isIsolated ? "chat.isolated" : isPrivate ? "chat.private" : null;
  // An isolated conversation has no folder, whatever was chosen before
  const canWriteGuide = !!workspace && !isIsolated;

  // The new conversation with this message; writesGuide: sent with /init
  function start(text: string, attachments: Attachment[], writesGuide: boolean) {
    onSend(text, attachments, [], {
      isPrivate,
      isIsolated,
      skills: skillNames,
      skill: invokedSkill.skill ?? undefined,
      workspace: workspace ?? undefined,
      // Even if a conversation is still active behind this screen, the message never goes into it
      newConversation: true,
      ...(writesGuide && { writesGuide }),
    });
    invokedSkill.clear();
    setDraft("");
  }

  return (
    <main className="main" ref={mainRef}>
      <div className="welcome-screen">
        <div className="welcome-column">
          <div className="emblem" aria-hidden="true">
            <BrandIcon size={64} gradient />
          </div>

          <div className="welcome-heading">
            <h1>{heading ? t(`${heading}.title`) : t("chat.welcome.hello")}</h1>
            <p>{heading ? t(`${heading}.description`) : t("chat.welcome.question")}</p>
          </div>

          {/* One or the other: pressing the one that is on goes back to a normal conversation */}
          <div className="privacy-toggles" role="group" aria-label={t("chat.privacyChoice")}>
            <button
              type="button"
              className={`private-toggle ${privacy === "private" ? "on" : ""}`}
              aria-pressed={privacy === "private"}
              title={t("chat.welcome.privateToggleTitle", {
                shortcut: shortcutLabelOf(SHORTCUTS.newPrivateConversation),
              })}
              onClick={() => onPrivacyChange(privacy === "private" ? "normal" : "private")}
            >
              <Lock size={14} strokeWidth={2.2} />
              {t("chat.private.label")}
            </button>
            <button
              type="button"
              className={`private-toggle ${isIsolated ? "on" : ""}`}
              aria-pressed={isIsolated}
              title={t("chat.isolated.toggleTitle")}
              onClick={() => {
                // Its pill would promise a skill an isolated conversation never uses
                if (!isIsolated) invokedSkill.clear();
                onPrivacyChange(isIsolated ? "normal" : "isolated");
              }}
            >
              <ShieldCheck size={14} strokeWidth={2.2} />
              {t("chat.isolated.label")}
            </button>
          </div>

          {aboveComposer}
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={(attachments) => {
              // This already is a new conversation: "/new …" sends what follows, and /new alone has nothing to do
              const forGuide = canWriteGuide ? initRequestOf(draft.trim()) : null;
              if (forGuide !== null) return start(forGuide || t("commands.init.message"), attachments, true);
              const text = messageForNew(draft.trim()) ?? draft.trim();
              if (!text && attachments.length === 0) return setDraft("");
              start(text, attachments, false);
            }}
            // /init, with a folder chosen: the new conversation writes its NYRA.md
            commands={[
              {
                name: "init",
                run: () => start(t("commands.init.message"), [], true),
                unavailable: !canWriteGuide ? t("commands.init.noFolder") : isBusy ? t("commands.init.busy") : undefined,
              },
            ]}
            models={models}
            selectedModelId={selectedModelId}
            onSelectModel={onSelectModel}
            variant="welcome"
            isLocked={isBusy}
            onOpenSettings={onOpenSettings}
            dropZoneRef={mainRef}
            skillNames={skillNames}
            onChangeSkills={setChosenSkills}
            isSkillPickerOpen={isSkillPickerOpen}
            onSkillPickerOpenChange={setIsSkillPickerOpen}
            onManageSkills={onManageSkills}
            invokedSkill={invokedSkill}
            onOpenFeatureSettings={onOpenFeatureSettings}
            workspace={{ folder: workspace, isPrivate, onChange: setWorkspace }}
            shortcutsEnabled={shortcutsEnabled}
            isIsolated={isIsolated}
          />

          <div className="suggestions">
            {suggestions.map((s) => (
              <button
                key={s.skill}
                type="button"
                className="suggestion"
                title={t("chat.welcome.applySkill", { name: s.skill })}
                onClick={() => invokedSkill.invoke(s.skill)}
              >
                <span className="suggestion-icon" style={{ color: s.color }}>
                  <s.icon size={16} strokeWidth={1.9} />
                </span>
                <span className="suggestion-text">
                  <span className="suggestion-title">{t(`chat.welcome.suggestions.${s.skill}.title`)}</span>
                  <span className="suggestion-description">{t(`chat.welcome.suggestions.${s.skill}.description`)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <Disclaimer />
    </main>
  );
}
