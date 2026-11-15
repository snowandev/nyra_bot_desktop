import { useCallback, useState } from "react";
import { loadProjectPanelOpen, saveProjectPanelOpen } from "@/shared/storage/settings";
import type { PanelTab } from "./ProjectPanel";
import { useWindowWidth } from "./useWindowWidth";

// How the Código space shares the window between the sidebar, the chat, a review and the project panel. The chat
// comes first, then the review, the panel and the sidebar: the sidebar is the first to fold into icons.
export function useCodeLayout(isReviewing: boolean) {
  const width = useWindowWidth();
  const [isPanelOpen, setIsPanelOpen] = useState(loadProjectPanelOpen);
  const [tab, setTab] = useState<PanelTab>("files");
  // Opened by hand while a review needs the room: it stays open until that review closes
  const [openDuringReview, setOpenDuringReview] = useState(false);

  // A new review takes the room again
  const onReviewChange = useCallback((open: boolean) => {
    if (!open) setOpenDuringReview(false);
  }, []);

  const isNarrow = width === "narrow";
  const reviewTakesPanel = isReviewing && width !== "extraWide" && !openDuringReview;
  const panelMode = !isPanelOpen || reviewTakesPanel ? "folded" : isNarrow ? "covering" : "open";

  function setOpen(open: boolean) {
    setIsPanelOpen(open);
    saveProjectPanelOpen(open);
    if (!open) setOpenDuringReview(false);
  }

  return {
    width,
    isNarrow,
    // Otherwise the user's choice, as in Chat: only a narrow window, or a review where it wouldn't fit beside it, keeps
    // the sidebar in icons
    sidebarFolded: isNarrow || (isReviewing && width !== "extraWide"),
    panelMode: panelMode as "open" | "folded" | "covering",
    tab,
    setTab,
    // Opening it during a review keeps it open until that review closes, as from its icons
    togglePanel: () => {
      if (panelMode !== "folded") return setOpen(false);
      setOpen(true);
      if (isReviewing) setOpenDuringReview(true);
    },
    closePanel: () => setOpen(false),
    // An icon of the folded panel opens it at that tab
    openPanelAt: (next: PanelTab) => {
      setTab(next);
      setOpen(true);
      if (isReviewing) setOpenDuringReview(true);
    },
    onReviewChange,
  };
}
