import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/shared/lib/errors";
import { canFormat, formatCode } from "./codeFormat";
import { jsonShapes, mayBeJson } from "./jsonFormat";

export type CodeView = "original" | "formatted" | "compact";

// A formatter's result, kept by the code and language it was made for
type Formatted = { text: string; language: string; output: string | null; error: string | null };

// Code as it came or reformatted: JSON at once, indented or on one line; any other language Nyra has a formatter for,
// once its formatter has loaded. A block without a language is offered JSON's views only when it really is JSON.
export function useCodeViews(text: string, language: string | null) {
  const name = language?.trim().toLowerCase() || null;
  const saysJson = name === "json" || name === "jsonc";
  const jsonOffered = saysJson || (!name && mayBeJson(text));
  const shapes = useMemo(() => (jsonOffered ? jsonShapes(text, name === "jsonc") : null), [jsonOffered, text, name]);
  const json = shapes && (saysJson || shapes.ok) ? shapes : null;
  const formattable = !json && canFormat(name);
  const [view, setView] = useState<CodeView>("original");
  const [formatted, setFormatted] = useState<Formatted | null>(null);

  useEffect(() => {
    if (!formattable || view !== "formatted" || !name) return;
    let current = true;
    formatCode(text, name).then(
      (output) => current && setFormatted({ text, language: name, output, error: null }),
      (e) => current && setFormatted({ text, language: name, output: null, error: errorMessage(e) }),
    );
    return () => {
      current = false;
    };
  }, [formattable, view, text, name]);

  const ready = formatted?.text === text && formatted.language === name ? formatted : null;
  const wantsFormatted = formattable && view === "formatted";
  let shown = text;
  if (json?.ok && view === "formatted") shown = json.formatted;
  else if (json?.ok && view === "compact" && json.compact !== null) shown = json.compact;
  else if (wantsFormatted && ready?.output) shown = ready.output;
  return {
    kind: json ? ("json" as const) : formattable ? ("code" as const) : null,
    json,
    view,
    setView,
    shown,
    isReshaped: shown !== text,
    // JSON recognized without a language is shown, and colored, as JSON
    language: json ? (name ?? "json") : name,
    formatting: wantsFormatted && !ready,
    error: wantsFormatted ? (ready?.error ?? null) : null,
  };
}
