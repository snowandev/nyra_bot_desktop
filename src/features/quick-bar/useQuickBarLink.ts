import { onQuickContinue, onQuickSaved } from "./quickWindow";
import { useAppEvent } from "@/shared/hooks/useAppEvent";
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

  useAppEvent(onQuickSaved, onSaved);
  useAppEvent(onQuickContinue, (id) => void onContinue(id));
}
