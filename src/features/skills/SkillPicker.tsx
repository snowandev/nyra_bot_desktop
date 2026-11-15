import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useClickOutside } from "@/shared/hooks/useClickOutside";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { formatNumber, formatShare } from "@/shared/lib/format";
import { foldForSearch } from "@/shared/lib/search";
import { activeSkillsTokens, type Skill, skillTokens } from "./skills";
import { SkillTokens } from "./SkillTokens";

type Props = {
  skills: Skill[];
  selected: string[];
  onChange: (names: string[]) => void;
  onClose: () => void;
  onManage: () => void;
  contextLimit: number | undefined;
  placement: "up" | "down";
};

export function SkillPicker({ skills, selected, onChange, onClose, onManage, contextLimit, placement }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const close = useStableCallback(onClose);
  useEscapeKey(close);
  useClickOutside(rootRef, close);

  useEffect(() => searchRef.current?.focus(), []);

  const terms = foldForSearch(query.trim());
  const visible = terms ? skills.filter((s) => foldForSearch(`${s.name} ${s.description}`).includes(terms)) : skills;
  const active = skills.filter((s) => selected.includes(s.name));
  // The model sees only the list until it asks for one, so the total isn't the sum of every skill
  const total = activeSkillsTokens(active);
  const footer = {
    active: t("skills.picker.active", { count: active.length }),
    tokens: formatNumber(total),
    percent: contextLimit ? formatShare(total / contextLimit) : "",
  };

  function toggle(name: string) {
    onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);
  }

  return (
    <div className={`skill-picker ${placement}`} role="dialog" aria-label={t("skills.picker.title")} ref={rootRef}>
      <div className="skill-picker-header">
        <strong>{t("skills.picker.title")}</strong>
        <button type="button" className="icon-button small" aria-label={t("skills.picker.close")} onClick={onClose}>
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      {skills.length > 0 && (
        <label className="search-field skill-picker-search">
          <Search size={15} strokeWidth={2} />
          <span className="visually-hidden">{t("skills.picker.search")}</span>
          <input
            ref={searchRef}
            type="search"
            placeholder={t("skills.picker.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}

      <ul className="skill-picker-list">
        {visible.map((skill) => (
          <li key={skill.name}>
            <label className="skill-picker-item">
              <input type="checkbox" checked={selected.includes(skill.name)} onChange={() => toggle(skill.name)} />
              <span className="skill-picker-text">
                <span className="mono skill-picker-name">{skill.name}</span>
                <span className="skill-picker-description">{skill.description}</span>
                <SkillTokens tokens={skillTokens(skill)} />
              </span>
            </label>
          </li>
        ))}
        {skills.length === 0 && (
          <li className="skill-picker-empty">{t("skills.picker.none")}</li>
        )}
        {skills.length > 0 && visible.length === 0 && (
          <li className="skill-picker-empty">{t("skills.picker.noMatch")}</li>
        )}
      </ul>

      <div className="skill-picker-footer">
        <span title={t("skills.picker.footerTitle")}>
          {contextLimit ? t("skills.picker.footerWithShare", footer) : t("skills.picker.footer", footer)}
        </span>
        <button type="button" className="link-button" onClick={onManage}>
          {t("skills.picker.manage")}
        </button>
      </div>
    </div>
  );
}
