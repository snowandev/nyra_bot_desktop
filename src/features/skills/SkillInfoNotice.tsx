import type { ReactNode } from "react";

type Props = {
  icon: ReactNode;
  children: ReactNode;
};

// Informative blue: it describes a limitation, nothing the user has to act on
export function SkillInfoNotice({ icon, children }: Props) {
  return (
    <div className="skill-info-notice">
      {icon}
      <span>{children}</span>
    </div>
  );
}
