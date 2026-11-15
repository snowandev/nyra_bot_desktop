import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Check, CircleAlert, Copy, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTransientState } from "@/shared/hooks/useTransientState";

type CopyState = "idle" | "copied" | "error";

const ICONS: Record<CopyState, LucideIcon> = {
  idle: Copy,
  copied: Check,
  error: CircleAlert,
};

const STATUS_KEYS = { copied: "ui.copied", error: "ui.copyFailed" } as const;

type Props = {
  label: string;
  showLabel?: boolean;
} & (
  | {
      // A function when building the text is costly; it then runs only on click
      text: string | (() => string);
    }
  | {
      // Copies something other than text, e.g. an image
      copy: () => Promise<void>;
    }
);

export function CopyButton(props: Props) {
  const { label, showLabel = false } = props;
  const { t } = useTranslation();
  const [state, , flash] = useTransientState<CopyState>("idle");
  const StateIcon = ICONS[state];
  const currentLabel = state === "idle" ? label : t(STATUS_KEYS[state]);

  async function copy() {
    try {
      if ("copy" in props) await props.copy();
      else await writeText(typeof props.text === "function" ? props.text() : props.text);
      flash("copied");
    } catch {
      flash("error");
    }
  }

  return (
    <button
      type="button"
      className={`copy-button ${state} ${showLabel ? "with-label" : "icon-button small"}`}
      aria-label={currentLabel}
      title={currentLabel}
      onClick={copy}
    >
      <StateIcon size={showLabel ? 14 : 16} strokeWidth={1.8} />
      {showLabel && <span aria-hidden="true">{currentLabel}</span>}
      <span className="visually-hidden" role="status">
        {state === "idle" ? "" : currentLabel}
      </span>
    </button>
  );
}
