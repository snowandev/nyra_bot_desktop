import { Gem, type LucideIcon, Package, SquareTerminal, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SkillSource } from "./skills";

type Props = {
  source: SkillSource;
};

const ICONS: Record<SkillSource, LucideIcon> = {
  own: UserRound,
  "claude-code": SquareTerminal,
  file: Package,
  nyra: Gem,
};

export function SkillSourcePill({ source }: Props) {
  const { t } = useTranslation();
  const Icon = ICONS[source];
  // Claude Code is a product name, the same in every language
  const label = source === "claude-code" ? "Claude Code" : t(`skills.source.${source}`);
  return (
    <span className="skill-pill">
      <Icon size={11} strokeWidth={2.4} />
      {label}
    </span>
  );
}
