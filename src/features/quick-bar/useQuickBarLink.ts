import { useEffect } from "react";
import { onQuickContinue, onQuickSaved } from "./quickWindow";
import { useStableCallback } from "@/shared/hooks/useStableCallback";

type Options = {
  // Reads these conversations again from disk (the bar wrote them)
  refreshConversations: (changedIds: string[]) => Promise<void>;
  openConversation: (id: string | null) => void;
  // Brings the chat forward if Settings covered it
  onShowChat: () => void;
};

// The main window's side of the quick chat bar: its conversations show up in the list at once, and "Continuar en
// Nyra" opens the one the bar was on
export function useQuickBarLink({ refreshConversations, openConversation, onShowChat }: Options) {
  const onSaved = useStableCallback((id: string) => void refreshConversations([id]));
  const onContinue = useStableCallback(async (id: string) => {
    await refreshConversations([id]);
    openConversation(id);
    onShowChat();
  });

  useEffect(() => {
    const listening = [onQuickSaved(onSaved), onQuickContinue((id) => void onContinue(id))];
    return () => {
      // If listening never started (no window, as in tests), there is nothing to stop
      for (const stop of listening) void stop.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [onSaved, onContinue]);
}
