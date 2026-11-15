import type { TFunction } from "i18next";
import {
  Camera,
  CircleCheck,
  CircleMinus,
  CircleX,
  Eraser,
  Globe,
  Highlighter,
  Keyboard,
  LoaderCircle,
  Lock,
  MousePointerClick,
  Search,
  TextCursorInput,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BrowserOutcome, BrowserStep, BrowserStepKind } from "@/shared/types";
import { type StepTone, toneOf } from "./browserSteps";

type Props = {
  step: BrowserStep;
};

const ICONS: Record<BrowserStepKind, typeof Globe> = {
  browse: Globe,
  click: MousePointerClick,
  type: TextCursorInput,
  key: Keyboard,
  pageSearch: Search,
  screenshot: Camera,
  mark: Highlighter,
  unmark: Eraser,
};

const TONE_ICONS = { ok: CircleCheck, noEffect: CircleMinus, failed: CircleX };

function ToneIcon({ tone }: { tone: StepTone }) {
  const Icon = TONE_ICONS[tone];
  return <Icon size={13} strokeWidth={2.2} aria-hidden="true" />;
}

// What the app checked, after the word for how it went; nothing when the word says it all
function detailOf(t: TFunction, step: BrowserStep, outcome: BrowserOutcome) {
  switch (outcome.key) {
    case "navigated":
      return t("browser.outcome.navigated", { site: outcome.site });
    case "typed":
      return step.secret ? t("browser.outcome.filled") : "";
    case "notTyped":
    case "changed":
    case "unchanged":
    case "shot":
    case "refused":
    case "markMissing":
    case "markHidden":
      return t(`browser.outcome.${outcome.key}`);
    case "unmarked":
      return "";
    case "marked":
      return outcome.count > 1 ? t("browser.outcome.markedFirst", { count: outcome.count }) : t("browser.outcome.marked");
    case "found":
      return outcome.count === 0
        ? t("browser.outcome.notFound")
        : t("browser.outcome.found", { count: outcome.count });
    case "failed":
      return outcome.error ?? "";
  }
}

// One action of a reply in the browser: what it did, on what, and what the app saw it change
export function BrowserStepItem({ step }: Props) {
  const { t } = useTranslation();
  const { outcome } = step;
  const Icon = step.secret ? Lock : ICONS[step.kind];
  const text = t(outcome ? `browser.step.${step.kind}` : `browser.stepNow.${step.kind}`, { target: step.target });
  const tone = outcome && toneOf(outcome);
  const detail = outcome && detailOf(t, step, outcome);
  return (
    <li className={`browser-step ${outcome ? "" : "running"}`}>
      <span className="browser-step-icon" aria-hidden="true">
        <Icon size={14} strokeWidth={2} />
      </span>
      <span className="browser-step-body">
        <span className="browser-step-text">
          {text}
          {step.typed && <code className="browser-step-typed">{step.typed}</code>}
          {step.secret && (
            <span className="browser-step-secret">
              <Lock size={11} strokeWidth={2.2} aria-hidden="true" />
              {t("browser.step.hidden")}
            </span>
          )}
        </span>
        {tone ? (
          <span className={`browser-step-outcome ${tone}`}>
            <ToneIcon tone={tone} />
            <b>{t(`browser.outcome.${tone}`)}</b>
            {detail && <span> · {detail}</span>}
          </span>
        ) : (
          <span className="browser-step-outcome checking">
            <LoaderCircle size={13} strokeWidth={2.2} className="spin" aria-hidden="true" />
            {t("browser.outcome.checking")}
          </span>
        )}
      </span>
    </li>
  );
}
