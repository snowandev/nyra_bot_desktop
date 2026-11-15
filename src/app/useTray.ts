import { useEffect } from "react";
import { notifyKeptInTray } from "@/shared/lib/notifications";
import { trayLabel } from "@/shared/lib/platform";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { onKeptInTray, onNewFromTray, onOpenFromTray, setKeepInTray } from "./tray";
import { loadTrayNoticeShown, saveTrayNoticeShown } from "@/shared/storage/settings";

type MenuActions = {
  onNewConversation: () => void;
  onOpenConversation: (id: string) => void;
};

// Keeps Rust in step with Settings → General → Notificaciones, says where Nyra went the first time closing hides it, and
// does what the icon's menu asks: a new conversation, or one of the recent ones
export function useTray(keepInTray: boolean, actions: MenuActions) {
  const newConversation = useStableCallback(actions.onNewConversation);
  const openConversation = useStableCallback(actions.onOpenConversation);
  useEffect(() => {
    // Without Rust (tests) there is no tray to tell; the setting stays as chosen for the next start
    setKeepInTray(keepInTray).catch(() => {});
  }, [keepInTray]);

  useEffect(() => {
    const stop = onKeptInTray(() => {
      if (loadTrayNoticeShown()) return;
      saveTrayNoticeShown();
      // A notice that can't be shown (no permission) isn't worth an error: the icon is there
      notifyKeptInTray(trayLabel()).catch(() => {});
    });
    return () => {
      // If listening never started (no window, as in tests), there is nothing to stop
      void stop.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const stops = [onNewFromTray(newConversation), onOpenFromTray(openConversation)];
    return () => stops.forEach((stop) => void stop.then((unlisten) => unlisten()).catch(() => {}));
  }, [newConversation, openConversation]);
}
