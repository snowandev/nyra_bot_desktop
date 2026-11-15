import type { Folder } from "./folderStorage";
import { i18n } from "@/shared/i18n/i18n";
import { foldForSearch } from "@/shared/lib/search";

export const FOLDER_NAME_MAX = 40;

// Recognizes a conversation being dragged, as opposed to files dragged in from the system
export const CONVERSATION_DRAG_TYPE = "application/x-nyra-conversation";
// The counter shows up near the limit, not while there is plenty of room
export const FOLDER_COUNTER_FROM = 30;

// Alphabetical: predictable, and no positions to manage
export const sortFolders = (folders: Folder[]) => [...folders].sort((a, b) => a.name.localeCompare(b.name, "es"));

// "Empty" is only reported once the user tries to save, so an empty new field doesn't start in red.
// Names are compared like the app's searches: "trabajo" clashes with "Trabajo", "Diseno" with "Diseño".
export function folderNameError(name: string, folders: Folder[], exceptId: string | null, hasTriedToSave: boolean) {
  const trimmed = name.trim();
  if (!trimmed) return hasTriedToSave ? i18n.t("conversations.folder.nameRequired") : null;
  const length = Array.from(trimmed).length;
  if (length > FOLDER_NAME_MAX) {
    return i18n.t("conversations.folder.nameTooLong", { max: FOLDER_NAME_MAX, extra: length - FOLDER_NAME_MAX });
  }
  const folded = foldForSearch(trimmed);
  if (folders.some((f) => f.id !== exceptId && foldForSearch(f.name) === folded)) {
    return i18n.t("conversations.folder.nameTaken", { name: trimmed });
  }
  return null;
}
