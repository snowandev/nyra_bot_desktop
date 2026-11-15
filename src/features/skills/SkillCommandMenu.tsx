import { Check, CornerDownLeft, Diamond, Settings, Sparkles, SquareTerminal } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useFitPlacement } from "@/shared/hooks/useFitPlacement";
import { optionId, type SlashOption } from "./useSkillCommand";
import { describeCommand } from "@/features/chat/reply/commands";

type Props = {
  matches: SlashOption[];
  query: string;
  // Skills marked in the conversation, shown as marked
  markedNames: string[];
  activeIndex: number;
  // The textarea points at this list and its active option (aria-controls, aria-activedescendant)
  listId: string;
  // The skill already chosen for this message, which picking another one replaces
  replacing: string | null;
  placement: "up" | "down";
  onPick: (option: SlashOption) => void;
  onHover: (index: number) => void;
  onManage: () => void;
  // Settings → Comandos y atajos; only where there are commands
  onShowCommands?: () => void;
  // After /model the list holds models, and the one in use is marked
  isPickingModel: boolean;
  selectedModelId: string;
};

function highlighted(name: string, query: string) {
  const at = query ? name.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at === -1) return name;
  return (
    <>
      {name.slice(0, at)}
      <mark>{name.slice(at, at + query.length)}</mark>
      {name.slice(at + query.length)}
    </>
  );
}

// The focus stays in the textarea while the user moves through the list, as in a combobox
export function SkillCommandMenu(props: Props) {
  const { matches, query, markedNames, activeIndex, listId, replacing, placement, onPick, onHover, onManage } = props;
  const { onShowCommands, isPickingModel, selectedModelId } = props;
  // Also redraws the commands' descriptions (describeCommand) when the language changes
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  useFitPlacement(menuRef, true, placement);
  const hasCommands = matches.some((m) => m.kind === "command");
  const skillCount = matches.filter((m) => m.kind === "skill").length;

  useEffect(() => {
    menuRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    // Clicking an option must not take the focus from the textarea
    <div ref={menuRef} className="skill-command-menu" onMouseDown={(e) => e.preventDefault()}>
      <div className="skill-command-header">
        <span>
          {isPickingModel
            ? t("skills.command.changeModel")
            : hasCommands
              ? t("skills.command.commandsAndSkills")
              : t("skills.command.applyToMessage")}
        </span>
        {isPickingModel ? (
          <span className="mono">/model {query}</span>
        ) : replacing && skillCount > 0 ? (
          <span className="mono">{t("skills.command.replaces", { name: replacing })}</span>
        ) : (
          query && <span className="mono">/{query}</span>
        )}
      </div>

      {matches.length === 0 && isPickingModel ? (
        <div className="skill-command-empty" role="status">
          <strong>
            <Trans
              i18nKey="skills.command.noModel"
              values={{ query }}
              components={{ code: <span className="mono" /> }}
            />
          </strong>
          <p>{t("skills.command.noModelHint")}</p>
        </div>
      ) : matches.length === 0 ? (
        <div className="skill-command-empty" role="status">
          <strong>
            <Trans
              i18nKey="skills.command.noMatch"
              values={{ query }}
              components={{ code: <span className="mono" /> }}
            />
          </strong>
          <p>{t("skills.command.noMatchHint")}</p>
          <button type="button" className="skill-command-manage" onClick={onManage}>
            <Settings size={14} strokeWidth={2} />
            {t("skills.picker.manage")}
          </button>
        </div>
      ) : (
        <>
          <ul
            role="listbox"
            id={listId}
            aria-label={isPickingModel ? t("skills.command.models") : t("skills.command.commandsAndSkills")}
            className="skill-command-list"
          >
            {matches.map((option, i) => {
              if (option.kind === "model") {
                const { model } = option;
                return (
                  <li
                    key={`model-${model.id}`}
                    id={optionId(listId, i)}
                    role="option"
                    aria-selected={i === activeIndex}
                    className="skill-command-option"
                    onMouseEnter={() => onHover(i)}
                    onClick={() => onPick(option)}
                  >
                    <span className="skill-command-icon">
                      <Diamond size={14} strokeWidth={2} />
                    </span>
                    <span className="skill-command-text">
                      <span>{highlighted(model.name, query)}</span>
                      <span>{model.description}</span>
                    </span>
                    {model.id === selectedModelId && (
                      <span className="skill-command-marked">
                        <Check size={11} strokeWidth={3} />
                        {t("skills.command.inUse")}
                      </span>
                    )}
                    <CornerDownLeft size={14} strokeWidth={2} className="skill-command-enter" aria-hidden="true" />
                  </li>
                );
              }
              const isCommand = option.kind === "command";
              const name = isCommand ? option.command.name : option.skill.name;
              const unavailable = isCommand ? option.command.unavailable : undefined;
              // A label above the first of each kind, when both are in the list
              const groupLabel: ReactNode =
                hasCommands && (i === 0 || matches[i - 1].kind !== option.kind) ? (
                  <li role="presentation" className="skill-command-group">
                    {isCommand ? t("skills.command.commands") : t("skills.command.skills")}
                  </li>
                ) : null;
              return (
                <Fragment key={`${option.kind}-${name}`}>
                  {groupLabel}
                  <li
                    id={optionId(listId, i)}
                    role="option"
                    aria-selected={i === activeIndex}
                    aria-disabled={!!unavailable}
                    className="skill-command-option"
                    onMouseEnter={() => onHover(i)}
                    onClick={() => onPick(option)}
                  >
                    <span className={`skill-command-icon ${isCommand ? "command" : ""}`}>
                      {isCommand ? <SquareTerminal size={15} strokeWidth={2} /> : <Sparkles size={15} strokeWidth={2} />}
                    </span>
                    <span className="skill-command-text">
                      <span className="mono">{highlighted(name, query)}</span>
                      <span>{unavailable ?? (isCommand ? describeCommand(option.command.name) : option.skill.description)}</span>
                    </span>
                    {!isCommand && markedNames.includes(name) && (
                      <span className="skill-command-marked">
                        <Check size={11} strokeWidth={3} />
                        {t("skills.command.marked")}
                      </span>
                    )}
                    {!unavailable && (
                      <CornerDownLeft size={14} strokeWidth={2} className="skill-command-enter" aria-hidden="true" />
                    )}
                  </li>
                </Fragment>
              );
            })}
          </ul>
          <div className="skill-command-footer">
            <span>{t("skills.command.keys")}</span>
            {onShowCommands && (
              <button type="button" className="skill-command-manage link" onClick={onShowCommands}>
                <SquareTerminal size={13} strokeWidth={2} />
                {t("skills.command.showCommands")}
              </button>
            )}
            <button type="button" className="skill-command-manage link" onClick={onManage}>
              <Settings size={13} strokeWidth={2} />
              {t("skills.picker.manage")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
