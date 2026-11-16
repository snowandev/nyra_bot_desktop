import { useEffect } from "react";
import { notifyKeptInTray } from "@/shared/lib/notifications";
import { trayLabel } from "@/shared/lib/platform";
import { useAppEvent } from "@/shared/hooks/useAppEvent";
import { onKeptInTray, onNewFromTray, onOpenFromTray, setKeepInTray } from "./tray";
import { loadTrayNoticeShown, saveTrayNoticeShown } from "@/shared/storage/settings";

type MenuActions = {
  onNewConversation: () => void;
  onOpenConversation: (id: string) => void;
};

// Keeps Rust in step with Settings → General → Notificaciones, says where Nyra went the first time closing hides it, and
// does what the icon's menu asks: a new conversation, or one of the recent ones
export function useTray(keepInTray: boolean, actions: MenuActions) {
  useEffect(() => {
    // Without Rust (tests) there is no tray to tell; the setting stays as chosen for the next start
    setKeepInTray(keepInTray).catch(() => {});
  }, [keepInTray]);

  useAppEvent(onKeptInTray, () => {
    if (loadTrayNoticeShown()) return;
    saveTrayNoticeShown();
    // A notice that can't be shown (no permission) isn't worth an error: the icon is there
    notifyKeptInTray(trayLabel()).catch(() => {});
  });
  useAppEvent(onNewFromTray, actions.onNewConversation);
  useAppEvent(onOpenFromTray, actions.onOpenConversation);
}
