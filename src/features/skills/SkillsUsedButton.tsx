import { ArrowRight, Sparkles, X } from "lucide-react";
import type { TFunction } from "i18next";
import { useId, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSkillsContext } from "./skillsContext";
import { useDialogPopover } from "@/shared/hooks/useDialogPopover";
import { joinedList } from "@/features/chat/listFormat";

type Props = {
  // The skills this reply followed, the one chosen with "/" first
  names: string[];
  // The one the user chose with "/" for their message, if any
  chosenByUser?: string;
  // Next to the model's name when there is no reasoning or search line to sit in
  compact?: boolean;
  onOpenSkill?: (name: string) => void;
};

function howChosen(names: string[], chosenByUser: string | undefined, t: TFunction) {
  const byModel = names.filter((n) => n !== chosenByUser);
  if (!chosenByUser || byModel.length === names.length) return t("skills.used.byModel", { count: byModel.length });
  if (byModel.length === 0) return t("skills.used.byYou", { name: chosenByUser });
  return t("skills.used.both", { count: byModel.length, chosen: chosenByUser, added: joinedList(byModel) });
}

// One ✦ button for the skills of a reply: the names on hover or focus, the details on click
export function SkillsUsedButton({ names, chosenByUser, compact = false, onOpenSkill }: Props) {
  const { skills } = useSkillsContext();
  const { t } = useTranslation();
  const { isOpen, rootRef, close, toggle, triggerRef, closeRef, closeAndReturn, onDialogKeyDown } = useDialogPopover();
  const popoverRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const count = names.length;

  // Aligned with the button's left edge; to its right edge if it would leave the window
  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!isOpen || !popover) return;
    popover.dataset.align = "start";
    if (popover.getBoundingClientRect().right > window.innerWidth - 12) popover.dataset.align = "end";
  }, [isOpen]);

  return (
    <span className={`skills-used ${compact ? "compact" : ""}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="skills-used-trigger"
        aria-label={t("skills.used.label", { count, names: joinedList(names) })}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={toggle}
      >
        <Sparkles size={compact ? 13 : 15} strokeWidth={2} />
        {count > 1 && <span>{count}</span>}
      </button>
      {/* Its text is already in the button's label */}
      {!isOpen && (
        <span className="skills-used-tip" aria-hidden="true">
          <span>{t("skills.used.tip", { count })}</span>
          {names.map((name) => (
            <span key={name} className="mono">
              <Sparkles size={12} strokeWidth={2} />
              {name}
            </span>
          ))}
          <small>{t("skills.used.clickForDetails")}</small>
        </span>
      )}

      {isOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-labelledby={titleId}
          className="skills-used-popover"
          onKeyDown={onDialogKeyDown}
        >
          <div className="skills-used-header">
            <span>
              <strong id={titleId}>{t("skills.used.title", { count })}</strong>
              <small>{t("skills.used.count", { count })}</small>
            </span>
            <button ref={closeRef} type="button" className="icon-button small" aria-label={t("skills.used.close")} onClick={closeAndReturn}>
              <X size={15} strokeWidth={2} />
            </button>
          </div>
          <ul className="skills-used-list">
            {names.map((name) => (
              <li key={name}>
                <span className="skills-used-icon">
                  <Sparkles size={15} strokeWidth={2} />
                </span>
                <span className="skills-used-text">
                  <span className="skills-used-name">
                    <span className="mono">{name}</span>
                    {name === chosenByUser && <span className="skills-used-chosen">{t("skills.used.chosenByYou")}</span>}
                  </span>
                  {/* A skill deleted since the reply only has its name */}
                  <span>{skills.find((s) => s.name === name)?.description}</span>
                  {onOpenSkill && skills.some((s) => s.name === name) && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        close();
                        onOpenSkill(name);
                      }}
                    >
                      {t("skills.used.openInSettings")}
                      <ArrowRight size={12} strokeWidth={2} />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="skills-used-footer">{howChosen(names, chosenByUser, t)}</p>
        </div>
      )}
    </span>
  );
}
