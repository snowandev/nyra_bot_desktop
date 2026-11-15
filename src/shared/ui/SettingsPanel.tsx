import type { ReactNode } from "react";

type Props = {
  title: ReactNode;
  description: ReactNode;
  // Read by screen readers as the panel's name; defaults to the title when that is plain text
  label?: string;
  // Next to the title, e.g. a pill with a count or a provider's badge
  badge?: ReactNode;
  // Right side of the header, e.g. a connection status
  aside?: ReactNode;
  children: ReactNode;
};

export function SettingsPanel({ title, description, label, badge, aside, children }: Props) {
  return (
    <section aria-label={label ?? (typeof title === "string" ? title : undefined)} className="settings-panel">
      <div className="settings-panel-header">
        <div className="settings-panel-title">
          <div className="settings-panel-name">
            <h3>{title}</h3>
            {badge}
          </div>
          <p>{description}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
