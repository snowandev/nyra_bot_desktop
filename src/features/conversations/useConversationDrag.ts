import { type DragEvent, useState } from "react";
import { CONVERSATION_DRAG_TYPE } from "./folders";

// A drop zone is a folder id or this, the general list
export const GENERAL_LIST = "chats";

type Options = {
  // Where a conversation is now; dropping it there again does nothing
  zoneOf: (conversationId: string) => string;
  onDrop: (conversationId: string, zone: string) => void;
};

// Dragging conversations between folders and the general list. Optional: "Mover a…" does the same.
// Folders don't open while dragging: their conversations would shift the list under the pointer
export function useConversationDrag({ zoneOf, onDrop }: Options) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);

  function end() {
    setDragging(null);
    setTarget(null);
  }

  // Files dragged in from the system don't count; they belong to the chat's drop zone
  const isOurs = (e: DragEvent) => !!dragging && e.dataTransfer.types.includes(CONVERSATION_DRAG_TYPE);

  function zone(zoneId: string) {
    return {
      onDragOver(e: DragEvent<HTMLDivElement>) {
        if (!isOurs(e) || !dragging || zoneOf(dragging) === zoneId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (target !== zoneId) setTarget(zoneId);
      },
      onDragLeave(e: DragEvent<HTMLDivElement>) {
        // Moving onto a child also fires dragleave; only leaving the zone itself counts
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        if (target === zoneId) setTarget(null);
      },
      onDrop(e: DragEvent<HTMLDivElement>) {
        if (!isOurs(e) || !dragging) return;
        e.preventDefault();
        onDrop(dragging, zoneId);
        end();
      },
    };
  }

  return { dragging, target, start: setDragging, end, zone };
}
