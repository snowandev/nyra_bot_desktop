import { ChevronDown, Lightbulb } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useElapsedSeconds } from "@/shared/hooks/useElapsedSeconds";
import { formatDuration } from "@/shared/lib/format";
import type { Reasoning } from "@/shared/types";

type Props = {
  reasoning: Reasoning;
  // Still arriving: the line counts the seconds
  isThinking?: boolean;
  // On the same line, to its right; the reasoning still unfolds below at full width
  aside?: ReactNode;
};

// "Pensó durante 12 s": what a reasoning model thought before answering, folded so the reply comes first
export function ReasoningSummary({ reasoning, isThinking = false, aside }: Props) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const textId = useId();
  // A reply that thinks again after a command goes on from what it thought before, not from zero
  const seconds =
    Math.floor((reasoning.durationMs ?? 0) / 1000) + useElapsedSeconds(isThinking, reasoning.thinkingSince);
  const label = isThinking
    ? t("chat.reasoning.thinking", { seconds })
    : reasoning.durationMs === undefined
      ? t("chat.reasoning.label")
      : t("chat.reasoning.thoughtFor", { duration: formatDuration(reasoning.durationMs) });

  return (
    <>
      <div className="reply-summary-row">
        <button
          type="button"
          className="reply-summary"
          aria-expanded={isExpanded}
          aria-controls={textId}
          onClick={() => setIsExpanded((open) => !open)}
        >
          <Lightbulb
            size={15}
            strokeWidth={2}
            className={`reply-summary-icon reasoning ${isThinking ? "thinking" : ""}`}
          />
          <span>{label}</span>
          <ChevronDown size={14} strokeWidth={2} className="reply-summary-chevron" />
        </button>
        {aside}
      </div>
      {isExpanded && (
        <div className="reasoning-text" id={textId}>
          {reasoning.text.trim()}
        </div>
      )}
    </>
  );
}
