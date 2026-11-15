import { CircleAlert, RotateCcw } from "lucide-react";
import { Component, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { retryFailedLoads } from "@/shared/lib/loadOnDemand";

// A way out when the part covers the window and its own close button is what didn't load
type Leave = { label: string; onLeave: () => void };

type Props = {
  children: ReactNode;
  leave?: Leave;
};

type State = { failed: boolean };

function LoadFailed({ onRetry, leave }: { onRetry: () => void; leave?: Leave }) {
  const { t } = useTranslation();
  return (
    <div className="load-failed" role="alert">
      <CircleAlert size={18} strokeWidth={2} aria-hidden="true" />
      <span className="load-failed-text">{t("ui.loadFailed")}</span>
      {leave && (
        <button type="button" className="ghost-button" onClick={leave.onLeave}>
          {leave.label}
        </button>
      )}
      <button type="button" className="primary-button" onClick={onRetry}>
        <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
        {t("common.retry")}
      </button>
    </div>
  );
}

// Around a part that loads on demand: if it can't load, a notice with "Retry" takes its place instead of the whole
// app failing. Only a class can catch a render error in React.
export class LoadErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      const retry = () => {
        retryFailedLoads();
        this.setState({ failed: false });
      };
      return <LoadFailed onRetry={retry} leave={this.props.leave} />;
    }
    return this.props.children;
  }
}
