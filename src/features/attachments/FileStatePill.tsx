import { CircleCheck, Link2, ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { FileState } from "@/features/chat/reply/summary";

// Each state's label and hint are in the catalog, under attachments.state.<state>
const ICONS = { complete: CircleCheck, summarized: ScrollText, referenced: Link2 } satisfies Record<FileState, typeof Link2>;

type Props = {
  state: FileState;
  // Small version for attachment cards inside messages, which have no room for a tooltip
  mini?: boolean;
};

export function FileStatePill({ state, mini = false }: Props) {
  const { t } = useTranslation();
  const Icon = ICONS[state];
  const label = t(`attachments.state.${state}.label`);
  const hint = t(`attachments.state.${state}.hint`);
  return (
    <span className={`file-state ${state} ${mini ? "mini" : "has-tip"}`} title={mini ? hint : undefined}>
      <Icon size={mini ? 11 : 12} strokeWidth={2.4} aria-hidden="true" />
      {label}
      {!mini && (
        <span className="hover-tip below" aria-hidden="true">
          {hint}
        </span>
      )}
    </span>
  );
}
