import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  icon: LucideIcon;
  kind: "chat" | "embedding";
  title: string;
  children: ReactNode;
  action: ReactNode;
};

// A group with no models stays in place and says what is missing, instead of disappearing
export function ModelGroupEmpty({ icon: Icon, kind, title, children, action }: Props) {
  return (
    <div className={`model-group-empty ${kind}`}>
      <span className="model-group-empty-icon" aria-hidden="true">
        <Icon size={20} strokeWidth={2} />
      </span>
      <div className="model-group-empty-text">
        <strong>{title}</strong>
        <p>{children}</p>
        <div className="model-group-empty-actions">{action}</div>
      </div>
    </div>
  );
}
