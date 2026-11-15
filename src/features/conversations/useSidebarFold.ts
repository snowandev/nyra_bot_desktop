import { useState } from "react";
import { flushSync } from "react-dom";
import { useShortcut } from "@/shared/hooks/useShortcut";
import { platformName } from "@/shared/lib/platform";
import { type Shortcut, SHORTCUTS } from "@/shared/lib/shortcuts";
import { whenRendered } from "@/shared/lib/whenRendered";
import { loadSidebarFolded, saveSidebarFolded } from "@/shared/storage/settings";

// The shortcut again, once the list that listens for it is drawn
function pressAgain({ key, withShift = false }: Shortcut) {
  whenRendered(
    () => document.querySelector(".sidebar"),
    () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          shiftKey: withShift,
          metaKey: platformName === "mac",
          ctrlKey: platformName !== "mac",
          bubbles: true,
        }),
      ),
  );
}

// From a button the focus would be lost with it: it goes to the button that does the opposite
const focusOn = (selector: string) =>
  whenRendered(
    () => document.querySelector<HTMLElement>(selector),
    (button) => button.focus(),
  );

// The sidebar folded into icons by the user, for more room: the same in Chat and Código, and kept that way when Nyra
// opens again. enabled: while Settings don't cover it and the window has room for the whole sidebar.
// moveToo: the list shown also answers "Mover a…".
export function useSidebarFold(enabled: boolean, moveToo: boolean) {
  const [isFolded, setIsFolded] = useState(loadSidebarFolded);

  function setFolded(folded: boolean) {
    setIsFolded(folded);
    saveSidebarFolded(folded);
  }

  useShortcut(SHORTCUTS.sidebar, () => setFolded(!isFolded), { enabled });
  // Folded, the list's own shortcuts, which need it on screen, bring it back and then do what they do there
  const unfoldFor = (shortcut: Shortcut) => () => {
    flushSync(() => setFolded(false));
    pressAgain(shortcut);
  };
  useShortcut(SHORTCUTS.searchAll, unfoldFor(SHORTCUTS.searchAll), { enabled: enabled && isFolded });
  useShortcut(SHORTCUTS.moveConversation, unfoldFor(SHORTCUTS.moveConversation), {
    enabled: enabled && isFolded && moveToo,
  });

  return {
    isFolded,
    fold: () => {
      setFolded(true);
      focusOn(".sidebar-unfold");
    },
    unfold: () => {
      setFolded(false);
      focusOn(".sidebar-fold");
    },
  };
}

export type SidebarFold = ReturnType<typeof useSidebarFold>;
