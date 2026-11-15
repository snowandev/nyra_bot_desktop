import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  title: string;
  children?: ReactNode;
};

export function ErrorNotice({ title, children }: Props) {
  return (
    <div role="alert" className="notice error">
      <CircleAlert size={20} strokeWidth={2} />
      <div className="notice-text">
        <span className="notice-title">{title}</span>
        {children}
      </div>
    </div>
  );
}
