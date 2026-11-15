import type { Message } from "@/shared/types";

// A reply shows these cards even without text: what it ran, did in the browser or on the screen, used of a connected
// service or transcribed. Such a reply isn't empty: it's shown while waiting for its text, and stays if it ends
// without any.
export const hasReplyCards = (message: Message) =>
  !!(
    message.commands?.length ||
    message.browser?.steps.length ||
    message.toolCalls?.length ||
    message.transcripts?.length ||
    message.screen?.steps.length
  );
