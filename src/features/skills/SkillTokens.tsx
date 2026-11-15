import { useTranslation } from "react-i18next";
import { formatNumber } from "@/shared/lib/format";
import { sizeOf } from "./skills";

type Props = {
  tokens: number;
};

// Always the number; the label only at the ends, where it changes a decision
export function SkillTokens({ tokens }: Props) {
  const { t } = useTranslation();
  const size = sizeOf(tokens);
  const label = size === "normal" ? null : t(`skills.tokens.${size}`);
  return (
    <span className="skill-tokens">
      <span className="skill-tokens-count">{t("skills.tokens.count", { tokens: formatNumber(tokens) })}</span>
      {label && <span className={`skill-size ${size}`}>{label}</span>}
    </span>
  );
}
