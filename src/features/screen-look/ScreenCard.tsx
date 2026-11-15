import {
  CircleCheck,
  CircleMinus,
  CircleStop,
  CircleX,
  Eraser,
  Eye,
  Highlighter,
  Keyboard,
  LoaderCircle,
  Monitor,
  MousePointerClick,
  MoveVertical,
  Type,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ScreenRecord, ScreenStep } from "@/shared/types";

type Props = {
  record: ScreenRecord;
};

const ICONS = {
  look: Monitor,
  point: Highlighter,
  unpoint: Eraser,
  watch: Eye,
  click: MousePointerClick,
  type: Type,
  key: Keyboard,
  scroll: MoveVertical,
};
const OUTCOME_ICONS = {
  ok: CircleCheck,
  done: CircleCheck,
  missing: CircleMinus,
  refused: CircleMinus,
  idle: CircleMinus,
  ended: CircleStop,
  taken: CircleStop,
  failed: CircleX,
};

function StepItem({ step }: { step: ScreenStep }) {
  const { t } = useTranslation();
  const Icon = ICONS[step.kind];
  const Outcome = step.outcome ? OUTCOME_ICONS[step.outcome] : LoaderCircle;
  return (
    <li className={`screen-step ${step.outcome ?? "running"}`}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      <span className="screen-step-text">{t(`screen.step.${step.kind}`, { target: step.target })}</span>
      <span className="screen-step-outcome">
        <Outcome size={13} strokeWidth={2.2} className={step.outcome ? undefined : "spin"} aria-hidden="true" />
        {step.outcome ? t(`screen.outcome.${step.outcome}`) : t("screen.outcome.running")}
        {step.error && <span className="screen-step-error"> · {step.error}</span>}
      </span>
    </li>
  );
}

// What a reply looked at, pointed out and did on the user's screen, where it did it; the marks themselves are on the
// screen
export function ScreenCard({ record }: Props) {
  const { t } = useTranslation();
  return (
    <section className="screen-card" aria-label={t("screen.card.label")}>
      <ul className="screen-steps">
        {record.steps.map((step, i) => (
          <StepItem key={i} step={step} />
        ))}
      </ul>
    </section>
  );
}
