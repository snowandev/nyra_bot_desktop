import { Info, Keyboard, SquareTerminal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePreferencesContext } from "./preferencesContext";
import { COMMANDS, exampleText } from "@/features/chat/reply/commands";
import { modifierLabel, platformName } from "@/shared/lib/platform";
import { acceleratorLabel } from "@/features/quick-bar/quickShortcut";
import { otherKeys, type Shortcut, SHORTCUTS, shortcutLabelOf } from "@/shared/lib/shortcuts";
import { SettingsOption } from "@/shared/ui/SettingsOption";
import { SettingsPanel } from "@/shared/ui/SettingsPanel";

type Option = "commands" | "shortcuts";

const shortcuts: Shortcut[] = Object.values(SHORTCUTS);

function keyRow(keys: string, action: string, detail?: string) {
  return (
    <tr key={`${keys}-${action}`}>
      <td>
        <kbd className="shortcut-keys">{keys}</kbd>
      </td>
      <td>
        <span className="shortcut-action">{action}</span>
        {detail && <span className="shortcut-detail">{detail}</span>}
      </td>
    </tr>
  );
}

// Only to read: what each command does and how to type it, and every keyboard shortcut with this system's keys
export function CommandsSettings() {
  const [selected, setSelected] = useState<Option>("commands");
  const { preferences } = usePreferencesContext();
  const { t } = useTranslation();
  const quickKeys = preferences.quickShortcutEnabled
    ? acceleratorLabel(preferences.quickShortcut, platformName)
    : t("settings.commands.disabled");
  const others = otherKeys();

  return (
    <div className="settings-content">
      <section aria-label={t("settings.sections.commands.label")} className="settings-list">
        <div className="section-label">{t("settings.commands.browse")}</div>
        <SettingsOption
          icon={<SquareTerminal size={18} strokeWidth={1.8} />}
          name={t("settings.commands.commands")}
          status={
            <span className="settings-option-status">
              {t("settings.commands.commandsCount", { count: COMMANDS.length })}
            </span>
          }
          selected={selected === "commands"}
          onSelect={() => setSelected("commands")}
        />
        <SettingsOption
          icon={<Keyboard size={18} strokeWidth={1.8} />}
          name={t("settings.commands.shortcuts")}
          status={
            <span className="settings-option-status">
              {t("settings.commands.shortcutsCount", { count: shortcuts.length + others.length + 1 })}
            </span>
          }
          selected={selected === "shortcuts"}
          onSelect={() => setSelected("shortcuts")}
        />
      </section>

      {selected === "commands" ? (
        <SettingsPanel title={t("settings.commands.commands")} description={t("settings.commands.commandsDescription")}>
          <ul className="command-cards">
            {COMMANDS.map((command) => (
              <li key={command.name} className="command-card">
                <div className="command-card-head">
                  <code className="command-card-name">/{command.name}</code>
                  <span>{t(command.description)}</span>
                </div>
                <p>{t(command.details)}</p>
                <div className="command-card-examples">
                  <span>{t("settings.commands.examples", { count: command.examples.length })}</span>
                  {command.examples.map((example) => (
                    <code key={example}>{exampleText(example)}</code>
                  ))}
                </div>
                {command.unavailableWhen && (
                  <p className="command-card-unavailable">
                    <Info size={13} strokeWidth={2} aria-hidden="true" />
                    <span>{t("settings.commands.unavailable", { when: t(command.unavailableWhen) })}</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </SettingsPanel>
      ) : (
        <SettingsPanel
          title={t("settings.commands.shortcuts")}
          description={t("settings.commands.shortcutsDescription", { key: modifierLabel })}
        >
          <table className="shortcut-table">
            <caption className="visually-hidden">{t("settings.commands.withKey", { key: modifierLabel })}</caption>
            <thead className="visually-hidden">
              <tr>
                <th scope="col">{t("settings.commands.keys")}</th>
                <th scope="col">{t("settings.commands.action")}</th>
              </tr>
            </thead>
            <tbody>{shortcuts.map((s) => keyRow(shortcutLabelOf(s), t(s.action), s.detail && t(s.detail)))}</tbody>
          </table>
          <h4 className="shortcut-group">{t("settings.commands.otherKeys")}</h4>
          <table className="shortcut-table">
            <caption className="visually-hidden">{t("settings.commands.otherKeys")}</caption>
            <thead className="visually-hidden">
              <tr>
                <th scope="col">{t("settings.commands.keys")}</th>
                <th scope="col">{t("settings.commands.action")}</th>
              </tr>
            </thead>
            <tbody>{others.map((k) => keyRow(k.keys, k.action, k.detail))}</tbody>
          </table>
          <h4 className="shortcut-group">{t("settings.commands.anywhere")}</h4>
          <table className="shortcut-table">
            <caption className="visually-hidden">{t("settings.commands.anywhere")}</caption>
            <thead className="visually-hidden">
              <tr>
                <th scope="col">{t("settings.commands.keys")}</th>
                <th scope="col">{t("settings.commands.action")}</th>
              </tr>
            </thead>
            <tbody>
              {keyRow(quickKeys, t("settings.commands.quickBarToggle"), t("settings.commands.quickBarWhere"))}
            </tbody>
          </table>
        </SettingsPanel>
      )}
    </div>
  );
}
