import type { Element } from "hast";
import { CircleAlert, Info, Lightbulb, type LucideIcon, OctagonAlert, TriangleAlert } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { useTranslation } from "react-i18next";
import { CALLOUT_KINDS, type CalloutKind } from "./callouts";

type Props = ComponentPropsWithoutRef<"blockquote"> & {
  node?: Element;
  // Set by remarkCallouts
  "data-callout"?: string;
  "data-callout-title"?: string;
};

const ICONS: Record<CalloutKind, LucideIcon> = {
  note: Info,
  tip: Lightbulb,
  important: CircleAlert,
  warning: TriangleAlert,
  caution: OctagonAlert,
};

const isKind = (value: string | undefined): value is CalloutKind =>
  CALLOUT_KINDS.some((kind) => kind === value);

// A quote, or a callout when the reply marked it as one: a box with its icon, its title and its color
export function QuoteBlock({ node: _node, "data-callout": kind, "data-callout-title": title, children, ...props }: Props) {
  const { t } = useTranslation();
  if (!isKind(kind)) return <blockquote {...props}>{children}</blockquote>;
  const Icon = ICONS[kind];
  return (
    <aside className={`callout callout-${kind}`} role="note">
      <p className="callout-title">
        <Icon size={16} strokeWidth={2} aria-hidden="true" />
        {title ?? t(`markdown.callouts.${kind}`)}
      </p>
      {children}
    </aside>
  );
}
