import type { Attachment, Message } from "@/shared/types";

// What a tool gives back to the model: the app's turn, with the pictures it took
export const toolTurn = (content: string, attachments?: Attachment[]): Message => ({
  role: "user",
  content,
  ...(attachments && { attachments }),
});
