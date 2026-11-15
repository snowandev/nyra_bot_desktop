import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openBrowser, useBrowserView } from "./browserSession";

type Props = {
  conversationId: string;
};

// Next to the composer: opens the conversation's browser, or brings its window to the front, so the user can ask Nyra
// about the page at any time. Accented while the conversation has one.
export function BrowserButton({ conversationId }: Props) {
  const { t } = useTranslation();
  const isOpen = !!useBrowserView(conversationId);
  return (
    <button
      type="button"
      className={`icon-button soft browser-button ${isOpen ? "open" : ""}`}
      aria-label={t(isOpen ? "browser.button.show" : "browser.button.open")}
      title={t(isOpen ? "browser.button.showTitle" : "browser.button.openTitle")}
      onClick={() => void openBrowser(conversationId)}
    >
      <Globe size={19} strokeWidth={1.9} />
    </button>
  );
}
