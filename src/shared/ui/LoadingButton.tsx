import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

// Takes the place of an action button while that action runs, so it can't be started twice
export function LoadingButton({ children }: Props) {
  return (
    <button type="button" className="loading-button" disabled aria-busy="true">
      <LoaderCircle size={17} strokeWidth={2.4} className="spin info" />
      {children}
    </button>
  );
}
