import { Check, CircleAlert, Download, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTransientState } from "@/shared/hooks/useTransientState";
import { errorMessage } from "@/shared/lib/errors";
import type { TableData } from "./tableData";
import { saveTable } from "./tableStorage";

type Props = {
  // Read on click, so it is saved in the order shown
  data: () => TableData;
};

type SaveState = "idle" | "saving" | "saved" | "error";

const ICONS = { idle: Download, saving: LoaderCircle, saved: Check, error: CircleAlert };
const LABELS = {
  idle: "markdown.saveTable",
  saving: "markdown.saveTable",
  saved: "markdown.tableSaved",
  error: "markdown.tableSaveFailed",
} as const;

// Looks like the copy button next to it; the native save dialog opens on the Rust side
export function SaveTableButton({ data }: Props) {
  const { t } = useTranslation();
  const [state, setState, flash] = useTransientState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const Icon = ICONS[state];

  async function save() {
    setState("saving");
    setError(null);
    try {
      if (await saveTable(`${t("markdown.tableFileName")}.xlsx`, data())) flash("saved");
      else setState("idle");
    } catch (e) {
      setError(errorMessage(e));
      flash("error");
    }
  }

  return (
    <button
      type="button"
      className={`copy-button with-label ${state === "saved" ? "copied" : state}`}
      aria-label={t(LABELS[state])}
      // Only while the error is on screen; afterwards the button is back to normal
      title={state === "error" ? (error ?? undefined) : undefined}
      disabled={state === "saving"}
      onClick={save}
    >
      <Icon size={14} strokeWidth={1.8} className={state === "saving" ? "spin" : undefined} />
      <span aria-hidden="true">{t(LABELS[state])}</span>
      <span className="visually-hidden" role="status">
        {state === "saved" || state === "error" ? (error ?? t(LABELS[state])) : ""}
      </span>
    </button>
  );
}
