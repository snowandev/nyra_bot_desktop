import { CornerDownLeft, File } from "lucide-react";
import { useEffect, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";
import { optionId } from "@/features/skills/useSkillCommand";
import { useFitPlacement } from "@/shared/hooks/useFitPlacement";
import type { FileMention } from "./useFileMention";
import { splitPath } from "@/shared/lib/paths";

type Props = {
  mention: FileMention;
  placement: "up" | "down";
};

// The folder's files for "@": the focus stays in the textarea while the arrows move through them, as with "/"
export function FileMentionMenu({ mention, placement }: Props) {
  const { matches, query, activeOption, listId, pick, setActiveIndex } = mention;
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  useFitPlacement(menuRef, true, placement);

  useEffect(() => {
    menuRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeOption]);

  return (
    // Clicking a file must not take the focus from the textarea
    <div ref={menuRef} className="skill-command-menu" onMouseDown={(e) => e.preventDefault()}>
      <div className="skill-command-header">
        <span>{t("workspace.mention.header")}</span>
        <span className="mono">@{query}</span>
      </div>
      {matches.length === 0 ? (
        <div className="skill-command-empty" role="status">
          <strong>
            <Trans
              i18nKey="workspace.mention.none"
              values={{ query }}
              components={{ mono: <span className="mono" /> }}
            />
          </strong>
          <p>{t("workspace.mention.hint")}</p>
        </div>
      ) : (
        <ul role="listbox" id={listId} aria-label={t("workspace.mention.files")} className="skill-command-list">
          {matches.map((path, i) => {
            const { name, folder } = splitPath(path);
            return (
              <li
                key={path}
                id={optionId(listId, i)}
                role="option"
                aria-selected={i === activeOption}
                className="skill-command-option"
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => pick(path)}
              >
                <span className="skill-command-icon">
                  <File size={14} strokeWidth={2} />
                </span>
                <span className="skill-command-text">
                  <span className="mono">{name}</span>
                  {folder && <span className="mono">{folder}</span>}
                </span>
                <CornerDownLeft size={14} strokeWidth={2} className="skill-command-enter" aria-hidden="true" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
