import { imageInputsOf } from "@/features/attachments/attachments";
import { tagged } from "@/features/chat/reply/replyTags";
import type { Conversation, Message, Model } from "@/shared/types";

// «Automático»: which of the two models answers. The main one does, unless the task needs the one for demanding
// tasks, told by its shape (images, length, a folder) or because the main one asked for it; never by the words
// written, so it works the same in any language.

type RouteReason = "main" | "continues" | "images" | "context" | "folder" | "asked";
type Route = { model: Model; reason: RouteReason; needsConsent: boolean };

type Input = {
  main: Model;
  demanding: Model;
  conversation: Pick<Conversation, "modelChoice" | "isPrivate" | "workspace" | "projectId"> | null;
  // The message about to be answered
  message: Message;
  // What the request with the whole conversation weighs, in tokens
  tokens: number;
  askBeforeCloud: boolean;
  isCloud: (model: Model) => boolean;
  // The main model said the task is beyond it
  asked?: boolean;
};

function reasonFor({ main, demanding, conversation, message, tokens, asked }: Input): RouteReason | null {
  if (asked) return "asked";
  const sendsImages = imageInputsOf(message).length > 0;
  if (sendsImages && main.supportsImages === false && demanding.supportsImages !== false) return "images";
  const roomier = (demanding.contextWindow ?? Infinity) > (main.contextWindow ?? Infinity);
  if (main.contextWindow && tokens > main.contextWindow && roomier) return "context";
  if (conversation?.workspace || conversation?.projectId) return "folder";
  return null;
}

// The conversation would go where it hasn't been: a cloud other than the main model's
const leavesForCloud = (main: Model, target: Model, isCloud: (model: Model) => boolean) =>
  isCloud(target) && !(isCloud(main) && main.providerId === target.providerId);

export function routeReply(input: Input): Route {
  const { main, demanding, conversation, askBeforeCloud, isCloud } = input;
  // Once moved it stays: going back and forth would reload local models and split the conversation in two
  if (conversation?.modelChoice === "demanding") return { model: demanding, reason: "continues", needsConsent: false };
  const reason = reasonFor(input);
  const onMain: Route = { model: main, reason: "main", needsConsent: false };
  if (!reason || conversation?.modelChoice === "main") return onMain;
  const leaves = leavesForCloud(main, demanding, isCloud);
  // A private conversation never goes to a cloud on its own
  if (leaves && conversation?.isPrivate) return onMain;
  return { model: demanding, reason, needsConsent: leaves && askBeforeCloud };
}

// Titles and other work in the background go to the main model, unless that would send the conversation to a cloud
// it wasn't in: then the conversation's own model does it
export function backgroundModel(main: Model | undefined, conversationModel: Model, isCloud: (model: Model) => boolean) {
  return main && !leavesForCloud(conversationModel, main, isCloud) ? main : conversationModel;
}

// What the main model is told when it can hand a task over. The model judges by what is asked, in any language; the
// criteria say when it is worth it and when it isn't.
export const ESCALATE_PROMPT = [
  "A more capable model is available for demanding tasks. Before writing anything else, reply with only " +
    `${tagged("escalate", "one short reason")} when the request clearly needs more than you can do well: a long or ` +
    "tricky piece of code, a careful multi-step analysis or plan, a long document that must be precise, hard math or " +
    "logic, or work on many files. The other model then answers instead of you.",
  "Don't use it for conversation, questions you can answer well, short texts, translations, summaries or everyday " +
    "help. When in doubt, answer yourself. Never mention this to the user.",
].join(" ");
